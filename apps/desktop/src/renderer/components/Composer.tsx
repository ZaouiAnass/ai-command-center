import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom"; import { ArrowUp, Square, Paperclip, ImagePlus, ChevronDown, X, Plug, Sparkles } from "lucide-react"; import { api } from "../api";
import { useData } from "../hooks";
import { AIModelConfiguration, AIConfig, Mode, PROVIDER_LABEL, effortLabel } from "./AIModelConfiguration";

export interface Attach { name: string; content: string }
export interface Img { name: string; mime: string; data: string }

/** Extensions (MCP, skills) applicables à la conversation : activées pour le mode, coupables une par une. */
function ExtToggles({ convId, mode, bare }: { convId?: string; mode: Mode; bare?: boolean }) {
  const { data: forConv, reload } = useData<any[]>("ext.forConv", [convId ?? ""], { events: /extension/ }); const { data: all } = useData<any[]>("ext.list", [], { events: /extension/ });
  const items = convId ? forConv : (all ?? []).filter((e) => e.enabled && e.modes.includes(mode)).map((e) => ({ id: e.id, kind: e.kind, name: e.name, active: true, description: "" }));
  return <div className={bare ? "" : "mt-3 pt-3 border-t border-line"}><div className="flex items-center justify-between mb-2"><span className="label !mb-0">Extensions de cette conversation</span><Link to="/mcp" className="text-2xs text-accent hover:underline">Gérer</Link></div>
    {!items?.length ? <p className="text-xs text-muted">Aucune extension activée pour ce mode. Ajoutez un serveur MCP ou une skill depuis « Gérer ».</p> : <ul className="space-y-1">{items.map((e: any) => <li key={e.id}><label className={`flex items-center gap-2 text-[13px] ${convId ? "cursor-pointer" : ""}`}>{convId ? <input type="checkbox" checked={e.active} onChange={async (x) => { await api("ext.setConv", convId, e.id, x.target.checked); reload(); }} aria-label={`Utiliser ${e.name} dans cette conversation`} /> : <span className="w-3.5" />}{e.kind === "mcp" ? <Plug size={13} className="text-muted shrink-0" /> : <Sparkles size={13} className="text-muted shrink-0" />}<span className="truncate">{e.name}</span><span className="text-2xs text-muted ml-auto shrink-0">{e.kind === "mcp" ? "outils MCP" : "skill"}</span></label></li>)}</ul>}
    {mode === "chat" && !!items?.some((e: any) => e.kind === "mcp" && e.active) && <p className="text-2xs text-warning mt-2">Les outils de ces serveurs MCP sont autorisés dans ce Chat.</p>}</div>;
}

/** Pastille « Extensions » : nombre d'extensions actives pour cette conversation, bascules individuelles au clic. */
function ExtChip({ mode, convId, disabled }: { mode: Mode; convId?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false); const [side, setSide] = useState<{ up: boolean; max: number }>({ up: true, max: 360 }); const ref = useRef<HTMLDivElement>(null);
  const { data: forConv } = useData<any[]>("ext.forConv", [convId ?? ""], { events: /extension/ }); const { data: all } = useData<any[]>("ext.list", [], { events: /extension/ });
  const items = convId ? forConv : (all ?? []).filter((e) => e.enabled && e.modes.includes(mode)).map((e) => ({ id: e.id, active: true }));
  const n = (items ?? []).filter((e: any) => e.active).length;
  useEffect(() => { if (!open) return; const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }; document.addEventListener("mousedown", down); document.addEventListener("keydown", key, true); return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key, true); }; }, [open]);
  return <div ref={ref} className="relative shrink-0">
    <button type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} title="Extensions (MCP et skills) actives dans cette conversation" onClick={() => { if (!open && ref.current) { const r = ref.current.getBoundingClientRect(); const above = r.top - 16, below = window.innerHeight - r.bottom - 16; const up = above >= below || above > 320; setSide({ up, max: Math.max(200, Math.min(420, up ? above : below)) }); } setOpen(!open); }} className={`flex items-center gap-1.5 h-9 px-2.5 rounded-xl text-[13px] transition-colors hover:bg-raised disabled:opacity-50 ${n ? "text-fg" : "text-muted hover:text-fg"}`}><Plug size={15} /><span className="hidden xl:inline">Extensions</span>{n > 0 && <span className="tnum text-2xs bg-accent-subtle text-accent rounded-full px-1.5">{n}</span>}</button>
    {open && <div role="dialog" aria-label="Extensions" className={`anim-pop absolute left-0 w-[340px] max-w-[88vw] bg-panel border border-line-strong rounded-2xl p-4 z-40 overflow-auto ${side.up ? "bottom-full mb-2" : "top-full mt-2"}`} style={{ boxShadow: "var(--shadow-pop)", maxHeight: side.max }}><ExtToggles convId={convId} mode={mode} bare /></div>}</div>;
}

