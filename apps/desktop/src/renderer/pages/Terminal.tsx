import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Terminal as XTerm } from "@xterm/xterm"; import { FitAddon } from "@xterm/addon-fit"; import { SearchAddon } from "@xterm/addon-search"; import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { Plus, X, Search, Copy, ClipboardPaste, Square, SquareTerminal, RotateCcw, ChevronUp, ChevronDown, Info, Maximize2, Minimize2, Minus, Sparkles, FolderGit2 } from "lucide-react";
import { Link } from "react-router-dom"; import { FileTree } from "../components/FileTree"; import { FolderTree } from "lucide-react";
import { api } from "../api"; import { useData } from "../hooks"; import { useT } from "../i18n"; import { toast, confirmDialog } from "../overlay"; import { currentTheme } from "../theme";
import { Page, Card, Modal, Field, EmptyState, Badge, ErrorState } from "../ui";

const DARK = { background: "#1f1e1d", foreground: "#faf9f5", cursor: "#e0865f", cursorAccent: "#09090b", selectionBackground: "#e0865f40", selectionInactiveBackground: "#e0865f22",
  black: "#18181d", red: "#fb7185", green: "#34d399", yellow: "#fbbf24", blue: "#60a5fa", magenta: "#c4a8ff", cyan: "#67c1f5", white: "#d4d4d8",
  brightBlack: "#52525b", brightRed: "#fda4af", brightGreen: "#6ee7b7", brightYellow: "#fcd34d", brightBlue: "#93c5fd", brightMagenta: "#ddd0ff", brightCyan: "#a5dcfa", brightWhite: "#f5f5f7" };
const LIGHT = { background: "#fbfaf6", foreground: "#1f1e1d", cursor: "#b4532f", cursorAccent: "#ffffff", selectionBackground: "#b4532f33", selectionInactiveBackground: "#b4532f1a",
  black: "#1f1e1d", red: "#be123c", green: "#047857", yellow: "#a35a06", blue: "#1d4ed8", magenta: "#7e22ce", cyan: "#0e7490", white: "#6b6a65",
  brightBlack: "#57554f", brightRed: "#e11d48", brightGreen: "#059669", brightYellow: "#b45309", brightBlue: "#2563eb", brightMagenta: "#9333ea", brightCyan: "#0891b2", brightWhite: "#1f1e1d" };
const THEME = () => (currentTheme() === "light" ? LIGHT : DARK);

interface Inst { term: XTerm; fit: FitAddon; search: SearchAddon; el: HTMLDivElement; ready: boolean; queue: { data: string; end: number }[]; offset: number; kind: string; exited?: number | null }
/** Les instances xterm vivent hors de React : changer de page ou d'onglet ne perd ni l'écran ni le scrollback. */
const insts = new Map<string, Inst>(); let listening = false;
window.addEventListener("acc-theme", () => insts.forEach((i) => { i.term.options.theme = THEME(); })); // les terminaux ouverts suivent le thème
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
  const term = new XTerm({ fontFamily: '"JetBrains Mono Variable", "Cascadia Code", Consolas, monospace', fontSize: 13, lineHeight: 1.25, cursorBlink: true, scrollback: 10000, theme: THEME(), allowProposedApi: true, convertEol: false, macOptionIsMeta: true, windowsPty: navigator.platform.includes("Win") ? { backend: "conpty" } : undefined });
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

const KINDS: [string, string, string][] = [["claude", "Claude Code", "CLI officiel, interface interactive, avec votre abonnement."], ["codex", "Codex", "CLI officiel, interface interactive, avec votre abonnement."], ["ollama", "Ollama", "Modèle open source local, interactif (ollama run). Gratuit."], ["shell", "Shell", "Invite de commandes classique dans le dossier du projet."]];
const KindMark = ({ k }: { k: string }) => k === "shell" ? <SquareTerminal size={13} /> : <Badge v={k === "ollama" ? "open" : k} text="" />;
/** Espace de travail = un projet : ses terminaux, sa disposition et ses emplacements. */
interface WsState { layout: LayoutId; slots: (string | null)[] }
const NO_PROJECT = "__none";

