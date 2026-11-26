import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Folder, FolderOpen, FileText, FileCode, FileJson, Image as ImageIcon, File, RefreshCw, GitBranch, Search, X, ExternalLink, FolderSearch, AtSign, Copy } from "lucide-react";
import { api } from "../api"; import { toast } from "../overlay"; import { Modal } from "../ui"; import { Md } from "../pages/Sessions";

interface Entry { name: string; path: string; dir: boolean; size?: number; heavy?: boolean; hidden?: boolean }
interface GitMap { branch: string | null; files: Record<string, string>; dirs: Record<string, number> }
const errText = (e: any) => String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
const GIT_TONE: Record<string, [string, string]> = { modified: ["text-warning", "M"], added: ["text-success", "A"], untracked: ["text-success", "U"], deleted: ["text-danger", "D"] };
const GIT_LABEL: Record<string, string> = { modified: "modifié", added: "ajouté", untracked: "nouveau (non suivi)", deleted: "supprimé" };
const kb = (n?: number) => n == null ? "" : n < 1024 ? `${n} o` : n < 1048576 ? `${(n / 1024).toFixed(0)} Ko` : `${(n / 1048576).toFixed(1)} Mo`;
function iconFor(name: string) { const e = name.split(".").pop()?.toLowerCase() ?? ""; if (/^(png|jpe?g|gif|svg|webp|ico|bmp)$/.test(e)) return ImageIcon; if (/^(json|ya?ml|toml|ipynb)$/.test(e)) return FileJson; if (/^(md|txt|csv|log|rst)$/.test(e)) return FileText; if (/^(ts|tsx|js|jsx|mjs|py|java|kt|cs|cpp|c|h|go|rs|rb|php|dart|swift|sh|ps1|sql|html|css|scss)$/.test(e)) return FileCode; return File; }

/**
 * Arborescence d'un projet : dossiers chargés à la demande, état Git (M/A/U/D), aperçu des fichiers texte,
 * ouverture dans VS Code ou l'Explorateur, et (dans le Terminal) insertion de la référence `@chemin` dans l'agent actif.
 */
