import { mkdirSync } from "node:fs";
import { DB, all, one, run, uid, now } from "./db.js";
import type { EventBus } from "./events.js";
import type { ExecutionManager } from "./execution.js";
import type { AICatalog } from "./catalog.js";
import { isGitRepo, hasCommits, worktreeChanges, worktreeDiff } from "./git.js";
import type { ProviderId } from "./types.js";

export interface CompareRun { provider: ProviderId; model?: string | null; effort?: string | null; label?: string }
const END = ["completed", "failed", "cancelled", "interrupted"];

/** Même tâche soumise à plusieurs fournisseurs/modèles, exécutions indépendantes (worktrees séparés si écriture). */
export class Comparisons {
  constructor(private db: DB, private bus: EventBus, private exec: ExecutionManager, private catalog: AICatalog, private sandboxDir: string) {
    bus.on((e) => { if (e.executionId && /^execution\.(completed|failed|cancelled|interrupted)$/.test(e.type)) { const id = e.executionId; setImmediate(() => this.refresh(id)); } });
  }
  private refresh(execId: string) {
    const r = one<any>(this.db, "SELECT comparison_id FROM comparison_runs WHERE execution_id=?", execId); if (!r) return;
    const left = all<any>(this.db, "SELECT e.status FROM comparison_runs r JOIN agent_executions e ON e.id=r.execution_id WHERE r.comparison_id=?", r.comparison_id).some((x) => !END.includes(x.status));
    if (!left) { run(this.db, "UPDATE comparisons SET status='done' WHERE id=? AND status='running'", r.comparison_id); this.bus.emit("comparison.done", { id: r.comparison_id }); }
  }
  async create(o: { projectId: string; prompt: string; write: boolean; runs: CompareRun[] }): Promise<string> {
    if (!o.prompt.trim()) throw new Error("L'instruction est vide."); if (o.runs.length < 2 || o.runs.length > 4) throw new Error("Une comparaison porte sur 2 à 4 configurations.");
    const proj = one<any>(this.db, "SELECT * FROM projects WHERE id=?", o.projectId); if (!proj) throw new Error("Projet introuvable");
    if (o.write && !(isGitRepo(proj.path) && hasCommits(proj.path))) throw new Error("Comparer des modifications nécessite un dépôt Git avec au moins un commit (un worktree isolé par exécution). Sinon, lancez une comparaison en lecture seule.");
    for (const r of o.runs) { const c = await this.catalog.validate(r.provider, r.model || null, r.effort || null); if (!c.ok) throw new Error(`${r.provider} : ${c.error}`); }
    const cid = uid(); run(this.db, "INSERT INTO comparisons (id,project_id,prompt,write,status,created_at) VALUES (?,?,?,?,?,?)", cid, o.projectId, o.prompt.trim(), o.write ? 1 : 0, "running", now());
    for (const r of o.runs) {
      const rid = uid();
      const eid = this.exec.enqueue({ projectId: o.projectId, mode: "code", provider: r.provider, model: r.model || undefined, effort: r.effort || null, prompt: o.prompt.trim(), permission: o.write ? undefined : "read-only", useWorktree: o.write, priority: 7 });
      run(this.db, "INSERT INTO comparison_runs (id,comparison_id,label,provider,model,effort,execution_id,created_at) VALUES (?,?,?,?,?,?,?,?)", rid, cid, r.label ?? null, r.provider, r.model ?? null, r.effort ?? null, eid, now());
    }
    this.bus.emit("comparison.created", { id: cid }); return cid;
  }
  list() { return all<any>(this.db, "SELECT c.*, p.name project_name, (SELECT COUNT(*) FROM comparison_runs WHERE comparison_id=c.id) runs FROM comparisons c LEFT JOIN projects p ON p.id=c.project_id ORDER BY c.created_at DESC"); }
  get(id: string) {
    const c = one<any>(this.db, "SELECT c.*, p.name project_name FROM comparisons c LEFT JOIN projects p ON p.id=c.project_id WHERE c.id=?", id); if (!c) return undefined;
    const runs = all<any>(this.db, "SELECT * FROM comparison_runs WHERE comparison_id=? ORDER BY created_at, rowid", id).map((r) => {
      const ex = one<any>(this.db, "SELECT id,status,model,effort_applied,duration_ms,error,result_text,worktree_id,started_at FROM agent_executions WHERE id=?", r.execution_id);
      const u = one<any>(this.db, "SELECT COALESCE(SUM(input),0) input, COALESCE(SUM(output),0) output, COALESCE(SUM(cache_read+cache_write),0) cache, COALESCE(SUM(total),0) tokens, COUNT(*) n FROM usage_events WHERE execution_id=?", r.execution_id);
      const usd = one<any>(this.db, "SELECT COALESCE(SUM(k.calculated_usd),0) usd, SUM(CASE WHEN k.calculated_usd IS NULL THEN 1 ELSE 0 END) unpriced FROM usage_events e LEFT JOIN cost_estimates k ON k.usage_event_id=e.id WHERE e.execution_id=?", r.execution_id);
      const files = [...new Set(all<any>(this.db, "SELECT content FROM exec_logs WHERE execution_id=? AND kind='file_change'", r.execution_id).flatMap((l) => JSON.parse(l.content) as string[]))];
      const tools = one<any>(this.db, "SELECT COUNT(*) n FROM exec_logs WHERE execution_id=? AND kind='tool'", r.execution_id)?.n ?? 0;
      const wt = ex?.worktree_id && ex.worktree_id !== "pending" ? one<any>(this.db, "SELECT * FROM git_worktrees WHERE id=?", ex.worktree_id) : undefined;
      let changes: any, diff: string | undefined; if (wt) { try { changes = worktreeChanges(wt.path); diff = worktreeDiff(wt.path).slice(0, 60000); } catch { /* worktree indisponible */ } }
      return { ...r, execution: ex, usage: { ...u, usd: usd?.usd ?? 0, unpriced: usd?.unpriced ?? 0 }, files, tools, worktree: wt ? { id: wt.id, branch: wt.branch, path: wt.path } : undefined, changes, diff };
    });
    return { ...c, runs };
  }
  /** « Choisir » ne supprime rien : les autres versions et leurs worktrees sont conservés. */
  choose(id: string, runId: string | "both" | null, note?: string) { run(this.db, "UPDATE comparisons SET winner_run_id=?, note=? WHERE id=?", runId, note ?? null, id); }
  remove(id: string) { run(this.db, "DELETE FROM comparisons WHERE id=?", id); }
  /** Synthèse demandée à un fournisseur (mode Chat, sans outil) à partir des résultats textuels. */
  synthesize(id: string, provider: ProviderId = "claude"): string {
    const c = this.get(id); if (!c) throw new Error("Comparaison introuvable"); if (c.runs.some((r: any) => !END.includes(r.execution?.status))) throw new Error("Attendez la fin de toutes les exécutions.");
    const cap = (s?: string) => (s ?? "(aucune réponse)").slice(0, 5000);
    const body = c.runs.map((r: any, i: number) => `### Version ${i + 1} — ${r.provider}${r.execution?.model ? ` (${r.execution.model})` : ""}\nStatut : ${r.execution?.status} · ${r.usage.tokens} tokens · fichiers modifiés : ${r.files.join(", ") || "aucun détecté"}\n${cap(r.execution?.result_text)}`).join("\n\n");
    const eid = this.exec.enqueue({ projectId: null, mode: "chat", cwd: this.sandbox(), provider, prompt: `Tâche confiée à plusieurs IA : « ${c.prompt} ».\nVoici leurs résultats. Tu n'as accès à aucun outil et ne peux rien vérifier toi-même : base-toi uniquement sur les textes fournis, et signale ce qui n'est pas vérifiable. Compare-les honnêtement (correction apparente, complétude, risques), indique leurs points communs et divergences, et recommande laquelle retenir ou comment les combiner. Ne présume pas qu'une réponse plus courte ou moins coûteuse est la meilleure.\n\n${body}`, systemPrompt: "Tu es un relecteur technique impartial. Tu n'as aucun outil : n'écris jamais d'appel d'outil. Réponds en Markdown, en français.", priority: 7 });
    run(this.db, "UPDATE comparisons SET synthesis_execution_id=? WHERE id=?", eid, id); return eid;
  }
  private sandbox() { mkdirSync(this.sandboxDir, { recursive: true }); return this.sandboxDir; }
}