// ---------- Dispositions : plusieurs terminaux dans la même page ----------
type LayoutId = "one" | "cols2" | "rows2" | "main2" | "cols3" | "grid4";
interface LayoutDef { id: LayoutId; label: string; cols: string; rows: string; rects: [number, number, number, number][]; span?: Record<number, string> }
const LAYOUTS: LayoutDef[] = [
  { id: "one", label: "1 terminal", cols: "1fr", rows: "1fr", rects: [[0, 0, 1, 1]] },
  { id: "cols2", label: "2 colonnes", cols: "1fr 1fr", rows: "1fr", rects: [[0, 0, .5, 1], [.5, 0, .5, 1]] },
  { id: "rows2", label: "2 lignes", cols: "1fr", rows: "1fr 1fr", rects: [[0, 0, 1, .5], [0, .5, 1, .5]] },
  { id: "main2", label: "1 grand + 2", cols: "1.5fr 1fr", rows: "1fr 1fr", rects: [[0, 0, .6, 1], [.6, 0, .4, .5], [.6, .5, .4, .5]], span: { 0: "1 / span 2" } },
  { id: "cols3", label: "3 colonnes", cols: "1fr 1fr 1fr", rows: "1fr", rects: [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]] },
  { id: "grid4", label: "Grille 2 × 2", cols: "1fr 1fr", rows: "1fr 1fr", rects: [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]] },
];
const layoutOf = (id: LayoutId) => LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0]!;
const forCount = (n: number): LayoutId => n <= 1 ? "one" : n === 2 ? "cols2" : n === 3 ? "cols3" : "grid4";
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* indisponible */ } } };
function Glyph({ l, on }: { l: LayoutDef; on?: boolean }) {
  return <svg width="20" height="15" viewBox="0 0 20 15" aria-hidden>{l.rects.map(([x, y, w, h], i) => <rect key={i} x={1 + x * 18 + .6} y={1 + y * 13 + .6} width={w * 18 - 1.2} height={h * 13 - 1.2} rx="1.6" fill={on ? "currentColor" : "none"} fillOpacity={on ? .28 : 0} stroke="currentColor" strokeWidth="1.2" />)}</svg>;
}

/** Collage sécurisé : confirmation si plusieurs lignes dans un shell (risque d'exécution immédiate). */
async function pasteSafe(inst: Inst, text?: string) {
  const s = text ?? await navigator.clipboard.readText().catch(() => ""); if (!s) return;
  if (inst.kind === "shell" && /[\r\n]/.test(s.trim())) { const ok = await confirmDialog({ title: "Coller plusieurs lignes ?", body: `Le texte contient ${s.trim().split(/\r?\n/).length} lignes et peut être exécuté immédiatement par le shell.`, confirmLabel: "Coller" }); if (!ok) return; }
  inst.term.paste(s); inst.term.focus();
}
const alive = (x: any) => !x.exited && insts.get(x.id)?.exited === undefined;

interface PaneProps { info: any; slot: number; count: number; all: any[]; shownIds: string[]; active: boolean; zoomed: boolean; projectName?: string;
  onActivate: () => void; onSwitch: (id: string) => void; onClose: () => void; onRestart: () => void; onSearch: () => void; onZoom: () => void; onFocusSlot: (n: number) => void; }
