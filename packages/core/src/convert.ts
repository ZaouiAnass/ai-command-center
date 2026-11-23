import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync, readFileSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { terminalEnv } from "./terminal.js";
import type { EventBus } from "./events.js";

const WIN = process.platform === "win32";
/** Formats convertis en Markdown par MarkItDown (Microsoft) : beaucoup plus compact que le binaire ou le texte brut mis en page. */
export const CONVERTIBLE = new Set([".pdf", ".docx", ".pptx", ".xlsx", ".xls", ".html", ".htm", ".epub"]);
/** Formats texte lus tels quels (déjà compacts et exacts : un CSV brut coûte moins de tokens qu'un tableau Markdown). */
export const TEXT_EXT = new Set([".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".xml", ".yml", ".yaml", ".toml", ".ini", ".log", ".sql", ".sh", ".bat", ".ps1", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".java", ".c", ".cpp", ".h", ".hpp", ".cs", ".go", ".rs", ".rb", ".php", ".swift", ".kt", ".css", ".scss", ".vue", ".svelte", ".ipynb", ".tex", ".rst", ".env.example", ".gitignore"]);
export const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
export const MAX_MARKDOWN_CHARS = 400_000;
export const MAX_TEXT_BYTES = 400_000;
/** Estimation grossière (≈ 4 caractères par token) : sert à informer, jamais à facturer. */
export const estimateTokens = (chars: number) => Math.round(chars / 4);

export interface ConverterStatus { installed: boolean; installing: boolean; python?: string; cli?: string; mcp?: string; version?: string; error?: string }
export interface LoadedFile { name: string; content: string; meta: { kind: "text" | "converted"; ext: string; sourceBytes: number; chars: number; tokens: number; truncated: boolean; note?: string } }
export interface LoadResult { files: LoadedFile[]; skipped: { name: string; reason: string }[]; needsConverter: string[] }

function run(cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; timeoutMs: number; onLine?: (l: string) => void; maxOut?: number }): Promise<{ code: number | null; out: string; err: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let out = "", err = "", timedOut = false; let c; try { c = spawn(cmd, args, { env: opts.env, windowsHide: true, shell: false }); } catch (e: any) { return resolve({ code: -1, out: "", err: String(e.message), timedOut: false }); }
    const t = setTimeout(() => { timedOut = true; try { c.kill(); } catch { /* arrêté */ } }, opts.timeoutMs); const max = opts.maxOut ?? 30_000_000;
    c.stdout.on("data", (d) => { if (out.length < max) out += d; if (opts.onLine) String(d).split(/\r?\n/).filter(Boolean).forEach(opts.onLine); }); c.stderr.on("data", (d) => { if (err.length < 200_000) err += d; if (opts.onLine) String(d).split(/\r?\n/).filter(Boolean).forEach(opts.onLine); });
    c.on("error", (e) => { clearTimeout(t); resolve({ code: -1, out, err: err + String(e.message), timedOut }); }); c.on("close", (code) => { clearTimeout(t); resolve({ code, out, err, timedOut }); });
  });
}

/** Conversion de documents en Markdown avec MarkItDown (Microsoft), installé dans un environnement Python isolé du dossier de données : aucun changement global sur l'ordinateur. */
export class DocConverter {
  private venv: string; private inflight?: Promise<ConverterStatus>; installing = false; lastError?: string;
  constructor(root: string, private bus?: EventBus) { this.venv = join(root, "tools", "markitdown"); }
  private exe(name: string) { return join(this.venv, WIN ? "Scripts" : "bin", name + (WIN ? ".exe" : "")); }
  get cliPath() { return this.exe("markitdown"); } get mcpPath() { return this.exe("markitdown-mcp"); }
  status(): ConverterStatus { const installed = existsSync(this.cliPath); return { installed, installing: this.installing, cli: installed ? this.cliPath : undefined, mcp: existsSync(this.mcpPath) ? this.mcpPath : undefined, error: this.lastError }; }