export function FileTree({ projectId, projectName, onInsert, compact }: { projectId: string; projectName?: string; onInsert?: (rel: string) => void; compact?: boolean }) {
  const [kids, setKids] = useState<Record<string, { entries: Entry[]; truncated: boolean } | "loading" | { error: string }>>({});
  const [open, setOpen] = useState<Set<string>>(new Set([""])); const [git, setGit] = useState<GitMap | null>(null); const [showHidden, setShowHidden] = useState(false);
  const [filter, setFilter] = useState(""); const [preview, setPreview] = useState<{ path: string; data?: any; error?: string } | null>(null); const [hasCode, setHasCode] = useState(false);
  const load = useCallback(async (rel: string) => { setKids((k) => ({ ...k, [rel]: "loading" })); try { const r = await api("files.list", projectId, rel); setKids((k) => ({ ...k, [rel]: r })); } catch (e) { setKids((k) => ({ ...k, [rel]: { error: errText(e) } })); } }, [projectId]);
  const refresh = useCallback(() => { setKids({}); void api("files.git", projectId).then(setGit).catch(() => setGit(null)); open.forEach((p) => void load(p)); }, [projectId, open, load]);
  useEffect(() => { setKids({}); setOpen(new Set([""])); setPreview(null); setFilter(""); void load(""); void api("files.git", projectId).then(setGit).catch(() => setGit(null)); }, [projectId]);
  useEffect(() => { void api("files.hasVscode").then(setHasCode).catch(() => {}); }, []);
  const toggle = (e: Entry) => setOpen((s) => { const n = new Set(s); if (n.has(e.path)) n.delete(e.path); else { n.add(e.path); if (!kids[e.path]) void load(e.path); } return n; });
  const show = async (e: Entry) => { setPreview({ path: e.path }); try { setPreview({ path: e.path, data: await api("files.read", projectId, e.path) }); } catch (x) { setPreview({ path: e.path, error: errText(x) }); } };
  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => toast(errText(e), "error"));
  const changed = git ? Object.keys(git.files).length : 0; const q = filter.trim().toLowerCase();

  const rows = (rel: string, depth: number): JSX.Element[] => {
    const k = kids[rel]; if (!k) return []; if (k === "loading") return [<div key={rel + ":l"} className="text-2xs text-muted py-1" style={{ paddingLeft: 8 + depth * 14 }}>Chargement…</div>];
    if ("error" in k) return [<div key={rel + ":e"} className="text-2xs text-danger py-1" style={{ paddingLeft: 8 + depth * 14 }}>{k.error}</div>];
    const out: JSX.Element[] = [];
    for (const e of k.entries) {
      if (e.hidden && !showHidden) continue; if (q && !e.dir && !e.name.toLowerCase().includes(q)) continue;
      const st = git?.files[e.path]; const dirCount = e.dir ? git?.dirs[e.path] : undefined; const isOpen = open.has(e.path); const I = e.dir ? (isOpen ? FolderOpen : Folder) : iconFor(e.name);
      out.push(<div key={e.path} role="treeitem" aria-expanded={e.dir ? isOpen : undefined} aria-selected={preview?.path === e.path} tabIndex={0}
        onClick={() => (e.dir ? toggle(e) : void show(e))} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); e.dir ? toggle(e) : void show(e); } }}
        className={`group flex items-center gap-1.5 h-7 pr-2 rounded-md cursor-pointer text-[13px] select-none ${preview?.path === e.path ? "bg-accent-subtle" : "hover:bg-raised"} ${e.heavy || e.hidden ? "opacity-60" : ""}`} style={{ paddingLeft: 4 + depth * 14 }} title={e.path}>
        {e.dir ? <ChevronRight size={13} className={`shrink-0 text-muted transition-transform ${isOpen ? "rotate-90" : ""}`} /> : <span className="w-[13px] shrink-0" />}
        <I size={14} className={`shrink-0 ${e.dir ? "text-accent" : "text-muted"}`} aria-hidden />
        <span className={`truncate ${st ? GIT_TONE[st]![0] : ""}`}>{e.name}</span>
        {e.heavy && <span className="text-2xs text-muted shrink-0">généré</span>}
        {dirCount ? <span className="ml-auto text-2xs text-warning shrink-0" title={`${dirCount} fichier(s) modifié(s) dans ce dossier`}>●</span> : st ? <span className={`ml-auto text-2xs font-semibold shrink-0 ${GIT_TONE[st]![0]}`} title={GIT_LABEL[st]}>{GIT_TONE[st]![1]}</span> : !e.dir && !compact ? <span className="ml-auto text-2xs text-muted shrink-0 opacity-0 group-hover:opacity-100">{kb(e.size)}</span> : null}
        {!e.dir && onInsert && <button className="btn btn-ghost btn-icon !h-6 !w-6 shrink-0 opacity-0 group-hover:opacity-100" aria-label={`Insérer @${e.path} dans le terminal actif`} title="Insérer @chemin dans le terminal actif" onClick={(ev) => { ev.stopPropagation(); onInsert(e.path); }}><AtSign size={12} /></button>}
      </div>);
      if (e.dir && isOpen) out.push(...rows(e.path, depth + 1));
    }
    if (k.truncated) out.push(<div key={rel + ":t"} className="text-2xs text-muted py-1" style={{ paddingLeft: 8 + depth * 14 }}>… liste tronquée (500 éléments)</div>);
    return out;
  };

  return <div className="flex flex-col min-h-0 h-full">
    <div className="flex items-center gap-1.5 mb-2 shrink-0">
      {git?.branch && <span className="inline-flex items-center gap-1 text-2xs text-fg2 shrink-0" title="Branche Git actuelle"><GitBranch size={12} />{git.branch}</span>}
      {changed > 0 && <span className="text-2xs text-warning shrink-0" title="Fichiers modifiés, ajoutés ou non suivis (git status)">{changed} modif.</span>}
      <span className="ml-auto" />
      {hasCode && <button className="btn btn-ghost btn-icon !h-7 !w-7" aria-label="Ouvrir le projet dans VS Code" title="Ouvrir le projet dans VS Code" onClick={() => act(() => api("files.vscode", projectId))}><ExternalLink size={13} /></button>}
      <button className="btn btn-ghost btn-icon !h-7 !w-7" aria-label="Afficher le dossier dans l'Explorateur" title="Afficher dans l'Explorateur" onClick={() => act(() => api("files.reveal", projectId, ""))}><FolderSearch size={13} /></button>
      <button className="btn btn-ghost btn-icon !h-7 !w-7" aria-label="Actualiser l'arborescence" title="Actualiser" onClick={refresh}><RefreshCw size={13} /></button></div>
    <div className="relative mb-2 shrink-0"><Search size={13} className="absolute left-2.5 top-2 text-muted" /><input className="input !h-8 !pl-8 !text-xs" placeholder="Filtrer les fichiers affichés…" aria-label="Filtrer les fichiers" value={filter} onChange={(e) => setFilter(e.target.value)} />{filter && <button className="absolute right-1.5 top-1 btn btn-ghost btn-icon !h-6 !w-6" aria-label="Effacer le filtre" onClick={() => setFilter("")}><X size={12} /></button>}</div>
    <div role="tree" aria-label={`Fichiers de ${projectName ?? "ce projet"}`} className="flex-1 min-h-0 overflow-auto -mx-1 px-1">{rows("", 0)}</div>
    <label className="flex items-center gap-2 text-2xs text-muted mt-2 cursor-pointer shrink-0"><input type="checkbox" className="accent-[var(--accent)]" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />Afficher les fichiers cachés (.env, .github…)</label>

    <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.path ?? ""} footer={preview && <>
      {onInsert && <button className="btn" onClick={() => { onInsert(preview.path); setPreview(null); }}><AtSign size={13} />Insérer dans le terminal</button>}
      <button className="btn" onClick={() => { void navigator.clipboard.writeText(preview.path); toast("Chemin copié.", "success"); }}><Copy size={13} />Copier le chemin</button>
      <button className="btn" onClick={() => act(() => api("files.reveal", projectId, preview.path))}><FolderSearch size={13} />Explorateur</button>
      {hasCode && <button className="btn btn-primary" onClick={() => act(() => api("files.vscode", projectId, preview.path))}><ExternalLink size={13} />Ouvrir dans VS Code</button>}</>}>
      {preview && (preview.error ? <p className="text-[13px] text-muted">{preview.error}</p> : !preview.data ? <p className="text-[13px] text-muted">Chargement…</p>
        : <div className="max-h-[60vh] overflow-auto text-[13px]">{git?.files[preview.path] && <p className={`text-xs mb-2 ${GIT_TONE[git.files[preview.path]!]![0]}`}>Git : {GIT_LABEL[git.files[preview.path]!]}</p>}
          {preview.data.language === "markdown" ? <Md text={preview.data.content} /> : <Md text={"````" + preview.data.language + "\n" + preview.data.content + "\n````"} />}
          {preview.data.truncated && <p className="text-xs text-muted mt-2">Aperçu limité aux 300 premiers Ko ({kb(preview.data.size)} au total).</p>}</div>)}
    </Modal>
  </div>;
}
