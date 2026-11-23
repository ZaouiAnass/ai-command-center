// Traduit .scratch/strings.json (FR -> EN) par lots avec Claude Code en mode Chat isolé (sans outil), puis génère le dictionnaire.
import { readFileSync, writeFileSync, existsSync } from "node:fs"; import { spawn } from "node:child_process";
const strings = JSON.parse(readFileSync(".scratch/strings.json", "utf8")); const CACHE = ".scratch/en-cache.json"; const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
const todo = strings.filter((s) => !cache[s]); const BATCH = 120;
function ask(batch) {
  const prompt = `Translate these French user-interface strings of a desktop developer app to natural, concise American English.
Rules: return ONLY one JSON object mapping each French string (exact key, unchanged) to its English translation. Keep punctuation, "…", "{{goal}}" and any code-like tokens unchanged. Keep product names (Claude Code, Codex, Git, MCP, Work, Chat, Code) unchanged. Translate "token(s)" as "token(s)". If a string is already English or untranslatable, map it to itself.\n\n${JSON.stringify(batch, null, 1)}`;
  return new Promise((res, rej) => { const p = spawn("claude", ["-p", "--tools", "", "--setting-sources", "project", "--strict-mcp-config", "--disable-slash-commands", "--output-format", "json", "--model", "sonnet"], { cwd: ".scratch/sbx2", shell: false }); let out = "", err = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d)); p.on("close", (c) => { try { const j = JSON.parse(out); const t = String(j.result); const m = /\{[\s\S]*\}/.exec(t); res(JSON.parse(m[0])); } catch (e) { rej(new Error("parse: " + e.message + " " + out.slice(0, 200) + err.slice(0, 200))); } }); p.stdin.end(prompt); });
}
import { mkdirSync } from "node:fs"; mkdirSync(".scratch/sbx2", { recursive: true });
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH); let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) { try { const r = await ask(batch); let n = 0; for (const k of batch) if (typeof r[k] === "string" && r[k].trim()) { cache[k] = r[k].trim(); n++; } writeFileSync(CACHE, JSON.stringify(cache)); console.log(`lot ${i / BATCH + 1}: ${n}/${batch.length}`); ok = n >= batch.length * 0.9; } catch (e) { console.log("erreur", e.message.slice(0, 160)); } }
}
const missing = strings.filter((s) => !cache[s]); console.log("traduites:", Object.keys(cache).length, "manquantes:", missing.length);
const map = Object.fromEntries(strings.filter((s) => cache[s] && cache[s] !== s).map((s) => [s, cache[s]]));
writeFileSync("apps/desktop/src/renderer/i18n.en.generated.ts", `// Généré par tools/translate-strings.mjs — dictionnaire FR -> EN appliqué à l'exécution (voir i18n.ts).\nexport const EN_MAP: Record<string, string> = ${JSON.stringify(map, null, 1)};\n`);
console.log("entrées:", Object.keys(map).length);
