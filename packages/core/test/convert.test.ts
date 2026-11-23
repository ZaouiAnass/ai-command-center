import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocConverter, estimateTokens, CONVERTIBLE } from "../src/convert.js";
import { createCore } from "../src/service.js";

const tmp = () => mkdtempSync(join(tmpdir(), "conv-"));
const file = (dir: string, name: string, data: string | Buffer) => { const p = join(dir, name); writeFileSync(p, data); return p; };

describe("Pièces jointes : tri des fichiers (sans convertisseur installé)", () => {
  it("lit le texte tel quel, refuse binaire/inconnu/absent/image avec une raison claire", async () => {
    const d = tmp(); const c = new DocConverter(tmp());
    const r = await c.load([file(d, "a.txt", "bonjour ORION"), file(d, "c.xyz", "x"), file(d, "d.log", Buffer.from([65, 0, 66])), join(d, "absent.txt"), file(d, "photo.png", "x")]);
    expect(r.files.map((f) => f.name)).toEqual(["a.txt"]); expect(r.files[0]!.meta).toMatchObject({ kind: "text", chars: 13, tokens: estimateTokens(13), truncated: false });
    const why = Object.fromEntries(r.skipped.map((s) => [s.name, s.reason])); expect(why["c.xyz"]).toMatch(/non pris en charge/); expect(why["d.log"]).toMatch(/binaire/); expect(why["absent.txt"]).toMatch(/introuvable/); expect(why["photo.png"]).toMatch(/bouton image/);
  });
  it("signale les documents à convertir quand MarkItDown n'est pas installé, sans les lire", async () => {
    const d = tmp(); const c = new DocConverter(tmp()); expect(c.status().installed).toBe(false);
    const r = await c.load([file(d, "r.pdf", "%PDF-1.4"), file(d, "n.docx", "PK"), file(d, "s.xlsx", "PK"), file(d, "t.txt", "ok")]);
    expect(r.needsConverter.map((p) => p.split(/[\\/]/).pop())).toEqual(["r.pdf", "n.docx", "s.xlsx"]); expect(r.files.map((f) => f.name)).toEqual(["t.txt"]);
    for (const e of [".pdf", ".docx", ".pptx", ".xlsx", ".xls", ".html", ".htm", ".epub"]) expect(CONVERTIBLE.has(e)).toBe(true);
  });
  it("limite à 5 fichiers et refuse les textes trop volumineux ; convert() échoue clairement sans installation", async () => {
    const d = tmp(); const c = new DocConverter(tmp()); const many = Array.from({ length: 7 }, (_, i) => file(d, `f${i}.txt`, "x"));
    const r = await c.load(many); expect(r.files).toHaveLength(5); expect(r.skipped.at(-1)!.reason).toMatch(/5 pièces jointes/);
    const big = await c.load([file(d, "gros.txt", "a".repeat(400_001))]); expect(big.skipped[0]!.reason).toMatch(/trop volumineux/);
    await expect(c.convert(join(d, "x.pdf"))).rejects.toThrow(/pas installé/);
  });
  it("estimation de tokens : ≈ 4 caractères par token", () => { expect(estimateTokens(4000)).toBe(1000); expect(estimateTokens(0)).toBe(0); });
});

describe("Pièces jointes : envoi au modèle", () => {
  it("clôture de code plus longue que les blocs contenus dans le fichier ; limites de taille", async () => {
    const dir = tmp(); const c = createCore({ dataDir: dir, dbFile: ":memory:", adapters: { claude: undefined as any, codex: undefined as any } } as any);
    const bad = "```js\nconsole.log(1)\n```\n````\nquatre\n````";
    const att = c.conversations.checkAttachments([{ name: "n.md", content: bad, meta: { x: 1 } } as any]); expect(att).toEqual([{ name: "n.md", content: bad }]); // seuls nom et contenu partent au modèle
    expect(() => c.conversations.checkAttachments([{ name: "g.md", content: "a".repeat(400_001) }])).toThrow(/400 000/);
    expect(() => c.conversations.checkAttachments([{ name: "a", content: "a".repeat(300_000) }, { name: "b", content: "b".repeat(300_000) }, { name: "c", content: "c".repeat(100) }])).toThrow(/600 000/);
    expect(() => c.conversations.checkAttachments(Array.from({ length: 6 }, (_, i) => ({ name: "f" + i, content: "x" })))).toThrow(/5 pièces/);
  });
});
