import { spawn } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { createInterface } from "node:readline";
import { AgentProviderAdapter, RunSink, checkEnv, childEnv, execCapture, findExe, killTree, trunc } from "./common.js";
import type { ModelInfo, ExecEvent, ProviderStatus, QuotaStatus, QuotaWindow, RunHandle, RunRequest, UsageReport } from "../types.js";

/** Convertit un événement stream-json de Claude Code en ExecEvent[] (pur, testable). */
export function parseClaudeLine(j: any, executionId: string, state: { model?: string; sawResult?: boolean }): ExecEvent[] {
  const out: ExecEvent[] = [];
  switch (j.type) {
    case "system":
      if (j.subtype === "init") { state.model = j.model; out.push({ type: "session", providerSessionId: j.session_id }); out.push({ type: "status", detail: `init ${j.model} (apiKeySource=${j.apiKeySource})` }); }
      break;
    case "stream_event": {
      const d = j.event?.delta;
      if (j.event?.type === "content_block_delta" && d?.type === "text_delta" && !j.parent_tool_use_id) out.push({ type: "text", text: d.text });
      break;
    }
    case "assistant":
      for (const b of j.message?.content ?? []) if (b.type === "tool_use") out.push({ type: "tool", id: b.id, name: b.name, summary: trunc(JSON.stringify(b.input ?? {})), state: "started" });
      break;
    case "user":
      for (const b of j.message?.content ?? []) if (b?.type === "tool_result") out.push({ type: "tool", id: b.tool_use_id, name: "", summary: "", state: b.is_error ? "failed" : "completed" });
      break;
    case "rate_limit_event": {
      const w = j.rate_limit_info?.unifiedWindows ?? {}; const windows: QuotaWindow[] = [];
      const lbl: Record<string, [string, number]> = { five_hour: ["Fenêtre 5 h", 300], seven_day: ["Fenêtre 7 jours", 10080] };
      for (const [k, v] of Object.entries<any>(w)) windows.push({ label: lbl[k]?.[0] ?? k, windowMinutes: lbl[k]?.[1], usedPercent: typeof v.utilization === "number" ? Math.round(v.utilization * 1000) / 10 : null, resetsAt: v.resetsAt ? new Date(v.resetsAt * 1000).toISOString() : undefined, status: v.status });
      const st = j.rate_limit_info?.status;
      out.push({ type: "quota", quota: { provider: "claude", state: st === "allowed" ? "available" : st === "rejected" ? "exhausted" : "limited", windows, checkedAt: new Date().toISOString() } });
      break;
    }
    case "result": {
      state.sawResult = true;
      const mu = j.modelUsage ?? {};
      for (const [model, m] of Object.entries<any>(mu)) {
        const input = m.inputTokens ?? 0, output = m.outputTokens ?? 0, cr = m.cacheReadInputTokens ?? 0, cw = m.cacheCreationInputTokens ?? 0;
        const rep: UsageReport = { model, mode: "final", counterKey: `claude-exec:${executionId}:${model}`, eventKey: "final", confidence: "reported", providerCostUsd: m.costUSD,
          tokens: { input, output, cacheRead: cr, cacheWrite: cw, cacheWrite1h: m.cacheCreationEphemeral1hInputTokens ?? 0, reasoning: m.thinkingTokens ?? 0, total: input + output + cr + cw } };
        out.push({ type: "usage", report: rep });
      }
      if (!Object.keys(mu).length && j.usage) {
        const u = j.usage; const input = u.input_tokens ?? 0, output = u.output_tokens ?? 0, cr = u.cache_read_input_tokens ?? 0, cw = u.cache_creation_input_tokens ?? 0;
        out.push({ type: "usage", report: { model: state.model ?? "unknown", mode: "final", counterKey: `claude-exec:${executionId}:${state.model}`, eventKey: "final", confidence: "reported", providerCostUsd: j.total_cost_usd, tokens: { input, output, cacheRead: cr, cacheWrite: cw, reasoning: 0, total: input + output + cr + cw } } });
      }
      const text = typeof j.result === "string" ? j.result : "";
      if (j.is_error) {
        const msg = text || j.subtype || "erreur";
        out.push({ type: "error", message: msg, quota: /limit|quota|usage/i.test(msg), auth: /login|auth|credential/i.test(msg) });
        out.push({ type: "done", ok: false, message: msg });
      } else { out.push({ type: "text", text, final: true }); out.push({ type: "done", ok: true, message: text }); }
      break;
    }
  }
  return out;
}

