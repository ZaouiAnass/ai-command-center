import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { DB } from "../db.js";
import { getSetting, setSetting } from "../settings.js";
import type { AgentProviderAdapter, RunSink } from "./common.js";
import { trunc } from "./common.js";
import type { ModelInfo, ProviderStatus, QuotaStatus, RunHandle, RunRequest, UsageReport } from "../types.js";

/**
 * Fournisseur « Modèles open source » : toute API compatible OpenAI (`/v1/models`, `/v1/chat/completions` en streaming SSE).
 * Local (Ollama, LM Studio, llama.cpp, vLLM sur cet ordinateur ou le réseau local) = gratuit.
 * Hébergé (OpenRouter, Groq, Together…) = facturé à l'usage par ce fournisseur : refusé tant que l'utilisateur ne l'a pas autorisé explicitement.
 * Pas de CLI : l'historique des sessions est conservé localement, et un petit jeu d'outils fichiers (bornés au dossier de travail) est fourni en Work et Code.
 */

export interface OpenEndpoint { id: string; name: string; baseUrl: string; models?: string[] }
export interface OpenEndpointView extends OpenEndpoint { local: boolean; hasKey: boolean }
/** Stockage des clés API, hors de la base (non incluses dans les sauvegardes, jamais renvoyées à l'interface). */
export interface SecretStore { get(key: string): string | undefined; set(key: string, value: string | undefined): void }

export class FileSecretStore implements SecretStore {
  constructor(private file: string, private codec: { enc(s: string): string; dec(s: string): string } = { enc: (s) => s, dec: (s) => s }) {}
  private read(): Record<string, string> { try { return JSON.parse(readFileSync(this.file, "utf8")); } catch { return {}; } }
  get(key: string) { const v = this.read()[key]; if (!v) return undefined; try { return this.codec.dec(v); } catch { return undefined; } }
  set(key: string, value: string | undefined) { const all = this.read(); if (value) all[key] = this.codec.enc(value); else delete all[key]; mkdirSync(dirname(this.file), { recursive: true }); writeFileSync(this.file, JSON.stringify(all), { mode: 0o600 }); }
}

/** Serveur sur cette machine ou le réseau local : aucune facturation. */
export function isLocalUrl(u: string): boolean {
  try { const h = new URL(u).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return h === "localhost" || h === "::1" || h.endsWith(".local") || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
  } catch { return false; }
}
/** Modèle Ollama Cloud (`kimi-k2.6:cloud`, `deepseek-v4-flash:cloud`…) : servi par le serveur local mais exécuté sur les serveurs d'Ollama. */
export const isCloudModel = (m: string) => /[:-]cloud$/i.test(m);
/** Retire le raisonnement intégré au texte par certains modèles (`<think>…</think>`, DeepSeek R1 sur d'anciens serveurs). */
export const stripThinking = (s: string) => s.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, "");
/** Identifiant de modèle du catalogue : `<point d'accès>/<modèle>` (le modèle peut lui-même contenir des « / », ex. OpenRouter). */
export function splitModelId(id: string): { endpointId: string; model: string } | undefined { const i = id.indexOf("/"); return i > 0 && i < id.length - 1 ? { endpointId: id.slice(0, i), model: id.slice(i + 1) } : undefined; }

