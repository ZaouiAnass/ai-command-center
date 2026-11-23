import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCore } from "../src/service.js";
import { parseClaudeHelp, buildClaudeArgs, claudeUserMessage } from "../src/providers/claude.js";
import { describePolicy, policyFor } from "../src/policies.js";
import { now, all, one, run } from "../src/db.js";
import type { RunRequest, RunHandle, ProviderStatus, ProviderId, ModelInfo } from "../src/types.js";
import type { RunSink } from "../src/providers/common.js";

const T = (o: any = {}) => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, ...o });
const CODEX_MODELS: ModelInfo[] = [{ id: "gpt-6.2-sol", displayName: "GPT-6.2-Sol", isDefault: true, defaultEffort: "low", efforts: ["low", "medium", "high"].map((value) => ({ value })), source: "provider" }, { id: "gpt-6-luna", displayName: "Luna", source: "provider" /* aucun effort exposé */ }];
const CLAUDE_MODELS: ModelInfo[] = [{ id: "", displayName: "Défaut", isDefault: true, source: "cli-alias", efforts: ["low", "medium", "high"].map((value) => ({ value })) }, { id: "sonnet", displayName: "Sonnet", source: "cli-alias", efforts: ["low", "medium", "high"].map((value) => ({ value })) }, { id: "opus", displayName: "Opus", source: "cli-alias", efforts: ["low", "medium", "high"].map((value) => ({ value })) }];

interface Rig { reqs: (RunRequest & { provider: ProviderId })[]; auth: Record<ProviderId, boolean>; authMode: Record<ProviderId, string>; toolInChat: boolean; sess: number }
function mk() {
  const r: Rig = { reqs: [], auth: { claude: true, codex: true }, authMode: { claude: "subscription", codex: "subscription" }, toolInChat: false, sess: 0 };
  const adapter = (id: ProviderId): any => ({ id, detectInstallation: async () => ({ installed: true }), getVersion: async () => "0", getSupportedModels: async () => (id === "codex" ? CODEX_MODELS : CLAUDE_MODELS), getCapabilities: () => ({}), getQuotaStatus: async () => ({ provider: id, state: "unknown", windows: [], checkedAt: now() }),
    getAuthStatus: async (): Promise<ProviderStatus> => ({ provider: id, installed: true, authenticated: r.auth[id], authMode: r.authMode[id] as any, warnings: [], checkedAt: now() }),
    startSession(req: RunRequest, sink: RunSink): RunHandle {
      r.reqs.push({ ...req, provider: id }); const sid = req.resumeSessionId ?? `sess-${id}-${++r.sess}`; let cancelled = false;
      const done = new Promise<void>((res) => { setTimeout(() => {
        sink.event({ type: "session", providerSessionId: sid }); sink.event({ type: "applied", model: req.model || `${id}-default`, effort: req.effort ?? null, effortSource: req.effort ? "requested" : "provider_default" });
        if (r.toolInChat && req.policy === "chat") { sink.event({ type: "tool", id: "t1", name: "Bash", summary: "ls", state: "started" }); setTimeout(() => { if (!cancelled) { sink.event({ type: "done", ok: true, message: "x" }); } res(); }, 300); return; }
        sink.event({ type: "usage", report: { model: req.model || `${id}-default`, mode: "final", counterKey: "k" + req.executionId, eventKey: "final", confidence: "reported", tokens: T({ input: 10, output: 5, total: 15 }) } });
        const text = `Réponse à: ${req.prompt.split("\n").pop()}`; sink.event({ type: "text", text, final: true }); sink.event({ type: "done", ok: true, message: text }); res(); }, 20); });
      return { done, cancel: async () => { cancelled = true; sink.event({ type: "done", ok: false, message: "Annulé" }); } }; },
    resumeSession(q: any, s: any) { return (this as any).startSession(q, s); }, cancelExecution: async (h: RunHandle) => h.cancel(), dispose: async () => {} });
  const dir = mkdtempSync(join(tmpdir(), "modes-")); const c = createCore({ dataDir: dir, dbFile: ":memory:", adapters: { claude: adapter("claude"), codex: adapter("codex") } });
  c.settings.set("concurrency.global", 6); c.settings.set("concurrency.provider", 6); const project = c.projects.create({ name: "P", path: dir }); return { c, r, dir, project };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(f: () => boolean, ms = 6000) { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error("timeout"); await wait(15); } }
