import { spawnSync } from "node:child_process";
import { readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { extname, join, relative, resolve, isAbsolute } from "node:path";

/** Arborescence d'un projet (lecture seule, chargement paresseux dossier par dossier, bornée au dossier du projet). */
export interface FileEntry { name: string; path: string; dir: boolean; size?: number; heavy?: boolean; hidden?: boolean }
/** Dossiers volumineux ou générés : affichés mais signalés, jamais ouverts automatiquement. */
export const HEAVY_DIRS = new Set(["node_modules", "dist", "build", "out", ".next", ".nuxt", ".venv", "venv", "env", "__pycache__", "target", ".cache", ".gradle", "bin", "obj", "coverage", ".turbo", "release"]);
const MAX_ENTRIES = 500;
const MAX_PREVIEW = 300_000;

/** Résout un chemin relatif au projet ; refuse toute sortie du dossier et le contenu de .git. */
export function insideProject(root: string, rel: string): string {
  const base = resolve(root); const full = resolve(base, String(rel || "."));
  const r = relative(base, full); if (r.startsWith("..") || isAbsolute(r)) throw new Error("Chemin hors du projet refusé.");
  if (r.split(/[\\/]/).includes(".git")) throw new Error("Le dossier .git n'est pas affiché.");
  return full;
}
const toRel = (root: string, full: string) => relative(resolve(root), full).split("\\").join("/");

export function listDir(root: string, rel = ""): { entries: FileEntry[]; truncated: boolean } {
  const dir = insideProject(root, rel); let names: string[];
  try { names = readdirSync(dir); } catch (e: any) { throw new Error(`Dossier illisible : ${e.code ?? e.message}`); }
  const out: FileEntry[] = [];
  for (const name of names) {
    if (name === ".git") continue; const full = join(dir, name); let st;
    try { st = statSync(full); } catch { continue; } // lien cassé, fichier verrouillé
    const isDir = st.isDirectory();
    out.push({ name, path: toRel(root, full), dir: isDir, ...(isDir ? {} : { size: st.size }), ...(isDir && HEAVY_DIRS.has(name) ? { heavy: true } : {}), ...(name.startsWith(".") ? { hidden: true } : {}) });
  }
  out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, "fr", { sensitivity: "base", numeric: true }) : a.dir ? -1 : 1));
  return { entries: out.slice(0, MAX_ENTRIES), truncated: out.length > MAX_ENTRIES };
}

const BINARY_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf", ".zip", ".gz", ".7z", ".rar", ".exe", ".dll", ".so", ".dylib", ".bin", ".class", ".jar", ".pyc", ".woff", ".woff2", ".ttf", ".otf", ".mp3", ".mp4", ".wav", ".mov", ".sqlite", ".db", ".h5", ".pkl", ".pt", ".onnx", ".npy", ".keras"]);
/** Aperçu texte d'un fichier (300 Ko max, les binaires sont refusés). */
export function readPreview(root: string, rel: string): { path: string; content: string; size: number; truncated: boolean; language: string } {
  const full = insideProject(root, rel); const st = statSync(full); if (st.isDirectory()) throw new Error("C'est un dossier.");
  const ext = extname(full).toLowerCase(); if (BINARY_EXT.has(ext)) throw new Error("Fichier binaire : aperçu indisponible.");
  const n = Math.min(st.size, MAX_PREVIEW); const buf = Buffer.alloc(n); const fd = openSync(full, "r"); try { readSync(fd, buf, 0, n, 0); } finally { closeSync(fd); }
  if (buf.includes(0)) throw new Error("Fichier binaire : aperçu indisponible.");
  return { path: toRel(root, full), content: buf.toString("utf8"), size: st.size, truncated: st.size > MAX_PREVIEW, language: LANG[ext] ?? ext.slice(1) };
}
const LANG: Record<string, string> = { ".ts": "typescript", ".tsx": "tsx", ".js": "javascript", ".jsx": "jsx", ".mjs": "javascript", ".cjs": "javascript", ".py": "python", ".md": "markdown", ".json": "json", ".yml": "yaml", ".yaml": "yaml", ".html": "html", ".css": "css", ".sh": "bash", ".ps1": "powershell", ".rs": "rust", ".go": "go", ".java": "java", ".kt": "kotlin", ".cs": "csharp", ".cpp": "cpp", ".c": "c", ".h": "c", ".sql": "sql", ".toml": "toml", ".ipynb": "json", ".dart": "dart", ".swift": "swift", ".php": "php", ".rb": "ruby" };

/** État Git des fichiers (modifiés, ajoutés, non suivis…) pour décorer l'arborescence ; vide si le dossier n'est pas un dépôt. */
export function gitStatusMap(root: string): { branch: string | null; files: Record<string, string>; dirs: Record<string, number> } {
  const r = spawnSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--branch"], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 8000, maxBuffer: 20 * 1024 * 1024 });
  if (r.status !== 0) return { branch: null, files: {}, dirs: {} };
  const files: Record<string, string> = {}; const dirs: Record<string, number> = {}; let branch: string | null = null;
  const parts = (r.stdout ?? "").split("\0"); for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!; if (!p) continue;
    if (p.startsWith("## ")) { branch = p.slice(3).split("...")[0]!.replace(/^No commits yet on /, ""); continue; }
    const code = p.slice(0, 2); const path = p.slice(3); if (code[0] === "R" || code[0] === "C") i++; // renommage : chemin d'origine dans l'entrée suivante
    const kind = code === "??" ? "untracked" : code.includes("D") ? "deleted" : code.includes("A") ? "added" : "modified";
    files[path] = kind; const segs = path.split("/"); for (let k = 1; k < segs.length; k++) { const d = segs.slice(0, k).join("/"); dirs[d] = (dirs[d] ?? 0) + 1; }
  }
  return { branch, files, dirs };
}