/** Pastille de configuration : un seul bouton lisible qui ouvre le panneau fournisseur / modèle / effort / permissions. */
function ModelPill({ mode, cfg, onChange, disabled, convId }: { mode: Mode; cfg: AIConfig; onChange: (c: AIConfig) => void; disabled?: boolean; convId?: string }) {
  const [open, setOpen] = useState(false); const [side, setSide] = useState<{ up: boolean; max: number }>({ up: true, max: 480 }); const ref = useRef<HTMLDivElement>(null); const { data: cat } = useData<any>("ai.catalog", [cfg.provider]);
  useEffect(() => { if (!open) return; const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }; document.addEventListener("mousedown", down); document.addEventListener("keydown", key, true); return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key, true); }; }, [open]);
  const model = cfg.model ? cat?.models?.find((m: any) => m.id === cfg.model)?.displayName ?? cfg.model : "Modèle par défaut";
  return <div ref={ref} className="relative min-w-0">
    <button type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} onClick={() => { if (!open && ref.current) { const r = ref.current.getBoundingClientRect(); const above = r.top - 16, below = window.innerHeight - r.bottom - 16; const up = above >= below || above > 460; setSide({ up, max: Math.max(260, Math.min(560, up ? above : below)) }); } setOpen(!open); }} className="group flex items-center gap-2 h-9 pl-2.5 pr-2 rounded-xl text-[13px] text-fg2 hover:bg-raised hover:text-fg transition-colors max-w-full disabled:opacity-50">
      <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.provider === "claude" ? "bg-claude" : "bg-codex"}`} aria-hidden />
      <span className="truncate font-medium text-fg">{PROVIDER_LABEL[cfg.provider]}</span><span className="text-muted hidden sm:inline">·</span><span className="truncate hidden sm:inline">{model}</span>
      {cfg.effort && <span className="hidden md:inline text-muted">· {effortLabel(cfg.effort)}</span>}<ChevronDown size={14} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} /></button>
    {open && <div role="dialog" aria-label="Configuration du modèle" className={`anim-pop absolute left-0 w-[380px] max-w-[88vw] bg-panel border border-line-strong rounded-2xl p-4 z-40 flex flex-col ${side.up ? "bottom-full mb-2" : "top-full mt-2"}`} style={{ boxShadow: "var(--shadow-pop)", maxHeight: side.max }}>
      <div className="flex items-center justify-between mb-3"><span className="font-semibold text-[14px]">Modèle et réglages</span><button className="btn btn-ghost btn-icon !h-7 !w-7" aria-label="Fermer" onClick={() => setOpen(false)}><X size={14} /></button></div>
      <div className="overflow-auto pr-1 -mr-1 flex-1 min-h-0"><AIModelConfiguration mode={mode} value={cfg} onChange={onChange} /></div></div>}</div>;
}

/**
 * Zone de saisie unique pour Chat, Work et Code : texte extensible, pièces jointes, pastille de modèle,
 * bouton d'envoi rond (flèche) ou d'arrêt (carré) pendant la génération.
 */
export function Composer({ value, onChange, onSend, onStop, busy, sending, placeholder, mode, cfg, onCfg, attachments, images, onAttach, onImage, onRemoveAttach, onRemoveImage, rows = 2, autoFocus, note, canAttach = true, convId }: {
  value: string; onChange: (v: string) => void; onSend: () => void; onStop?: () => void; busy?: boolean; sending?: boolean; placeholder?: string; mode: Mode; cfg: AIConfig; onCfg: (c: AIConfig) => void;
  attachments: Attach[]; images: Img[]; onAttach: () => void; onImage: () => void; onRemoveAttach: (i: number) => void; onRemoveImage: (i: number) => void; rows?: number; autoFocus?: boolean; note?: string; canAttach?: boolean; convId?: string;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (autoFocus) ta.current?.focus(); }, [autoFocus]);
  useEffect(() => { const t = ta.current; if (t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 240) + "px"; } }, [value]);
  const can = !!value.trim() && !busy && !sending;
  return <div className="rounded-[22px] border border-line-strong bg-panel glow-focus">
    {images.length > 0 && <div className="flex flex-wrap gap-2 px-4 pt-3">{images.map((a, i) => <span key={i} className="relative inline-block"><img src={`data:${a.mime};base64,${a.data}`} alt={a.name} className="h-16 w-16 object-cover rounded-xl border border-line" /><button aria-label={`Retirer ${a.name}`} className="absolute -top-1.5 -right-1.5 bg-raised border border-line-strong rounded-full p-0.5 text-muted hover:text-fg" onClick={() => onRemoveImage(i)}><X size={11} /></button></span>)}</div>}
    {attachments.length > 0 && <div className="flex flex-wrap gap-1.5 px-4 pt-3">{attachments.map((a, i) => <span key={i} className="inline-flex items-center gap-1.5 text-xs bg-raised border border-line rounded-lg pl-2 pr-1 py-1"><Paperclip size={11} className="text-muted" />{a.name}<button aria-label={`Retirer ${a.name}`} className="text-muted hover:text-fg p-0.5" onClick={() => onRemoveAttach(i)}><X size={12} /></button></span>)}</div>}
    <textarea ref={ta} value={value} onChange={(e) => onChange(e.target.value)} rows={rows} aria-label="Message" disabled={sending} placeholder={busy ? "Génération en cours… vous pourrez répondre ensuite." : placeholder ?? "Écrivez votre message…"}
      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (can) onSend(); } }} className="block w-full bg-transparent resize-none outline-none px-5 pt-4 pb-2 text-[15px] leading-7 placeholder:text-muted disabled:opacity-60" style={{ maxHeight: 240 }} />
    <div className="flex items-center gap-1 px-2.5 pb-2.5">
      {canAttach && <><button type="button" className="btn btn-ghost btn-icon !h-9 !w-9 !rounded-xl" aria-label="Joindre des fichiers texte" title="Joindre des fichiers texte ou de code (200 Ko max chacun)" disabled={busy} onClick={onAttach}><Paperclip size={17} /></button>
        <button type="button" className="btn btn-ghost btn-icon !h-9 !w-9 !rounded-xl" aria-label="Joindre des images" title="Joindre des images (PNG, JPEG, GIF, WebP — 5 Mo, 4 max)" disabled={busy} onClick={onImage}><ImagePlus size={17} /></button></>}
      <ModelPill mode={mode} cfg={cfg} onChange={onCfg} disabled={busy} convId={convId} />
      <ExtChip mode={mode} convId={convId} disabled={busy} />
      {note && <span className="text-2xs text-accent ml-1 hidden md:inline" role="status">{note}</span>}
      <div className="ml-auto flex items-center gap-2 shrink-0"><span className="hidden lg:inline text-2xs text-muted"><span className="kbd">Entrée</span> pour envoyer</span>
        {busy ? <button type="button" className="h-9 w-9 rounded-full grid place-items-center bg-[var(--danger-subtle)] text-danger hover:bg-[rgba(251,113,133,.25)] transition-colors" aria-label="Arrêter la génération" title="Arrêter" onClick={onStop}><Square size={13} fill="currentColor" /></button>
          : <button type="button" className={`h-9 w-9 rounded-full grid place-items-center transition-all ${can ? "bg-[var(--btn-primary)] text-white hover:bg-[var(--btn-primary-hover)] hover:scale-105 active:scale-95" : "bg-raised text-muted cursor-not-allowed"}`} aria-label="Envoyer" title="Envoyer (Entrée)" disabled={!can} onClick={onSend}><ArrowUp size={18} strokeWidth={2.4} /></button>}</div></div></div>;
}
