import { spawn } from "node:child_process";
import { readFileSync, readdirSync, existsSync, copyFileSync, renameSync, rmSync, statSync, mkdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { DB, all, one, run, uid, now } from "./db.js";
import { execCapture, findExe } from "./providers/common.js";

// ---------------- mémoire de projet ----------------
export class ProjectMemory {
  constructor(private db: DB) {}
  list(projectId: string) { return all<any>(this.db, "SELECT * FROM project_memory WHERE project_id=? ORDER BY pinned DESC, updated_at DESC", projectId); }
  add(projectId: string, m: { title: string; content: string; kind?: string; pinned?: boolean }) {
    if (!m.title.trim() || !m.content.trim()) throw new Error("Titre et contenu requis."); const id = uid();
    run(this.db, "INSERT INTO project_memory VALUES (?,?,?,?,?,?,?,?)", id, projectId, m.title.trim().slice(0, 120), m.content.trim().slice(0, 8000), m.kind ?? "note", m.pinned === false ? 0 : 1, now(), now()); return id;
  }
  update(id: string, p: { title?: string; content?: string; pinned?: boolean }) {
    if (p.title !== undefined) run(this.db, "UPDATE project_memory SET title=? WHERE id=?", p.title.trim(), id); if (p.content !== undefined) run(this.db, "UPDATE project_memory SET content=? WHERE id=?", p.content.slice(0, 8000), id);
    if (p.pinned !== undefined) run(this.db, "UPDATE project_memory SET pinned=? WHERE id=?", p.pinned ? 1 : 0, id); run(this.db, "UPDATE project_memory SET updated_at=? WHERE id=?", now(), id);
  }
  remove(id: string) { run(this.db, "DELETE FROM project_memory WHERE id=?", id); }
  summary(projectId: string) { return one<any>(this.db, "SELECT * FROM project_memory WHERE project_id=? AND kind='summary' ORDER BY updated_at DESC LIMIT 1", projectId); }
  /** Remplace le résumé généré du projet (une seule note de type « summary », épinglée, modifiable ensuite comme les autres). */
  setSummary(projectId: string, content: string, source: string): string {
    const text = cleanSummary(content); if (text.length < 40) throw new Error("Résumé vide ou trop court : rien n'a été enregistré.");
    const cur = this.summary(projectId);
    if (cur) { run(this.db, "UPDATE project_memory SET content=?, title=?, pinned=1, updated_at=? WHERE id=?", text.slice(0, SUMMARY_MAX), `Résumé du projet (${source})`, now(), cur.id); return cur.id; }
    const id = uid(); run(this.db, "INSERT INTO project_memory VALUES (?,?,?,?,?,?,?,?)", id, projectId, `Résumé du projet (${source})`, text.slice(0, SUMMARY_MAX), "summary", 1, now(), now()); return id;
  }
  /**
   * Contexte injecté : le résumé du projet (s'il est épinglé) en premier avec son propre budget, puis les notes épinglées, bornées en taille.
   * Le résumé garde sa mise en forme (sections) ; les notes sont aplaties sur une ligne.
   */
  context(projectId: string, max = 3000): { text: string; included: { id: string; title: string }[] } {
    let text = ""; const included: { id: string; title: string }[] = []; let head = "";
    const s = this.summary(projectId); if (s?.pinned) { head = `[Résumé du projet]\n${String(s.content).slice(0, SUMMARY_MAX)}\n\n`; included.push({ id: s.id, title: s.title }); }
    for (const m of all<any>(this.db, "SELECT * FROM project_memory WHERE project_id=? AND pinned=1 AND kind<>'summary' ORDER BY updated_at DESC", projectId)) { const block = `- ${m.title} : ${String(m.content).replace(/\s+/g, " ")}\n`; if ((text + block).length > max) break; text += block; included.push({ id: m.id, title: m.title }); }
    return { text: head + (text ? `[Mémoire du projet — conventions et décisions]\n${text}` : ""), included };
  }
}
export const SUMMARY_MAX = 3500;
/** Retire un éventuel préambule (« Voici le résumé… ») et une clôture de bloc de code englobante. */
export function cleanSummary(s: string): string {
  let t = String(s ?? "").trim(); const fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/.exec(t); if (fenced) t = fenced[1]!.trim();
  const firstHeading = t.search(/^(#{1,3} |\*\*[^*\n]+\*\*)/m); if (firstHeading > 0 && firstHeading < 200) t = t.slice(firstHeading);
  return t.trim();
}
export const SUMMARY_PROMPT = [
  "Analyse ce projet en lecture seule : arborescence, README, fichiers de configuration et de dépendances, points d'entrée, scripts, quelques fichiers clés. Ne modifie aucun fichier et ne lance aucune commande qui écrit.",
  "Rédige ensuite un RÉSUMÉ DE CONTEXTE destiné à un assistant de programmation qui reprendra ce projet sans le connaître. Markdown concis, 3 000 caractères maximum, avec exactement ces sections :",
  "## Objectif — ce que fait le projet, en 2 phrases.",
  "## Stack — langages, frameworks, versions notables, gestionnaire de paquets.",
  "## Structure — dossiers et fichiers clés, et leur rôle.",
  "## Commandes — installer, lancer, tester, construire (commandes exactes trouvées dans le projet).",
  "## Conventions — style, nommage, patterns récurrents, règles visibles dans le code.",
  "## Points d'attention — pièges, zones sensibles, dette, éléments inachevés.",
  "Réponds uniquement avec le résumé, sans introduction ni conclusion. N'invente rien : si une information est absente, écris « non trouvé ».",
].join("\n");

// ---------------- MCP & Skills (lecture seule via les commandes officielles) ----------------
export interface McpServer { provider: "claude" | "codex"; name: string; transport: string; target: string; status: string; enabled?: boolean; envKeys: string[] }
function mcpStatus(raw: string): string { const t = raw.toLowerCase(); if (/needs auth/.test(t)) return "Authentification requise"; if (/connected/.test(t) && !/fail|not/.test(t)) return "Connecté"; if (/fail|error|✘|✗/.test(t)) return "Échec de connexion"; return raw.replace(/^[✔✘✗!]\s*/, "").trim(); }
export function parseClaudeMcp(out: string): McpServer[] {
  const res: McpServer[] = [];
  for (const l of out.split(/\r?\n/)) { const m = /^(.+?): (.+) - (\S+)\s*(.*)$/.exec(l.trim()); if (!m) continue; const target = m[2]!; res.push({ provider: "claude", name: m[1]!, transport: /^https?:/.test(target) ? "http" : "stdio", target: target.replace(/\s*\((HTTP|SSE)\)$/, ""), status: mcpStatus(`${m[3]} ${m[4]}`), envKeys: [] }); }
  return res;
}
export function parseCodexMcp(json: string): McpServer[] {
  try { return (JSON.parse(json) as any[]).map((s) => ({ provider: "codex" as const, name: s.name, transport: s.transport?.type ?? "?", target: [s.transport?.command ?? s.transport?.url, ...(s.transport?.args ?? [])].filter(Boolean).join(" ").slice(0, 240), status: s.enabled ? "Activé" : s.disabled_reason ? `Désactivé (${s.disabled_reason})` : "Désactivé", enabled: !!s.enabled, envKeys: Object.keys(s.transport?.env ?? {}) })); } catch { return []; } // jamais les valeurs d'environnement
}
/** Exécution asynchrone (ne bloque pas le processus principal) avec délai maximal. */
function execAsync(cmd: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((res) => { let out = "", err = ""; let c; try { c = spawn(cmd, args, { windowsHide: true, shell: false }); } catch (e: any) { return res({ ok: false, out: "", err: String(e.message) }); }
    const t = setTimeout(() => { try { c.kill(); } catch { /* arrêté */ } }, timeoutMs);
    c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d)); c.on("error", (e) => { clearTimeout(t); res({ ok: false, out: out.trim(), err: String(e.message) }); }); c.on("close", (code) => { clearTimeout(t); res({ ok: code === 0, out: out.trim(), err: err.trim() }); }); });
}
let mcpCache: { at: number; v: { servers: McpServer[]; errors: string[] } } | undefined; let mcpInflight: Promise<{ servers: McpServer[]; errors: string[] }> | undefined;
/** Résultat mis en cache 60 s ; appels simultanés fusionnés ; `force` pour actualiser. */
export function listMcpCached(force = false) {
  if (!force && mcpCache && Date.now() - mcpCache.at < 60000) return Promise.resolve(mcpCache.v);
  return (mcpInflight ??= listMcp().then((v) => { mcpCache = { at: Date.now(), v }; return v; }).finally(() => { mcpInflight = undefined; }));
}
export async function listMcp(): Promise<{ servers: McpServer[]; errors: string[] }> {
  const servers: McpServer[] = []; const errors: string[] = [];
  const cl = findExe("claude"); if (cl) { const r = await execAsync(cl, ["mcp", "list"], 40000); if (r.out) servers.push(...parseClaudeMcp(r.out)); else errors.push("Claude Code : `claude mcp list` n'a rien renvoyé."); } else errors.push("Claude Code non détecté.");
  const cx = findExe("codex"); if (cx) { const r = await execAsync(cx, ["mcp", "list", "--json"], 30000); const l = parseCodexMcp(r.out); if (l.length || r.ok) servers.push(...l); else errors.push("Codex : `codex mcp list` a échoué."); } else errors.push("Codex non détecté.");
  return { servers, errors };
}
export interface SkillInfo { provider: "claude" | "codex"; name: string; description: string; path: string; scope: string }
function frontmatter(p: string): { name?: string; description?: string } { try { const t = readFileSync(p, "utf8"); const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(t); if (!m) return {}; const g = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, "m").exec(m[1]!)?.[1]?.trim().replace(/^["']|["']$/g, ""); return { name: g("name"), description: g("description") }; } catch { return {}; } }
export function listSkills(home = homedir()): SkillInfo[] {
  const out: SkillInfo[] = []; const scan = (root: string, provider: "claude" | "codex", scope: string, depth: number) => {
    if (!existsSync(root) || depth < 0) return; for (const e of readdirSync(root, { withFileTypes: true })) { if (!e.isDirectory()) continue; const d = join(root, e.name); const sk = join(d, "SKILL.md");
      if (existsSync(sk)) { const f = frontmatter(sk); out.push({ provider, name: f.name ?? e.name, description: (f.description ?? "").slice(0, 300), path: d, scope }); } else if (depth > 0) scan(d, provider, scope, depth - 1); } };
  scan(join(home, ".claude", "skills"), "claude", "utilisateur", 1); scan(join(home, ".codex", "skills"), "codex", "utilisateur", 2);
  try { const pc = join(home, ".claude", "plugins", "cache"); if (existsSync(pc)) for (const a of readdirSync(pc)) for (const b of readdirSync(join(pc, a))) for (const v of readdirSync(join(pc, a, b))) scan(join(pc, a, b, v, "skills"), "claude", `plugin ${b}`, 0); } catch { /* optionnel */ }
  return out.slice(0, 300);
}

// ---------------- sauvegarde / restauration ----------------
const nodeRequire = createRequire((typeof __dirname !== "undefined" ? __dirname : process.cwd()) + "/");
export function backupTo(db: DB, file: string) { if (existsSync(file)) rmSync(file); db.exec(`VACUUM INTO '${resolve(file).replace(/'/g, "''")}'`); return statSync(file).size; }
/** Valide un fichier de sauvegarde sans l'appliquer. */
export function inspectBackup(file: string): { ok: boolean; error?: string; migrations?: number; projects?: number; conversations?: number } {
  try { const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite"); const d = new DatabaseSync(file, { readOnly: true }); try {
    const mig = (d.prepare("SELECT COUNT(*) c FROM schema_migrations").get() as any).c; const has = (t: string) => !!d.prepare("SELECT 1 x FROM sqlite_master WHERE type='table' AND name=?").get(t);
    if (!has("projects") || !has("agent_executions")) return { ok: false, error: "Ce fichier n'est pas une sauvegarde AI Command Center." };
    return { ok: true, migrations: mig, projects: (d.prepare("SELECT COUNT(*) c FROM projects").get() as any).c, conversations: has("conversations") ? (d.prepare("SELECT COUNT(*) c FROM conversations").get() as any).c : 0 }; } finally { d.close(); } }
  catch (e: any) { return { ok: false, error: `Fichier illisible : ${e.message}` }; }
}
export const PENDING_RESTORE = "restore-pending.sqlite";
/** Prépare la restauration (appliquée au prochain démarrage, avant l'ouverture de la base). */
export function stageRestore(dataDir: string, file: string) { const c = inspectBackup(file); if (!c.ok) throw new Error(c.error); mkdirSync(dataDir, { recursive: true }); copyFileSync(file, join(dataDir, PENDING_RESTORE)); return c; }
export function applyPendingRestore(dataDir: string, dbFile: string): boolean {
  const pend = join(dataDir, PENDING_RESTORE); if (!existsSync(pend)) return false;
  if (existsSync(dbFile)) renameSync(dbFile, `${dbFile}.avant-restauration-${Date.now()}.bak`); for (const ext of ["-wal", "-shm"]) rmSync(dbFile + ext, { force: true }); renameSync(pend, dbFile); return true;
}
export { basename };
