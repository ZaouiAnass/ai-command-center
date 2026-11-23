import { describe, it, expect } from "vitest";
import { moveRule } from "../src/renderer/pages/Tasks";
import { score } from "../src/renderer/Shell";
import { layout } from "../src/renderer/pages/Orchestrator";

describe("règles de déplacement des tâches (ne contournent pas le planificateur)", () => {
  it("refuse de déplacer une tâche en cours", () => expect(moveRule({ status: "in_progress" }, "todo").ok).toBe(false));
  it("déposer sur « En cours » démarre via le planificateur", () => expect(moveRule({ status: "todo" }, "in_progress")).toMatchObject({ ok: true, action: "start" }));
  it("« Terminé » exige la validation humaine préalable", () => { expect(moveRule({ status: "todo" }, "done").ok).toBe(false); expect(moveRule({ status: "review" }, "done").ok).toBe(true); });
  it("déplacement sans effet vers la même colonne", () => expect(moveRule({ status: "todo" }, "todo").ok).toBe(false));
});
describe("recherche de la palette", () => {
  it("préfixe > sous-chaîne > sous-séquence", () => { expect(score("tâc", "Tâches")).toBeGreaterThan(score("che", "Tâches")); });
  it("insensible aux accents", () => expect(score("taches", "Tâches")).toBeGreaterThan(0));
  it("tolère une faute simple", () => expect(score("agnts", "Agents")).toBeGreaterThan(0));
  it("rejette un terme sans rapport", () => expect(score("zzzz", "Agents")).toBe(0));
});
describe("disposition du graphe d'orchestration", () => {
  it("place les dépendances dans des colonnes successives", () => {
    const p = layout([{ id: "a" }, { id: "b" }, { id: "c" }], [{ task_id: "b", depends_on: "a" }, { task_id: "c", depends_on: "b" }]);
    expect(p.get("a")!.x).toBeLessThan(p.get("b")!.x); expect(p.get("b")!.x).toBeLessThan(p.get("c")!.x);
  });
  it("ne boucle pas sur un cycle", () => { expect(() => layout([{ id: "a" }, { id: "b" }], [{ task_id: "a", depends_on: "b" }, { task_id: "b", depends_on: "a" }])).not.toThrow(); });
});

import { effortsFor } from "../src/renderer/components/AIModelConfiguration";
describe("efforts exposés par le fournisseur", () => {
  const cat: any = { provider: "codex", available: true, notes: [], models: [{ id: "a", isDefault: true, displayName: "A", efforts: [{ value: "low" }, { value: "high" }] }, { id: "b", displayName: "B" }], defaultEfforts: [{ value: "low" }, { value: "high" }] };
  it("renvoie les efforts du modèle choisi", () => expect(effortsFor(cat, "a")?.map((e) => e.value)).toEqual(["low", "high"]));
  it("modèle sans effort exposé → non configurable (undefined)", () => expect(effortsFor(cat, "b")).toBeUndefined());
  it("sans modèle choisi → efforts du modèle par défaut", () => expect(effortsFor(cat, null)?.map((e) => e.value)).toEqual(["low", "high"]));
  it("fournisseur indisponible → aucun effort proposé", () => expect(effortsFor({ ...cat, available: false }, "a")).toBeUndefined());
});
