import { describe, it, expect, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { openDb, now } from "../src/db.js";
import { TerminalManager, terminalEnv } from "../src/terminal.js";
import { setSetting } from "../src/settings.js";
import type { ProviderStatus } from "../src/types.js";

const st = (o: Partial<ProviderStatus> = {}): ProviderStatus => ({ provider: "claude", installed: true, path: "C:/x/claude.exe", authenticated: true, authMode: "subscription", warnings: [], checkedAt: now(), ...o });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(f: () => boolean, ms = 15000) { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error("timeout"); await wait(50); } }
let tm: TerminalManager | undefined; afterEach(() => tm?.shutdown());

describe("TerminalManager", () => {
  it("lance un vrai shell PTY, reçoit la sortie, redimensionne et conserve le scrollback", async () => {
    const out: Record<string, string> = {}; const db = openDb(":memory:");
    tm = new TerminalManager(db, async () => st(), (e) => { if (e.data) out[e.id] = (out[e.id] ?? "") + e.data; });
    const info = await tm.create({ kind: "shell", cwd: tmpdir(), cols: 100, rows: 30 });
    tm.write(info.id, "echo marqueur-" + "pty42\r");
    await until(() => (out[info.id] ?? "").split("marqueur-pty42").length > 2 || /marqueur-pty42\r?\n/.test(out[info.id] ?? ""));
    expect(tm.list()[0]!.pid).toBeGreaterThan(0); tm.resize(info.id, 120, 40); expect(tm.list()[0]!.cols).toBe(120);
    expect(tm.attach(info.id).buffer).toContain("marqueur-pty42");
  });
  it("signale la sortie du processus", async () => {
    const exits: any[] = []; tm = new TerminalManager(openDb(":memory:"), async () => st(), (e) => e.exit && exits.push(e));
    const info = await tm.create({ kind: "shell", cwd: tmpdir() }); tm.write(info.id, "exit\r"); await until(() => exits.length > 0); expect(tm.list()[0]!.exited).toBeTruthy();
  });
  it("bloque Claude/Codex si l'authentification n'est pas un abonnement (mode exclusif)", async () => {
    tm = new TerminalManager(openDb(":memory:"), async () => st({ authMode: "api_key" }), () => {});
    await expect(tm.create({ kind: "claude", cwd: tmpdir() })).rejects.toThrow(/abonnement exclusif/);
  });
  it("refuse un CLI absent ou déconnecté avec un message clair", async () => {
    tm = new TerminalManager(openDb(":memory:"), async () => st({ installed: false }), () => {}); await expect(tm.create({ kind: "codex", cwd: tmpdir() })).rejects.toThrow(/n'est pas détecté/);
    tm = new TerminalManager(openDb(":memory:"), async () => st({ authenticated: false }), () => {}); await expect(tm.create({ kind: "claude", cwd: tmpdir() })).rejects.toThrow(/authentification requise/);
  });
  it("dossier inexistant refusé", async () => { tm = new TerminalManager(openDb(":memory:"), async () => st(), () => {}); await expect(tm.create({ kind: "shell", cwd: "C:/n/existe/pas/zz" })).rejects.toThrow(/introuvable/); });
  it("terminalEnv retire les variables API des deux fournisseurs et l'état de session parent", () => {
    const e = terminalEnv(true, { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "b", CLAUDE_CODE_SESSION_ID: "s", PATH: "p" } as any);
    expect(e.ANTHROPIC_API_KEY).toBeUndefined(); expect(e.OPENAI_API_KEY).toBeUndefined(); expect(e.CLAUDE_CODE_SESSION_ID).toBeUndefined(); expect(e.PATH).toBe("p"); expect(e.TERM).toBe("xterm-256color");
    expect(terminalEnv(false, { OPENAI_API_KEY: "b" } as any).OPENAI_API_KEY).toBe("b");
  });
  it("mode exclusif désactivé laisse passer un mode non-abonnement", async () => {
    const db = openDb(":memory:"); setSetting(db, "billing.exclusive", false); tm = new TerminalManager(db, async () => st({ authMode: "api_key", path: process.execPath }), () => {});
    const info = await tm.create({ kind: "claude", cwd: tmpdir() }); await wait(500); expect(tm.list().find((x) => x.id === info.id)!.pid).toBeGreaterThan(0);
  });
});
