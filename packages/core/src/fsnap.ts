import { readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const SKIP = new Set([".git", "node_modules", ".next", "dist", "build", ".cache", "__pycache__", ".venv", "target", ".gradle", ".idea"]);
/** Empreinte légère d'un dossier (taille + date) pour détecter les fichiers modifiés quand le fournisseur ne les signale pas (ex. écriture via shell). */
export function snapshotDir(root: string, opts: { maxFiles?: number; maxMs?: number } = {}): { map: Map<string, string>; truncated: boolean } {
  const map = new Map<string, string>(); const max = opts.maxFiles ?? 20000; const deadline = Date.now() + (opts.maxMs ?? 3000); let truncated = false;
  const walk = (dir: string, rel: string) => {
    if (truncated) return; let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) { if (map.size >= max || Date.now() > deadline) { truncated = true; return; } if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(join(dir, e.name), rel ? rel + "/" + e.name : e.name); } else if (e.isFile()) { try { const st = statSync(join(dir, e.name)); map.set(rel ? rel + "/" + e.name : e.name, `${Math.round(st.mtimeMs)}:${st.size}`); } catch { /* fichier disparu */ } } }
  };
  walk(root, ""); return { map, truncated };
}
export function diffSnapshots(before: Map<string, string>, after: Map<string, string>): string[] {
  const out: string[] = []; for (const [k, v] of after) if (before.get(k) !== v) out.push(k); for (const k of before.keys()) if (!after.has(k)) out.push(k); return out.sort();
}
export const _sep = sep;
