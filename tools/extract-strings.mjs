// Extrait les chaînes d'interface (JSX, littéraux, templates) de l'app pour traduction.
import ts from "typescript"; import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs"; import { join } from "node:path";
const roots = ["apps/desktop/src/renderer", "packages/core/src"]; const out = new Set();
const FR = /[àâäçéèêëîïôöùûüœÀÂÉÈÊÎÔÙÛ]|\b(?:le|la|les|des|du|un|une|vous|votre|vos|pour|dans|avec|sans|est|sont|ou|et|pas|aucun|aucune|ce|cette|ces|nouveau|nouvelle|projet|tâche|fichier|ajouter|créer|lancer|choisir|supprimer|enregistrer|annuler|rechercher|chargement|erreur|échec|terminé|cours|modèle|fournisseur|titre|nom|objectif|statut|durée|date|total|tout|tous|toutes|oui|non|retour|suivant|fermer|ouvrir|voir|plus|moins|jamais|déjà)\b/i;
function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f) && !/\.d\.ts$/.test(f)) scan(p); } }
function keep(s, force) {
  s = s.replace(/\s+/g, " ").trim(); if (s.length < 2 || s.length > 400) return; if (!/[A-Za-zÀ-ÿ]{2}/.test(s)) return;
  if (/^(https?:|SELECT |INSERT |UPDATE |DELETE |CREATE |ALTER |UPDATE )/.test(s)) return; if (!force && /^[\w.:/#@%()\[\]\\-]+$/.test(s) && !FR.test(s)) return; if (!force && !FR.test(s)) return; if (force && /^[\w.:/#@%()\[\]\-]+$/.test(s) && /^[a-z]/.test(s)) return; out.add(s);
}
function scan(p) {
  const sf = ts.createSourceFile(p, readFileSync(p, "utf8"), ts.ScriptTarget.Latest, true, p.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  (function v(n) { if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) keep(n.text); else if (ts.isJsxText(n)) keep(n.text, true); else if (ts.isJsxAttribute(n) && n.initializer && ts.isStringLiteral(n.initializer) && ['title','placeholder','label','aria-label','alt','sub','text','desc','hint'].includes(n.name.getText())) keep(n.initializer.text, true); else if (ts.isTemplateExpression(n)) { keep(n.head.text); for (const s of n.templateSpans) keep(s.literal.text); } ts.forEachChild(n, v); })(sf);
}
roots.forEach(walk); mkdirSync(".scratch", { recursive: true }); const arr = [...out].sort(); writeFileSync(".scratch/strings.json", JSON.stringify(arr, null, 1));
console.log(arr.length, "chaînes ;", arr.reduce((s, x) => s + x.length, 0), "caractères");