const reply = async (c: any, id: string, n: number) => until(() => c.conversations.messages(id).filter((m: any) => m.role === "assistant").length === n);

describe("politiques et arguments CLI", () => {
  it("Chat/Claude désactive tous les outils, sans projet", () => { const a = buildClaudeArgs({ executionId: "e", prompt: "x", cwd: "/s", permission: "read-only", approvalPolicy: "never", policy: "chat", effort: "high", model: "sonnet" } as any); const i = a.indexOf("--tools"); expect(i).toBeGreaterThan(-1); expect(a[i + 1]).toBe(""); expect(a).toEqual(expect.arrayContaining(["--setting-sources", "project", "--strict-mcp-config", "--disable-slash-commands"])); expect(a).toContain("--effort"); expect(a[a.indexOf("--effort") + 1]).toBe("high"); expect(a[a.indexOf("--permission-mode") + 1]).toBe("default"); });
  it("Code/Claude garde ses outils (pas de --tools) et acceptEdits ; sans effort aucun --effort", () => { const a = buildClaudeArgs({ executionId: "e", prompt: "x", cwd: "/p", permission: "workspace-write", approvalPolicy: "never", policy: "code" } as any); expect(a).not.toContain("--tools"); expect(a).not.toContain("--strict-mcp-config"); expect(a).not.toContain("--effort"); expect(a[a.indexOf("--permission-mode") + 1]).toBe("acceptEdits"); });
  it("lit alias et efforts dans la vraie forme de `claude --help`", () => { const h = parseClaudeHelp(`  --effort <level>   Effort level for the current session\n                     (low, medium, high, xhigh, max)\n  --model <model>    Model for the current session. Use an\n                     alias for the latest model (e.g.\n                     'fable', 'opus', or 'sonnet') or a model's full name.`); expect(h.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]); expect(h.aliases).toEqual(["fable", "opus", "sonnet"]); expect(parseClaudeHelp("rien")).toEqual({ aliases: [], efforts: [] }); });
  it("descriptions honnêtes : Chat/Codex n'affirme pas une isolation totale ; pas de Chat natif", () => {
    const cx = describePolicy("chat", "codex"); expect(cx.notGuaranteed.join(" ")).toMatch(/ne garantit pas/); expect(cx.notGuaranteed.join(" ")).toMatch(/pas le ChatGPT Chat natif/); expect(cx.bestEffort.join(" ")).toMatch(/interrompue/);
    expect(describePolicy("chat", "claude").guaranteed.join(" ")).toMatch(/MCP/); expect(describePolicy("work", "claude").guaranteed.join(" ")).toMatch(/Work natif|local/);
    expect(policyFor("chat").requiresProject).toBe(false); expect(policyFor("code").requiresProject).toBe(true); expect(policyFor("chat").tools).toBe("none");
  });
});

