import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os"; import { join } from "node:path";
import { createCore, isLocalUrl, splitModelId, createSseParser, applyChunk, newAcc, safePath, runTool, normalizeBaseUrl, cleanSummary } from "../src/index.js";
import type { AgentProviderAdapter } from "../src/providers/common.js";

/** Faux serveur compatible OpenAI : /v1/models, /v1/chat/completions en SSE, appels d'outils, contrôle de la clé. */
let srv: Server; let base = ""; const seen: any[] = [];
beforeAll(async () => {
  srv = createServer((req, res) => {
    let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => {
      if (req.headers.authorization && req.headers.authorization !== "Bearer bonne-cle") { res.writeHead(401).end(JSON.stringify({ error: { message: "bad key" } })); return; }
      if (req.url === "/v1/models") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "qwen-test" }, { id: "llama-test" }] })); return; }
      if (req.url === "/v1/chat/completions") {
        const j = JSON.parse(body); seen.push(j); const last = j.messages[j.messages.length - 1];
        const sse = (chunks: any[]) => { res.writeHead(200, { "content-type": "text/event-stream" }); for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`); res.end("data: [DONE]\n\n"); };
        const usage = { usage: { prompt_tokens: 100, completion_tokens: 20 }, choices: [] };
        if (j.model === "no-tools" && j.tools) { res.writeHead(400).end(JSON.stringify({ error: { message: "model does not support tools" } })); return; }
        const wantsFile = typeof last.content === "string" && last.content.includes("ÉCRIS");
        if (j.tools && wantsFile && last.role === "user") return sse([{ model: j.model, choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "write_file", arguments: "{\"path\":\"livrables/r.md\"," } }] } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"content\":\"# Rapport\"}" } }] }, finish_reason: "tool_calls" }] }, usage]);
        if (last.role === "tool") return sse([{ choices: [{ delta: { content: "Fichier écrit." }, finish_reason: "stop" }] }, usage]);
        const hist = j.messages.filter((m: any) => m.role === "user").length;
        return sse([{ model: j.model, choices: [{ delta: { content: "Bon" } }] }, { choices: [{ delta: { content: `jour (${hist})` }, finish_reason: "stop" }] }, usage]);
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r())); base = `http://127.0.0.1:${(srv.address() as any).port}/v1`;
});
afterAll(() => srv.close());

const mem = () => { const m = new Map<string, string>(); return { get: (k: string) => m.get(k), set: (k: string, v?: string) => { v ? m.set(k, v) : m.delete(k); }, m }; };
const mk = () => { const dir = mkdtempSync(join(tmpdir(), "acc-open-")); const secrets = mem(); return { c: createCore({ dataDir: dir, dbFile: ":memory:", scheduler: false, secrets }), dir, secrets }; };
async function until(f: () => boolean, ms = 10000) { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 30)); } }

describe("protocole (pur)", () => {
  it("local vs hébergé, découpage des identifiants, normalisation d'URL", () => {
    expect(isLocalUrl("http://localhost:11434/v1")).toBe(true); expect(isLocalUrl("http://192.168.1.20:1234/v1")).toBe(true); expect(isLocalUrl("https://openrouter.ai/api/v1")).toBe(false);
    expect(splitModelId("openrouter/meta-llama/llama-3.3-70b")).toEqual({ endpointId: "openrouter", model: "meta-llama/llama-3.3-70b" }); expect(splitModelId("sans-slash")).toBeUndefined();
    expect(normalizeBaseUrl("http://localhost:11434/v1/")).toBe("http://localhost:11434/v1");
    expect(() => normalizeBaseUrl("http://openrouter.ai/api/v1")).toThrow(/https/); expect(() => normalizeBaseUrl("ftp://x")).toThrow();
  });
  it("assemble texte, appels d'outils fragmentés et usage depuis un flux SSE coupé n'importe où", () => {
    const acc = newAcc(); let shown = ""; const feed = createSseParser((j) => { shown += applyChunk(acc, j); });
    const raw = `data: {"choices":[{"delta":{"content":"Sa"}}]}\n\ndata: {"choices":[{"delta":{"content":"lut","tool_calls":[{"index":0,"id":"a","function":{"name":"read_file","arguments":"{\\"pa"}}]}}]}\n\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\":\\"x\\"}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3,"cost":0.0012}}\n\ndata: [DONE]\n\n`;
    for (let i = 0; i < raw.length; i += 7) feed(raw.slice(i, i + 7));
    expect(shown).toBe("Salut"); expect(acc.tools.get(0)).toEqual({ id: "a", name: "read_file", args: '{"path":"x"}' }); expect(acc.usage).toMatchObject({ prompt: 7, completion: 3, cost: 0.0012 }); expect(acc.finish).toBe("tool_calls");
  });
  it("outils fichiers bornés au dossier de travail", () => {
    const d = mkdtempSync(join(tmpdir(), "acc-tools-")); writeFileSync(join(d, "a.txt"), "contenu");
    expect(() => safePath(d, "../hors.txt")).toThrow(/hors du dossier/); expect(() => safePath(d, "C:/Windows/win.ini")).toThrow(/hors du dossier/); expect(() => safePath(d, ".git/config")).toThrow(/\.git/);
    expect(runTool(d, "read_file", '{"path":"a.txt"}', false).output).toBe("contenu"); expect(runTool(d, "list_files", "{}", false).output).toContain("a.txt");
    expect(() => runTool(d, "write_file", '{"path":"b.txt","content":"x"}', false)).toThrow(/lecture seule/);
    expect(runTool(d, "write_file", '{"path":"sous/b.txt","content":"x"}', true).changed).toBe("sous/b.txt"); expect(readFileSync(join(d, "sous", "b.txt"), "utf8")).toBe("x");
  });
  it("nettoie le préambule et la clôture d'un résumé", () => {
    expect(cleanSummary("Voici le résumé :\n\n## Objectif\nUn outil.")).toBe("## Objectif\nUn outil.");
    expect(cleanSummary("```markdown\n## Stack\nTS\n```")).toBe("## Stack\nTS");
  });
});

