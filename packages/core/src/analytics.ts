import { DB, all, one } from "./db.js";
export interface UsageFilter { provider?: string; mode?: string; model?: string; agentId?: string; projectId?: string; taskId?: string; since?: string; until?: string }
function where(f: UsageFilter) {
  const c: string[] = []; const p: any[] = [];
  const add = (col: string, v?: string, op = "=") => { if (v) { c.push(`${col}${op}?`); p.push(v); } };
  add("u.provider", f.provider); add("xe.mode", f.mode); add("u.model", f.model); add("u.agent_id", f.agentId); add("u.project_id", f.projectId); add("u.task_id", f.taskId); add("u.created_at", f.since, ">="); add("u.created_at", f.until, "<=");
  return { sql: c.length ? "WHERE " + c.join(" AND ") : "", p };
}
const AGG = `COALESCE(SUM(u.input),0) input, COALESCE(SUM(u.output),0) output, COALESCE(SUM(u.cache_read),0) cache_read, COALESCE(SUM(u.cache_write),0) cache_write, COALESCE(SUM(u.reasoning),0) reasoning, COALESCE(SUM(u.total),0) total, COALESCE(SUM(c.calculated_usd),0) usd, COUNT(*) events, SUM(CASE WHEN c.status<>'calculated' OR c.calculated_usd IS NULL THEN 1 ELSE 0 END) unpriced, SUM(CASE WHEN u.confidence IN ('unknown','estimated') THEN 1 ELSE 0 END) uncertain, COALESCE(SUM(u.provider_cost_usd),0) provider_cost_usd`;
const FROM = `FROM usage_events u LEFT JOIN cost_estimates c ON c.usage_event_id=u.id LEFT JOIN agent_executions xe ON xe.id=u.execution_id`;

export function usageTotals(db: DB, f: UsageFilter = {}) { const w = where(f); return one<any>(db, `SELECT ${AGG} ${FROM} ${w.sql}`, ...w.p); }
export type GroupBy = "mode" | "provider" | "model" | "agent" | "project" | "task" | "execution" | "session";
export function usageBy(db: DB, by: GroupBy, f: UsageFilter = {}, limit = 50) {
  const col = { mode: "xe.mode", provider: "u.provider", model: "u.model", agent: "u.agent_id", project: "u.project_id", task: "u.task_id", execution: "u.execution_id", session: "e.provider_session_id" }[by];
  const w = where(f);
  const join = by === "session" ? "LEFT JOIN agent_executions e ON e.id=u.execution_id" : "";
  const label = { mode: "xe.mode", provider: "u.provider", model: "u.model", agent: "(SELECT name FROM agent_profiles WHERE id=u.agent_id)", project: "(SELECT name FROM projects WHERE id=u.project_id)", task: "(SELECT title FROM tasks WHERE id=u.task_id)", execution: "u.execution_id", session: "e.provider_session_id" }[by];
  return all(db, `SELECT ${col} key, ${label} label, ${AGG} ${FROM} ${join} ${w.sql} GROUP BY ${col} ORDER BY total DESC LIMIT ${limit}`, ...w.p);
}
export function usageSeries(db: DB, bucket: "hour" | "day" | "week" | "month", f: UsageFilter = {}) {
  const fmt = { hour: "%Y-%m-%d %H:00", day: "%Y-%m-%d", week: "%Y-W%W", month: "%Y-%m" }[bucket]; const w = where(f);
  return all(db, `SELECT strftime('${fmt}', u.created_at, 'localtime') bucket, u.provider provider, ${AGG} ${FROM} ${w.sql} GROUP BY bucket, u.provider ORDER BY bucket`, ...w.p);
}
export function executionStats(db: DB, f: { projectId?: string; since?: string } = {}) {
  const c: string[] = []; const p: any[] = []; if (f.projectId) { c.push("project_id=?"); p.push(f.projectId); } if (f.since) { c.push("created_at>=?"); p.push(f.since); }
  const w = c.length ? "WHERE " + c.join(" AND ") : "";
  return all(db, `SELECT provider, agent_id, COUNT(*) runs, SUM(status='completed') ok, SUM(status='failed') failed, SUM(status='cancelled') cancelled, AVG(CASE WHEN status='completed' THEN duration_ms END) avg_ms, MAX(retries) retries FROM (SELECT *, attempt-1 retries FROM agent_executions) ${w} GROUP BY provider, agent_id`, ...p);
}
export function exportRows(db: DB, f: UsageFilter, fmt: "csv" | "json") {
  const w = where(f);
  const rows = all<any>(db, `SELECT u.created_at, u.provider, u.model, u.execution_id, u.task_id, u.agent_id, u.project_id, u.input, u.output, u.cache_read, u.cache_write, u.reasoning, u.total, u.confidence, u.source, u.provider_cost_usd, c.calculated_usd api_equivalent_usd, c.status pricing_status, c.pricing_version FROM usage_events u LEFT JOIN cost_estimates c ON c.usage_event_id=u.id LEFT JOIN agent_executions xe ON xe.id=u.execution_id ${w.sql} ORDER BY u.created_at`, ...w.p);
  if (fmt === "json") return JSON.stringify(rows, null, 2);
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]); const esc = (v: any) => v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  return [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
}

/** Lignes détaillées : agent × fournisseur × modèle, avec tâches, exécutions et durée cumulée. */
export function usageRows(db: DB, f: UsageFilter = {}) {
  const w = where(f);
  return all(db, `WITH per AS (SELECT u.execution_id, u.agent_id, u.provider, u.model, u.task_id, u.project_id, SUM(u.input) input, SUM(u.output) output, SUM(u.cache_read+u.cache_write) cache, SUM(u.total) total, COALESCE(SUM(c.calculated_usd),0) usd, SUM(CASE WHEN c.calculated_usd IS NULL THEN 1 ELSE 0 END) unpriced FROM usage_events u LEFT JOIN cost_estimates c ON c.usage_event_id=u.id LEFT JOIN agent_executions xe ON xe.id=u.execution_id ${w.sql} GROUP BY u.execution_id, u.model)
    SELECT per.agent_id, (SELECT name FROM agent_profiles WHERE id=per.agent_id) agent, per.provider, per.model, COUNT(DISTINCT per.task_id) tasks, COUNT(*) runs, SUM(input) input, SUM(output) output, SUM(cache) cache, SUM(total) total, SUM(usd) usd, SUM(unpriced) unpriced, SUM((SELECT duration_ms FROM agent_executions e WHERE e.id=per.execution_id)) duration_ms FROM per GROUP BY per.agent_id, per.provider, per.model ORDER BY total DESC`, ...w.p);
}
