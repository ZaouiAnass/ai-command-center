import { describe, it, expect } from "vitest";
import { parseQuiz } from "../src/renderer/components/RichBlocks";

describe("QCM : validation du JSON produit par le modèle", () => {
  const q = (o: any) => JSON.stringify(o);
  it("accepte un QCM valide (index, lettre ou tableau pour plusieurs bonnes réponses)", () => {
    const r = parseQuiz(q({ title: "T", questions: [{ q: "a ?", options: ["x", "y", "z"], answer: 1, explain: "parce que" }, { q: "b ?", options: ["x", "y"], answer: "B" }, { q: "c ?", options: ["x", "y", "z"], answer: [0, 2] }, { q: "d ?", options: ["x", "y"] }] }));
    expect(typeof r).toBe("object"); if (typeof r === "string") return; expect(r.title).toBe("T");
    expect(r.questions.map((x) => x.answer)).toEqual([[1], [1], [0, 2], undefined]); expect(r.questions.map((x) => x.multi)).toEqual([false, false, true, false]); expect(r.questions[0]!.explain).toBe("parce que");
  });
  it("accepte un simple tableau de questions et les clés alternatives", () => {
    const r = parseQuiz(q([{ question: "a ?", choices: ["x", "y"], correct: 0, explanation: "e" }])); expect(typeof r).toBe("object"); if (typeof r !== "string") expect(r.questions[0]).toMatchObject({ q: "a ?", options: ["x", "y"], answer: [0], explain: "e" });
  });
  it("refuse proprement : JSON invalide, vide, options hors bornes, trop de questions, réponse hors options", () => {
    expect(parseQuiz("{pas du json")).toBe("JSON invalide"); expect(parseQuiz(q({ questions: [] }))).toMatch(/aucune question/); expect(parseQuiz(q({ questions: [{ q: "a", options: ["seule"] }] }))).toMatch(/mal formée/);
    expect(parseQuiz(q({ questions: [{ q: "a", options: Array.from({ length: 9 }, (_, i) => String(i)) }] }))).toMatch(/mal formée/); expect(parseQuiz(q({ questions: Array.from({ length: 41 }, () => ({ q: "a", options: ["x", "y"] })) }))).toMatch(/trop de questions/);
    const r = parseQuiz(q({ questions: [{ q: "a", options: ["x", "y"], answer: 5 }] })); if (typeof r !== "string") expect(r.questions[0]!.answer).toBeUndefined(); // réponse invalide : on n'invente pas de correction
  });
});