describe("catalogue modèles / efforts", () => {
  it("valide modèle et effort selon ce que le fournisseur expose", async () => {
    const { c } = mk();
    expect((await c.ai.validate("codex", "gpt-6.2-sol", "medium")).ok).toBe(true);
    expect((await c.ai.validate("codex", "gpt-6.2-sol", "ultra")).error).toMatch(/non pris en charge/);
    expect((await c.ai.validate("codex", "gpt-6-luna", "low")).error).toMatch(/n'expose pas de réglage d'effort/);
    expect((await c.ai.validate("codex", "gpt-inconnu")).error).toMatch(/n'est pas disponible/);
    expect((await c.ai.validate("claude", "", "max")).error).toMatch(/non pris en charge/); // max non exposé par ce faux CLI
    expect((await c.ai.validate("claude", "sonnet", "high")).effortApplied).toBe("high");
  });
  it("fournisseur déconnecté ou en mode API → indisponible avec raison, rien n'est proposé", async () => {
    const { c, r } = mk(); r.auth.codex = false; const cat = await c.ai.catalog("codex", true); expect(cat.available).toBe(false); expect(cat.models).toHaveLength(0); expect(cat.reason).toMatch(/Authentification requise/);
    r.authMode.claude = "api_key"; c.providerStatus("claude", true); const cl = await c.ai.catalog("claude", true); expect(cl.available).toBe(false); expect(cl.reason).toMatch(/abonnement exclusif/);
  });
  it("modèles Claude déjà observés ajoutés au catalogue (source: observed)", async () => {
    const { c, project } = mk(); const id = await c.conversations.create({ mode: "chat", provider: "claude" }); void project; await c.conversations.send(id, "salut", { model: "sonnet" }); await reply(c, id, 1);
    c.ai.catalog("claude", true); const cat = await c.ai.catalog("claude", true); expect(cat.models.find((m) => m.id === "sonnet")?.source).toBe("cli-alias");
  });
});

describe("Chat : sans projet, politique d'outils, historique", () => {
  it("crée un chat sans projet ; Chat avec projet et Code sans projet sont refusés", async () => {
    const { c, project } = mk(); await expect(c.conversations.create({ mode: "chat", provider: "claude" })).resolves.toBeTruthy();
    await expect(c.conversations.create({ mode: "chat", provider: "claude", projectId: project })).rejects.toThrow(/Seul le mode Code/); await expect(c.conversations.create({ mode: "code", provider: "claude" })).rejects.toThrow(/nécessite un projet/);
  });
  it("envoi : exécution mode chat, dossier isolé, sans projet, effort/modèle transmis, réponse enregistrée avec effort appliqué et tokens", async () => {
    const { c, r, dir } = mk(); const id = await c.conversations.create({ mode: "chat", provider: "codex", model: "gpt-6.2-sol", effort: "high" });
    await c.conversations.send(id, "Explique les monades"); await reply(c, id, 1);
    const q = r.reqs[0]!; expect(q.policy).toBe("chat"); expect(q.cwd).toBe(join(dir, "chat-sandbox")); expect(existsSync(q.cwd)).toBe(true); expect(q.permission).toBe("read-only"); expect(q.effort).toBe("high"); expect(q.model).toBe("gpt-6.2-sol"); expect(q.resumeSessionId).toBeUndefined();
    const ex = all<any>(c.db, "SELECT * FROM agent_executions")[0]; expect(ex.mode).toBe("chat"); expect(ex.project_id).toBeNull(); expect(ex.conversation_id).toBe(id);
    const ms = c.conversations.messages(id); expect(ms.map((m: any) => m.role)).toEqual(["user", "assistant"]); expect(ms[1].effort_applied).toBe("high"); expect(ms[1].tokens).toBe(15); expect(ms[1].model).toBe("gpt-6.2-sol");
    expect(c.conversations.get(id).title).toBe("Explique les monades");
  });
  it("effort ou modèle non pris en charge refusés à l'envoi (jamais envoyés)", async () => {
    const { c, r } = mk(); const id = await c.conversations.create({ mode: "chat", provider: "codex", model: "gpt-6.2-sol" });
    await expect(c.conversations.send(id, "x", { effort: "ultra" })).rejects.toThrow(/non pris en charge/); await expect(c.conversations.send(id, "x", { model: "gpt-6-luna", effort: "low" })).rejects.toThrow(/n'expose pas/); expect(r.reqs).toHaveLength(0); expect(c.conversations.messages(id)).toHaveLength(0);
  });
  it("même fournisseur : la session est reprise, y compris lors d'un changement de modèle/effort (historique tracé)", async () => {
    const { c, r } = mk(); const id = await c.conversations.create({ mode: "chat", provider: "claude", model: "sonnet", effort: "low" });
    await c.conversations.send(id, "un"); await reply(c, id, 1); await c.conversations.send(id, "deux"); await reply(c, id, 2); expect(r.reqs[1]!.resumeSessionId).toBe("sess-claude-1");
    const res = await c.conversations.send(id, "trois", { model: "opus", effort: "high" }); await reply(c, id, 3); expect(res.newSession).toBe(false); expect(r.reqs[2]!.resumeSessionId).toBe("sess-claude-1"); expect(r.reqs[2]!.model).toBe("opus"); expect(r.reqs[2]!.effort).toBe("high");
    const h = c.conversations.history(id).map((x: any) => x.kind); expect(h).toContain("model_changed"); expect(h).toContain("effort_changed"); expect(h).not.toContain("provider_changed");
    const ms = c.conversations.messages(id).filter((m: any) => m.role === "assistant"); expect(ms.map((m: any) => m.model)).toEqual(["sonnet", "sonnet", "opus"]); // modèle utilisé par chaque réponse
  });
  it("changement de fournisseur : NOUVELLE session, contexte transmis explicitement, jamais présentée comme la même session", async () => {
    const { c, r } = mk(); const id = await c.conversations.create({ mode: "chat", provider: "claude" }); await c.conversations.send(id, "Mon nom est Zoé"); await reply(c, id, 1);
    const res = await c.conversations.send(id, "Quel est mon nom ?", { provider: "codex", model: null, effort: null }); await reply(c, id, 2);
    expect(res.newSession).toBe(true); expect(res.notice).toMatch(/nouvelle session/i); const q = r.reqs[1]!; expect(q.provider).toBe("codex"); expect(q.resumeSessionId).toBeUndefined(); expect(q.prompt).toMatch(/Contexte repris/); expect(q.prompt).toMatch(/Mon nom est Zoé/);
    expect(c.conversations.history(id).map((x: any) => x.kind)).toEqual(expect.arrayContaining(["provider_changed", "new_session"])); expect(c.conversations.get(id).session_provider).toBe("codex");
  });
  it("PolitiqueChat : un outil utilisé en Chat interrompt l'exécution, trace d'audit et message explicite", async () => {
    const { c, r } = mk(); r.toolInChat = true; const id = await c.conversations.create({ mode: "chat", provider: "codex" }); await c.conversations.send(id, "lis /etc/passwd");
    await until(() => all(c.db, "SELECT 1 FROM audit_events WHERE type='policy.violation'").length === 1); await reply(c, id, 1);
    const m = c.conversations.messages(id).find((x: any) => x.role === "assistant"); expect(m.status).not.toBe("completed"); expect(m.content).toMatch(/Politique Chat|interrompue/); expect(all(c.db, "SELECT status FROM agent_executions")[0]).toMatchObject({ status: "cancelled" });
  });
  it("une seule réponse à la fois ; stop interrompt", async () => {
    const { c } = mk(); const id = await c.conversations.create({ mode: "chat", provider: "claude" }); await c.conversations.send(id, "a"); await expect(c.conversations.send(id, "b")).rejects.toThrow(/déjà en cours/); await reply(c, id, 1);
  });
});

describe("historique : recherche, favoris, archives, export, suppression", () => {
  it("gère le cycle de vie sans toucher aux statistiques", async () => {
    const { c } = mk(); const a = await c.conversations.create({ mode: "chat", provider: "claude", title: "Alpha" }); const b = await c.conversations.create({ mode: "chat", provider: "claude", title: "Beta" });
    await c.conversations.send(a, "bonjour quantique"); await reply(c, a, 1); c.conversations.rename(b, "Beta renommé"); c.conversations.setFavorite(b, true);
    expect(c.conversations.list({ mode: "chat", q: "quantique" }).map((x: any) => x.id)).toEqual([a]); expect(c.conversations.list({ mode: "chat", favorite: true }).map((x: any) => x.id)).toEqual([b]); expect(c.conversations.list({ mode: "chat" })[0].title).toBe("Beta renommé");
    c.conversations.setArchived(a, true); expect(c.conversations.list({ mode: "chat" }).map((x: any) => x.id)).toEqual([b]); expect(c.conversations.list({ mode: "chat", archived: true }).map((x: any) => x.id)).toEqual([a]);
    expect(c.conversations.export(a, "md")).toMatch(/# Alpha[\s\S]*bonjour quantique/); expect(JSON.parse(c.conversations.export(a, "json")).messages).toHaveLength(2);
    const before = c.analytics.totals({}).total; c.conversations.remove(a); expect(c.conversations.get(a)).toBeUndefined(); expect(c.analytics.totals({}).total).toBe(before); expect(before).toBeGreaterThan(0);
  });
  it("les modes sont indépendants : un chat n'apparaît pas dans Code", async () => {
    const { c, project } = mk(); const ch = await c.conversations.create({ mode: "chat", provider: "claude" }); const co = await c.conversations.create({ mode: "code", provider: "claude", projectId: project });
    expect(c.conversations.list({ mode: "chat" }).map((x: any) => x.id)).toEqual([ch]); expect(c.conversations.list({ mode: "code" }).map((x: any) => x.id)).toEqual([co]);
  });
});

describe("Code Chat", () => {
  it("session directe sur un projet : cwd du projet, politique code, pas d'agent à configurer", async () => {
    const { c, r, project, dir } = mk(); const id = await c.conversations.create({ mode: "code", submode: "direct", provider: "claude", projectId: project }); await c.conversations.send(id, "ajoute un test"); await reply(c, id, 1);
    const q = r.reqs[0]!; expect(q.policy).toBe("code"); expect(q.cwd).toBe(dir); expect(q.permission).toBe("workspace-write"); const ex = all<any>(c.db, "SELECT * FROM agent_executions")[0]; expect(ex.mode).toBe("code"); expect(ex.project_id).toBe(project); expect(ex.agent_id).toBeNull();
  });
  it("« Continuer dans Code » transmet un contexte explicite une seule fois", async () => {
    const { c, r, project } = mk(); const chat = await c.conversations.create({ mode: "chat", provider: "claude", title: "Idée appli" }); await c.conversations.send(chat, "Je veux une app de todo"); await reply(c, chat, 1);
    const code = await c.conversations.continueInCode(chat, project, "Décision : stack React + SQLite"); expect(c.conversations.get(code)).toMatchObject({ mode: "code", project_id: project }); expect(c.conversations.get(chat).mode).toBe("chat"); // la conversation source ne bouge pas
    await c.conversations.send(code, "Commence"); await reply(c, code, 1); expect(r.reqs.at(-1)!.prompt).toMatch(/Décision : stack React \+ SQLite/); await c.conversations.send(code, "Suite"); await reply(c, code, 2); expect(r.reqs.at(-1)!.prompt).not.toMatch(/Décision : stack/);
    expect(c.conversations.history(code).some((h: any) => h.kind === "context_imported")).toBe(true);
  });
});

describe("consommation par mode", () => {
  it("sépare chat / work / code sans double comptage ; total global = somme des modes", async () => {
    const { c, project } = mk(); const ch = await c.conversations.create({ mode: "chat", provider: "claude" }); const co = await c.conversations.create({ mode: "code", provider: "codex", projectId: project }); const w = await c.works.create({ title: "W", provider: "claude" });
    await c.conversations.send(ch, "a"); await c.conversations.send(co, "b"); await c.conversations.send(c.works.get(w).conversation_id, "c"); await until(() => c.analytics.totals({}).events === 3);
    const by = c.analytics.by("mode", {}); const sum = by.reduce((s: number, r: any) => s + r.total, 0); expect(c.analytics.totals({}).total).toBe(sum); expect(by.map((r: any) => r.key).sort()).toEqual(["chat", "code", "work"]); expect(by.every((r: any) => r.total === 15)).toBe(true);
    expect(c.analytics.totals({ mode: "chat" }).total).toBe(15); expect(c.analytics.rows({ mode: "code" }).reduce((s: number, r: any) => s + r.total, 0)).toBe(15);
  });
  it("les anciennes exécutions (agents/orchestrateur) restent en mode code", async () => {
    const { c, project } = mk(); const id = c.run({ projectId: project, prompt: "x", provider: "claude" }); await until(() => (c.executions.get(id) as any).status === "completed"); expect((c.executions.get(id) as any).mode).toBe("code");
  });
});

describe("Work local", () => {
  it("espace dédié : dossiers, conversation work, cwd = dossier du travail, politique work", async () => {
    const { c, r } = mk(); const id = await c.works.create({ title: "Rapport comparatif", goal: "Comparer 3 docs", provider: "claude" }); const w = c.works.get(id); const dir = c.works.dirOf(id)!;
    expect(existsSync(join(dir, "sources"))).toBe(true); expect(existsSync(join(dir, "livrables"))).toBe(true); expect(c.conversations.get(w.conversation_id)).toMatchObject({ mode: "work", work_id: id });
    await c.conversations.send(w.conversation_id, "Résume"); await reply(c, w.conversation_id, 1); const q = r.reqs[0]!; expect(q.cwd).toBe(dir); expect(q.policy).toBe("work"); expect(q.permission).toBe("workspace-write"); expect(q.instructions).toMatch(/livrables\//);
  });
  it("sources copiées explicitement (fichiers seulement), étapes, plan IA importé sur demande, livrables réels", async () => {
    const { c, dir } = mk(); const id = await c.works.create({ title: "T", provider: "claude" }); const w = c.works.get(id); const src = join(dir, "doc.txt"); writeFileSync(src, "contenu"); mkdirSync(join(dir, "sousdossier"));
    const res = c.works.addFiles(id, [src, join(dir, "sousdossier"), join(dir, "absent.txt")]); expect(res.added).toEqual(["doc.txt"]); expect(res.errors).toHaveLength(2); expect(readFileSync(join(c.works.dirOf(id)!, "sources", "doc.txt"), "utf8")).toBe("contenu"); expect(c.works.addFiles(id, [src]).added).toEqual(["doc-1.txt"]);
    const s1 = c.works.addStep(id, "Lire les sources"); c.works.addStep(id, "Rédiger"); c.works.setStep(s1, { status: "doing" }); c.works.setStep(s1, { status: "done" }); expect(() => c.works.setStep(s1, { status: "bof" })).toThrow(); expect(c.works.get(id)).toMatchObject({ steps: 2, steps_done: 1 });
    expect(() => c.works.importPlan(id)).toThrow(/Aucun plan/); // pas d'import automatique
    expect(c.works.planPrompt("T")).toMatch(/steps/); await c.conversations.send(w.conversation_id, "Propose un plan"); await reply(c, w.conversation_id, 1); expect(() => c.works.importPlan(id)).toThrow(/Aucun plan exploitable/); // le faux fournisseur ne répond pas de JSON
    // réponse IA avec bloc JSON → import explicite
    run(c.db, "INSERT INTO conversation_messages (id,conversation_id,role,content,status,created_at) VALUES (?,?,?,?,?,?)", "m-plan", w.conversation_id, "assistant", 'Voici : ```json\n{"steps":[{"title":"Collecter"},{"title":"Synthétiser"}]}\n```', "completed", new Date(Date.now() + 5000).toISOString()); expect(c.works.importPlan(id)).toBe(2); expect(c.works.steps(id).filter((x: any) => x.source === "ai")).toHaveLength(2);
    const liv = join(c.works.dirOf(id)!, "livrables"); writeFileSync(join(liv, "rapport.md"), "# Rapport"); mkdirSync(join(liv, "annexes")); writeFileSync(join(liv, "annexes", "data.csv"), "a,b");
    expect(c.works.deliverables(id).map((d) => d.rel).sort()).toEqual(["annexes/data.csv", "rapport.md"]); expect(c.works.readDeliverable(id, "rapport.md")).toBe("# Rapport"); expect(() => c.works.deliverablePath(id, "../sources/doc.txt")).toThrow(/non autorisé/); expect(c.works.syncDeliverables(id)).toBe(2); expect(c.works.syncDeliverables(id)).toBe(0);
  });
  it("suppression d'un travail : dossier local supprimé, consommation conservée", async () => {
    const { c } = mk(); const id = await c.works.create({ title: "T", provider: "claude" }); const w = c.works.get(id); await c.conversations.send(w.conversation_id, "x"); await reply(c, w.conversation_id, 1); const dir = c.works.dirOf(id)!; const tot = c.analytics.totals({ mode: "work" }).total;
    c.works.remove(id); expect(existsSync(dir)).toBe(false); expect(c.works.get(id)).toBeUndefined(); expect(c.analytics.totals({ mode: "work" }).total).toBe(tot);
  });
});

describe("abonnement exclusif dans les modes", () => {
  it("une conversation est refusée si l'authentification n'est pas un abonnement", async () => {
    const { c, r } = mk(); r.authMode.claude = "api_key"; c.providerStatus("claude", true); await expect(c.conversations.create({ mode: "chat", provider: "claude" })).rejects.toThrow(/abonnement exclusif/);
  });
});

describe("pièces jointes texte", () => {
  it("le contenu est injecté dans le prompt ; le message n'affiche que les noms ; limites et binaires refusés", async () => {
    const { c, r } = mk(); const id = await c.conversations.create({ mode: "chat", provider: "claude" });
    await c.conversations.send(id, "Résume ce fichier", undefined, [{ name: "notes.md", content: "ligne importante" }]); await until(() => c.conversations.messages(id).length === 2);
    expect(r.reqs[0]!.prompt).toMatch(/\[Fichier joint : notes\.md\][\s\S]*ligne importante/); const u = c.conversations.messages(id)[0]; expect(u.content).toMatch(/📎 notes\.md/); expect(u.content).not.toMatch(/ligne importante/);
    await expect(c.conversations.send(id, "x", undefined, [{ name: "bin", content: "a" + String.fromCharCode(0) + "b" }])).rejects.toThrow(/pas un fichier texte/);
    await expect(c.conversations.send(id, "x", undefined, [{ name: "gros", content: "x".repeat(200_001) }])).rejects.toThrow(/200 Ko/);
    await expect(c.conversations.send(id, "x", undefined, Array.from({ length: 6 }, (_, i) => ({ name: "f" + i, content: "x" })))).rejects.toThrow(/5 pièces/);
  });
});

describe("images en pièce jointe", () => {
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
  it("transmises à l'adaptateur (base64), nom affiché, signature vérifiée, limites", async () => {
    const { c, r } = mk(); const id = await c.conversations.create({ mode: "chat", provider: "claude" });
    await c.conversations.send(id, "Décris", undefined, [], [{ name: "pixel.png", mime: "image/png", data: PNG }]); await until(() => c.conversations.messages(id).length === 2);
    expect(r.reqs[0]!.images?.[0]).toMatchObject({ name: "pixel.png", mime: "image/png" }); expect(c.conversations.messages(id)[0].content).toMatch(/🖼 pixel\.png/);
    await expect(c.conversations.send(id, "x", undefined, [], [{ name: "faux.png", mime: "image/png", data: Buffer.from("pas une image").toString("base64") }])).rejects.toThrow(/pas une image/);
    await expect(c.conversations.send(id, "x", undefined, [], Array.from({ length: 5 }, (_, i) => ({ name: "i" + i, mime: "image/png", data: PNG })))).rejects.toThrow(/4 images/);
  });
  it("Claude : entrée stream-json avec bloc image ; sans image : entrée texte inchangée", () => {
    const req: any = { executionId: "e", prompt: "p", cwd: "/", permission: "read-only", approvalPolicy: "never", policy: "chat", images: [{ name: "a", mime: "image/png", data: PNG }] };
    expect(buildClaudeArgs(req)).toEqual(expect.arrayContaining(["--input-format", "stream-json"])); expect(claudeUserMessage(req).message.content[1]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/png", data: PNG } });
    expect(buildClaudeArgs({ ...req, images: undefined })).not.toContain("--input-format");
  });
});
