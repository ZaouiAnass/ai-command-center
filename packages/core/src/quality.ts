import { spawn } from "node:child_process";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DB, all, one, run, uid, now } from "./db.js";
import type { EventBus } from "./events.js";
import type { ExecutionManager } from "./execution.js";
import { getSetting, setSetting } from "./settings.js";
import { terminalEnv } from "./terminal.js";
import { git, isGitRepo } from "./git.js";
import type { ProviderId } from "./types.js";
import { parseCounts } from "./counts.js";

export type CheckKind = "test" | "lint" | "typecheck" | "build";
export const CHECK_KINDS: CheckKind[] = ["test", "lint", "typecheck", "build"];
export type Scripts = Partial<Record<CheckKind, string>>;

/** Détecte les commandes usuelles d'un projet à partir de ses fichiers (package.json, tsconfig, pytest, cargo, go). */
export function detectScripts(path: string): Scripts {
  const out: Scripts = {}; try {
    const pj = join(path, "package.json");
    if (existsSync(pj)) { const s = (JSON.parse(readFileSync(pj, "utf8")).scripts ?? {}) as Record<string, string>; if (s.test && !/no test specified/i.test(s.test)) out.test = "npm test"; if (s.lint) out.lint = "npm run lint"; if (s.typecheck) out.typecheck = "npm run typecheck"; else if (existsSync(join(path, "tsconfig.json"))) out.typecheck = "npx tsc --noEmit"; if (s.build) out.build = "npm run build"; }
    else if (existsSync(join(path, "pyproject.toml")) || existsSync(join(path, "pytest.ini")) || existsSync(join(path, "requirements.txt"))) { out.test = "python -m pytest -q"; }
    else if (existsSync(join(path, "Cargo.toml"))) { out.test = "cargo test"; out.build = "cargo build"; out.lint = "cargo clippy"; }
    else if (existsSync(join(path, "go.mod"))) { out.test = "go test ./..."; out.build = "go build ./..."; out.typecheck = "go vet ./..."; }
  } catch { /* projet illisible : aucune détection */ }
  return out;
}

export { parseCounts } from "./counts.js";

export class Quality {
  private running = new Set<string>();
  constructor(private db: DB, private bus: EventBus, private exec: ExecutionManager, private sandboxDir: string) {}
  scripts(projectId: string): { scripts: Scripts; detected: Scripts; custom: boolean } {
    const p = one<any>(this.db, "SELECT path FROM projects WHERE id=?", projectId); const detected = p ? detectScripts(p.path) : {}; const saved = getSetting<Scripts | null>(this.db, `project.${projectId}.scripts`, null);
    return { scripts: saved ?? detected, detected, custom: !!saved };
  }
  setScripts(projectId: string, s: Scripts | null) { const clean: Scripts = {}; if (s) for (const k of CHECK_KINDS) if (s[k]?.trim()) clean[k] = s[k]!.trim().slice(0, 500); setSetting(this.db, `project.${projectId}.scripts`, s ? clean : null); }

