import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os"; import { join } from "node:path"; import { spawnSync } from "node:child_process";
import { listDir, readPreview, gitStatusMap, insideProject } from "../src/files.js";
import { applyChunk, newAcc, isCloudModel, stripThinking } from "../src/providers/open.js";

describe("arborescence des projets", () => {
  const mk = () => { const d = mkdtempSync(join(tmpdir(), "acc-tree-")); mkdirSync(join(d, "src")); mkdirSync(join(d, "node_modules")); writeFileSync(join(d, "src", "b.ts"), "export const b = 1;"); writeFileSync(join(d, "a.md"), "# A"); writeFileSync(join(d, ".env"), "X=1"); writeFileSync(join(d, "img.png"), Buffer.from([0x89, 0x50, 0, 1])); return d; };
  it("dossiers d'abord, dossiers générés signalés, .git masqué, fichiers cachés marqués", () => {
    const d = mk(); mkdirSync(join(d, ".git")); const r = listDir(d);
    expect(r.entries.map((e) => e.name)).toEqual(["node_modules", "src", ".env", "a.md", "img.png"]);
    expect(r.entries.find((e) => e.name === "node_modules")!.heavy).toBe(true); expect(r.entries.find((e) => e.name === ".env")!.hidden).toBe(true);
    expect(listDir(d, "src").entries[0]).toMatchObject({ name: "b.ts", path: "src/b.ts", dir: false, size: 19 });
  });
  it("refuse de sortir du projet ou de lire .git ; aperçu texte seulement", () => {
    const d = mk(); expect(() => listDir(d, "..")).toThrow(/hors du projet/); expect(() => insideProject(d, ".git/config")).toThrow(/\.git/); expect(() => readPreview(d, "../x")).toThrow(/hors du projet/);
    expect(readPreview(d, "src/b.ts")).toMatchObject({ content: "export const b = 1;", language: "typescript", truncated: false });
    expect(() => readPreview(d, "img.png")).toThrow(/binaire/); expect(() => readPreview(d, "src")).toThrow(/dossier/);
  });
  it("état Git : branche, fichiers modifiés / non suivis et compte par dossier", () => {
    const d = mk(); const g = (...a: string[]) => spawnSync("git", a, { cwd: d, encoding: "utf8" });
    expect(gitStatusMap(d).branch).toBeNull();
    g("init", "-q", "-b", "main"); g("-c", "user.email=t@t", "-c", "user.name=t", "add", "a.md"); g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
    writeFileSync(join(d, "a.md"), "# A modifié"); const s = gitStatusMap(d);
    expect(s.branch).toBe("main"); expect(s.files["a.md"]).toBe("modified"); expect(s.files["src/b.ts"]).toBe("untracked"); expect(s.dirs["src"]).toBe(1);
  });
});

describe("modèles « thinking » et Ollama Cloud", () => {
  it("raisonnement séparé du texte affiché, cache DeepSeek compté", () => {
    const acc = newAcc(); let shown = "";
    shown += applyChunk(acc, { choices: [{ delta: { reasoning_content: "Je réfléchis" } }] }); shown += applyChunk(acc, { choices: [{ delta: { reasoning: "…encore" } }] }); shown += applyChunk(acc, { choices: [{ delta: { content: "Réponse" } }] });
    applyChunk(acc, { choices: [], usage: { prompt_tokens: 50, completion_tokens: 10, prompt_cache_hit_tokens: 30 } });
    expect(shown).toBe("Réponse"); expect(acc.reasoning).toBe("Je réfléchis…encore"); expect(acc.usage).toMatchObject({ prompt: 50, cached: 30 });
  });
  it("détecte les modèles cloud et retire <think>", () => {
    expect(isCloudModel("kimi-k2.6:cloud")).toBe(true); expect(isCloudModel("deepseek-v4-flash:cloud")).toBe(true); expect(isCloudModel("gpt-oss:120b-cloud")).toBe(true); expect(isCloudModel("deepseek-r1:8b")).toBe(false);
    expect(stripThinking("<think>\nhmm\n</think>\n\nBonjour")).toBe("Bonjour"); expect(stripThinking("Bonjour")).toBe("Bonjour");
  });
});
