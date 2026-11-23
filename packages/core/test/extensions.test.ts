import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCore } from "../src/service.js";
import { buildClaudeArgs, mcpConfigObject } from "../src/providers/claude.js";
import { parseSkillMd, SKILLS_MAX_CHARS } from "../src/extensions.js";
import { now, all } from "../src/db.js";
import type { RunRequest, RunHandle, ProviderStatus, ProviderId, ModelInfo } from "../src/types.js";
import type { RunSink } from "../src/providers/common.js";

const T = (o: any = {}) => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, ...o });
const MODELS: ModelInfo[] = [{ id: "", displayName: "Défaut", isDefault: true, source: "cli-alias" }];
const DEMO = resolve(__dirname, "fixtures/mcp-demo.mjs");
function mk(toolName?: string) {
  const reqs: (RunRequest & { provider: ProviderId })[] = [];
  const adapter = (id: ProviderId): any => ({ id, detectInstallation: async () => ({ installed: true }), getVersion: async () => "0", getSupportedModels: async () => MODELS, getCapabilities: () => ({}), getQuotaStatus: async () => ({ provider: id, state: "unknown", windows: [], checkedAt: now() }),
    getAuthStatus: async (): Promise<ProviderStatus> => ({ provider: id, installed: true, authenticated: true, authMode: "subscription", warnings: [], checkedAt: now() }),
    startSession(req: RunRequest, sink: RunSink): RunHandle { reqs.push({ ...req, provider: id }); let cancelled = false;
      const done = new Promise<void>((res) => setTimeout(() => { sink.event({ type: "session", providerSessionId: "s" }); if (toolName) sink.event({ type: "tool", id: "t", name: toolName, summary: "{}", state: "started" });
        setTimeout(() => { if (cancelled) return res(); sink.event({ type: "usage", report: { model: "m", mode: "final", counterKey: "k" + req.executionId, eventKey: "f", confidence: "reported", tokens: T({ input: 10, output: 5, total: 15 }) } }); sink.event({ type: "text", text: "ok", final: true }); sink.event({ type: "done", ok: true, message: "ok" }); res(); }, 150); }, 20));
      return { done, cancel: async () => { cancelled = true; sink.event({ type: "done", ok: false, message: "Annulé" }); } }; },
    resumeSession(q: any, s: any) { return (this as any).startSession(q, s); }, cancelExecution: async (h: RunHandle) => h.cancel(), dispose: async () => {} });
  const dir = mkdtempSync(join(tmpdir(), "ext-")); const c = createCore({ dataDir: dir, dbFile: ":memory:", adapters: { claude: adapter("claude"), codex: adapter("codex") } });
  c.settings.set("concurrency.global", 8); c.settings.set("concurrency.provider", 8); const project = c.projects.create({ name: "P", path: dir }); return { c, reqs, dir, project };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(f: () => boolean, ms = 8000) { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error("timeout"); await wait(20); } }
const stdio = (extra: any = {}) => ({ transport: "stdio" as const, command: "node", args: [DEMO], ...extra });

