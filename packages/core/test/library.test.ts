import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCore } from "../src/service.js";
import { extractBlocks, isArtifact } from "../src/library.js";
import { run, uid } from "../src/db.js";

const F = "`".repeat(3), F4 = "`".repeat(4);
const quiz = F + "quiz\n" + JSON.stringify({ title: "Capitales", questions: [{ q: "France ?", options: ["Paris", "Rome"], answer: 0 }] }) + "\n" + F;
const chart = F + "chart\n" + JSON.stringify({ type: "bar", title: "Ventes", x: "m", series: ["v"], data: [{ m: "Jan", v: 3 }] }) + "\n" + F;
const page = F + "artifact\n<!doctype html><html><head><title>Compteur</title></head><body>ok</body></html>\n" + F;
const snippet = F + "html\n<div class=\"x\">juste un extrait de code</div>\n" + F;
const fullHtml = F + "html\n<!DOCTYPE html><html><body><h1>Titre complet</h1></body></html>\n" + F;
const svg = F + "svg\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"></svg>\n" + F;
const fakeSvg = F + "svg\nce n'est pas une image\n" + F;
const mermaid = F + "mermaid\ngraph LR\n  A --> B\n" + F;
const py = F + "python\nprint(1)\n" + F;

function mk() {
  const c = createCore({ dataDir: mkdtempSync(join(tmpdir(), "lib-")), dbFile: ":memory:", adapters: { claude: undefined as any, codex: undefined as any } } as any);
  const conv = (title: string, mode = "chat") => { const id = uid(); run(c.db, "INSERT INTO conversations (id,mode,title,provider,created_at,updated_at) VALUES (?,?,?,?,?,?)", id, mode, title, "claude", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"); return id; };
  const msg = (cid: string, content: string, at: string, role = "assistant", status = "completed") => { const id = uid(); run(c.db, "INSERT INTO conversation_messages (id,conversation_id,role,content,status,created_at) VALUES (?,?,?,?,?,?)", id, cid, role, content, status, at); return id; };
  return { c, conv, msg };
}

describe("Bibliothèque d'artefacts : extraction (mêmes règles que l'affichage)", () => {
  it("reconnaît les blocs interactifs et ignore le code ordinaire, les extraits HTML et les faux SVG", () => {
    const blocks = extractBlocks([quiz, py, snippet, fullHtml, svg, fakeSvg, mermaid, page, chart].join("\n\ntexte\n\n")); expect(blocks.map((b) => b.lang)).toEqual(["quiz", "html", "svg", "mermaid", "artifact", "chart"]);
    expect(isArtifact("html", "<div>extrait</div>")).toBe(false); expect(isArtifact("html", "<!doctype html><html></html>")).toBe(true); expect(isArtifact("svg", "pas de balise")).toBe(false); expect(isArtifact("python", "x")).toBe(false); expect(isArtifact("quiz", "   ")).toBe(false);
  });
  it("gère les clôtures plus longues (4 accents graves) contenant un bloc de code interne", () => {
    const inner = F4 + "artifact\n<!doctype html><html><body><pre>\n" + F + "js\nlet a = 1\n" + F + "\n</pre></body></html>\n" + F4; const b = extractBlocks("avant\n" + inner + "\naprès"); expect(b).toHaveLength(1); expect(b[0]!.code).toContain("let a = 1");
  });
});

describe("Bibliothèque d'artefacts : liste, filtres, ouverture", () => {
  it("liste du plus récent au plus ancien, avec titres, filtres par type et recherche", () => {
    const { c, conv, msg } = mk(); const a = conv("Géographie"), b = conv("Ventes 2026", "work");
    const m1 = msg(a, "Voici :\n\n" + quiz, "2026-03-01T10:00:00Z"); msg(a, "du code " + py, "2026-03-02T10:00:00Z"); const m3 = msg(b, chart + "\n\n" + page + "\n\n" + mermaid, "2026-03-03T10:00:00Z");
    const all = c.library.list(); expect(all.map((x) => x.kind)).toEqual(["chart", "page", "diagram", "quiz"]); expect(all[0]).toMatchObject({ conversationTitle: "Ventes 2026", mode: "work", title: "Graphique : Ventes" }); expect(all[1]!.title).toBe("Page : Compteur"); expect(all[3]!.title).toMatch(/QCM \(1 question\) : Capitales/);
    expect(c.library.list({ kind: "quiz" })).toHaveLength(1); expect(c.library.list({ kind: "page" })).toHaveLength(1); expect(c.library.list({ q: "géographie" })).toHaveLength(1); expect(c.library.list({ q: "compteur" })[0]!.kind).toBe("page"); expect(c.library.list({ q: "introuvable-xyz" })).toHaveLength(0); expect(c.library.list({ limit: 2 })).toHaveLength(2);
    expect(all.map((x) => x.id)).toEqual([`${m3}:0`, `${m3}:1`, `${m3}:2`, `${m1}:0`]);
  });
  it("get() renvoie le code exact ; refuse un identifiant inconnu ; ignore messages de l'utilisateur et réponses échouées", () => {
    const { c, conv, msg } = mk(); const a = conv("T"); const m = msg(a, quiz, "2026-03-01T10:00:00Z"); msg(a, quiz, "2026-03-02T10:00:00Z", "user"); msg(a, quiz, "2026-03-03T10:00:00Z", "assistant", "failed");
    expect(c.library.list()).toHaveLength(1); const it = c.library.get(`${m}:0`); expect(it.code).toBe(JSON.stringify({ title: "Capitales", questions: [{ q: "France ?", options: ["Paris", "Rome"], answer: 0 }] })); expect(it.lang).toBe("quiz");
    expect(() => c.library.get("inconnu:0")).toThrow(/introuvable/); expect(() => c.library.get(`${m}:9`)).toThrow(/introuvable/);
  });
});
