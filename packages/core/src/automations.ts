import { DB, all, one, run, uid, now } from "./db.js";
import type { EventBus } from "./events.js";

export type TriggerKind = "manual" | "interval" | "daily" | "weekly" | "task_done" | "workflow_done" | "checks_failed" | "new_commit" | "provider_available";
export type ActionKind = "run_workflow" | "run_checks" | "review_changes" | "notify" | "create_task" | "usage_report";
export const TRIGGERS: TriggerKind[] = ["manual", "interval", "daily", "weekly", "task_done", "workflow_done", "checks_failed", "new_commit", "provider_available"];
export const ACTIONS: ActionKind[] = ["run_workflow", "run_checks", "review_changes", "notify", "create_task", "usage_report"];
/** Actions qui exécutent du code ou lancent des agents : confirmation explicite à la création. */
export const SENSITIVE: ActionKind[] = ["run_workflow", "run_checks", "review_changes"];
export const MIN_INTERVAL_MIN = 5; export const MAX_AUTOMATIONS = 50;

const hm = (t: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t ?? ""); if (!m || +m[1]! > 23 || +m[2]! > 59) throw new Error("Heure invalide (HH:MM)."); return [+m[1]!, +m[2]!] as const; };
/** Prochaine échéance (heure locale) ; null pour les déclencheurs sur événement. Pur et testable. */
export function nextRun(kind: TriggerKind, cfg: any, from: Date): Date | null {
  if (kind === "interval") { const m = Math.max(MIN_INTERVAL_MIN, Number(cfg?.everyMinutes) || 0); if (!cfg?.everyMinutes) throw new Error("Intervalle manquant."); return new Date(from.getTime() + m * 60_000); }
  if (kind === "daily" || kind === "weekly") {
    const [h, m] = hm(cfg?.time); const days: number[] = kind === "weekly" ? (cfg?.days ?? []).map(Number) : [0, 1, 2, 3, 4, 5, 6]; if (!days.length || days.some((d) => d < 0 || d > 6)) throw new Error("Jours invalides.");
    for (let i = 0; i < 8; i++) { const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i, h, m, 0, 0); if (d > from && days.includes(d.getDay())) return d; }
  }
  return null;
}
export function validateAutomation(a: { trigger_kind: string; trigger_config: any; action_kind: string; action_config: any }) {
  if (!TRIGGERS.includes(a.trigger_kind as TriggerKind)) throw new Error("Déclencheur inconnu."); if (!ACTIONS.includes(a.action_kind as ActionKind)) throw new Error("Action inconnue.");
  nextRun(a.trigger_kind as TriggerKind, a.trigger_config, new Date()); const c = a.action_config ?? {};
  if (a.action_kind === "run_workflow" && (!c.workflowId || !c.projectId || !String(c.goal ?? "").trim())) throw new Error("Workflow, projet et objectif requis.");
  if ((a.action_kind === "run_checks" || a.action_kind === "review_changes" || a.action_kind === "create_task") && !c.projectId) throw new Error("Projet requis.");
  if (a.action_kind === "create_task" && !String(c.title ?? "").trim()) throw new Error("Titre de tâche requis."); if (a.action_kind === "notify" && !String(c.title ?? "").trim()) throw new Error("Titre de notification requis.");
  if (a.trigger_kind === "new_commit" && !a.trigger_config?.projectId) throw new Error("Projet requis pour surveiller les commits."); if (a.trigger_kind === "provider_available" && !["claude", "codex"].includes(a.trigger_config?.provider)) throw new Error("Fournisseur requis.");
}

