import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCore } from "../src/service.js";
import { now, all } from "../src/db.js";
import type { RunRequest, RunHandle, ProviderStatus, ProviderId, ModelInfo } from "../src/types.js";
import type { RunSink } from "../src/providers/common.js";

const MODELS: ModelInfo[] = [{ id: "", displayName: "Défaut", isDefault: true, source: "cli-alias" }];
function mk(delay = 20) {
  const reqs: RunRequest[] = [];
  const adapter = (id: ProviderId): any => ({ id, detectInstallation: async () => ({ installed: true }), getVersion: async () => "0", getSupportedModels: async () => MODELS, getCapabilities: () => ({}), getQuotaStatus: async () => ({ provider: id, state: "unknown", windows: [], checkedAt: now() }),
    getAuthStatus: async (): Promise<ProviderStatus> => ({ provider: id, installed: true, authenticated: true, authMode: "subscription", warnings: [], checkedAt: now() }),
    startSession(req: RunRequest, sink: RunSink): RunHandle { reqs.push(req); const done = new Promise<void>((res) => setTimeout(() => { sink.event({ type: "session", providerSessionId: "sess-" + reqs.length }); sink.event({ type: "text", text: "réponse " + reqs.length, final: true }); sink.event({ type: "done", ok: true, message: "ok" }); res(); }, delay)); return { done, cancel: async () => {} }; },
    resumeSession(q: any, s: any) { return (this as any).startSession(q, s); }, cancelExecution: async () => {}, dispose: async () => {} });
  const dir = mkdtempSync(join(tmpdir(), "br-")); const c = createCore({ dataDir: dir, dbFile: ":memory:", adapters: { claude: adapter("claude"), codex: adapter("codex") } }); c.settings.set("ui.richBlocks", false); return { c, reqs, dir };
}
const until = async (f: () => boolean) => { const t = Date.now(); while (!f()) { if (Date.now() - t > 6000) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 15)); } };
async function twoTurns(c: any) { const id = await c.conversations.create({ mode: "chat", provider: "claude" }); await c.conversations.send(id, "Mon mot est PLATANE."); await until(() => c.conversations.messages(id).length === 2); await c.conversations.send(id, "Quel est mon mot ?"); await until(() => c.conversations.messages(id).length === 4); return id; }

describe("Modifier un message et relancer (branche)", () => {
  it("crée une conversation neuve avec l'historique avant le message ; l'original reste intact", async () => {
    const { c, reqs } = mk(); const id = await twoTurns(c); const before = c.conversations.messages(id); const second = before[2]; expect(second.role).toBe("user");
    const r = await c.conversations.branchFrom(id, second.id, "Quel est mon mot, en majuscules ?"); await until(() => c.conversations.messages(r.id).length === 4);
    const msgs = c.conversations.messages(r.id); expect(msgs.map((m: any) => m.role)).toEqual(["user", "assistant", "user", "assistant"]); expect(msgs[0].content).toBe("Mon mot est PLATANE."); expect(msgs[2].content).toBe("Quel est mon mot, en majuscules ?");
    expect(c.conversations.messages(id)).toHaveLength(4); expect(c.conversations.messages(id).map((m: any) => m.content)).toEqual(before.map((m: any) => m.content)); // original inchangé
    const conv = c.conversations.get(r.id); expect(conv.parent_id).toBe(id); expect(conv.title).toMatch(/\(modifié\)$/); expect(conv.provider_session_id === null || conv.provider_session_id.startsWith("sess-")).toBe(true);
    const last = reqs.at(-1)!; expect(last.resumeSessionId ?? null).toBeNull(); expect(last.instructions + last.prompt).toContain("PLATANE"); // contexte repris par transcription, pas par la session de l'original
  });
  it("modifier le tout premier message : la branche ne contient aucun ancien tour", async () => {
    const { c, reqs } = mk(); const id = await twoTurns(c); const first = c.conversations.messages(id)[0];
    const r = await c.conversations.branchFrom(id, first.id, "Mon mot est CITRON."); await until(() => c.conversations.messages(r.id).length === 2);
    expect(c.conversations.messages(r.id).map((m: any) => m.content)[0]).toBe("Mon mot est CITRON."); const last = reqs.at(-1)!; expect(last.instructions + last.prompt).not.toContain("PLATANE"); expect(last.resumeSessionId ?? null).toBeNull();
    expect(c.conversations.messages(id)).toHaveLength(4);
  });
  it("refus clairs : message d'assistant, introuvable, vide, réponse en cours, Work", async () => {
    const { c } = mk(150); const id = await twoTurns(c); const ms = c.conversations.messages(id);
    await expect(c.conversations.branchFrom(id, ms[1].id, "x")).rejects.toThrow(/vos propres messages/); await expect(c.conversations.branchFrom(id, "inconnu", "x")).rejects.toThrow(/introuvable/); await expect(c.conversations.branchFrom(id, ms[0].id, "  ")).rejects.toThrow(/vide/); await expect(c.conversations.branchFrom("nope", ms[0].id, "x")).rejects.toThrow(/introuvable/);
    await c.conversations.send(id, "encore"); await expect(c.conversations.branchFrom(id, ms[0].id, "x")).rejects.toThrow(/en cours/); await until(() => c.conversations.messages(id).length === 6);
    const w = c.works.get(await c.works.create({ title: "W", provider: "claude" })); await c.conversations.send(w.conversation_id, "hello"); await until(() => c.conversations.messages(w.conversation_id).length === 2);
    await expect(c.conversations.branchFrom(w.conversation_id, c.conversations.messages(w.conversation_id)[0].id, "x")).rejects.toThrow(/Work/);
  });
  it("copie le style et le fournisseur ; n'attribue pas les jetons de l'original à la branche", async () => {
    const { c } = mk(); const id = await c.conversations.create({ mode: "chat", provider: "codex", style: "formel" }); await c.conversations.send(id, "bonjour"); await until(() => c.conversations.messages(id).length === 2);
    const r = await c.conversations.branchFrom(id, c.conversations.messages(id)[0].id, "salut"); await until(() => c.conversations.messages(r.id).length === 2); const conv = c.conversations.get(r.id); expect(conv.provider).toBe("codex"); expect(conv.style).toBe("formel");
    expect(all<any>(c.db, "SELECT execution_id FROM conversation_messages WHERE conversation_id=? AND role='assistant' AND execution_id IS NOT NULL", r.id)).toHaveLength(1); // seule la nouvelle réponse porte une exécution
  });
});
