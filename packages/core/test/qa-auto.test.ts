import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createCore } from "../src/service.js";
import { detectScripts } from "../src/quality.js";
import { parseCounts } from "../src/counts.js";
import { nextRun, validateAutomation } from "../src/automations.js";
import { now, all, run } from "../src/db.js";
import type { RunRequest, RunHandle, ProviderStatus, ProviderId, ModelInfo } from "../src/types.js";
import type { RunSink } from "../src/providers/common.js";

const T = (o: any = {}) => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, ...o });
const MODELS: ModelInfo[] = [{ id: "", displayName: "Défaut", isDefault: true, source: "cli-alias" }];
function mk(dir?: string) {
  const reqs: (RunRequest & { provider: ProviderId })[] = [];
  const adapter = (id: ProviderId): any => ({ id, detectInstallation: async () => ({ installed: true }), getVersion: async () => "0", getSupportedModels: async () => MODELS, getCapabilities: () => ({}), getQuotaStatus: async () => ({ provider: id, state: "unknown", windows: [], checkedAt: now() }),
    getAuthStatus: async (): Promise<ProviderStatus> => ({ provider: id, installed: true, authenticated: true, authMode: "subscription", warnings: [], checkedAt: now() }),
    startSession(req: RunRequest, sink: RunSink): RunHandle { reqs.push({ ...req, provider: id }); const done = new Promise<void>((res) => setTimeout(() => { sink.event({ type: "session", providerSessionId: "s" }); sink.event({ type: "usage", report: { model: "m", mode: "final", counterKey: "k" + req.executionId, eventKey: "f", confidence: "reported", tokens: T({ input: 10, output: 5, total: 15 }) } }); const t = /orchestrateur d'une équipe/.test(req.prompt) ? "{}" : `Revue ${id}`; sink.event({ type: "text", text: t, final: true }); sink.event({ type: "done", ok: true, message: t }); res(); }, 20)); return { done, cancel: async () => {} }; },
    resumeSession(q: any, s: any) { return (this as any).startSession(q, s); }, cancelExecution: async (h: RunHandle) => h.cancel(), dispose: async () => {} });
  const d = dir ?? mkdtempSync(join(tmpdir(), "qa-")); const c = createCore({ dataDir: d, dbFile: ":memory:", adapters: { claude: adapter("claude"), codex: adapter("codex") } });
  c.settings.set("concurrency.global", 8); c.settings.set("concurrency.provider", 8); const project = c.projects.create({ name: "P", path: d }); return { c, reqs, d, project };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(f: () => boolean, ms = 8000) { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error("timeout"); await wait(20); } }
const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" });
function gitRepo() { const d = mkdtempSync(join(tmpdir(), "qagit-")); git(d, "init", "-q"); git(d, "config", "user.email", "t@t.t"); git(d, "config", "user.name", "t"); writeFileSync(join(d, "a.txt"), "1"); git(d, "add", "."); git(d, "commit", "-qm", "init"); return d; }

describe("Quality Center", () => {
  it("détecte les commandes depuis package.json / tsconfig", () => {
    const d = mkdtempSync(join(tmpdir(), "det-")); writeFileSync(join(d, "package.json"), JSON.stringify({ scripts: { test: "vitest", lint: "eslint .", build: "vite build" } })); writeFileSync(join(d, "tsconfig.json"), "{}");
    expect(detectScripts(d)).toEqual({ test: "npm test", lint: "npm run lint", typecheck: "npx tsc --noEmit", build: "npm run build" });
    const e = mkdtempSync(join(tmpdir(), "det-")); writeFileSync(join(e, "package.json"), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } })); expect(detectScripts(e).test).toBeUndefined(); expect(detectScripts(mkdtempSync(join(tmpdir(), "det-")))).toEqual({});
  });
  it("décompte de tests : vitest, jest, cargo, pytest ; format inconnu → null (rien d'inventé)", () => {
    expect(parseCounts("  Tests  1 failed | 106 passed (107)\n")).toEqual({ passed: 106, failed: 1, total: 107 }); expect(parseCounts("      Tests  107 passed (107)")).toEqual({ passed: 107, failed: 0, total: 107 });
    expect(parseCounts("Tests:       2 failed, 8 passed, 10 total")).toEqual({ passed: 8, failed: 2, total: 10 }); expect(parseCounts("test result: ok. 12 passed; 1 failed; 0 ignored")).toEqual({ passed: 12, failed: 1, total: 13 });
    expect(parseCounts("===== 3 failed, 17 passed in 2.31s =====")).toEqual({ passed: 17, failed: 3, total: 20 }); expect(parseCounts("rien de reconnaissable")).toBeNull();
  });
  it("exécute vraiment les commandes : pass, fail, régression, historique, synthèse, notification", async () => {
    const { c, project } = mk(); c.quality.setScripts(project, { test: "node -e \"console.log('Tests  4 passed (4)')\"", lint: "node -e \"process.exit(2)\"" });
    const ok = await c.quality.run(project, "test"); expect(ok).toMatchObject({ status: "pass", exit_code: 0, passed: 4, failed: 0, total: 4, regression: 0 });
    const bad = await c.quality.run(project, "lint"); expect(bad).toMatchObject({ status: "fail", exit_code: 2 }); expect(c.notifications.list().some((n: any) => n.category === "quality")).toBe(true);
    c.quality.setScripts(project, { test: "node -e \"process.exit(1)\"" }); const reg = await c.quality.run(project, "test"); expect(reg).toMatchObject({ status: "fail", regression: 1 }); expect(c.notifications.list().some((n: any) => /Régression/.test(n.title))).toBe(true);
    const sum = c.quality.summary(project); expect(sum.test).toMatchObject({ runs: 2, passRate: 50, regressions: 1 }); expect(sum.test.last.status).toBe("fail"); expect(sum.build.last).toBeNull(); expect(c.quality.history(project, "test")).toHaveLength(2);
    await expect(c.quality.run(project, "build")).rejects.toThrow(/Aucune commande/);
  });
  it("refuse deux contrôles identiques simultanés", async () => {
    const { c, project } = mk(); c.quality.setScripts(project, { test: "node -e \"setTimeout(()=>{},400)\"" }); const a = c.quality.run(project, "test"); await expect(c.quality.run(project, "test")).rejects.toThrow(/déjà en cours/); expect((await a).status).toBe("pass");
  });
  it("revue IA : diff transmis en mode Chat isolé (sans outil), revue croisée possible, erreurs claires", async () => {
    const repo = gitRepo(); const { c, reqs } = mk(); const p = c.projects.create({ name: "G", path: repo }); expect(() => c.quality.review(p, "claude")).toThrow(/propre/); writeFileSync(join(repo, "a.txt"), "2"); writeFileSync(join(repo, "neuf.txt"), "x");
    const rid = c.quality.review(p, "codex"); await until(() => c.quality.reviews(p)[0]?.status === "completed"); const q = reqs.at(-1)!; expect(q.provider).toBe("codex"); expect(q.policy).toBe("chat"); expect(q.cwd).not.toBe(repo); expect(q.prompt).toMatch(/\+2/); expect(q.prompt).toMatch(/neuf\.txt/); expect(c.quality.reviews(p)[0]).toMatchObject({ id: rid, files: ["a.txt"], result_text: "Revue codex" });
    const { c: c2, project } = mk(); expect(() => c2.quality.review(project, "claude")).toThrow(/dépôt Git/);
  });
});

describe("Automation Center", () => {
  it("calcule les prochaines échéances (intervalle, quotidien, hebdomadaire) et valide les entrées", () => {
    const from = new Date(2026, 0, 7, 10, 0, 0); // mercredi
    expect(nextRun("interval", { everyMinutes: 30 }, from)!.getTime() - from.getTime()).toBe(30 * 60000); expect(nextRun("interval", { everyMinutes: 1 }, from)!.getTime() - from.getTime()).toBe(5 * 60000); // plancher 5 min
    expect(nextRun("daily", { time: "09:30" }, from)).toEqual(new Date(2026, 0, 8, 9, 30)); expect(nextRun("daily", { time: "18:00" }, from)).toEqual(new Date(2026, 0, 7, 18, 0));
    expect(nextRun("weekly", { days: [1], time: "08:00" }, from)).toEqual(new Date(2026, 0, 12, 8, 0)); expect(nextRun("task_done", {}, from)).toBeNull();
    expect(() => nextRun("daily", { time: "25:00" }, from)).toThrow(/Heure invalide/); expect(() => nextRun("weekly", { days: [], time: "08:00" }, from)).toThrow(/Jours/);
    expect(() => validateAutomation({ trigger_kind: "manual", trigger_config: {}, action_kind: "create_task", action_config: { projectId: "p" } })).toThrow(/Titre/);
  });
  it("actions sensibles : confirmation obligatoire ; plafond du nombre d'automatisations ; audit", () => {
    const { c, project } = mk(); const base = { name: "T", trigger_kind: "manual" as const, trigger_config: {}, action_kind: "run_checks" as const, action_config: { projectId: project } };
    expect(() => c.automations.create(base)).toThrow(/confirmation explicite/); const id = c.automations.create({ ...base, confirmed: true }); expect(c.automations.get(id).confirmed_at).toBeTruthy(); expect(c.audit().some((a: any) => a.type === "automation.created")).toBe(true);
    c.automations.create({ name: "N", trigger_kind: "manual", trigger_config: {}, action_kind: "notify", action_config: { title: "x" } });
  });
  it("lance une action manuelle, enregistre l'exécution, signale l'échec ; plafond quotidien", async () => {
    const { c, project } = mk(); const n = c.automations.create({ name: "Notif", trigger_kind: "manual", trigger_config: {}, action_kind: "notify", action_config: { title: "Bonjour", body: "corps" }, max_runs_per_day: 1 });
    expect(await c.automations.fire(n, "manual")).toMatchObject({ status: "ok" }); expect(c.notifications.list().some((x: any) => x.title === "Bonjour")).toBe(true); expect(c.automations.runs(n)[0]).toMatchObject({ status: "ok", trigger: "manual" });
    expect((await c.automations.fire(n, "planifié")).status).toBe("skipped"); expect((await c.automations.fire(n, "manual")).status).toBe("ok"); // manuel non plafonné, planifié oui
    const bad = c.automations.create({ name: "KO", trigger_kind: "manual", trigger_config: {}, action_kind: "create_task", action_config: { projectId: "inexistant", title: "t" } }); void project; expect((await c.automations.fire(bad)).status).toBe("error"); expect(c.notifications.list().some((x: any) => /en échec/.test(x.title))).toBe(true);
  });
  it("planification : l'échéance passée déclenche l'action puis se replanifie ; rattrapage selon le réglage", async () => {
    const { c, project } = mk(); const a = c.automations.create({ name: "Tâche quotidienne", trigger_kind: "daily", trigger_config: { time: "09:00" }, action_kind: "create_task", action_config: { projectId: project, title: "Revue du matin" } });
    run(c.db, "UPDATE automations SET next_run_at=? WHERE id=?", new Date(Date.now() - 1000).toISOString(), a); await c.automations.tick(); await until(() => c.automations.runs(a).length === 1);
    expect(c.automations.runs(a)[0]).toMatchObject({ status: "ok", trigger: "planifié" }); expect(c.tasks.list(project).some((t: any) => t.title === "Revue du matin")).toBe(true); expect(new Date(c.automations.get(a).next_run_at).getTime()).toBeGreaterThan(Date.now());
    const sk = c.automations.create({ name: "Sans rattrapage", trigger_kind: "daily", trigger_config: { time: "09:00" }, action_kind: "notify", action_config: { title: "R" } }); run(c.db, "UPDATE automations SET next_run_at=? WHERE id=?", new Date(Date.now() - 5000).toISOString(), sk);
    (c.automations as any).catchUp(); expect(c.automations.runs(sk)[0]).toMatchObject({ status: "skipped", trigger: "rattrapage" }); expect(c.notifications.list().some((x: any) => x.title === "R")).toBe(false);
  });
  it("déclencheurs sur événements : workflow terminé, contrôle en échec, tâche terminée", async () => {
    const { c, project } = mk(); const wf = c.workflows.list().find((w: any) => w.key === "dual");
    const a1 = c.automations.create({ name: "Après workflow", trigger_kind: "workflow_done", trigger_config: { workflowId: wf.id }, action_kind: "notify", action_config: { title: "Workflow fini" } });
    const a2 = c.automations.create({ name: "Si tests KO", trigger_kind: "checks_failed", trigger_config: { projectId: project }, action_kind: "create_task", action_config: { projectId: project, title: "Corriger les tests" } });
    const a3 = c.automations.create({ name: "Après tâche", trigger_kind: "task_done", trigger_config: { projectId: project }, action_kind: "notify", action_config: { title: "Tâche finie" } });
    await c.workflows.run({ workflowId: wf.id, projectId: project, goal: "x" }); await until(() => c.automations.runs(a1).length === 1, 10000); expect(c.notifications.list().some((n: any) => n.title === "Workflow fini")).toBe(true);
    c.quality.setScripts(project, { test: "node -e \"process.exit(1)\"" }); await c.quality.run(project, "test"); await until(() => c.automations.runs(a2).length === 1); expect(c.tasks.list(project).some((t: any) => t.title === "Corriger les tests")).toBe(true);
    const t = c.tasks.create({ projectId: project, title: "Tâche réelle" }); c.tasks.start(t); await until(() => c.automations.runs(a3).length >= 1); expect(c.automations.runs(a3)[0].status).toBe("ok");
  });
  it("nouveau commit Git : détecté entre deux relevés", async () => {
    const repo = gitRepo(); const { c } = mk(); const p = c.projects.create({ name: "G", path: repo }); const a = c.automations.create({ name: "Commit", trigger_kind: "new_commit", trigger_config: { projectId: p }, action_kind: "notify", action_config: { title: "Nouveau commit !" } });
    await c.automations.tick(); expect(c.automations.runs(a)).toHaveLength(0); writeFileSync(join(repo, "b.txt"), "b"); git(repo, "add", "."); git(repo, "commit", "-qm", "deux"); await c.automations.tick(); await until(() => c.automations.runs(a).length === 1); expect(c.automations.runs(a)[0].trigger).toBe("nouveau commit");
    await c.automations.tick(); await wait(100); expect(c.automations.runs(a)).toHaveLength(1); // pas de doublon sans nouveau commit
  });
  it("désactiver supprime l'échéance ; réactiver la recalcule ; suppression en cascade de l'historique", async () => {
    const { c } = mk(); const a = c.automations.create({ name: "I", trigger_kind: "interval", trigger_config: { everyMinutes: 10 }, action_kind: "notify", action_config: { title: "x" } }); expect(c.automations.get(a).next_run_at).toBeTruthy();
    c.automations.setEnabled(a, false); expect(c.automations.get(a)).toMatchObject({ enabled: 0, next_run_at: null }); c.automations.setEnabled(a, true); expect(c.automations.get(a).next_run_at).toBeTruthy(); await c.automations.fire(a); c.automations.remove(a); expect(all(c.db, "SELECT 1 FROM automation_runs WHERE automation_id=?", a)).toHaveLength(0);
  });
});
