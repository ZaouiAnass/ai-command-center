import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { DB, run, uid, now } from "./db.js";
import { BILLING_ENV, findExe, execCapture, subscriptionBlocked } from "./providers/common.js";
import { getSetting } from "./settings.js";
import type { ProviderId, ProviderStatus } from "./types.js";

export type TerminalKind = "claude" | "codex" | "shell" | "ollama";
export interface TerminalInfo { id: string; kind: TerminalKind; title: string; cwd: string; projectId?: string; pid?: number; cols: number; rows: number; startedAt: string; exited?: { code: number | null; at: string }; model?: string; contextChars?: number }
const BUF_MAX = 400_000; // octets de scrollback conservés côté processus principal pour ré-attacher l'écran

interface Term { info: TerminalInfo; pty: any; buf: string; total: number }
type PtyModule = { spawn(file: string, args: string[], opts: any): any };
let ptyMod: PtyModule | undefined;
const loadPty = (): PtyModule => (ptyMod ??= createRequire((typeof __dirname !== "undefined" ? __dirname : process.cwd()) + "/")("@lydell/node-pty") as PtyModule);

/** Environnement d'un terminal : retire les variables de facturation API (les deux fournisseurs) et l'état des sessions Claude Code parentes. */
export function terminalEnv(exclusive: boolean, env = process.env): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...env };
  if (exclusive) for (const k of [...BILLING_ENV.claude, ...BILLING_ENV.codex]) delete e[k];
  for (const k of Object.keys(e)) if (k.startsWith("CLAUDE_CODE_") || k === "CLAUDECODE") delete e[k];
  e.TERM = "xterm-256color"; e.COLORTERM = "truecolor";
  return e;
}
export function defaultShell(): { file: string; args: string[] } {
  if (process.platform === "win32") { const ps = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`; return existsSync(ps) ? { file: ps, args: ["-NoLogo"] } : { file: process.env.ComSpec ?? "cmd.exe", args: [] }; }
  return { file: process.env.SHELL ?? "/bin/bash", args: ["-l"] };
}

export class TerminalManager {
  private terms = new Map<string, Term>();
  constructor(private db: DB, private statusOf: (p: ProviderId) => Promise<ProviderStatus>, private emit: (e: { id: string; data?: string; end?: number; exit?: { code: number | null } }) => void) {}

  /**
   * `context` (Claude Code uniquement) : contexte du projet (résumé + notes épinglées) passé par l'option officielle `--append-system-prompt`.
   * `model` (Ollama uniquement) : modèle local lancé par `ollama run`.
   */
  async create(o: { kind: TerminalKind; cwd: string; projectId?: string; cols?: number; rows?: number; title?: string; context?: string; model?: string }): Promise<TerminalInfo> {
    if (!existsSync(o.cwd)) throw new Error(`Dossier introuvable : ${o.cwd}`);
    const exclusive = !!getSetting(this.db, "billing.exclusive", true);
    let file: string, args: string[] = []; let contextChars: number | undefined;
    if (o.kind === "shell") ({ file, args } = defaultShell());
    else if (o.kind === "ollama") {
      file = findExe("ollama") ?? ""; if (!file) throw new Error("Ollama n'est pas installé sur cet ordinateur (https://ollama.com/download).");
      const m = String(o.model ?? "").trim(); if (!/^[\w.:/-]{1,120}$/.test(m)) throw new Error("Choisissez un modèle Ollama (ex. qwen2.5-coder:7b).");
      args = ["run", m];
    } else {
      const st = await this.statusOf(o.kind);
      if (!st.installed) throw new Error(`${o.kind === "claude" ? "Claude Code" : "Codex"} n'est pas détecté sur cet ordinateur. Vérifiez son installation.`);
      if (!st.authenticated) throw new Error(`${o.kind === "claude" ? "Claude Code" : "Codex"} : authentification requise (connectez-vous avec le CLI officiel).`);
      if (subscriptionBlocked(st, exclusive)) throw new Error(`Mode abonnement exclusif : terminal bloqué (mode d'authentification « ${st.authMode} » non vérifié comme abonnement). ${st.blockedReason ?? ""}`);
      file = st.path ?? findExe(o.kind) ?? ""; if (!file) throw new Error("Exécutable introuvable");
      // Option officielle de Codex : certaines installations (app de bureau) exigent de ne pas passer par le démon partagé.
      if (o.kind === "codex" && /--no-daemon/.test(execCapture(file, ["--help"]).out)) args = ["--no-daemon"];
      if (o.kind === "claude" && o.context?.trim()) { args = ["--append-system-prompt", o.context.trim()]; contextChars = o.context.trim().length; }
    }
    const cols = Math.max(20, o.cols ?? 100), rows = Math.max(5, o.rows ?? 30);
    const pty = loadPty().spawn(file, args, { name: "xterm-256color", cols, rows, cwd: o.cwd, env: terminalEnv(exclusive) as any });
    const info: TerminalInfo = { id: uid(), kind: o.kind, title: o.title ?? (o.kind === "claude" ? "Claude Code" : o.kind === "codex" ? "Codex" : o.kind === "ollama" ? `Ollama · ${o.model}` : "Shell"), cwd: o.cwd, projectId: o.projectId, pid: pty.pid, cols, rows, startedAt: now(), model: o.kind === "ollama" ? o.model : undefined, contextChars };
    const t: Term = { info, pty, buf: "", total: 0 }; this.terms.set(info.id, t);
    pty.onData((d: string) => { t.buf += d; t.total += d.length; if (t.buf.length > BUF_MAX) t.buf = t.buf.slice(-BUF_MAX); this.emit({ id: info.id, data: d, end: t.total }); });
    pty.onExit((e: { exitCode: number }) => { info.exited = { code: e.exitCode ?? null, at: now() }; this.emit({ id: info.id, exit: { code: info.exited.code } }); });
    run(this.db, "INSERT INTO audit_events (id,type,provider,project_id,payload,at) VALUES (?,?,?,?,?,?)", uid(), "terminal.created", o.kind === "shell" ? null : o.kind === "ollama" ? "open" : o.kind, o.projectId ?? null, JSON.stringify({ kind: o.kind, cwd: o.cwd, exclusive, model: info.model, contextChars }), now());
    return info;
  }
  list(): TerminalInfo[] { return [...this.terms.values()].map((t) => { t.info.pid = t.pty.pid || t.info.pid; return t.info; }); }
  attach(id: string) { const t = this.get(id); t.info.pid = t.pty.pid || t.info.pid; return { info: t.info, buffer: t.buf, total: t.total }; }
  write(id: string, data: string) { const t = this.get(id); if (!t.info.exited) t.pty.write(data); }
  resize(id: string, cols: number, rows: number) { const t = this.get(id); if (t.info.exited || cols < 2 || rows < 2) return; t.pty.resize(cols, rows); t.info.cols = cols; t.info.rows = rows; }
  kill(id: string) { const t = this.terms.get(id); if (!t) return; if (!t.info.exited) { try { t.pty.kill(); } catch { /* déjà terminé */ } } }
  /** Retire un terminal terminé de la liste. */
  close(id: string) { const t = this.terms.get(id); if (!t) return; this.kill(id); this.terms.delete(id); }
  shutdown() { for (const id of [...this.terms.keys()]) this.kill(id); }
  private get(id: string) { const t = this.terms.get(id); if (!t) throw new Error("Terminal introuvable"); return t; }
}
