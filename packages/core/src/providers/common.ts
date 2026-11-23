import { spawn, spawnSync, ChildProcess } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ProviderEnvCheck, ProviderId, ProviderStatus, ExecEvent, RunRequest, RunHandle, QuotaStatus, ModelInfo } from "../types.js";

/** Variables pouvant faire basculer les CLI vers une facturation API. */
export const BILLING_ENV: Record<ProviderId, string[]> = {
  claude: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "ANTHROPIC_BASE_URL"],
  codex: ["OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL"],
};
export function checkEnv(provider: ProviderId, env = process.env): ProviderEnvCheck {
  const flagged = BILLING_ENV[provider].filter((k) => env[k]);
  return { ok: flagged.length === 0, stripped: flagged, flagged };
}
/** Environnement enfant : retire les variables de facturation API (mode abonnement exclusif) et l'état des sessions Claude Code parentes. */
export function childEnv(provider: ProviderId, exclusive: boolean, env = process.env): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...env };
  if (exclusive) for (const k of BILLING_ENV[provider]) delete e[k];
  for (const k of Object.keys(e)) if (k.startsWith("CLAUDE_CODE_") || k === "CLAUDECODE") delete e[k];
  return e;
}

export function execCapture(cmd: string, args: string[], timeoutMs = 15000): { ok: boolean; out: string; err: string } {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: timeoutMs, windowsHide: true, shell: false });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}
export function findExe(provider: ProviderId, override?: string): string | undefined {
  if (override && existsSync(override)) return override;
  const name = provider === "claude" ? "claude" : "codex";
  const w = spawnSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf8", windowsHide: true });
  if (w.status === 0) { const first = w.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).find((p) => !/\.(cmd|ps1)$/i.test(p)) ?? w.stdout.split(/\r?\n/)[0]; if (first) return first.trim(); }
  const cands: string[] = [];
  if (provider === "claude") cands.push(join(homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude"));
  if (provider === "codex") {
    const base = join(process.env.LOCALAPPDATA ?? "", "OpenAI", "Codex", "bin");
    if (existsSync(base)) {
      const dirs = readdirSync(base).map((d) => join(base, d, "codex.exe")).filter(existsSync).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      cands.push(...dirs);
    }
  }
  return cands.find(existsSync);
}

export interface RunSink { event(e: ExecEvent): void; requestApproval(kind: string, summary: string): Promise<boolean>; setPid(pid: number | undefined): void }
export interface AgentProviderAdapter {
  readonly id: ProviderId;
  detectInstallation(override?: string): Promise<{ installed: boolean; path?: string }>;
  getVersion(): Promise<string | undefined>;
  getAuthStatus(): Promise<ProviderStatus>;
  getSupportedModels(): Promise<ModelInfo[]>;
  getCapabilities(): Record<string, import("../types.js").CapState>;
  getQuotaStatus(): Promise<QuotaStatus>;
  startSession(req: RunRequest, sink: RunSink, opts: { exclusive: boolean }): RunHandle;
  resumeSession(req: RunRequest & { resumeSessionId: string }, sink: RunSink, opts: { exclusive: boolean }): RunHandle;
  cancelExecution(h: RunHandle): Promise<void>;
  dispose(): Promise<void>;
}
export function killTree(p: ChildProcess) {
  if (!p.pid) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { windowsHide: true });
  else p.kill("SIGTERM");
}
export const trunc = (s: string, n = 200) => (s.length > n ? s.slice(0, n) + "…" : s);