export const PRESETS: { name: string; baseUrl: string; hint: string }[] = [
  { name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", hint: "Local, gratuit (ex. `ollama pull deepseek-r1:8b`). Les modèles « :cloud » (Kimi, grands DeepSeek) passent par Ollama Cloud : `ollama signin` requis." },
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com", hint: "API officielle DeepSeek, hébergée, facturée à l'usage. Clé sur platform.deepseek.com." },
  { name: "Kimi (Moonshot)", baseUrl: "https://api.moonshot.ai/v1", hint: "API officielle Kimi, hébergée, facturée à l'usage. Clé sur platform.kimi.ai (une clé chinoise exige api.moonshot.cn/v1)." },
  { name: "LM Studio", baseUrl: "http://localhost:1234/v1", hint: "Local, gratuit. Démarrez le serveur dans l'onglet Developer de LM Studio." },
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", hint: "Hébergé, facturé à l'usage (DeepSeek, Kimi, Llama, Qwen… sous une seule clé). Clé sur openrouter.ai/keys." },
  { name: "Groq", baseUrl: "https://api.groq.com/openai/v1", hint: "Hébergé, facturé à l'usage. Clé sur console.groq.com." },
  { name: "Together AI", baseUrl: "https://api.together.xyz/v1", hint: "Hébergé, facturé à l'usage. Clé sur api.together.ai." },
];

export class OpenEndpoints {
  constructor(private db: DB, private secrets: SecretStore) {}
  all(): OpenEndpoint[] { return getSetting<OpenEndpoint[]>(this.db, "open.endpoints", []); }
  get(id: string) { return this.all().find((e) => e.id === id); }
  key(id: string) { return this.secrets.get("open.key." + id); }
  view(): OpenEndpointView[] { return this.all().map((e) => ({ ...e, local: isLocalUrl(e.baseUrl), hasKey: !!this.key(e.id) })); }
  /** `apiKey` : undefined = inchangée, "" = supprimée. */
  save(e: { id?: string; name: string; baseUrl: string; apiKey?: string; models?: string[] }): string {
    const name = String(e.name ?? "").trim().slice(0, 40); if (!name) throw new Error("Nom requis.");
    const baseUrl = normalizeBaseUrl(e.baseUrl);
    const list = this.all(); const cur = e.id ? list.find((x) => x.id === e.id) : undefined; if (e.id && !cur) throw new Error("Point d'accès introuvable.");
    const id = cur?.id ?? uniqueSlug(name, list.map((x) => x.id));
    const models = (e.models ?? []).map((m) => String(m).trim()).filter(Boolean).slice(0, 100);
    const next: OpenEndpoint = { id, name, baseUrl, ...(models.length ? { models } : {}) };
    setSetting(this.db, "open.endpoints", cur ? list.map((x) => (x.id === id ? next : x)) : [...list, next]);
    if (e.apiKey !== undefined) this.secrets.set("open.key." + id, String(e.apiKey).trim() || undefined);
    return id;
  }
  remove(id: string) { setSetting(this.db, "open.endpoints", this.all().filter((e) => e.id !== id)); this.secrets.set("open.key." + id, undefined); }
  allowPaid() { return !!getSetting(this.db, "open.allowPaid", false); }
  setAllowPaid(v: boolean) { setSetting(this.db, "open.allowPaid", !!v); }
  defaultModel() { return getSetting<string>(this.db, "open.defaultModel", ""); }
  setDefaultModel(id: string) { setSetting(this.db, "open.defaultModel", String(id ?? "")); }
}
export function normalizeBaseUrl(u: string): string {
  let url: URL; try { url = new URL(String(u ?? "").trim()); } catch { throw new Error("Adresse invalide (exemple : http://localhost:11434/v1)."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("L'adresse doit commencer par http:// ou https://.");
  if (url.protocol === "http:" && !isLocalUrl(url.href)) throw new Error("Un point d'accès hébergé doit utiliser https (la clé API ne doit pas circuler en clair).");
  return url.href.replace(/\/+$/, "");
}
const uniqueSlug = (name: string, taken: string[]) => { const base = name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "api"; let s = base, n = 2; while (taken.includes(s)) s = `${base}-${n++}`; return s; };

// ---------------- Protocole (pur, testable) ----------------

/** Découpe un flux SSE en objets JSON `data:` (ignore `[DONE]` et les commentaires). */
export function createSseParser(onData: (j: any) => void) {
  let buf = "";
  return (chunk: string) => {
    buf += chunk; let i: number;
    while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1); if (!line.startsWith("data:")) continue; const d = line.slice(5).trim(); if (!d || d === "[DONE]") continue; try { onData(JSON.parse(d)); } catch { /* ligne partielle ou non JSON */ } }
  };
}
export interface TurnAcc { text: string; reasoning: string; tools: Map<number, { id: string; name: string; args: string }>; usage?: { prompt: number; completion: number; cached: number; cost?: number; reasoning?: number }; finish?: string; model?: string; error?: string }
export const newAcc = (): TurnAcc => ({ text: "", reasoning: "", tools: new Map() });
// DeepSeek rapporte le cache dans prompt_cache_hit_tokens ; OpenAI/OpenRouter/Kimi dans prompt_tokens_details.cached_tokens (ou cached_tokens).
const usageOf = (u: any) => ({ prompt: u.prompt_tokens ?? 0, completion: u.completion_tokens ?? 0, cached: u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? u.cached_tokens ?? 0, cost: typeof u.cost === "number" ? u.cost : undefined, reasoning: u.completion_tokens_details?.reasoning_tokens });
/** Applique un fragment de flux `chat.completion.chunk` ; renvoie le texte nouveau à afficher. */
export function applyChunk(acc: TurnAcc, j: any): string {
  if (j.error) { acc.error = typeof j.error === "string" ? j.error : j.error.message ?? JSON.stringify(j.error); return ""; }
  if (j.model) acc.model = j.model; if (j.usage) acc.usage = usageOf(j.usage);
  let out = "";
  for (const c of j.choices ?? []) {
    const d = c.delta ?? c.message ?? {};
    if (typeof d.content === "string" && d.content) { acc.text += d.content; out += d.content; }
    const think = d.reasoning_content ?? d.reasoning; if (typeof think === "string" && think) acc.reasoning += think; // modèles « thinking » (DeepSeek, Kimi, R1 via Ollama) : raisonnement séparé, non affiché
    for (const [n, tc] of ((d.tool_calls ?? []) as any[]).entries()) { const k = tc.index ?? n; const cur = acc.tools.get(k) ?? { id: "", name: "", args: "" }; if (tc.id) cur.id = tc.id; if (tc.function?.name) cur.name += tc.function.name; if (tc.function?.arguments) cur.args += typeof tc.function.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function.arguments); acc.tools.set(k, cur); }
    if (c.finish_reason) acc.finish = c.finish_reason;
  }
  return out;
}