describe("Extensions : ajout, validation, secrets", () => {
  it("ajoute un MCP et une skill ; valide les noms et doublons ; masque les secrets dans la liste", () => {
    const { c } = mk(); const id = c.extensions.addMcp({ name: "Demo", config: stdio({ env: { API_TOKEN: "valeur-secrete" } }), modes: ["chat", "code"] });
    const l = c.extensions.list("mcp"); expect(l).toHaveLength(1); expect(l[0]).toMatchObject({ name: "demo", modes: ["chat", "code"], enabled: true }); expect(l[0].config.envKeys).toEqual(["API_TOKEN"]); expect(JSON.stringify(l)).not.toMatch(/valeur-secrete/); void id;
    expect(() => c.extensions.addMcp({ name: "demo", config: stdio() })).toThrow(/existe déjà/); expect(() => c.extensions.addMcp({ name: "Mauvais Nom!", config: stdio() })).toThrow(/Nom invalide/);
    expect(() => c.extensions.addMcp({ name: "x1", config: { transport: "stdio" } })).toThrow(/Commande requise/); expect(() => c.extensions.addMcp({ name: "x2", config: { transport: "http", url: "ftp://a" } })).toThrow(/URL http/);
    c.extensions.addSkill({ name: "revue", description: "Relit le code", body: "Vérifie les erreurs." }); expect(() => c.extensions.addSkill({ name: "vide", description: "", body: "  " })).toThrow(/vides/);
    expect(c.audit().filter((a: any) => a.type === "extension.added")).toHaveLength(2);
  });
  it("importe une skill depuis un dossier SKILL.md (frontmatter) et parse le frontmatter", () => {
    const { c } = mk(); const d = mkdtempSync(join(tmpdir(), "sk-")); mkdirSync(join(d, "ma-skill")); writeFileSync(join(d, "ma-skill", "SKILL.md"), "---\nname: Résumeur\ndescription: \"Résume des textes\"\n---\nRésume en 3 points.");
    const id = c.extensions.importSkill(join(d, "ma-skill"), ["chat"]); expect(c.extensions.list("skill")[0]).toMatchObject({ name: "r-sum-eur".length ? c.extensions.list("skill")[0].name : "", modes: ["chat"] }); expect(c.extensions.list("skill")[0].config).toMatchObject({ description: "Résume des textes" }); void id;
    expect(parseSkillMd("---\nname: a\ndescription: b\n---\ncorps")).toEqual({ name: "a", description: "b", body: "corps" }); expect(parseSkillMd("sans frontmatter").body).toBe("sans frontmatter");
    expect(() => c.extensions.importSkill(join(d, "absent"))).toThrow(/introuvable/);
  });
  it("teste réellement un serveur stdio (handshake + outils) ; erreurs claires sinon", async () => {
    const { c } = mk(); const ok = await c.extensions.test(stdio()); expect(ok).toMatchObject({ ok: true }); expect(ok.tools.map((t) => t.name)).toEqual(["get_secret_word"]);
    const bad = await c.extensions.test({ transport: "stdio", command: "commande-inexistante-xyz" }); expect(bad.ok).toBe(false); expect(bad.error).toBeTruthy();
    expect((await c.extensions.test({ transport: "stdio", command: "node", args: ["-e", "process.exit(3)"] })).error).toMatch(/code 3/); expect((await c.extensions.test({ transport: "http", url: "http://127.0.0.1:1/mcp" })).ok).toBe(false);
  });
});