  /** Cherche un Python ≥ 3.10 (prérequis de MarkItDown). */
  async findPython(): Promise<{ cmd: string; args: string[]; version: string } | undefined> {
    for (const [cmd, args] of [["python", []], ["py", ["-3"]], ["python3", []]] as [string, string[]][]) {
      const r = await run(cmd, [...args, "--version"], { timeoutMs: 10000 }); const m = /Python (\d+)\.(\d+)\.(\d+)/.exec(r.out + r.err);
      if (m && (Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 10))) return { cmd, args, version: `${m[1]}.${m[2]}.${m[3]}` };
    }
    return undefined;
  }
  private progress(line: string) { this.bus?.emit("convert.progress", { line: line.slice(0, 200) }); }

  /** Installe MarkItDown (convertisseur + serveur MCP officiel) dans un environnement virtuel dédié. Action explicite de l'utilisateur. */
  install(): Promise<ConverterStatus> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      this.installing = true; this.lastError = undefined;
      try {
        const py = await this.findPython(); if (!py) throw new Error("Python 3.10 ou plus récent est requis (introuvable). Installez-le depuis python.org puis réessayez.");
        this.progress(`Python ${py.version} détecté`); mkdirSync(join(this.venv, ".."), { recursive: true });
        if (!existsSync(this.exe("python"))) { this.progress("Création de l'environnement isolé…"); const v = await run(py.cmd, [...py.args, "-m", "venv", this.venv], { timeoutMs: 120000 }); if (v.code !== 0) throw new Error("Création de l'environnement Python impossible : " + (v.err || v.out).slice(-300)); }
        this.progress("Téléchargement et installation de MarkItDown (1 à 3 minutes)…");
        const env = { ...terminalEnv(true), PIP_DISABLE_PIP_VERSION_CHECK: "1", PYTHONUTF8: "1" };
        const p = await run(this.exe("python"), ["-m", "pip", "install", "--disable-pip-version-check", "markitdown[pdf,docx,pptx,xlsx,xls]", "markitdown-mcp"], { env, timeoutMs: 900000, onLine: (l) => this.progress(l) });
        if (p.code !== 0) throw new Error(p.timedOut ? "Délai dépassé pendant l'installation (connexion lente ?)." : "Installation échouée : " + (p.err || p.out).split(/\r?\n/).filter(Boolean).slice(-3).join(" ").slice(0, 400));
        if (!existsSync(this.cliPath)) throw new Error("Installation terminée mais l'exécutable markitdown est introuvable.");
        this.progress("Installation terminée."); this.bus?.emit("convert.installed", {});
      } catch (e: any) { this.lastError = String(e.message); this.bus?.emit("convert.progress", { line: this.lastError, error: true }); }
      finally { this.installing = false; this.inflight = undefined; }
      return this.status();
    })();
    return this.inflight;
  }

  /** Convertit un fichier en Markdown. Lève une erreur claire (PDF scanné, protégé, corrompu…). */
  async convert(file: string): Promise<{ markdown: string; truncated: boolean; ms: number }> {
    if (!existsSync(this.cliPath)) throw new Error("MarkItDown n'est pas installé.");
    const t0 = Date.now(); const r = await run(this.cliPath, [file], { env: { ...terminalEnv(true), PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }, timeoutMs: 180000 });
    if (r.timedOut) throw new Error("Conversion trop longue (plus de 3 minutes).");
    if (r.code !== 0) throw new Error("Conversion impossible : " + (r.err.split(/\r?\n/).filter(Boolean).slice(-2).join(" ") || "erreur inconnue").slice(0, 300));
    let md = r.out.replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
    if (md.length < 20) throw new Error("Aucun texte extrait : le document est probablement un scan (image) ou protégé. Ajoutez-le comme image ou fournissez une version texte.");
    let truncated = false; if (md.length > MAX_MARKDOWN_CHARS) { md = md.slice(0, MAX_MARKDOWN_CHARS) + "\n\n[… document tronqué : la suite dépasse la taille maximale envoyée au modèle]"; truncated = true; }
    return { markdown: md, truncated, ms: Date.now() - t0 };
  }

  /** Prépare des fichiers pour le chat : texte lu tel quel, documents convertis en Markdown, le reste refusé avec une raison. */
  async load(paths: string[]): Promise<LoadResult> {
    const res: LoadResult = { files: [], skipped: [], needsConverter: [] };
    for (const p of paths.slice(0, 5)) {
      const name = basename(p); const ext = extname(p).toLowerCase(); let size = 0;
      try { const st = statSync(p); if (!st.isFile()) { res.skipped.push({ name, reason: "Ce n'est pas un fichier." }); continue; } size = st.size; } catch { res.skipped.push({ name, reason: "Fichier introuvable." }); continue; }
      if (size > MAX_SOURCE_BYTES) { res.skipped.push({ name, reason: `Fichier trop volumineux (${Math.round(size / 1048576)} Mo, 50 Mo maximum).` }); continue; }
      if (IMAGE_EXT.has(ext)) { res.skipped.push({ name, reason: "Les images s'ajoutent avec le bouton image." }); continue; }
      if (CONVERTIBLE.has(ext)) {
        if (!this.status().installed) { res.needsConverter.push(p); continue; }
        try { const c = await this.convert(p); res.files.push({ name: `${name}.md`, content: c.markdown, meta: { kind: "converted", ext, sourceBytes: size, chars: c.markdown.length, tokens: estimateTokens(c.markdown.length), truncated: c.truncated, note: `Converti en Markdown en ${(c.ms / 1000).toFixed(1)} s` } }); }
        catch (e: any) { res.skipped.push({ name, reason: String(e.message) }); }
        continue;
      }
      if (TEXT_EXT.has(ext) || ext === "") {
        if (size > MAX_TEXT_BYTES) { res.skipped.push({ name, reason: `Fichier texte trop volumineux (${Math.round(size / 1000)} Ko, 400 Ko maximum).` }); continue; }
        const buf = readFileSync(p); if (buf.includes(0)) { res.skipped.push({ name, reason: "Fichier binaire non pris en charge." }); continue; }
        const content = buf.toString("utf8"); res.files.push({ name, content, meta: { kind: "text", ext, sourceBytes: size, chars: content.length, tokens: estimateTokens(content.length), truncated: false } }); continue;
      }
      res.skipped.push({ name, reason: `Type « ${ext || "inconnu"} » non pris en charge. Formats : PDF, Word, PowerPoint, Excel, HTML, EPUB, texte et code.` });
    }
    if (paths.length > 5) res.skipped.push({ name: `${paths.length - 5} fichier(s)`, reason: "5 pièces jointes maximum." });
    return res;
  }
}