// ---------------- Outils fichiers (bornés au dossier de travail) ----------------

const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", ".venv", "venv", "__pycache__", "target", ".cache"]);
export function safePath(root: string, p: string): string {
  const base = resolve(root); const full = resolve(base, String(p || "."));
  const rel = relative(base, full); if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Chemin hors du dossier de travail refusé : ${p}`);
  if (rel.split(/[\\/]/).includes(".git")) throw new Error("Le dossier .git n'est pas accessible.");
  return full;
}
export function toolDefs(write: boolean) {
  const fn = (name: string, description: string, properties: Record<string, any>, required: string[]) => ({ type: "function", function: { name, description, parameters: { type: "object", properties, required } } });
  const path = { type: "string", description: "Chemin relatif au dossier de travail ('.' pour la racine)" };
  return [fn("list_files", "Liste les fichiers et sous-dossiers (3 niveaux, dossiers de dépendances ignorés).", { path }, []),
    fn("read_file", "Lit un fichier texte (60 000 caractères maximum).", { path }, ["path"]),
    ...(write ? [fn("write_file", "Crée ou remplace un fichier texte avec le contenu complet donné.", { path, content: { type: "string", description: "Contenu complet du fichier" } }, ["path", "content"])] : [])];
}
export function runTool(root: string, name: string, rawArgs: string, write: boolean): { output: string; changed?: string } {
  let a: any; try { a = rawArgs ? JSON.parse(rawArgs) : {}; } catch { throw new Error("Arguments JSON invalides."); }
  if (name === "list_files") {
    const start = safePath(root, a.path ?? "."); const out: string[] = []; const baseRel = relative(resolve(root), start);
    const walk = (d: string, depth: number) => { if (out.length >= 400) return; let ents: string[] = []; try { ents = readdirSync(d).sort(); } catch { return; }
      for (const n of ents) { if (out.length >= 400) { out.push("… (liste tronquée)"); return; } const f = join(d, n); let dir = false; try { dir = statSync(f).isDirectory(); } catch { continue; }
        const rel = relative(resolve(root), f).split("\\").join("/"); if (dir) { out.push(rel + "/"); if (!SKIP.has(n) && depth < 3) walk(f, depth + 1); } else out.push(rel); } };
    walk(start, 1); return { output: out.length ? out.join("\n") : `(dossier vide : ${baseRel || "."})` };
  }
  if (name === "read_file") { const f = safePath(root, a.path); if (!existsSync(f)) throw new Error(`Fichier introuvable : ${a.path}`); const s = readFileSync(f, "utf8"); if (s.includes("\u0000")) throw new Error("Fichier binaire : lecture refusée."); return { output: s.length > 60_000 ? s.slice(0, 60_000) + "\n… (tronqué)" : s }; }
  if (name === "write_file") { if (!write) throw new Error("Écriture non autorisée (lecture seule)."); if (typeof a.content !== "string") throw new Error("Paramètre « content » manquant."); const f = safePath(root, a.path); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, a.content, "utf8"); return { output: `Écrit : ${a.path} (${a.content.length} caractères)`, changed: relative(resolve(root), f).split("\\").join("/") }; }
  throw new Error(`Outil inconnu : ${name}`);
}
const toolGuide = (write: boolean) => `Outils disponibles : list_files et read_file${write ? " et write_file" : ""}, limités au dossier de travail. Utilise-les pour lire${write ? " et écrire" : ""} les fichiers au lieu de supposer leur contenu. Aucune commande système n'est disponible.`;

// ---------------- Historique local des sessions ----------------

class Sessions {
  constructor(private dir: string) {}
  private file(id: string) { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("session invalide"); return join(this.dir, id + ".json"); }
  exists(id: string) { try { return existsSync(this.file(id)); } catch { return false; } }
  load(id: string): any[] { try { return JSON.parse(readFileSync(this.file(id), "utf8")); } catch { return []; } }
  save(id: string, msgs: any[]) {
    let keep = msgs.slice(-40); while (keep.length && keep[0].role !== "user") keep = keep.slice(1); // jamais de résultat d'outil orphelin en tête
    mkdirSync(this.dir, { recursive: true }); writeFileSync(this.file(id), JSON.stringify(keep));
  }
}

const MAX_ROUNDS = 16;
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export class OpenAdapter implements AgentProviderAdapter {
  readonly id = "open" as const;
  private sessions: Sessions;
  constructor(private endpoints: OpenEndpoints, dataDir: string, private fetchImpl: typeof fetch = fetch) { this.sessions = new Sessions(join(dataDir, "open-sessions")); }

  private headers(ep: OpenEndpoint): Record<string, string> { const k = this.endpoints.key(ep.id); return { "content-type": "application/json", ...(k ? { authorization: `Bearer ${k}` } : {}), ...(/openrouter\.ai/.test(ep.baseUrl) ? { "X-Title": "AI Command Center" } : {}) }; }
  private async get(ep: OpenEndpoint, path: string, ms = 4000) { return this.fetchImpl(ep.baseUrl + path, { headers: this.headers(ep), signal: AbortSignal.timeout(ms) }); }
  usable(ep: OpenEndpoint) { return isLocalUrl(ep.baseUrl) || this.endpoints.allowPaid(); }

  /** Teste un point d'accès : joignable, clé acceptée, nombre de modèles. */
  async test(ep: OpenEndpoint): Promise<{ ok: boolean; models: string[]; error?: string }> {
    try { const r = await this.get(ep, "/models");
      if (r.status === 401 || r.status === 403) return { ok: false, models: [], error: `Clé API refusée (HTTP ${r.status}).` };
      if (!r.ok) return ep.models?.length && r.status === 404 ? { ok: true, models: ep.models } : { ok: false, models: [], error: `HTTP ${r.status} sur ${ep.baseUrl}/models` };
      const j: any = await r.json(); const models = ((j.data ?? j.models ?? []) as any[]).map((m) => String(m.id ?? m.name ?? "")).filter(Boolean);
      return { ok: true, models };
    } catch (e: any) { return { ok: false, models: [], error: /timeout|abort/i.test(String(e?.name) + e?.message) ? `Aucune réponse de ${ep.baseUrl} (serveur arrêté ?)` : `Injoignable : ${e?.cause?.code ?? e?.message ?? e}` }; }
  }
  async detectInstallation() { return { installed: this.endpoints.all().length > 0 }; }
  async getVersion() { return undefined; }
  async getAuthStatus(): Promise<ProviderStatus> {
    const eps = this.endpoints.all(); const base: ProviderStatus = { provider: "open", installed: eps.length > 0, authenticated: false, authMode: "unavailable", warnings: [], checkedAt: new Date().toISOString() };
    if (!eps.length) { base.blockedReason = "Aucun point d'accès configuré (Paramètres › Modèles open source)."; return base; }
    const res = await Promise.all(eps.map(async (ep) => ({ ep, r: await this.test(ep) })));
    for (const { ep, r } of res) if (!r.ok) base.warnings.push(`${ep.name} : ${r.error}`);
    const ok = res.filter((x) => x.r.ok).map((x) => x.ep); const usable = ok.filter((e) => this.usable(e));
    if (ok.some((e) => !this.usable(e))) base.warnings.push("Points d'accès hébergés ignorés : la facturation à l'usage n'est pas autorisée (Paramètres › Modèles open source).");
    base.authenticated = usable.length > 0; base.version = `${ok.length}/${eps.length} point(s) d'accès joignable(s)`; base.account = usable.map((e) => e.name).join(", ") || undefined;
    base.authMode = !usable.length ? "unavailable" : usable.some((e) => isLocalUrl(e.baseUrl)) ? "local" : "api_key";
    base.plan = !usable.length ? undefined : usable.every((e) => isLocalUrl(e.baseUrl)) ? "Local (gratuit)" : usable.some((e) => isLocalUrl(e.baseUrl)) ? "Local + hébergé" : "Hébergé (à l'usage)";
    if (!usable.length) base.blockedReason = base.warnings[0] ?? "Aucun point d'accès utilisable.";
    return base;
  }
  async getSupportedModels(): Promise<ModelInfo[]> {
    const out: ModelInfo[] = []; const def = this.endpoints.defaultModel();
    for (const ep of this.endpoints.all().filter((e) => this.usable(e))) {
      const local = isLocalUrl(ep.baseUrl); const names = ep.models?.length ? ep.models : (await this.test(ep)).models;
      for (const m of names.slice(0, 150)) out.push({ id: `${ep.id}/${m}`, displayName: `${m} — ${ep.name}`, source: "provider", category: ep.name,
        description: local && isCloudModel(m) ? `${ep.name} · Ollama Cloud : exécuté sur les serveurs d'Ollama (compte ollama.com, quota de votre offre Ollama), vos messages quittent cet ordinateur` : local ? `${ep.name} · local, gratuit` : `${ep.name} · hébergé, facturé à l'usage par ce fournisseur` });
    }
    const d = out.find((m) => m.id === def) ?? out.find((m) => /local, gratuit/.test(m.description ?? "")) ?? out[0]; if (d) d.isDefault = true;
    return out;
  }
  getCapabilities() { return { streaming: "supported", resume: "supported", usageTokens: "supported", usageCostReported: "unknown", quotaWindows: "unsupported", interactiveTerminal: "unsupported", approvalsInStructuredMode: "unsupported", fileTools: "supported", shellCommands: "unsupported", mcp: "unsupported", webSearch: "unsupported" } as const; }
  async getQuotaStatus(): Promise<QuotaStatus> { return { provider: "open", state: "unknown", windows: [], note: "Pas de quota d'abonnement : limité par votre matériel (local) ou par votre compte chez le fournisseur hébergé.", checkedAt: new Date().toISOString() }; }

  private async resolve(model?: string): Promise<{ ep: OpenEndpoint; model: string; id: string }> {
    let id = model; if (!id) id = (await this.getSupportedModels()).find((m) => m.isDefault)?.id; if (!id) throw new Error("Aucun modèle open source disponible : vérifiez qu'un serveur (Ollama, LM Studio…) est démarré ou qu'un point d'accès est configuré.");
    const s = splitModelId(id); const ep = s && this.endpoints.get(s.endpointId); if (!s || !ep) throw new Error(`Modèle « ${id} » introuvable : point d'accès supprimé ?`);
    if (!this.usable(ep)) throw new Error(`« ${ep.name} » est un service hébergé facturé à l'usage : autorisez-le d'abord dans Paramètres › Modèles open source.`);
    return { ep, model: s.model, id };
  }

  /** Un tour de complétion en streaming (ou JSON si le serveur ignore `stream`). */
  private async complete(ep: OpenEndpoint, model: string, messages: any[], tools: any[] | undefined, signal: AbortSignal, onText: (t: string) => void, onThinking: () => void = () => {}): Promise<TurnAcc> {
    const body: any = { model, messages, stream: true, stream_options: { include_usage: true } };
    if (tools) body.tools = tools; if (/openrouter\.ai/.test(ep.baseUrl)) body.usage = { include: true }; // coût réel rapporté par OpenRouter
    const r = await this.fetchImpl(ep.baseUrl + "/chat/completions", { method: "POST", headers: this.headers(ep), body: JSON.stringify(body), signal });
    if (!r.ok) { const t = await r.text().catch(() => ""); let m = t; try { const j = JSON.parse(t); m = j.error?.message ?? j.error ?? j.message ?? t; } catch { /* texte brut */ } throw new HttpError(r.status, `HTTP ${r.status} : ${trunc(String(m || r.statusText), 400)}`); }
    const acc = newAcc();
    if (!/event-stream/.test(r.headers.get("content-type") ?? "")) { const j: any = await r.json(); const d = applyChunk(acc, j); if (d) onText(d); }
    else { const feed = createSseParser((j) => { const d = applyChunk(acc, j); if (d) onText(d); if (acc.reasoning) onThinking(); }); const dec = new TextDecoder(); for await (const chunk of r.body as any) feed(dec.decode(chunk as Uint8Array, { stream: true })); feed("\n"); }
    if (acc.error) throw new Error(acc.error);
    return acc;
  }

  startSession(req: RunRequest, sink: RunSink): RunHandle {
    const ctl = new AbortController(); let cancelled = false;
    const done = (async () => {
      try {
        const { ep, model, id } = await this.resolve(req.model); const local = isLocalUrl(ep.baseUrl) && !isCloudModel(model); let thinkingShown = false;
        sink.event({ type: "applied", model: id, effort: null, effortSource: "not_configurable" });
        const sid = req.resumeSessionId && this.sessions.exists(req.resumeSessionId) ? req.resumeSessionId : randomUUID(); sink.event({ type: "session", providerSessionId: sid });
        const convo: any[] = req.resumeSessionId ? this.sessions.load(req.resumeSessionId) : [];
        const pol = req.policy ?? "code"; const write = pol !== "chat" && req.permission !== "read-only"; let tools = pol === "chat" ? undefined : toolDefs(write);
        if (req.web) sink.event({ type: "status", detail: "Recherche web non disponible avec les modèles open source : ignorée." });
        if (req.mcp?.length) sink.event({ type: "status", detail: "Extensions MCP non prises en charge par les modèles open source : ignorées." });
        const system = () => [req.instructions, tools ? toolGuide(write) : ""].filter(Boolean).join("\n\n");
        const userContent = req.images?.length ? [{ type: "text", text: req.prompt }, ...req.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.data}` } }))] : req.prompt;
        const start = convo.length; convo.push({ role: "user", content: userContent });
        const tot = { prompt: 0, completion: 0, cached: 0, cost: undefined as number | undefined, estimated: false }; let final = ""; let usedModel = model;
        for (let round = 0; round < MAX_ROUNDS; round++) {
          const msgs = system() ? [{ role: "system", content: system() }, ...convo] : convo; let acc: TurnAcc;
          try { acc = await this.complete(ep, model, msgs, tools, ctl.signal, (t) => sink.event({ type: "text", text: t }), () => { if (!thinkingShown) { thinkingShown = true; sink.event({ type: "status", detail: "Le modèle réfléchit (raisonnement non affiché)…" }); } }); }
          catch (e: any) { if (tools && e instanceof HttpError && e.status >= 400 && e.status < 500 && /tool|function/i.test(e.message)) { tools = undefined; sink.event({ type: "status", detail: "Ce modèle ne prend pas en charge les outils : réponse sans accès aux fichiers." }); round--; continue; } throw e; }
          if (acc.model) usedModel = acc.model;
          if (acc.usage) { tot.prompt += acc.usage.prompt; tot.completion += acc.usage.completion; tot.cached += acc.usage.cached; if (acc.usage.cost != null) tot.cost = (tot.cost ?? 0) + acc.usage.cost; }
          else { tot.estimated = true; tot.prompt += Math.ceil(JSON.stringify(msgs).length / 4); tot.completion += Math.ceil(acc.text.length / 4); } // serveur sans compteur : estimation ≈ 4 caractères/token
          const calls = [...acc.tools.values()].filter((c) => c.name);
          if (!calls.length) { final = stripThinking(acc.text); convo.push({ role: "assistant", content: final }); break; }
          // Modèles « thinking » : le raisonnement doit être renvoyé pendant le même tour d'outils (DeepSeek, Kimi), jamais conservé ensuite.
          convo.push({ role: "assistant", content: acc.text || null, ...(acc.reasoning ? { reasoning_content: acc.reasoning } : {}), tool_calls:calls.map((c, i) => ({ id: c.id || `call_${round}_${i}`, type: "function", function: { name: c.name, arguments: c.args || "{}" } })) });
          for (const [i, c] of calls.entries()) {
            const cid = c.id || `call_${round}_${i}`; sink.event({ type: "tool", id: cid, name: c.name, summary: trunc(c.args, 200), state: "started" }); let output: string;
            try { const r = runTool(req.cwd, c.name, c.args, write); output = r.output; if (r.changed) sink.event({ type: "file_change", paths: [r.changed] }); sink.event({ type: "tool", id: cid, name: c.name, summary: "", state: "completed" }); }
            catch (e: any) { output = `Erreur : ${e.message}`; sink.event({ type: "tool", id: cid, name: c.name, summary: e.message, state: "failed" }); }
            convo.push({ role: "tool", tool_call_id: cid, content: trunc(output, 20_000) });
          }
          if (acc.text) sink.event({ type: "text", text: "\n\n" });
          if (round === MAX_ROUNDS - 1) final = `${acc.text}\n\n(Arrêt : ${MAX_ROUNDS} tours d'outils atteints.)`;
        }
        // l'historique conservé remplace les images par leur nom (pas de base64 sur disque)
        if (req.images?.length) convo[start] = { role: "user", content: `${req.prompt}\n\n[Images jointes : ${req.images.map((i) => i.name).join(", ")}]` };
        this.sessions.save(sid, convo.map(({ reasoning_content: _r, ...m }) => m));
        const rep: UsageReport = { model: usedModel, mode: "final", counterKey: `open-exec:${req.executionId}`, eventKey: "final", confidence: tot.estimated ? "estimated" : "reported", providerCostUsd: local ? 0 : tot.cost,
          tokens: { input: Math.max(0, tot.prompt - tot.cached), output: tot.completion, cacheRead: tot.cached, cacheWrite: 0, reasoning: 0, total: tot.prompt + tot.completion } };
        sink.event({ type: "usage", report: rep });
        sink.event({ type: "text", text: final, final: true }); sink.event({ type: "done", ok: true, message: final });
      } catch (e: any) {
        const msg = cancelled ? "Annulé" : e?.name === "AbortError" ? "Annulé" : e?.cause?.code === "ECONNREFUSED" ? "Serveur de modèles injoignable (connexion refusée) : est-il démarré ?" : String(e?.message ?? e);
        if (!cancelled) sink.event({ type: "error", message: msg, auth: e instanceof HttpError && (e.status === 401 || e.status === 403), quota: e instanceof HttpError && (e.status === 429 || e.status === 402) });
        sink.event({ type: "done", ok: false, message: msg });
      }
    })();
    return { done, cancel: async () => { cancelled = true; ctl.abort(); } };
  }
  resumeSession(req: RunRequest & { resumeSessionId: string }, sink: RunSink) { return this.startSession(req, sink); }
  async cancelExecution(h: RunHandle) { await h.cancel(); }
  async dispose() {}
}

/** Modèles installés dans Ollama (API native), pour le terminal `ollama run`. */
export async function ollamaModels(base = "http://127.0.0.1:11434", fetchImpl: typeof fetch = fetch): Promise<string[]> {
  try { const r = await fetchImpl(base + "/api/tags", { signal: AbortSignal.timeout(2500) }); if (!r.ok) return []; const j: any = await r.json(); return ((j.models ?? []) as any[]).map((m) => String(m.name)).filter(Boolean); } catch { return []; }
}
