import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCore } from "../src/service.js";
import { BUILTIN_STYLES, MAX_ABOUT } from "../src/profile.js";
import { now } from "../src/db.js";
import type { RunRequest, RunHandle, ProviderStatus, ProviderId, ModelInfo } from "../src/types.js";
import type { RunSink } from "../src/providers/common.js";

const MODELS: ModelInfo[] = [{ id: "", displayName: "Défaut", isDefault: true, source: "cli-alias" }];
function mk() {
  const reqs: RunRequest[] = [];
  const adapter = (id: ProviderId): any => ({ id, detectInstallation: async () => ({ installed: true }), getVersion: async () => "0", getSupportedModels: async () => MODELS, getCapabilities: () => ({}), getQuotaStatus: async () => ({ provider: id, state: "unknown", windows: [], checkedAt: now() }),
    getAuthStatus: async (): Promise<ProviderStatus> => ({ provider: id, installed: true, authenticated: true, authMode: "subscription", warnings: [], checkedAt: now() }),
    startSession(req: RunRequest, sink: RunSink): RunHandle { reqs.push(req); const done = new Promise<void>((res) => setTimeout(() => { sink.event({ type: "text", text: "ok", final: true }); sink.event({ type: "done", ok: true, message: "ok" }); res(); }, 20)); return { done, cancel: async () => {} }; },
    resumeSession(q: any, s: any) { return (this as any).startSession(q, s); }, cancelExecution: async () => {}, dispose: async () => {} });
  const c = createCore({ dataDir: mkdtempSync(join(tmpdir(), "prof-")), dbFile: ":memory:", adapters: { claude: adapter("claude"), codex: adapter("codex") } }); c.settings.set("ui.richBlocks", false); return { c, reqs };
}
const until = async (f: () => boolean) => { const t = Date.now(); while (!f()) { if (Date.now() - t > 6000) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 15)); } };
async function ask(c: any, reqs: RunRequest[], mode: "chat" | "work", style?: string) { const id = mode === "work" ? c.works.get(await c.works.create({ title: "W", provider: "claude" })).conversation_id : await c.conversations.create({ mode, provider: "claude", style }); const n = reqs.length; await c.conversations.send(id, "bonjour"); await until(() => reqs.length > n && c.conversations.messages(id).length >= 2); return { id, instr: reqs[reqs.length - 1]!.instructions ?? "" }; }

describe("Instructions personnalisées et styles", () => {
  it("rien n'est ajouté tant que les champs sont vides", async () => {
    const { c, reqs } = mk(); const { instr } = await ask(c, reqs, "chat"); expect(instr).not.toMatch(/Préférences de l'utilisateur|Style de réponse/);
  });
  it("préférences et style par défaut ajoutés à l'invite, en Chat comme en Work", async () => {
    const { c, reqs } = mk(); c.profile.save({ about: "Je m'appelle Nada, développeuse.", howto: "Termine toujours par ZEBRA.", defaultStyle: "concis" });
    for (const mode of ["chat", "work"] as const) { const { instr } = await ask(c, reqs, mode); expect(instr).toContain("Je m'appelle Nada"); expect(instr).toContain("Termine toujours par ZEBRA."); expect(instr).toMatch(/\[Style de réponse : Concis\]/); }
  });
  it("le style de la conversation remplace le style par défaut ; « aucun » retire le style", async () => {
    const { c, reqs } = mk(); c.profile.save({ defaultStyle: "concis" });
    const a = await ask(c, reqs, "chat", "formel"); expect(a.instr).toMatch(/Style de réponse : Formel/); expect(a.instr).not.toMatch(/Concis/);
    c.conversations.setStyle(a.id, null); await c.conversations.send(a.id, "encore"); await until(() => c.conversations.messages(a.id).length >= 4); expect(reqs.at(-1)!.instructions).toMatch(/Style de réponse : Concis/);
    expect(() => c.conversations.setStyle(a.id, "inconnu")).toThrow(/Style inconnu/); expect(c.conversations.get(a.id).style).toBeNull();
  });
  it("styles personnalisés : validation, unicité, limite, repli du style par défaut supprimé", () => {
    const { c } = mk(); const s = c.profile.saveCustom([{ name: "Pirate", prompt: "Parle comme un pirate." }]); expect(s).toHaveLength(1); expect(c.profile.list()).toHaveLength(BUILTIN_STYLES.length + 1);
    c.profile.save({ defaultStyle: s[0]!.id }); expect(c.profile.textFor()).toMatch(/Pirate/);
    expect(() => c.profile.saveCustom([{ name: "concis", prompt: "x" }])).toThrow(/déjà utilisé/); expect(() => c.profile.saveCustom([{ name: "A", prompt: "x" }, { name: "a", prompt: "y" }])).toThrow(/déjà utilisé/); expect(() => c.profile.saveCustom([{ name: "", prompt: "x" }])).toThrow(/nom et d'une consigne/);
    expect(() => c.profile.saveCustom(Array.from({ length: 13 }, (_, i) => ({ name: "n" + i, prompt: "p" })))).toThrow(/12 styles/);
    c.profile.saveCustom([]); expect(c.profile.get().defaultStyle).toBe(""); // le style par défaut supprimé est retiré
  });
  it("longueurs bornées", () => { const { c } = mk(); c.profile.save({ about: "x".repeat(MAX_ABOUT + 500) }); expect(c.profile.get().about.length).toBe(MAX_ABOUT); expect(() => c.profile.save({ defaultStyle: "nexistepas" })).toThrow(/Style inconnu/); });
});