export class ClaudeAdapter implements AgentProviderAdapter {
  readonly id = "claude" as const;
  private exe?: string;
  constructor(private override?: string) {}
  async detectInstallation(override?: string) { this.exe = findExe("claude", override ?? this.override); return { installed: !!this.exe, path: this.exe }; }
  async getVersion() { if (!this.exe) await this.detectInstallation(); if (!this.exe) return undefined; const r = execCapture(this.exe, ["--version"]); return r.ok ? r.out.split(/\s+/)[0] : undefined; }
  async getAuthStatus(): Promise<ProviderStatus> {
    const base: ProviderStatus = { provider: "claude", installed: false, authenticated: false, authMode: "unavailable", warnings: [], checkedAt: new Date().toISOString() };
    const d = await this.detectInstallation(); if (!d.installed) return base;
    base.installed = true; base.path = d.path; base.version = await this.getVersion();
    const env = checkEnv("claude"); if (!env.ok) base.warnings.push(`Variables API détectées (${env.flagged.join(", ")}) : ignorées en mode abonnement exclusif.`);
    const r = execCapture(d.path!, ["auth", "status"], 20000);
    try {
      const j = JSON.parse(r.out); base.authenticated = !!j.loggedIn; base.account = j.email; base.plan = j.subscriptionType;
      base.authMode = !j.loggedIn ? "unavailable" : j.authMethod === "claude.ai" ? "subscription" : j.authMethod ? "api_key" : "unknown";
      if (j.loggedIn && base.authMode !== "subscription") base.blockedReason = `Mode d'authentification « ${j.authMethod} » : non vérifié comme abonnement.`;
    } catch { base.authMode = "unknown"; base.blockedReason = "Statut d'authentification illisible (claude auth status)."; }
    return base;
  }
  /** Le CLI n'expose pas de liste de modèles du compte : on lit les alias et niveaux d'effort déclarés dans `claude --help`. */
  async getSupportedModels(): Promise<ModelInfo[]> {
    if (!this.exe) await this.detectInstallation(); if (!this.exe) return [];
    const h = parseClaudeHelp(execCapture(this.exe, ["--help"], 20000).out); const efforts = h.efforts.map((value) => ({ value }));
    return [{ id: "", displayName: "Défaut du CLI", isDefault: true, source: "cli-alias", efforts: efforts.length ? efforts : undefined, description: "Le CLI choisit le modèle recommandé pour votre abonnement." }, ...h.aliases.map((a) => ({ id: a, displayName: a.charAt(0).toUpperCase() + a.slice(1), source: "cli-alias" as const, efforts: efforts.length ? efforts : undefined, description: "Alias du dernier modèle de cette famille (résolu par Claude Code)." }))];
  }
  getCapabilities() { return { streaming: "supported", resume: "supported", usageTokens: "supported", usageCostReported: "supported", quotaWindows: "supported", subAgentUsage: "unsupported", interactiveTerminal: "supported", approvalsInStructuredMode: "unsupported" } as const; }
  async getQuotaStatus(): Promise<QuotaStatus> { return { provider: "claude", state: "unknown", windows: [], note: "Quota exact non disponible via l'interface utilisée : il est reçu pendant les exécutions (rate_limit_event).", checkedAt: new Date().toISOString() }; }
  startSession(req: RunRequest, sink: RunSink, opts: { exclusive: boolean }): RunHandle {
    const exe = this.exe ?? findExe("claude", this.override);
    if (!exe) throw new Error("Claude Code introuvable");
    const args = buildClaudeArgs(req);
    const child = spawn(exe, args, { cwd: req.cwd, env: childEnv("claude", opts.exclusive), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    sink.setPid(child.pid);
    child.stdin.end(req.images?.length ? JSON.stringify(claudeUserMessage(req)) + String.fromCharCode(10) : req.prompt);
    const state: { model?: string; sawResult?: boolean } = {}; let cancelled = false; let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    createInterface({ input: child.stdout }).on("line", (l) => { if (!l.trim()) return; try { const j = JSON.parse(l); if (j.type === "system" && j.subtype === "init") sink.event({ type: "applied", model: j.model, effort: req.effort ?? null, effortSource: req.effort ? "requested" : "provider_default" }); for (const e of parseClaudeLine(j, req.executionId, state)) sink.event(e); } catch { /* ligne non JSON ignorée */ } });
    const done = new Promise<void>((resolve) => {
      child.on("close", () => { if (req.mcp?.length) rmSync(join(tmpdir(), `acc-mcp-${req.executionId}.json`), { force: true }); });
      child.on("error", (e) => { sink.event({ type: "error", message: e.message }); sink.event({ type: "done", ok: false, message: e.message }); resolve(); });
      child.on("close", (code) => {
        if (!state.sawResult) { const m = cancelled ? "Annulé" : `Processus terminé sans résultat (code ${code}). ${trunc(stderr, 300)}`; sink.event({ type: "done", ok: false, message: m }); }
        resolve();
      });
    });
    return { done, cancel: async () => { cancelled = true; killTree(child); } };
  }
  resumeSession(req: RunRequest & { resumeSessionId: string }, sink: RunSink, opts: { exclusive: boolean }) { return this.startSession(req, sink, opts); }
  async cancelExecution(h: RunHandle) { await h.cancel(); }
  async dispose() {}
}

/** Extrait alias de modèles et niveaux d'effort de la sortie de `claude --help` (pur, testable). */
export function parseClaudeHelp(help: string): { aliases: string[]; efforts: string[] } {
  const flat = help.replace(/\s+/g, " ");
  const m = /--model <model>.*?\(e\.g\.\s*([^)]*)\)/.exec(flat); const aliases = m ? [...m[1]!.matchAll(/'([a-z0-9-]+)'/gi)].map((x) => x[1]!) : [];
  const e = /--effort <level>[^(]*\(([^)]*)\)/.exec(flat); const efforts = e ? e[1]!.split(",").map((x) => x.trim()).filter((x) => /^[a-z]+$/.test(x)) : [];
  return { aliases, efforts };
}

/** Arguments du CLI Claude Code pour une exécution, selon la politique du mode (pur, testable). */
export function buildClaudeArgs(req: RunRequest): string[] {
  const pol = req.policy ?? "code";
  const pm = pol === "chat" ? "default" : req.permission === "read-only" ? "plan" : "acceptEdits";
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--permission-mode", pm];
  if (req.images?.length) args.push("--input-format", "stream-json"); // images : entrée structurée officielle
  const allowed: string[] = [];
  if (req.mcp?.length) { args.push("--mcp-config", mcpConfigPath(req)); allowed.push(...req.mcp.map((m) => `mcp__${m.name}`)); } // extensions MCP activées explicitement par l'utilisateur
  const web = pol === "chat" && !!req.web; if (web) allowed.push("WebSearch", "WebFetch"); // recherche web activée pour cette conversation de Chat
  if (allowed.length) args.push("--allowedTools", ...allowed);
  // Chat : aucun outil intégré, aucun serveur MCP, aucune skill, et seuls les réglages du dossier isolé sont lus
  // (ni hooks ni mémoire utilisateur) — options officielles du CLI, sans toucher à l'authentification par abonnement.
  if (pol !== "chat") args.push("--disallowedTools", "AskUserQuestion"); // outil interactif impossible en mode non interactif : le modèle utilise les blocs ```choices/quiz à la place
  if (pol === "chat") args.push("--tools", web ? "WebSearch,WebFetch" : "", "--setting-sources", "project", "--strict-mcp-config", "--disable-slash-commands");
  if (req.effort) args.push("--effort", req.effort);
  if (req.model) args.push("--model", req.model);
  if (req.resumeSessionId) args.push("--resume", req.resumeSessionId);
  if (req.instructions) args.push("--append-system-prompt", req.instructions);
  return args;
}

/** Message utilisateur au format stream-json de Claude Code (texte + images base64). */
export function claudeUserMessage(req: RunRequest) {
  return { type: "user", message: { role: "user", content: [{ type: "text", text: req.prompt }, ...(req.images ?? []).map((i) => ({ type: "image", source: { type: "base64", media_type: i.mime, data: i.data } }))] } };
}

/** Écrit la configuration MCP temporaire (supprimée en fin d'exécution) au format attendu par `claude --mcp-config`. */
export function mcpConfigObject(req: RunRequest) {
  const mcpServers: Record<string, any> = {}; for (const m of req.mcp ?? []) mcpServers[m.name] = m.transport === "http" ? { type: "http", url: m.url, headers: m.headers ?? {} } : { type: "stdio", command: m.command, args: m.args ?? [], env: m.env ?? {} };
  return { mcpServers };
}
export function mcpConfigPath(req: RunRequest): string { const f = join(tmpdir(), `acc-mcp-${req.executionId}.json`); writeFileSync(f, JSON.stringify(mcpConfigObject(req)), { mode: 0o600 }); return f; }
