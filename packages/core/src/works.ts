import { join, basename, extname, resolve, relative, sep } from "node:path";
import { mkdirSync, copyFileSync, statSync, readdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { DB, all, one, run, uid, now } from "./db.js";
import type { Conversations } from "./conversations.js";
import { extractJson } from "./orchestration-plan.js";
import type { ProviderId } from "./types.js";

const MAX_FILE = 50 * 1024 * 1024;
const TEXT_EXT = new Set([".md", ".txt", ".csv", ".json", ".html", ".htm", ".xml", ".yml", ".yaml", ".log", ".tsv", ".rtf"]);
export const STEP_STATUSES = ["todo", "doing", "done", "blocked"] as const;

export interface DeliverableInfo { name: string; rel: string; size: number; modifiedAt: string; previewable: boolean }
/** Espace Work local à AI Command Center : ce n'est PAS le Work natif de ChatGPT ou Claude (aucune intégration officielle n'existe). */
export class Works {
  constructor(private db: DB, private convs: Conversations, private dataDir: string) {}
  dirOf(id: string) { return one<any>(this.db, "SELECT dir FROM works WHERE id=?", id)?.dir as string | undefined; }
  private ev(id: string, type: string, detail?: string) { run(this.db, "INSERT INTO work_events VALUES (?,?,?,?,?)", uid(), id, type, detail ?? null, now()); run(this.db, "UPDATE works SET updated_at=? WHERE id=?", now(), id); }

  async create(o: { title: string; goal?: string; provider: ProviderId; model?: string | null; effort?: string | null }): Promise<string> {
    if (!o.title.trim()) throw new Error("Le nom du travail est vide.");
    const id = uid(); const dir = join(this.dataDir, "works", id); mkdirSync(join(dir, "sources"), { recursive: true }); mkdirSync(join(dir, "livrables"), { recursive: true });
    let convId: string; try { convId = await this.convs.create({ mode: "work", title: o.title.trim(), provider: o.provider, model: o.model, effort: o.effort, workId: id }); } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; }
    run(this.db, "INSERT INTO works (id,title,goal,status,conversation_id,dir,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)", id, o.title.trim(), o.goal?.trim() || null, "active", convId, dir, now(), now());
    this.ev(id, "created", o.goal ?? ""); return id;
  }
  list(f: { status?: string; q?: string } = {}) {
    const c = ["1=1"]; const p: any[] = []; if (f.status) { c.push("w.status=?"); p.push(f.status); } if (f.q?.trim()) { c.push("(w.title LIKE ? OR w.goal LIKE ?)"); p.push(`%${f.q.trim()}%`, `%${f.q.trim()}%`); }
    return all<any>(this.db, `SELECT w.*, cv.provider, cv.model, cv.effort, (SELECT COUNT(*) FROM work_steps WHERE work_id=w.id) steps, (SELECT COUNT(*) FROM work_steps WHERE work_id=w.id AND status='done') steps_done, (SELECT COUNT(*) FROM work_files WHERE work_id=w.id) files, (SELECT COALESCE(SUM(u.total),0) FROM usage_events u JOIN agent_executions e ON e.id=u.execution_id WHERE e.conversation_id=w.conversation_id) tokens, (SELECT COALESCE(SUM(k.calculated_usd),0) FROM usage_events u JOIN agent_executions e ON e.id=u.execution_id JOIN cost_estimates k ON k.usage_event_id=u.id WHERE e.conversation_id=w.conversation_id) usd FROM works w JOIN conversations cv ON cv.id=w.conversation_id WHERE ${c.join(" AND ")} ORDER BY w.updated_at DESC`, ...p);
  }
  get(id: string) { return this.list().find((w) => w.id === id); }
  update(id: string, p: { title?: string; goal?: string; status?: string }) {
    if (p.status && !["active", "done", "archived"].includes(p.status)) throw new Error("Statut invalide");
    if (p.title !== undefined) { if (!p.title.trim()) throw new Error("Titre vide"); run(this.db, "UPDATE works SET title=? WHERE id=?", p.title.trim(), id); }
    if (p.goal !== undefined) run(this.db, "UPDATE works SET goal=? WHERE id=?", p.goal, id); if (p.status) { run(this.db, "UPDATE works SET status=? WHERE id=?", p.status, id); this.ev(id, "status", p.status); } run(this.db, "UPDATE works SET updated_at=? WHERE id=?", now(), id);
  }
  /** Supprime l'espace de travail ET son dossier local ; opération explicite, confirmée côté interface. */
  remove(id: string) { const w = one<any>(this.db, "SELECT * FROM works WHERE id=?", id); if (!w) return; if (this.convs.activeExecution(w.conversation_id)) throw new Error("Une réponse est en cours : arrêtez-la d'abord."); run(this.db, "DELETE FROM works WHERE id=?", id); this.convs.remove(w.conversation_id); rmSync(w.dir, { recursive: true, force: true }); }

  // --- étapes (gérées par l'utilisateur ; l'IA peut en proposer sur demande) ---
  steps(id: string) { return all<any>(this.db, "SELECT * FROM work_steps WHERE work_id=? ORDER BY position, rowid", id); }
  addStep(id: string, title: string, source = "user") { if (!title.trim()) throw new Error("Titre vide"); const pos = (one<any>(this.db, "SELECT COALESCE(MAX(position),0)+1 p FROM work_steps WHERE work_id=?", id)?.p ?? 1) as number; const sid = uid(); run(this.db, "INSERT INTO work_steps VALUES (?,?,?,?,?,?,?,?)", sid, id, title.trim().slice(0, 200), "todo", null, pos, source, now()); this.ev(id, "step_added", title); return sid; }
  setStep(stepId: string, p: { status?: string; title?: string; note?: string }) {
    const s = one<any>(this.db, "SELECT * FROM work_steps WHERE id=?", stepId); if (!s) throw new Error("Étape introuvable");
    if (p.status) { if (!(STEP_STATUSES as readonly string[]).includes(p.status)) throw new Error("Statut invalide"); run(this.db, "UPDATE work_steps SET status=? WHERE id=?", p.status, stepId); this.ev(s.work_id, "step_status", `${s.title} → ${p.status}`); }
    if (p.title !== undefined && p.title.trim()) run(this.db, "UPDATE work_steps SET title=? WHERE id=?", p.title.trim(), stepId); if (p.note !== undefined) run(this.db, "UPDATE work_steps SET note=? WHERE id=?", p.note, stepId); run(this.db, "UPDATE work_steps SET updated_at=? WHERE id=?", now(), stepId);
  }
  removeStep(stepId: string) { run(this.db, "DELETE FROM work_steps WHERE id=?", stepId); }
  moveStep(stepId: string, dir: -1 | 1) { const s = one<any>(this.db, "SELECT * FROM work_steps WHERE id=?", stepId); if (!s) return; const all_ = this.steps(s.work_id); const i = all_.findIndex((x) => x.id === stepId); const j = i + dir; if (j < 0 || j >= all_.length) return; const o = all_[j]; run(this.db, "UPDATE work_steps SET position=? WHERE id=?", o.position, s.id); run(this.db, "UPDATE work_steps SET position=? WHERE id=?", s.position, o.id); }
  /** Plan proposé par l'IA sur demande explicite : on importe le JSON de la dernière réponse (jamais automatique). */
  planPrompt(goal: string) { return `Propose un plan d'étapes pour ce travail : « ${goal} ». Réponds avec une courte explication puis un bloc \`\`\`json de la forme {"steps":[{"title":"..."}]} (3 à 8 étapes concrètes).`; }
  importPlan(id: string): number {
    const w = one<any>(this.db, "SELECT conversation_id FROM works WHERE id=?", id); const last = all<any>(this.db, "SELECT content FROM conversation_messages WHERE conversation_id=? AND role='assistant' AND status='completed' ORDER BY created_at DESC, rowid DESC LIMIT 1", w?.conversation_id)[0];
    const j = last ? (extractJson(last.content) as any) : undefined; const steps: string[] = Array.isArray(j?.steps) ? j.steps.map((s: any) => String(s?.title ?? s ?? "")).filter(Boolean).slice(0, 12) : [];
    if (!steps.length) throw new Error("Aucun plan exploitable dans la dernière réponse (bloc JSON {\"steps\":[…]} attendu)."); steps.forEach((t) => this.addStep(id, t, "ai")); this.ev(id, "plan_imported", `${steps.length} étapes proposées par l'IA`); return steps.length;
  }

  // --- sources : copie explicite de fichiers choisis par l'utilisateur ---
  files(id: string) { return all<any>(this.db, "SELECT * FROM work_files WHERE work_id=? ORDER BY added_at", id); }
  addFiles(id: string, paths: string[]) {
    const dir = this.dirOf(id); if (!dir) throw new Error("Travail introuvable"); const added: string[] = []; const errors: string[] = [];
    for (const p of paths) { try { const st = statSync(p); if (!st.isFile()) { errors.push(`${basename(p)} : ce n'est pas un fichier`); continue; } if (st.size > MAX_FILE) { errors.push(`${basename(p)} : dépasse 50 Mo`); continue; }
      let name = basename(p); let n = 1; while (existsSync(join(dir, "sources", name))) name = `${basename(p, extname(p))}-${n++}${extname(p)}`;
      const dest = join(dir, "sources", name); copyFileSync(p, dest); run(this.db, "INSERT INTO work_files VALUES (?,?,?,?,?,?)", uid(), id, name, p, dest, now()); added.push(name); this.ev(id, "file_added", name); } catch (e: any) { errors.push(`${basename(p)} : ${e.message}`); } }
    return { added, errors };
  }
  removeFile(fileId: string) { const f = one<any>(this.db, "SELECT * FROM work_files WHERE id=?", fileId); if (!f) return; rmSync(f.copied_path, { force: true }); run(this.db, "DELETE FROM work_files WHERE id=?", fileId); this.ev(f.work_id, "file_removed", f.name); }

  // --- livrables : fichiers réellement présents dans livrables/ ---
  deliverables(id: string): DeliverableInfo[] {
    const dir = this.dirOf(id); if (!dir) return []; const root = join(dir, "livrables"); const out: DeliverableInfo[] = [];
    const walk = (d: string) => { if (!existsSync(d)) return; for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else { const st = statSync(p); out.push({ name: e.name, rel: relative(root, p).split(sep).join("/"), size: st.size, modifiedAt: st.mtime.toISOString(), previewable: TEXT_EXT.has(extname(e.name).toLowerCase()) && st.size <= 300_000 }); } } };
    walk(root); return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }
  /** Chemin absolu d'un livrable, avec protection contre toute sortie du dossier. */
  deliverablePath(id: string, rel: string): string { const dir = this.dirOf(id); if (!dir) throw new Error("Travail introuvable"); const root = resolve(dir, "livrables"); const p = resolve(root, rel); if (p !== root && !p.startsWith(root + sep)) throw new Error("Chemin non autorisé"); if (!existsSync(p)) throw new Error("Livrable introuvable"); return p; }
  readDeliverable(id: string, rel: string) { const p = this.deliverablePath(id, rel); const st = statSync(p); if (!TEXT_EXT.has(extname(p).toLowerCase()) || st.size > 300_000) throw new Error("Aperçu indisponible pour ce type ou cette taille de fichier."); return readFileSync(p, "utf8"); }
  /** À appeler après chaque réponse : enregistre les nouveaux livrables dans l'activité. */
  syncDeliverables(id: string) { const known = new Set(all<any>(this.db, "SELECT detail FROM work_events WHERE work_id=? AND type='deliverable'", id).map((e) => e.detail)); let n = 0; for (const d of this.deliverables(id)) if (!known.has(d.rel)) { this.ev(id, "deliverable", d.rel); n++; } return n; }
  events(id: string) { return all<any>(this.db, "SELECT * FROM work_events WHERE work_id=? ORDER BY at DESC, rowid DESC LIMIT 200", id); }
}
