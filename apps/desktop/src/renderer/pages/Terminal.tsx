import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Terminal as XTerm } from "@xterm/xterm"; import { FitAddon } from "@xterm/addon-fit"; import { SearchAddon } from "@xterm/addon-search"; import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { Plus, X, Search, Copy, ClipboardPaste, Square, SquareTerminal, RotateCcw, ChevronUp, ChevronDown, Info } from "lucide-react";
import { api } from "../api"; import { useData } from "../hooks"; import { useT } from "../i18n"; import { toast, confirmDialog } from "../overlay";
import { Page, Card, Modal, Field, EmptyState, Badge, ErrorState } from "../ui";

const THEME = { background: "#1f1e1d", foreground: "#faf9f5", cursor: "#e0865f", cursorAccent: "#09090b", selectionBackground: "#a78bfa40", selectionInactiveBackground: "#a78bfa22",
  black: "#18181d", red: "#fb7185", green: "#34d399", yellow: "#fbbf24", blue: "#60a5fa", magenta: "#c4a8ff", cyan: "#67c1f5", white: "#d4d4d8",
  brightBlack: "#52525b", brightRed: "#fda4af", brightGreen: "#6ee7b7", brightYellow: "#fcd34d", brightBlue: "#93c5fd", brightMagenta: "#ddd0ff", brightCyan: "#a5dcfa", brightWhite: "#f5f5f7" };

interface Inst { term: XTerm; fit: FitAddon; search: SearchAddon; el: HTMLDivElement; ready: boolean; queue: { data: string; end: number }[]; offset: number; kind: string; exited?: number | null }
/** Les instances xterm vivent hors de React : changer de page ou d'onglet ne perd ni l'écran ni le scrollback. */
const insts = new Map<string, Inst>(); let listening = false;
function listen() {
  if (listening) return; listening = true;
  window.acc.onTerminal((e) => {
    const i = insts.get(e.id); if (!i) return;
    if (e.exit) { i.exited = e.exit.code; i.term.write(`\r\n\x1b[90m[processus terminé — code ${e.exit.code ?? "?"}]\x1b[0m\r\n`); window.dispatchEvent(new CustomEvent("acc-term-exit")); return; }
    if (e.data == null || e.end == null) return;
    if (!i.ready) { i.queue.push({ data: e.data, end: e.end }); return; }
    writeSlice(i, e.data, e.end);
  });
}
function writeSlice(i: Inst, data: string, end: number) { const start = end - data.length; if (end <= i.offset) return; i.term.write(start < i.offset ? data.slice(i.offset - start) : data); i.offset = end; }

async function ensureInst(id: string, kind: string): Promise<Inst> {
  listen(); const ex = insts.get(id); if (ex) return ex;
  const el = document.createElement("div"); el.style.cssText = "width:100%;height:100%";
  const term = new XTerm({ fontFamily: '"JetBrains Mono Variable", "Cascadia Code", Consolas, monospace', fontSize: 13, lineHeight: 1.25, cursorBlink: true, scrollback: 10000, theme: THEME, allowProposedApi: true, convertEol: false, macOptionIsMeta: true, windowsPty: navigator.platform.includes("Win") ? { backend: "conpty" } : undefined });
  const fit = new FitAddon(); const search = new SearchAddon(); term.loadAddon(fit); term.loadAddon(search); term.loadAddon(new WebLinksAddon((_, uri) => window.open(uri, "_blank")));
  term.open(el);
  const inst: Inst = { term, fit, search, el, ready: false, queue: [], offset: 0, kind };
  insts.set(id, inst);
  term.onData((d) => { if (!inst.exited && inst.exited !== 0) void api("terminal.write", id, d).catch(() => {}); });
  term.onResize(({ cols, rows }) => void api("terminal.resize", id, cols, rows).catch(() => {}));
  const a = await api("terminal.attach", id); term.write(a.buffer); inst.offset = a.total; inst.ready = true; inst.queue.forEach((q) => writeSlice(inst, q.data, q.end)); inst.queue = [];
  return inst;
}
const disposeInst = (id: string) => { const i = insts.get(id); if (i) { i.term.dispose(); insts.delete(id); } };