export interface AutomationDeps {
  runWorkflow(c: any): Promise<string>; runChecks(c: any): Promise<string>; reviewChanges(c: any): Promise<string>; notify(title: string, body: string): void; createTask(c: any): Promise<string>; usageReport(c: any): Promise<string>;
  gitHead(projectId: string): string | undefined; providerState(p: string): Promise<string>;
}
/** Automation Center : déclencheurs planifiés ou sur événements ; tourne tant que l'application est ouverte. Respecte la file d'exécution, les permissions et les limites de concurrence. */
export class Automations {
  private timer?: NodeJS.Timeout; private busy = new Set<string>();
  constructor(private db: DB, private bus: EventBus, private deps: AutomationDeps) {
    bus.on((e) => {
      if (e.type === "orchestration.status" && e.payload.status === "completed") void this.fireEvent("workflow_done", { orchestrationId: e.payload.id });
      else if (e.type === "quality.failed") void this.fireEvent("checks_failed", { projectId: e.projectId });
      else if (e.type === "execution.completed" && e.taskId) void this.fireEvent("task_done", { projectId: e.projectId, taskId: e.taskId });
    });
  }
  start(everyMs = 30_000) { this.catchUp(); this.timer = setInterval(() => void this.tick(), everyMs); this.timer.unref?.(); }
  stop() { if (this.timer) clearInterval(this.timer); }
  list() { return all<any>(this.db, "SELECT a.*, (SELECT COUNT(*) FROM automation_runs WHERE automation_id=a.id) runs, (SELECT COUNT(*) FROM automation_runs WHERE automation_id=a.id AND status='ok') ok FROM automations a ORDER BY a.created_at DESC").map((a) => ({ ...a, trigger_config: JSON.parse(a.trigger_config), action_config: JSON.parse(a.action_config) })); }
  runs(id: string) { return all<any>(this.db, "SELECT * FROM automation_runs WHERE automation_id=? ORDER BY at DESC LIMIT 50", id); }
  get(id: string) { return this.list().find((a) => a.id === id); }
  create(a: { name: string; trigger_kind: TriggerKind; trigger_config: any; action_kind: ActionKind; action_config: any; catchup?: boolean; max_runs_per_day?: number; confirmed?: boolean }) {
    if (!a.name.trim()) throw new Error("Nom requis."); if (one<any>(this.db, "SELECT COUNT(*) c FROM automations")!.c >= MAX_AUTOMATIONS) throw new Error(`${MAX_AUTOMATIONS} automatisations maximum.`);
    validateAutomation(a); if (SENSITIVE.includes(a.action_kind) && !a.confirmed) throw new Error("Cette action exécute du code ou lance des agents : confirmation explicite requise.");
    const id = uid(); const next = nextRun(a.trigger_kind, a.trigger_config, new Date());
    run(this.db, "INSERT INTO automations (id,name,trigger_kind,trigger_config,action_kind,action_config,enabled,catchup,max_runs_per_day,next_run_at,confirmed_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", id, a.name.trim(), a.trigger_kind, JSON.stringify(a.trigger_config ?? {}), a.action_kind, JSON.stringify(a.action_config ?? {}), 1, a.catchup ? 1 : 0, Math.min(100, a.max_runs_per_day ?? 20), next?.toISOString() ?? null, a.confirmed ? now() : null, now());
    run(this.db, "INSERT INTO audit_events (id,type,payload,at) VALUES (?,?,?,?)", uid(), "automation.created", JSON.stringify({ id, name: a.name, trigger: a.trigger_kind, action: a.action_kind }), now()); return id;
  }
  setEnabled(id: string, v: boolean) { const a = this.get(id); if (!a) return; const next = v ? nextRun(a.trigger_kind, a.trigger_config, new Date()) : null; run(this.db, "UPDATE automations SET enabled=?, next_run_at=? WHERE id=?", v ? 1 : 0, next?.toISOString() ?? null, id); }
  remove(id: string) { run(this.db, "DELETE FROM automations WHERE id=?", id); }