/** Un panneau : en-tête (sélecteur, actions) + zone xterm. L'instance xterm persiste hors de React. */
function Pane(p: PaneProps) {
  const host = useRef<HTMLDivElement>(null); const cb = useRef(p); cb.current = p; const { info } = p; const live = alive(info);
  useEffect(() => {
    const h = host.current; if (!h) return; let cancelled = false; let ro: ResizeObserver | undefined; let tm: any;
    void ensureInst(info.id, info.kind).then((inst) => { if (cancelled) return; h.replaceChildren(inst.el);
      const doFit = () => { try { if (h.clientWidth > 40 && h.clientHeight > 40) inst.fit.fit(); } catch { /* conteneur masqué */ } };
      doFit(); if (cb.current.active) inst.term.focus(); ro = new ResizeObserver(() => { clearTimeout(tm); tm = setTimeout(doFit, 60); }); ro.observe(h);
      inst.term.attachCustomKeyEventHandler((e) => {
        if (e.type !== "keydown") return true; const mod = e.ctrlKey || e.metaKey;
        if (e.altKey && !mod && /^[1-6]$/.test(e.key)) { cb.current.onFocusSlot(Number(e.key) - 1); return false; }
        if (mod && e.key.toLowerCase() === "f" && !e.shiftKey) { cb.current.onSearch(); return false; }
        if (mod && e.key.toLowerCase() === "c" && (e.shiftKey || inst.term.hasSelection())) { if (inst.term.hasSelection()) { void navigator.clipboard.writeText(inst.term.getSelection()); inst.term.clearSelection(); } return false; } // Ctrl+C sans sélection = interruption
        if (mod && e.shiftKey && e.key.toLowerCase() === "v") { e.preventDefault(); void pasteSafe(inst); return false; }
        return true;
      });
    });
    const onPaste = (e: ClipboardEvent) => { const i = insts.get(info.id); if (!i) return; e.preventDefault(); e.stopPropagation(); void pasteSafe(i, e.clipboardData?.getData("text") ?? ""); };
    h.addEventListener("paste", onPaste, true);
    return () => { cancelled = true; ro?.disconnect(); clearTimeout(tm); h.removeEventListener("paste", onPaste, true); };
  }, [info.id]);
  useEffect(() => { if (p.active) insts.get(info.id)?.term.focus(); }, [p.active, info.id, p.zoomed]);
  const ic = "btn btn-ghost btn-icon !h-7 !w-7";
  return <section aria-label={`Terminal ${p.slot + 1} : ${info.title}`} onMouseDownCapture={() => { if (!p.active) p.onActivate(); }} className="relative flex flex-col flex-1 min-w-0 min-h-0 bg-bg" style={{ boxShadow: p.active && p.count > 1 ? "inset 0 0 0 1px var(--accent)" : undefined }}>
    <header className="flex items-center gap-1.5 h-10 pl-3 pr-1.5 border-b border-line shrink-0 min-w-0 bg-panel/60">
      {p.count > 1 && <span className="tnum text-2xs w-4 h-4 rounded grid place-items-center bg-raised text-muted shrink-0" title={`Alt+${p.slot + 1} pour y aller`}>{p.slot + 1}</span>}
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${live ? "bg-success pulse-dot" : "bg-muted"}`} aria-hidden /><span className="sr-only">{live ? "en cours" : "terminé"}</span>
      <select aria-label="Terminal affiché dans ce panneau" value={info.id} onChange={(e) => p.onSwitch(e.target.value)} className="min-w-0 flex-1 h-8 bg-transparent text-[13px] font-medium truncate cursor-pointer outline-none hover:text-accent focus-visible:text-accent transition-colors" >
        {p.all.map((x) => <option key={x.id} value={x.id}>{x.title}{p.shownIds.includes(x.id) && x.id !== info.id ? "  (affiché ailleurs)" : ""}</option>)}</select>
      {info.contextChars ? <span className="hidden lg:inline-flex items-center gap-1 text-2xs text-accent shrink-0" title={`Contexte du projet (résumé + notes épinglées, ${info.contextChars} caractères) transmis à Claude Code au lancement.`}><Sparkles size={11} />contexte</span> : null}
      <button className={ic} aria-label="Rechercher dans ce terminal" title="Rechercher (Ctrl+F)" onClick={p.onSearch}><Search size={13} /></button>
      <button className={`${ic} hidden sm:grid`} aria-label="Copier la sélection" title="Copier (Ctrl+Maj+C)" onClick={() => { const i = insts.get(info.id); if (i?.term.hasSelection()) { void navigator.clipboard.writeText(i.term.getSelection()); toast("Copié.", "success"); } else toast("Sélectionnez du texte à copier.", "info"); }}><Copy size={13} /></button>
      <button className={`${ic} hidden sm:grid`} aria-label="Coller" title="Coller (Ctrl+Maj+V)" onClick={() => { const i = insts.get(info.id); if (i) void pasteSafe(i); }}><ClipboardPaste size={13} /></button>
      {live ? <button className={`${ic} hover:!text-danger`} aria-label="Arrêter le processus" title="Arrêter le processus" onClick={() => api("terminal.kill", info.id)}><Square size={12} /></button>
        : <button className={ic} aria-label="Relancer" title="Relancer ce terminal" onClick={p.onRestart}><RotateCcw size={13} /></button>}
      {p.count > 1 && <button className={ic} aria-label={p.zoomed ? "Réduire le panneau" : "Agrandir le panneau"} title={p.zoomed ? "Revenir à la disposition" : "Agrandir ce panneau"} onClick={p.onZoom}>{p.zoomed ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>}
      <button className={`${ic} hover:!text-danger`} aria-label={`Fermer ${info.title}`} title="Fermer ce terminal" onClick={p.onClose}><X size={14} /></button></header>
    {(info.kind === "claude" || info.kind === "codex") && <div className="hidden 2xl:flex items-center gap-1.5 px-3 h-6 text-2xs text-warning border-b border-line shrink-0" title="Le CLI interactif n'expose pas de mesures structurées : les tokens de ce terminal ne sont pas suivis."><Info size={11} />Consommation non mesurée en mode terminal</div>}
    <div ref={host} className="flex-1 min-h-0 min-w-0 p-2" role="region" aria-label={`Zone du terminal ${p.slot + 1}`} /></section>;
}

/** Panneau libre : lancement rapide d'un agent ou d'un shell directement à cet emplacement. */
function EmptyPane({ slot, onLaunch, onMore, hasProject }: { slot: number; onLaunch: (kind: string) => void; onMore: () => void; hasProject: boolean }) {
  return <section aria-label={`Emplacement libre ${slot + 1}`} className="flex flex-col flex-1 items-center justify-center gap-3 min-w-0 min-h-0 bg-bg/60 p-4 text-center">
    <span className="tnum text-2xs w-5 h-5 rounded grid place-items-center bg-raised text-muted">{slot + 1}</span><p className="text-[13px] text-fg2">Emplacement libre</p>
    <div className="flex flex-wrap justify-center gap-2">{KINDS.filter(([k]) => k !== "ollama").map(([k, l]) => <button key={k} className="chip" disabled={!hasProject} onClick={() => onLaunch(k)}><KindMark k={k} />{l}</button>)}</div>
    {!hasProject && <p className="text-2xs text-muted">Ajoutez d'abord un projet.</p>}<button className="text-2xs text-accent hover:underline" onClick={onMore}>Plus d'options…</button></section>;
}

export default function TerminalPage() {
  const t = useT(); const [sp, setSp] = useSearchParams();
  const { data: rawList, err, reload } = useData<any[]>("terminal.list", [], { every: 4000 }); const { data: projects } = useData<any[]>("projects.list", []);
  // ---- Espaces de travail : un par projet, chacun avec sa disposition et ses emplacements (mémorisés) ----
  const [ws, setWs] = useState<string>(() => store.get("acc.term.ws") ?? "");
  const [wsState, setWsState] = useState<Record<string, WsState>>(() => { try { const v = JSON.parse(store.get("acc.term.wsState") ?? "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; } });
  const cur: WsState = wsState[ws] ?? { layout: "one", slots: [] }; const layout = LAYOUTS.some((l) => l.id === cur.layout) ? cur.layout : "one"; const slots = cur.slots;
  const patchWs = (key: string, fn: (s: WsState) => WsState) => setWsState((all) => ({ ...all, [key]: fn(all[key] ?? { layout: "one", slots: [] }) }));
  const setLayoutRaw = (l: LayoutId) => patchWs(ws, (s) => ({ ...s, layout: l }));
  const setSlots = (fn: (prev: (string | null)[]) => (string | null)[]) => patchWs(ws, (s) => { const next = fn(s.slots); return next === s.slots ? s : { ...s, slots: next }; });
  const [activeSlot, setActiveSlot] = useState(0); const [zoom, setZoom] = useState<number | null>(null);
  const [creating, setCreating] = useState(false); const [f, setF] = useState({ kind: "claude", projectId: "", count: 1, model: "", injectContext: true }); const [busy, setBusy] = useState(false);
  const { data: ollama } = useData<string[]>("open.ollamaModels", [], { enabled: creating && f.kind === "ollama" });
  const { data: memCtx } = useData<any>("mem.context", [f.projectId], { enabled: creating && f.kind === "claude" && !!f.projectId });
  const [searchOpen, setSearchOpen] = useState(false); const [q, setQ] = useState(""); const [, force] = useState(0);
  const [treeOpen, setTreeOpenRaw] = useState(() => store.get("acc.term.tree") === "1"); const setTreeOpen = (v: boolean) => { setTreeOpenRaw(v); store.set("acc.term.tree", v ? "1" : "0"); };
  const projOf = (x: any) => x.projectId ?? NO_PROJECT;
  /** Numérote les terminaux homonymes (« Shell 1 », « Shell 2 »…) au sein d'un même projet. */
  const all = rawList?.map((x, _i, arr) => { const same = arr.filter((y) => y.title === x.title && projOf(y) === projOf(x)); return same.length > 1 ? { ...x, title: `${x.title} ${same.indexOf(x) + 1}` } : x; });
  const list = all?.filter((x) => projOf(x) === ws);
  const def = layoutOf(layout); const cap = def.rects.length;
  const proj = (id?: string) => projects?.find((p) => p.id === id)?.name;
  const wsName = (id: string) => (id === NO_PROJECT ? "Sans projet" : proj(id) ?? "Projet retiré");
  /** Onglets d'espaces : projets ayant des terminaux, plus l'espace actif. */
  const wsIds = [...new Set([...(all ?? []).map(projOf), ...(ws ? [ws] : [])])].filter((id) => id === NO_PROJECT ? (all ?? []).some((x) => !x.projectId) : projects?.some((p) => p.id === id) || (all ?? []).some((x) => x.projectId === id));
  const liveIn = (id: string) => (all ?? []).filter((x) => projOf(x) === id && alive(x)).length;

  useEffect(() => { const h = () => { force((x) => x + 1); reload(); }; window.addEventListener("acc-term-exit", h); return () => window.removeEventListener("acc-term-exit", h); }, [reload]);
  useEffect(() => { if (sp.get("new")) { const k = sp.get("kind"); if (k) setF((x) => ({ ...x, kind: k })); setCreating(true); sp.delete("new"); sp.delete("kind"); setSp(sp, { replace: true }); } }, [sp]);
  useEffect(() => { store.set("acc.term.wsState", JSON.stringify(wsState)); }, [wsState]); useEffect(() => { if (ws) store.set("acc.term.ws", ws); }, [ws]);
  // espace initial ou devenu invalide : le premier projet qui a des terminaux, sinon le premier projet
  useEffect(() => { if (!projects || !all) return; const valid = ws === NO_PROJECT ? all.some((x) => !x.projectId) : projects.some((p) => p.id === ws); if (!valid) setWs(all.find((x) => x.projectId)?.projectId ?? projects[0]?.id ?? (all.length ? NO_PROJECT : "")); }, [projects, all?.length, ws]);
  useEffect(() => { setZoom(null); setActiveSlot(0); setSearchOpen(false); }, [ws]);

  // Cohérence des emplacements de l'espace actif : retire les terminaux fermés, remplit les emplacements libres avec ses terminaux non affichés.
  useEffect(() => {
    if (!list || !ws) return; const ids = new Set(list.map((x) => x.id));
    setSlots((prev) => { const next = Array.from({ length: Math.max(cap, prev.length) }, (_, i) => (prev[i] && ids.has(prev[i]!) ? prev[i]! : null)); const used = new Set(next.filter(Boolean) as string[]);
      const spare = list.map((x) => x.id).filter((id) => !used.has(id)); for (let i = 0; i < cap && spare.length; i++) if (!next[i]) next[i] = spare.shift()!;
      return next.length === prev.length && next.every((v, i) => v === prev[i]) ? prev : next; });
  }, [list?.map((x) => x.id).join(), cap, ws]);
  useEffect(() => { if (activeSlot >= cap) setActiveSlot(0); if (zoom != null && zoom >= cap) setZoom(null); }, [cap, activeSlot, zoom]);

  const infoOf = (id: string | null) => (id ? list?.find((x) => x.id === id) : undefined);
  const shown = slots.slice(0, cap); const shownIds = shown.filter(Boolean) as string[];
  const setLayout = (l: LayoutId) => { setLayoutRaw(l); setZoom(null); };
  /** Affiche le terminal `id` dans l'emplacement `slot` (échange si déjà affiché ailleurs). */
  const place = (slot: number, id: string) => setSlots((prev) => { const next = [...prev]; while (next.length <= slot) next.push(null); const from = next.indexOf(id); if (from >= 0) next[from] = next[slot] ?? null; next[slot] = id; return next; });
  const openNew = (projectId = ws) => { setF((x) => ({ ...x, projectId: projectId && projectId !== NO_PROJECT ? projectId : x.projectId || projects?.[0]?.id || "" })); setCreating(true); };

  const launch = async (kind: string, projectId: string, count: number, target: number) => {
    setBusy(true);
    try {
      const ids: string[] = []; for (let i = 0; i < count; i++) ids.push((await api("terminal.create", { kind, projectId: projectId || undefined, cols: 100, rows: 30, model: kind === "ollama" ? f.model : undefined, injectContext: kind === "claude" ? f.injectContext : undefined })).id);
      await reload(); setCreating(false);
      const key = projectId || NO_PROJECT; const into = key === ws ? { layout, slots } : wsState[key] ?? { layout: "one" as LayoutId, slots: [] }; const intoCap = layoutOf(into.layout).rects.length;
      if (key !== ws) setWs(key);
      if (count > 1 || key !== ws) { const nOpen = (all ?? []).filter((x) => projOf(x) === key).length + ids.length; const l = count > 1 || nOpen > intoCap ? forCount(Math.min(4, Math.max(nOpen, intoCap))) : into.layout;
        patchWs(key, (s) => { const next = [...s.slots]; const free = (i: number) => !next[i]; let k = 0; for (let i = 0; i < layoutOf(l).rects.length && k < ids.length; i++) if (free(i) || count > 1) next[i] = ids[k++]; return { layout: l, slots: next }; }); setZoom(null); setActiveSlot(0); }
      else { place(target, ids[0]!); setActiveSlot(target); }
    } catch (e: any) { toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "error"); } finally { setBusy(false); }
  };
  const closeTerm = async (x: any) => { if (alive(x) && !(await confirmDialog({ title: "Fermer ce terminal ?", body: "Le processus en cours sera arrêté.", confirmLabel: "Fermer", danger: true }))) return; await api("terminal.close", x.id).catch(() => {}); disposeInst(x.id); setSlots((prev) => prev.map((v) => (v === x.id ? null : v))); reload(); };
  const activeId = shown[activeSlot] ?? null; const activeInst = activeId ? insts.get(activeId) : undefined;
  /** Arborescence → terminal actif : `@chemin` pour Claude Code (référence de fichier officielle), chemin entre guillemets sinon. Rien n'est validé (pas d'Entrée). */
  const insertPath = (rel: string) => { const x = infoOf(activeId); if (!x || !alive(x)) { toast("Aucun terminal actif dans ce panneau.", "info"); return; } const txt = x.kind === "claude" ? `@${rel} ` : /\s/.test(rel) ? `"${rel}" ` : `${rel} `; void api("terminal.write", x.id, txt); insts.get(x.id)?.term.focus(); };
  const doSearch = (dir: "next" | "prev") => { if (!activeInst || !q) return; (dir === "next" ? activeInst.search.findNext : activeInst.search.findPrevious).call(activeInst.search, q, { decorations: { matchBackground: "#e0865f55", activeMatchBackground: "#e0865f", matchOverviewRuler: "#e0865f", activeMatchColorOverviewRuler: "#e0865f" } }); };
  const focusSlot = (n: number) => { if (n < cap) { setZoom(null); setActiveSlot(n); } };
  const visible: number[] = zoom != null ? [zoom] : shown.map((_, i) => i);
  const gridStyle = zoom != null ? { gridTemplateColumns: "1fr", gridTemplateRows: "1fr" } : { gridTemplateColumns: def.cols, gridTemplateRows: def.rows };
  const others = (projects ?? []).filter((p) => !wsIds.includes(p.id));
  const canLaunch = !!f.projectId && (f.kind !== "ollama" || /^[\w.:/-]{1,120}$/.test(f.model.trim()));

  return <div className="h-full flex flex-col anim-page">
    <div className="px-8 pt-7 pb-4 flex items-end justify-between gap-4 flex-wrap"><div className="min-w-0"><h1 className="text-[28px] leading-8">{t("nav.terminal")}</h1><p className="text-fg2 mt-1">Un espace par projet : ses agents côte à côte, sa disposition, son contexte.</p></div>
      <div className="flex items-center gap-3"><div role="radiogroup" aria-label="Disposition des terminaux" className="flex items-center gap-0.5 p-1 rounded-xl bg-panel border border-line">{LAYOUTS.map((l) => <button key={l.id} role="radio" aria-checked={layout === l.id} title={l.label} aria-label={l.label} onClick={() => setLayout(l.id)} className={`h-8 w-9 grid place-items-center rounded-lg transition-all ${layout === l.id ? "bg-[var(--surface-hover)] text-accent shadow-sm" : "text-muted hover:text-fg hover:bg-raised"}`}><Glyph l={l} on={layout === l.id} /></button>)}</div>
        {ws && ws !== NO_PROJECT && <button className={`btn ${treeOpen ? "!border-accent !text-accent" : ""}`} aria-pressed={treeOpen} title="Arborescence du projet" onClick={() => setTreeOpen(!treeOpen)}><FolderTree size={15} />Fichiers</button>}
        <button className="btn btn-primary" onClick={() => openNew()}><Plus size={15} />Nouveau terminal</button></div></div>

    {!!projects?.length && <div role="tablist" aria-label="Espaces de travail (projets)" className="mx-8 mb-3 flex items-center gap-1 overflow-x-auto shrink-0">{wsIds.map((id) => { const on = id === ws; const n = (all ?? []).filter((x) => projOf(x) === id).length; const live = liveIn(id);
      return <button key={id} role="tab" aria-selected={on} onClick={() => setWs(id)} title={id === NO_PROJECT ? "Terminaux ouverts hors projet" : projects.find((p) => p.id === id)?.path} className={`flex items-center gap-2 h-9 px-3 rounded-xl text-[13px] shrink-0 border transition-colors ${on ? "bg-panel border-line-strong text-fg font-medium" : "border-transparent text-fg2 hover:bg-raised"}`}>
        <FolderGit2 size={14} className={on ? "text-accent" : "text-muted"} /><span className="max-w-[180px] truncate">{wsName(id)}</span>{n > 0 && <span className={`tnum text-2xs px-1.5 rounded-md ${live ? "bg-[var(--success-subtle)] text-success" : "bg-raised text-muted"}`} title={`${live} actif(s) sur ${n}`}>{n}</span>}</button>; })}
      {others.length > 0 && <select aria-label="Ouvrir l'espace d'un autre projet" className="input !h-9 !w-auto !text-xs ml-1 shrink-0" value="" onChange={(e) => { if (e.target.value) setWs(e.target.value); }}><option value="">+ Projet…</option>{others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}</div>}

    {err && !all ? <div className="px-8"><ErrorState message={err} onRetry={reload} /></div> : !projects?.length && !all?.length ? <div className="px-8"><Card><EmptyState icon={SquareTerminal} title="Aucun projet" desc="Chaque espace du terminal correspond à un projet : ajoutez d'abord un dossier de projet." action={<Link className="btn btn-primary" to="/projects?new=1">Ajouter un projet</Link>} /></Card></div>
    : !list?.length ? <div className="px-8"><Card><EmptyState icon={SquareTerminal} title={`Aucun terminal dans « ${wsName(ws)} »`} desc="Ouvrez Claude Code, Codex, un modèle Ollama ou un shell dans le dossier de ce projet. Vous pourrez en afficher plusieurs côte à côte ; les autres projets gardent leurs propres terminaux." action={<div className="flex flex-wrap justify-center gap-2">{KINDS.filter(([k]) => k !== "ollama").map(([k, l]) => <button key={k} className="chip" disabled={busy || ws === NO_PROJECT} onClick={() => { setF((x) => ({ ...x, kind: k, projectId: ws })); void launch(k, ws, 1, 0); }}><KindMark k={k} />{l}</button>)}<button className="chip" onClick={() => openNew()}>Plus d'options…</button></div>} /></Card></div>
    : <div className="flex-1 min-h-0 mx-8 mb-6 flex gap-3">{treeOpen && ws !== NO_PROJECT && <aside className="w-72 shrink-0 card p-3 flex flex-col min-h-0 anim-fade" aria-label={`Fichiers de ${wsName(ws)}`}><FileTree projectId={ws} projectName={wsName(ws)} compact onInsert={insertPath} /></aside>}<div className="flex-1 min-w-0 min-h-0 card flex flex-col overflow-hidden">
      <div role="tablist" aria-label={`Terminaux de ${wsName(ws)}`} className="flex items-center gap-1 px-2 py-1.5 border-b border-line overflow-x-auto shrink-0">{list.map((x) => { const at = shown.indexOf(x.id); const on = at === activeSlot; const live = alive(x);
        return <div key={x.id} role="tab" aria-selected={on} tabIndex={0} title="Afficher dans le panneau actif" onClick={() => { place(activeSlot, x.id); setActiveSlot(activeSlot); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); place(activeSlot, x.id); } }} className={`group flex items-center gap-2 h-8 pl-2.5 pr-1 rounded-lg text-[13px] cursor-pointer shrink-0 transition-colors ${on ? "bg-raised text-fg" : at >= 0 ? "text-fg2 hover:bg-raised/70" : "text-muted hover:bg-raised/70 hover:text-fg2"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-success" : "bg-muted"}`} aria-hidden />{at >= 0 && cap > 1 && <span className="tnum text-2xs w-4 h-4 rounded grid place-items-center bg-[var(--surface-hover)] text-fg2">{at + 1}</span>}<span className="max-w-[160px] truncate">{x.title}</span>
          <button aria-label={`Fermer ${x.title}`} className="btn btn-ghost btn-icon !h-6 !w-6 opacity-50 group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); void closeTerm(x); }}><X size={12} /></button></div>; })}
        <button className="btn btn-ghost btn-icon !h-7 !w-7 ml-1 shrink-0" aria-label="Nouveau terminal" onClick={() => openNew()}><Plus size={14} /></button></div>
      {searchOpen && <div className="flex items-center gap-2 px-4 py-2 border-b border-line bg-panel anim-fade shrink-0"><Search size={14} className="text-muted" /><input autoFocus className="input !h-8 !w-64" placeholder={`Rechercher dans le terminal ${activeSlot + 1}…`} aria-label="Rechercher" value={q} onChange={(e) => { setQ(e.target.value); if (activeInst && e.target.value) activeInst.search.findNext(e.target.value); }} onKeyDown={(e) => { if (e.key === "Enter") doSearch(e.shiftKey ? "prev" : "next"); if (e.key === "Escape") { setSearchOpen(false); activeInst?.term.focus(); } }} />
        <button className="btn btn-sm btn-icon" aria-label="Précédent" onClick={() => doSearch("prev")}><ChevronUp size={14} /></button><button className="btn btn-sm btn-icon" aria-label="Suivant" onClick={() => doSearch("next")}><ChevronDown size={14} /></button><button className="btn btn-sm btn-ghost btn-icon ml-auto" aria-label="Fermer la recherche" onClick={() => { setSearchOpen(false); activeInst?.term.focus(); }}><X size={14} /></button></div>}
      <div className="flex-1 min-h-0 grid gap-px bg-[var(--border)]" style={gridStyle}>{visible.map((i) => { const x = infoOf(shown[i] ?? null); const style = zoom == null && def.span?.[i] ? { gridRow: def.span[i] } : undefined;
        return <div key={x ? x.id : `empty${i}`} className="min-w-0 min-h-0 flex flex-col" style={style}>{x
          ? <Pane info={x} slot={i} count={cap} all={list} shownIds={shownIds} active={activeSlot === i} zoomed={zoom === i} projectName={proj(x.projectId)} onActivate={() => setActiveSlot(i)} onSwitch={(id) => place(i, id)} onClose={() => void closeTerm(x)}
            onRestart={async () => { await closeTerm(x); setF({ ...f, kind: x.kind, projectId: x.projectId ?? f.projectId, count: 1, model: x.model ?? f.model }); void launch(x.kind, x.projectId ?? f.projectId, 1, i); }} onSearch={() => { setActiveSlot(i); setSearchOpen(true); }} onZoom={() => setZoom(zoom === i ? null : i)} onFocusSlot={focusSlot} />
          : <EmptyPane slot={i} hasProject={ws !== NO_PROJECT && !!projects?.length} onLaunch={(k) => { setActiveSlot(i); void launch(k, ws, 1, i); }} onMore={() => { setActiveSlot(i); openNew(); }} />}</div>; })}</div></div></div>}

    <Modal open={creating} onClose={() => setCreating(false)} title="Nouveau terminal" footer={<><button className="btn" onClick={() => setCreating(false)}>{t("common.cancel")}</button><button className="btn btn-primary" disabled={busy || !canLaunch} onClick={() => void launch(f.kind, f.projectId, f.count, f.projectId === ws ? activeSlot : 0)}>{f.count > 1 ? `Ouvrir ${f.count} terminaux` : "Ouvrir"}</button></>}>
      <div role="radiogroup" aria-label="Type de terminal" className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">{KINDS.map(([k, l, d]) => <button key={k} role="radio" aria-checked={f.kind === k} onClick={() => setF({ ...f, kind: k })} className={`text-left p-3 rounded-xl border transition-colors ${f.kind === k ? "border-accent bg-accent-subtle" : "border-line hover:border-line-strong"}`}><div className="mb-1.5">{k === "shell" ? <span className="text-xs text-muted">Shell</span> : <Badge v={k === "ollama" ? "open" : k} text={k === "ollama" ? "Ollama" : undefined} />}</div><div className="text-[13px] font-medium">{l}</div><div className="text-2xs text-muted mt-0.5">{d}</div></button>)}</div>
      {!projects?.length ? <p className="text-fg2 pb-3">Ajoutez d'abord un projet : le terminal s'ouvre dans son dossier.</p> : <Field label="Projet (espace de travail)" hint={f.projectId && f.projectId !== ws ? "Le terminal s'ouvrira dans l'espace de ce projet." : undefined}><select className="input" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}><option value="">Choisir un projet…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
      {f.kind === "ollama" && <Field label="Modèle Ollama" hint={ollama?.length ? `${ollama.length} modèle(s) installé(s) détecté(s).` : "Aucun modèle détecté : Ollama est-il démarré ? Vous pouvez saisir un nom ; « ollama run » le téléchargera s'il manque."}><input className="input mono" list="ollama-models" value={f.model} placeholder="qwen2.5-coder:7b" onChange={(e) => setF({ ...f, model: e.target.value })} /><datalist id="ollama-models">{(ollama ?? []).map((m) => <option key={m} value={m} />)}</datalist></Field>}
      {f.kind === "claude" && f.projectId && <label className="flex items-start gap-3 cursor-pointer mb-4"><input type="checkbox" className="w-4 h-4 mt-0.5 accent-[var(--accent)]" checked={f.injectContext} onChange={(e) => setF({ ...f, injectContext: e.target.checked })} /><span><span className="text-[13px] font-medium block">Transmettre le contexte du projet</span><span className="text-xs text-muted block mt-0.5">{memCtx?.text ? `Résumé et notes épinglées (${memCtx.text.length} caractères), via l'option officielle --append-system-prompt.` : "Ce projet n'a encore ni résumé ni note épinglée : générez un résumé dans Projets › Mémoire."}</span></span></label>}
      <Field label="Nombre de terminaux" hint="Ouvre plusieurs agents du même type d'un coup et les affiche côte à côte (jusqu'à 4)."><div className="flex items-center gap-2"><button type="button" className="btn btn-icon" aria-label="Moins" disabled={f.count <= 1} onClick={() => setF({ ...f, count: f.count - 1 })}><Minus size={14} /></button><span className="tnum w-8 text-center text-[15px] font-medium" aria-live="polite">{f.count}</span><button type="button" className="btn btn-icon" aria-label="Plus" disabled={f.count >= 4} onClick={() => setF({ ...f, count: f.count + 1 })}><Plus size={14} /></button></div></Field>
      <p className="text-xs text-muted pb-3">{f.kind === "ollama" ? "Ollama tourne sur votre ordinateur : gratuit, rien ne sort de votre machine. Le modèle n'a pas accès aux fichiers du projet depuis ce terminal." : "Mode abonnement exclusif : les variables de clé API sont retirées de l'environnement du terminal, et Claude Code / Codex ne s'ouvrent que si leur connexion est vérifiée comme abonnement."}</p></Modal>
  </div>;
}