const KINDS: [string, string, string][] = [["claude", "Claude Code", "CLI officiel, interface interactive, avec votre abonnement."], ["codex", "Codex", "CLI officiel, interface interactive, avec votre abonnement."], ["shell", "Shell", "Invite de commandes classique dans le dossier du projet."]];

export default function TerminalPage() {
  const t = useT(); const [sp, setSp] = useSearchParams();
  const { data: list, err, reload } = useData<any[]>("terminal.list", [], { every: 4000 }); const { data: projects } = useData<any[]>("projects.list", []);
  const [sel, setSel] = useState<string>(); const [creating, setCreating] = useState(false); const [f, setF] = useState({ kind: "claude", projectId: "" }); const [busy, setBusy] = useState(false);
  const host = useRef<HTMLDivElement>(null); const [searchOpen, setSearchOpen] = useState(false); const [q, setQ] = useState(""); const [, force] = useState(0);
  useEffect(() => { const h = () => { force((x) => x + 1); reload(); }; window.addEventListener("acc-term-exit", h); return () => window.removeEventListener("acc-term-exit", h); }, [reload]);
  useEffect(() => { if (sp.get("new")) { const k = sp.get("kind"); if (k) setF((x) => ({ ...x, kind: k })); setCreating(true); sp.delete("new"); sp.delete("kind"); setSp(sp, { replace: true }); } }, [sp]);
  useEffect(() => { if (!sel && list?.length) setSel(list[list.length - 1]!.id); if (sel && list && !list.some((x) => x.id === sel)) setSel(list[0]?.id); }, [list, sel]);
  const cur = list?.find((x) => x.id === sel);

  // Affiche l'instance de l'onglet actif et suit la taille du conteneur.
  useEffect(() => {
    if (!sel || !host.current || !cur) return; let cancelled = false; const h = host.current; let ro: ResizeObserver | undefined; let tm: any;
    void ensureInst(sel, cur.kind).then((inst) => { if (cancelled) return; h.replaceChildren(inst.el);
      const doFit = () => { try { if (h.clientWidth > 40 && h.clientHeight > 40) inst.fit.fit(); } catch { /* conteneur masqué */ } };
      doFit(); inst.term.focus(); ro = new ResizeObserver(() => { clearTimeout(tm); tm = setTimeout(doFit, 60); }); ro.observe(h);
      inst.term.attachCustomKeyEventHandler((e) => {
        if (e.type !== "keydown") return true; const mod = e.ctrlKey || e.metaKey;
        if (mod && e.key.toLowerCase() === "f" && !e.shiftKey) { setSearchOpen(true); return false; }
        if (mod && e.key.toLowerCase() === "c" && (e.shiftKey || inst.term.hasSelection())) { if (inst.term.hasSelection()) { void navigator.clipboard.writeText(inst.term.getSelection()); inst.term.clearSelection(); } return false; } // Ctrl+C sans sélection = interruption
        if (mod && e.shiftKey && e.key.toLowerCase() === "v") { e.preventDefault(); void pasteSafe(sel, inst); return false; }
        return true;
      });
    });
    return () => { cancelled = true; ro?.disconnect(); clearTimeout(tm); };
  }, [sel, cur?.id]);

  // Collage sécurisé : confirmation si plusieurs lignes dans un shell (risque d'exécution immédiate).
  const pasteSafe = useCallback(async (id: string, inst: Inst, text?: string) => {
    const s = text ?? await navigator.clipboard.readText().catch(() => ""); if (!s) return;
    if (inst.kind === "shell" && /[\r\n]/.test(s.trim())) { const ok = await confirmDialog({ title: "Coller plusieurs lignes ?", body: `Le texte contient ${s.trim().split(/\r?\n/).length} lignes et peut être exécuté immédiatement par le shell.`, confirmLabel: "Coller" }); if (!ok) return; }
    inst.term.paste(s); inst.term.focus();
  }, []);
  useEffect(() => { const h = host.current; if (!h || !sel) return; const onPaste = (e: ClipboardEvent) => { const i = insts.get(sel); if (!i) return; e.preventDefault(); e.stopPropagation(); void pasteSafe(sel, i, e.clipboardData?.getData("text") ?? ""); }; h.addEventListener("paste", onPaste, true); return () => h.removeEventListener("paste", onPaste, true); }, [sel, pasteSafe]);

  const create = async () => { setBusy(true); try { const proj = projects?.find((p) => p.id === f.projectId); const info = await api("terminal.create", { kind: f.kind, projectId: f.projectId || undefined, cols: 100, rows: 30 }); void proj; setCreating(false); await reload(); setSel(info.id); } catch (e: any) { toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "error"); } finally { setBusy(false); } };
  const closeTab = async (id: string, running: boolean) => { if (running && !(await confirmDialog({ title: "Fermer ce terminal ?", body: "Le processus en cours sera arrêté.", confirmLabel: "Fermer", danger: true }))) return; await api("terminal.close", id).catch(() => {}); disposeInst(id); if (sel === id) setSel(undefined); reload(); };
  const inst = sel ? insts.get(sel) : undefined; const running = cur && !cur.exited && inst?.exited === undefined;
  const doSearch = (dir: "next" | "prev") => { if (!inst || !q) return; (dir === "next" ? inst.search.findNext : inst.search.findPrevious).call(inst.search, q, { decorations: { matchBackground: "#a78bfa55", activeMatchBackground: "#a78bfa", matchOverviewRuler: "#a78bfa", activeMatchColorOverviewRuler: "#a78bfa" } }); };
  const proj = (id?: string) => projects?.find((p) => p.id === id)?.name;

  return <div className="h-full flex flex-col anim-page">
    <div className="px-8 pt-7 pb-4 flex items-end justify-between"><div><h1 className="text-[26px] leading-8 font-semibold tracking-tight">{t("nav.terminal")}</h1><p className="text-fg2 mt-1">Les CLI officiels Claude Code et Codex, non modifiés, dans l'application.</p></div><button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={15} />Nouveau terminal</button></div>
    {err && !list ? <div className="px-8"><ErrorState message={err} onRetry={reload} /></div> : !list?.length ? <div className="px-8"><Card><EmptyState icon={SquareTerminal} title="Aucun terminal ouvert" desc="Ouvrez Claude Code ou Codex dans son interface interactive officielle, ou un simple shell dans le dossier d'un projet." action={<button className="btn btn-primary" onClick={() => setCreating(true)}>Nouveau terminal</button>} /></Card></div>
    : <div className="flex-1 min-h-0 mx-8 mb-6 card flex flex-col overflow-hidden">
      <div role="tablist" aria-label="Terminaux" className="flex items-center gap-1 px-2 pt-2 border-b border-line overflow-x-auto shrink-0">{list.map((x) => { const live = !x.exited && insts.get(x.id)?.exited === undefined; return <div key={x.id} role="tab" aria-selected={sel === x.id} className={`group flex items-center gap-2 h-9 pl-3 pr-1.5 rounded-t-lg border border-b-0 text-[13px] cursor-pointer shrink-0 ${sel === x.id ? "bg-bg border-line text-fg" : "border-transparent text-muted hover:text-fg"}`} onClick={() => setSel(x.id)}>
        <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-success" : "bg-muted"}`} aria-hidden /><span>{x.title}</span>{x.projectId && <span className="text-2xs text-muted max-w-[90px] truncate">{proj(x.projectId)}</span>}<span className="sr-only">{live ? "en cours" : "terminé"}</span>
        <button aria-label={`Fermer ${x.title}`} className="btn btn-ghost btn-icon !h-6 !w-6 opacity-60 group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); void closeTab(x.id, live); }}><X size={13} /></button></div>; })}
        <button className="btn btn-ghost btn-icon !h-7 !w-7 ml-1" aria-label="Nouveau terminal" onClick={() => setCreating(true)}><Plus size={14} /></button></div>
      {cur && <div className="flex items-center gap-2 px-4 h-11 border-b border-line text-xs text-muted shrink-0"><span className="mono truncate flex-1" title={cur.cwd}>{cur.cwd}</span>
        {cur.kind !== "shell" && <span className="hidden lg:inline-flex items-center gap-1.5 text-warning" title="Le CLI interactif n'expose pas de mesures structurées : les tokens de ce terminal ne sont pas suivis."><Info size={12} />Consommation non mesurée en mode terminal</span>}
        <button className="btn btn-sm btn-ghost" onClick={() => setSearchOpen(!searchOpen)} aria-label="Rechercher dans le terminal" title="Rechercher (Ctrl+F)"><Search size={13} /></button>
        <button className="btn btn-sm btn-ghost" onClick={() => { const i = insts.get(cur.id); if (i?.term.hasSelection()) { void navigator.clipboard.writeText(i.term.getSelection()); toast("Copié.", "success"); } else toast("Sélectionnez du texte à copier.", "info"); }} aria-label="Copier la sélection" title="Copier (Ctrl+Maj+C)"><Copy size={13} /></button>
        <button className="btn btn-sm btn-ghost" onClick={() => { const i = insts.get(cur.id); if (i) void pasteSafe(cur.id, i); }} aria-label="Coller" title="Coller (Ctrl+Maj+V)"><ClipboardPaste size={13} /></button>
        {running ? <button className="btn btn-sm btn-danger" onClick={() => api("terminal.kill", cur.id)}><Square size={12} />Arrêter</button> : <button className="btn btn-sm" onClick={async () => { await closeTab(cur.id, false); setF({ kind: cur.kind, projectId: cur.projectId ?? "" }); setCreating(true); }}><RotateCcw size={12} />Relancer</button>}</div>}
      {searchOpen && <div className="flex items-center gap-2 px-4 py-2 border-b border-line bg-panel anim-fade"><Search size={14} className="text-muted" /><input autoFocus className="input !h-8 !w-64" placeholder="Rechercher dans le scrollback…" aria-label="Rechercher" value={q} onChange={(e) => { setQ(e.target.value); if (inst && e.target.value) inst.search.findNext(e.target.value); }} onKeyDown={(e) => { if (e.key === "Enter") doSearch(e.shiftKey ? "prev" : "next"); if (e.key === "Escape") { setSearchOpen(false); inst?.search.clearDecorations(); inst?.term.focus(); } }} />
        <button className="btn btn-sm btn-icon" aria-label="Précédent" onClick={() => doSearch("prev")}><ChevronUp size={14} /></button><button className="btn btn-sm btn-icon" aria-label="Suivant" onClick={() => doSearch("next")}><ChevronDown size={14} /></button><button className="btn btn-sm btn-ghost btn-icon ml-auto" aria-label="Fermer la recherche" onClick={() => { setSearchOpen(false); inst?.search.clearDecorations(); inst?.term.focus(); }}><X size={14} /></button></div>}
      <div ref={host} className="flex-1 min-h-0 bg-bg p-2" aria-label="Zone du terminal" role="region" /></div>}

    <Modal open={creating} onClose={() => setCreating(false)} title="Nouveau terminal" footer={<><button className="btn" onClick={() => setCreating(false)}>{t("common.cancel")}</button><button className="btn btn-primary" disabled={busy || !f.projectId} onClick={create}>Ouvrir</button></>}>
      <div role="radiogroup" aria-label="Type de terminal" className="grid grid-cols-3 gap-2 mb-5">{KINDS.map(([k, l, d]) => <button key={k} role="radio" aria-checked={f.kind === k} onClick={() => setF({ ...f, kind: k })} className={`text-left p-3 rounded-xl border transition-colors ${f.kind === k ? "border-accent bg-accent-subtle" : "border-line hover:border-line-strong"}`}><div className="mb-1.5">{k === "shell" ? <span className="text-xs text-muted">Shell</span> : <Badge v={k} />}</div><div className="text-[13px] font-medium">{l}</div><div className="text-2xs text-muted mt-0.5">{d}</div></button>)}</div>
      {!projects?.length ? <p className="text-fg2 pb-3">Ajoutez d'abord un projet : le terminal s'ouvre dans son dossier.</p> : <Field label="Projet (dossier de travail)"><select className="input" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}><option value="">Choisir un projet…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
      <p className="text-xs text-muted pb-3">Mode abonnement exclusif : les variables de clé API sont retirées de l'environnement du terminal, et Claude Code / Codex ne s'ouvrent que si leur connexion est vérifiée comme abonnement.</p></Modal>
  </div>;
}