  private runsToday(id: string) { const d = new Date(); d.setHours(0, 0, 0, 0); return one<any>(this.db, "SELECT COUNT(*) c FROM automation_runs WHERE automation_id=? AND at>=? AND status!='skipped'", id, d.toISOString())!.c as number; }
  /** Exécute l'action ; jamais de relance si la précédente tourne encore, plafond de lancements par jour. */
  async fire(id: string, trigger = "manual", ctx: any = {}): Promise<{ status: string; detail: string }> {
    const a = this.get(id); if (!a) throw new Error("Automatisation introuvable");
    const rec = (status: string, detail: string, ref?: string) => { run(this.db, "INSERT INTO automation_runs VALUES (?,?,?,?,?,?,?)", uid(), id, now(), trigger, status, detail.slice(0, 500), ref ?? null); run(this.db, "UPDATE automations SET last_run_at=?, last_status=? WHERE id=?", now(), status, id); this.bus.emit("automation.run", { id, status, detail }); return { status, detail }; };
    if (this.busy.has(id)) return rec("skipped", "Exécution précédente encore en cours."); if (trigger !== "manual" && this.runsToday(id) >= a.max_runs_per_day) return rec("skipped", `Plafond de ${a.max_runs_per_day} lancements par jour atteint.`);
    this.busy.add(id);
    try { const c = { ...a.action_config, _ctx: ctx }; let ref = ""; switch (a.action_kind as ActionKind) {
      case "run_workflow": ref = await this.deps.runWorkflow(c); break; case "run_checks": ref = await this.deps.runChecks(c); break; case "review_changes": ref = await this.deps.reviewChanges(c); break;
      case "notify": this.deps.notify(String(c.title), String(c.body ?? "")); ref = "notification"; break; case "create_task": ref = await this.deps.createTask(c); break; case "usage_report": ref = await this.deps.usageReport(c); break; }
      return rec("ok", ref ? `Terminé : ${ref}` : "Terminé", ref); }
    catch (e: any) { this.deps.notify(`Automatisation « ${a.name} » en échec`, String(e.message)); return rec("error", String(e.message)); }
    finally { this.busy.delete(id); }
  }
  /** Rattrapage au démarrage : une seule exécution (si activé) puis replanification future ; sinon l'échéance manquée est ignorée. */
  private catchUp() { for (const a of all<any>(this.db, "SELECT * FROM automations WHERE enabled=1 AND next_run_at IS NOT NULL AND next_run_at<=?", now())) { const next = nextRun(a.trigger_kind, JSON.parse(a.trigger_config), new Date()); run(this.db, "UPDATE automations SET next_run_at=? WHERE id=?", next?.toISOString() ?? null, a.id); if (a.catchup) void this.fire(a.id, "rattrapage"); else run(this.db, "INSERT INTO automation_runs VALUES (?,?,?,?,?,?,?)", uid(), a.id, now(), "rattrapage", "skipped", "Échéance manquée pendant que l'application était fermée (rattrapage désactivé).", null); } }
  async tick() {
    const t = new Date();
    for (const a of all<any>(this.db, "SELECT * FROM automations WHERE enabled=1 AND next_run_at IS NOT NULL AND next_run_at<=?", t.toISOString())) { const next = nextRun(a.trigger_kind, JSON.parse(a.trigger_config), t); run(this.db, "UPDATE automations SET next_run_at=? WHERE id=?", next?.toISOString() ?? null, a.id); void this.fire(a.id, "planifié"); }
    for (const a of all<any>(this.db, "SELECT * FROM automations WHERE enabled=1 AND trigger_kind IN ('new_commit','provider_available')")) {
      const cfg = JSON.parse(a.trigger_config); const st = a.trigger_state ? JSON.parse(a.trigger_state) : {};
      if (a.trigger_kind === "new_commit") { const head = this.deps.gitHead(cfg.projectId); if (head && st.head && head !== st.head) void this.fire(a.id, "nouveau commit", { head }); if (head && head !== st.head) run(this.db, "UPDATE automations SET trigger_state=? WHERE id=?", JSON.stringify({ head }), a.id); }
      else { const state = await this.deps.providerState(cfg.provider).catch(() => "unknown"); const was = st.state; if ((was === "limited" || was === "exhausted") && state === "available") void this.fire(a.id, "fournisseur disponible"); if (state !== was) run(this.db, "UPDATE automations SET trigger_state=? WHERE id=?", JSON.stringify({ state }), a.id); }
    }
  }
  private async fireEvent(kind: TriggerKind, ctx: any) { for (const a of this.list().filter((x) => x.enabled && x.trigger_kind === kind)) { const c = a.trigger_config ?? {}; if (c.projectId && ctx.projectId && c.projectId !== ctx.projectId) continue; if (kind === "workflow_done" && c.workflowId) { const o = one<any>(this.db, "SELECT workflow_id FROM orchestrations WHERE id=?", ctx.orchestrationId); if (o?.workflow_id !== c.workflowId) continue; } void this.fire(a.id, kind, ctx); } }
}