describe("fournisseur open (bout en bout, faux serveur)", () => {
  it("statut, catalogue et clé API hors de la base", async () => {
    const { c, secrets } = mk();
    expect((await c.providerStatus("open", true)).installed).toBe(false);
    const id = c.open.save({ name: "Mon Ollama", baseUrl: base }); expect(id).toBe("mon-ollama");
    const st = await c.providerStatus("open", true); expect(st).toMatchObject({ installed: true, authenticated: true, authMode: "local" });
    const cat = await c.ai.catalog("open", true); expect(cat.available).toBe(true); expect(cat.models.map((m) => m.id)).toEqual(["mon-ollama/qwen-test", "mon-ollama/llama-test"]); expect(cat.models[0]!.isDefault).toBe(true);
    c.open.save({ id, name: "Mon Ollama", baseUrl: base, apiKey: "bonne-cle" });
    expect(secrets.m.get("open.key.mon-ollama")).toBe("bonne-cle"); expect(JSON.stringify(c.settings.all())).not.toContain("bonne-cle"); expect(c.open.endpoints()[0]).toMatchObject({ hasKey: true, local: true }); expect(JSON.stringify(c.open.endpoints())).not.toContain("bonne-cle");
    expect(await c.open.test({ baseUrl: base, apiKey: "mauvaise" })).toMatchObject({ ok: false, error: expect.stringMatching(/refusée/) });
    expect((await c.open.test({ id })).ok).toBe(true);
    await c.close();
  });
  it("Chat : streaming, aucun outil transmis, session reprise avec l'historique, usage gratuit en local", async () => {
    const { c } = mk(); c.open.save({ name: "local", baseUrl: base }); seen.length = 0;
    const conv = await c.conversations.create({ mode: "chat", provider: "open", model: "local/qwen-test" });
    const texts: string[] = []; c.bus.on((e) => { if (e.type === "execution.text") texts.push(String(e.payload.text)); });
    const r1 = await c.conversations.send(conv, "Salut"); await until(() => c.conversations.messages(conv).some((m: any) => m.role === "assistant"));
    expect(texts.join("")).toContain("Bonjour (1)"); expect(seen[0].tools).toBeUndefined(); expect(seen[0].model).toBe("qwen-test"); expect(seen[0].stream).toBe(true);
    const u = c.executions.usage(r1.executionId)[0] as any; expect(u).toMatchObject({ provider: "open", input: 100, output: 20, total: 120, calculated_usd: 0, confidence: "reported" });
    await c.conversations.send(conv, "Encore"); await until(() => c.conversations.messages(conv).filter((m: any) => m.role === "assistant").length === 2);
    expect(c.conversations.messages(conv).at(-1).content).toBe("Bonjour (2)"); // l'historique local a bien été renvoyé
    await c.close();
  });
  it("Work : boucle d'outils réelle (write_file dans le dossier de travail), fichier signalé", async () => {
    const { c } = mk(); c.open.save({ name: "local", baseUrl: base });
    const work = c.works.get(await c.works.create({ title: "Rapport", provider: "open", model: "local/qwen-test" })) as any;
    await c.conversations.send(work.conversation_id, "ÉCRIS le rapport"); await until(() => c.conversations.messages(work.conversation_id).some((m: any) => m.role === "assistant"), 15000);
    const msg = c.conversations.messages(work.conversation_id).find((m: any) => m.role === "assistant"); expect(msg.status).toBe("completed"); expect(msg.content).toBe("Fichier écrit.");
    expect(existsSync(join(c.works.dirOf(work.id)!, "livrables", "r.md"))).toBe(true);
    const logs = c.executions.logs(msg.execution_id) as any[]; expect(logs.some((l) => l.kind === "tool" && l.content.includes("write_file"))).toBe(true); expect(logs.some((l) => l.kind === "file_change")).toBe(true);
    await c.close();
  });
  it("modèle sans outils : nouvelle tentative sans outils (signalée)", async () => {
    const { c } = mk(); c.open.save({ name: "local", baseUrl: base, models: ["no-tools"] });
    const work = c.works.get(await c.works.create({ title: "x", provider: "open", model: "local/no-tools" })) as any;
    await c.conversations.send(work.conversation_id, "Bonjour"); await until(() => c.conversations.messages(work.conversation_id).some((m: any) => m.role === "assistant"));
    const msg = c.conversations.messages(work.conversation_id).find((m: any) => m.role === "assistant"); expect(msg.status).toBe("completed");
    expect((c.executions.logs(msg.execution_id) as any[]).some((l) => /ne prend pas en charge les outils/.test(l.content))).toBe(true);
    await c.close();
  });
  it("point d'accès hébergé : masqué et refusé tant que la facturation à l'usage n'est pas autorisée", async () => {
    const { c } = mk(); const fake: typeof fetch = async () => new Response(JSON.stringify({ data: [{ id: "llama-70b" }] }), { status: 200, headers: { "content-type": "application/json" } });
    const dir = mkdtempSync(join(tmpdir(), "acc-open-")); const c2 = createCore({ dataDir: dir, dbFile: ":memory:", scheduler: false, secrets: mem(), fetchImpl: fake }); await c.close();
    c2.open.save({ name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: "k" });
    const st = await c2.providerStatus("open", true); expect(st.authenticated).toBe(false); expect(st.warnings.join(" ")).toMatch(/facturation à l'usage/);
    expect((await c2.ai.catalog("open", true)).available).toBe(false);
    c2.open.setAllowPaid(true); const st2 = await c2.providerStatus("open", true); expect(st2).toMatchObject({ authenticated: true, authMode: "api_key" });
    const cat = await c2.ai.catalog("open", true); expect(cat.models[0]!.description).toMatch(/facturé à l'usage/);
    expect(c2.audit().some((a: any) => a.type === "open.allow_paid_changed")).toBe(true);
    await c2.close();
  });
  it("le mode abonnement exclusif ne bloque pas les modèles locaux, mais bloque toujours Claude par clé API", async () => {
    const { c } = mk(); c.open.save({ name: "local", baseUrl: base });
    expect((await c.ai.validate("open", "local/qwen-test")).ok).toBe(true);
    const apiClaude: Partial<AgentProviderAdapter> = { id: "claude", getAuthStatus: async () => ({ provider: "claude", installed: true, authenticated: true, authMode: "api_key", warnings: [], checkedAt: "" }), getSupportedModels: async () => [] };
    const c2 = createCore({ dataDir: mkdtempSync(join(tmpdir(), "acc-open-")), dbFile: ":memory:", scheduler: false, secrets: mem(), adapters: { claude: apiClaude as AgentProviderAdapter } });
    expect((await c2.ai.catalog("claude", true)).reason).toMatch(/abonnement exclusif/);
    await c.close(); await c2.close();
  });
});

describe("résumé de projet", () => {
  it("génère via une exécution en lecture seule, enregistre une note épinglée injectée en premier", async () => {
    const { c } = mk(); c.open.save({ name: "local", baseUrl: base }); const pdir = mkdtempSync(join(tmpdir(), "acc-proj-"));
    const pid = c.projects.create({ name: "P", path: pdir, defaultProvider: "open" }); c.memory.add(pid, { title: "Note", content: "Utiliser pnpm." });
    const exId = c.summary.generate(pid); expect(() => c.summary.generate(pid)).toThrow(/déjà en cours/);
    expect((c.executions.get(exId) as any).permission).toBe("read-only");
    await until(() => !c.summary.status(pid).running);
    // le faux serveur répond « Bonjour (1) » : trop court → refusé proprement, rien enregistré
    expect(c.summary.status(pid).error).toMatch(/trop court/); expect(c.summary.status(pid).summary).toBeNull();
    c.memory.setSummary(pid, "## Objectif\nUne application de test qui fait des choses utiles pour vérifier le résumé.", "test");
    const ctx = c.memory.context(pid); expect(ctx.text.startsWith("[Résumé du projet]\n## Objectif")).toBe(true); expect(ctx.text).toContain("Utiliser pnpm."); expect(ctx.included).toHaveLength(2);
    c.memory.setSummary(pid, "## Objectif\nVersion 2 du résumé, assez longue pour être acceptée par la vérification.", "test"); expect(c.memory.list(pid).filter((m: any) => m.kind === "summary")).toHaveLength(1);
    await c.close();
  });
});