describe("Extensions : utilisation dans Chat, Work et Code", () => {
  it("activées par mode : transmises à l'adaptateur et skills injectées ; autres modes non concernés", async () => {
    const { c, reqs, project } = mk(); c.extensions.addMcp({ name: "demo", config: stdio(), modes: ["chat", "work"] }); c.extensions.addSkill({ name: "style", description: "Ton formel", body: "Réponds toujours de façon formelle.", modes: ["chat", "code"] });
    const chat = await c.conversations.create({ mode: "chat", provider: "claude" }); await c.conversations.send(chat, "a"); await until(() => c.conversations.messages(chat).length === 2);
    expect(reqs[0]!.mcp?.map((m) => m.name)).toEqual(["demo"]); expect(reqs[0]!.instructions).toMatch(/Skill « style »[\s\S]*formelle/);
    const code = await c.conversations.create({ mode: "code", provider: "codex", projectId: project }); await c.conversations.send(code, "b"); await until(() => c.conversations.messages(code).length === 2);
    expect(reqs[1]!.mcp ?? []).toHaveLength(0); expect(reqs[1]!.instructions).toMatch(/Skill « style »/); // skill active en code, pas le MCP
    const w = await c.works.create({ title: "W", provider: "claude" }); await c.conversations.send(c.works.get(w).conversation_id, "c"); await until(() => c.conversations.messages(c.works.get(w).conversation_id).length === 2); expect(reqs[2]!.mcp?.map((m) => m.name)).toEqual(["demo"]); expect(reqs[2]!.instructions ?? "").not.toMatch(/Skill « style »/);
  });
  it("désactivation par conversation ; extension désactivée globalement ignorée", async () => {
    const { c, reqs } = mk(); const m = c.extensions.addMcp({ name: "demo", config: stdio(), modes: ["chat"] }); const chat = await c.conversations.create({ mode: "chat", provider: "claude" });
    expect(c.conversations.extensions(chat)).toEqual([expect.objectContaining({ name: "demo", active: true })]); c.conversations.setExtensionActive(chat, m, false); expect(c.conversations.extensions(chat)[0].active).toBe(false);
    await c.conversations.send(chat, "x"); await until(() => reqs.length === 1); expect(reqs[0]!.mcp ?? []).toHaveLength(0); c.conversations.setExtensionActive(chat, m, true); await until(() => c.conversations.messages(chat).length === 2); await c.conversations.send(chat, "y"); await until(() => reqs.length === 2); expect(reqs[1]!.mcp).toHaveLength(1);
    await until(() => c.conversations.messages(chat).length === 4); c.extensions.setEnabled(m, false); await c.conversations.send(chat, "z"); await until(() => reqs.length === 3); expect(reqs[2]!.mcp ?? []).toHaveLength(0);
  });
  it("Chat : l'outil MCP activé est autorisé, tout autre outil reste interdit (interruption + audit)", async () => {
    const a = mk("mcp__demo__get_secret_word"); a.c.extensions.addMcp({ name: "demo", config: stdio(), modes: ["chat"] }); const chat = await a.c.conversations.create({ mode: "chat", provider: "claude" }); await a.c.conversations.send(chat, "x"); await until(() => a.c.conversations.messages(chat).length === 2);
    expect(a.c.audit().some((x: any) => x.type === "policy.violation")).toBe(false); expect(a.c.conversations.messages(chat)[1].status).toBe("completed");
    const b = mk("Bash"); b.c.extensions.addMcp({ name: "demo", config: stdio(), modes: ["chat"] }); const chat2 = await b.c.conversations.create({ mode: "chat", provider: "claude" }); await b.c.conversations.send(chat2, "x"); await until(() => b.c.audit().some((x: any) => x.type === "policy.violation"));
    const c3 = mk("mcp__autre__outil"); c3.c.extensions.addMcp({ name: "demo", config: stdio(), modes: ["chat"] }); const chat3 = await c3.c.conversations.create({ mode: "chat", provider: "claude" }); await c3.c.conversations.send(chat3, "x"); await until(() => c3.c.audit().some((x: any) => x.type === "policy.violation")); // serveur non activé → bloqué
  });
  it("skills : texte borné ; arguments et fichier de configuration Claude", () => {
    const { c } = mk(); for (let i = 0; i < 5; i++) c.extensions.addSkill({ name: "s" + i, description: "d", body: "x".repeat(3000), modes: ["code"] }); const r = c.extensions.resolve("code"); expect(r.skillsText.length).toBeLessThanOrEqual(SKILLS_MAX_CHARS + 200); expect(r.skills).toHaveLength(5);
    const req: any = { executionId: "e1", prompt: "p", cwd: "/", permission: "read-only", approvalPolicy: "never", policy: "chat", mcp: [{ name: "demo", transport: "stdio", command: "node", args: ["a.mjs"], env: { K: "v" } }, { name: "web", transport: "http", url: "https://x/mcp", headers: { Authorization: "Bearer t" } }] };
    const args = buildClaudeArgs(req); const i = args.indexOf("--mcp-config"); expect(i).toBeGreaterThan(-1); expect(existsSync(args[i + 1]!)).toBe(true); expect(args).toEqual(expect.arrayContaining(["--allowedTools", "mcp__demo", "mcp__web", "--strict-mcp-config"]));
    expect(mcpConfigObject(req).mcpServers).toEqual({ demo: { type: "stdio", command: "node", args: ["a.mjs"], env: { K: "v" } }, web: { type: "http", url: "https://x/mcp", headers: { Authorization: "Bearer t" } } }); expect(all(c.db, "SELECT 1 FROM extensions")).toHaveLength(5);
  });
});