  /** Exécute réellement la commande configurée dans le projet (sortie bornée, délai 10 min). */
  async run(projectId: string, kind: CheckKind, o: { source?: string; refId?: string; command?: string } = {}) {
    const p = one<any>(this.db, "SELECT * FROM projects WHERE id=?", projectId); if (!p) throw new Error("Projet introuvable");
    const command = (o.command ?? this.scripts(projectId).scripts[kind])?.trim(); if (!command) throw new Error(`Aucune commande « ${kind} » configurée pour ce projet.`);
    const key = projectId + ":" + kind; if (this.running.has(key)) throw new Error(`Un contrôle « ${kind} » est déjà en cours pour ce projet.`); this.running.add(key);
    const started = Date.now(); let out = ""; let timedOut = false; let code = -1;
    try {
      const excl = getSetting(this.db, "billing.exclusive", true); const child = spawn(command, { cwd: p.path, shell: true, env: terminalEnv(!!excl), windowsHide: true });
      const add = (d: Buffer) => { out += d.toString(); if (out.length > 60000) out = out.slice(-60000); }; child.stdout.on("data", add); child.stderr.on("data", add);
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, 600_000);
      code = await new Promise<number>((res) => { child.on("error", (e) => { out += String(e.message); res(-1); }); child.on("close", (c) => res(c ?? -1)); }); clearTimeout(timer);
    } finally { this.running.delete(key); }
    const counts = kind === "test" ? parseCounts(out) : null; const status = timedOut ? "timeout" : code === 0 ? "pass" : code === -1 ? "error" : "fail";
    const prev = one<any>(this.db, "SELECT status FROM test_runs WHERE project_id=? AND kind=? ORDER BY created_at DESC, rowid DESC LIMIT 1", projectId, kind); const regression = prev?.status === "pass" && status !== "pass" ? 1 : 0;
    const id = uid(); run(this.db, "INSERT INTO test_runs (id,project_id,kind,command,status,exit_code,duration_ms,passed,failed,total,regression,output_tail,source,ref_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", id, projectId, kind, command, status, code, Date.now() - started, counts?.passed ?? null, counts?.failed ?? null, counts?.total ?? null, regression, out.slice(-20000), o.source ?? "manual", o.refId ?? null, now());
    this.bus.emit("quality.run", { id, kind, status, regression }, { projectId });
    if (status !== "pass") { this.exec.notify("error", regression ? `Régression : ${kind} échoue` : `${kind} en échec`, `${p.name} — ${command} (code ${code})`, "quality"); this.bus.emit("quality.failed", { id, kind, projectId }, { projectId }); }
    return one<any>(this.db, "SELECT * FROM test_runs WHERE id=?", id)!;
  }
  async runAll(projectId: string, kinds: CheckKind[] = CHECK_KINDS, source = "manual") { const res = []; const sc = this.scripts(projectId).scripts; for (const k of kinds) if (sc[k]) { try { res.push(await this.run(projectId, k, { source })); } catch (e: any) { res.push({ kind: k, status: "error", error: e.message }); } } return res; }
  history(projectId: string, kind?: string, limit = 60) { return all<any>(this.db, `SELECT * FROM test_runs WHERE project_id=? ${kind ? "AND kind=?" : ""} ORDER BY created_at DESC, rowid DESC LIMIT ${Math.min(limit, 500)}`, ...(kind ? [projectId, kind] : [projectId])); }
  summary(projectId: string) {
    const out: Record<string, any> = {}; for (const k of CHECK_KINDS) { const h = this.history(projectId, k, 20); const last = h[0]; const done = h.filter((x) => x.status !== "error");
      out[k] = { last: last ? { status: last.status, at: last.created_at, duration_ms: last.duration_ms, passed: last.passed, failed: last.failed, total: last.total } : null, runs: h.length, passRate: done.length ? Math.round((done.filter((x) => x.status === "pass").length / done.length) * 100) : null, avgMs: done.length ? Math.round(done.reduce((s, x) => s + (x.duration_ms ?? 0), 0) / done.length) : null, regressions: h.filter((x) => x.regression).length }; }
    return out;
  }

  /** Revue IA des changements non commités : le diff est transmis au relecteur (mode Chat, sans outil). Permet la revue croisée en choisissant l'autre fournisseur. */
  review(projectId: string, provider: ProviderId): string {
    const p = one<any>(this.db, "SELECT * FROM projects WHERE id=?", projectId); if (!p) throw new Error("Projet introuvable"); if (!isGitRepo(p.path)) throw new Error("La revue nécessite un dépôt Git.");
    const diff = git(p.path, ["diff", "HEAD"]).out; const untracked = git(p.path, ["ls-files", "--others", "--exclude-standard"]).out.split("\n").filter(Boolean);
    if (!diff.trim() && !untracked.length) throw new Error("Aucune modification à relire (arbre de travail propre).");
    const capped = diff.length > 40000 ? diff.slice(0, 40000) + "\n[… diff tronqué à 40 000 caractères]" : diff;
    const prompt = `Relis ces modifications (projet « ${p.name} »). Produis un rapport Markdown structuré : 1) Bugs probables, 2) Sécurité, 3) Lisibilité/maintenabilité, 4) Tests manquants, 5) Verdict. Appuie-toi UNIQUEMENT sur le diff fourni ; signale ce que tu ne peux pas vérifier. Tu n'as aucun outil.\n\nFichiers non suivis (contenu non fourni) : ${untracked.join(", ") || "aucun"}\n\n\`\`\`diff\n${capped}\n\`\`\``;
    const eid = this.exec.enqueue({ projectId: null, mode: "chat", cwd: (mkdirSync(this.sandboxDir, { recursive: true }), this.sandboxDir), provider, prompt, systemPrompt: "Tu es un relecteur de code rigoureux et honnête. Tu n'as aucun outil : n'écris jamais d'appel d'outil.", priority: 7 });
    const id = uid(); run(this.db, "INSERT INTO reviews VALUES (?,?,?,?,?,?,?)", id, projectId, provider, eid, JSON.stringify(git(p.path, ["diff", "HEAD", "--name-only"]).out.split("\n").filter(Boolean)), diff.length, now()); return id;
  }
  reviews(projectId: string) { return all<any>(this.db, "SELECT r.*, e.status, e.result_text, e.error, e.model FROM reviews r LEFT JOIN agent_executions e ON e.id=r.execution_id WHERE r.project_id=? ORDER BY r.created_at DESC LIMIT 30", projectId).map((r) => ({ ...r, files: JSON.parse(r.files ?? "[]") })); }
}
