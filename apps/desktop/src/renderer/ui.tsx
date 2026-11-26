import React, { useEffect, useRef, useId } from "react";
import { CheckCircle2, CircleDashed, Clock, XCircle, Loader2, ShieldAlert, PauseCircle, Ban, AlertTriangle, Inbox, RefreshCw, X } from "lucide-react";
import { useT } from "./i18n";

type Tone = "success" | "warning" | "danger" | "info" | "accent" | "neutral" | "claude" | "codex" | "open";
const TONE: Record<Tone, string> = {
  success: "bg-[var(--success-subtle)] text-success", warning: "bg-[var(--warning-subtle)] text-warning", danger: "bg-[var(--danger-subtle)] text-danger",
  info: "bg-[var(--info-subtle)] text-info", accent: "bg-accent-subtle text-accent", neutral: "bg-raised text-fg2", claude: "bg-[rgba(245,158,107,.12)] text-claude", codex: "bg-[rgba(103,193,245,.12)] text-codex", open: "bg-[rgba(134,199,120,.14)] text-open",
};
const STATUS: Record<string, { tone: Tone; icon: any; spin?: boolean }> = {
  running: { tone: "success", icon: Loader2, spin: true }, preparing: { tone: "info", icon: Loader2, spin: true }, queued: { tone: "neutral", icon: Clock }, completed: { tone: "success", icon: CheckCircle2 },
  failed: { tone: "danger", icon: XCircle }, cancelled: { tone: "neutral", icon: Ban }, interrupted: { tone: "warning", icon: PauseCircle }, waiting_approval: { tone: "warning", icon: ShieldAlert },
  blocked: { tone: "danger", icon: Ban }, draft: { tone: "neutral", icon: CircleDashed }, idle: { tone: "neutral", icon: CircleDashed }, working: { tone: "success", icon: Loader2, spin: true },
  waiting: { tone: "warning", icon: ShieldAlert }, offline: { tone: "neutral", icon: Ban },
};
const AUTH: Record<string, Tone> = { subscription: "success", local: "success", api_key: "danger", unknown: "warning", unavailable: "neutral" };
const CONF: Record<string, Tone> = { reported: "success", calculated: "info", estimated: "warning", unknown: "warning" };

/** Pastille de statut : icône + libellé (jamais la couleur seule). */
export function StatusIndicator({ status, label, size = "md" }: { status: string; label?: string; size?: "sm" | "md" }) {
  const t = useT(); const s = STATUS[status] ?? { tone: "neutral" as Tone, icon: CircleDashed }; const I = s.icon;
  return <span className={`inline-flex items-center gap-1.5 rounded-md font-medium ${size === "sm" ? "px-1.5 py-0.5 text-2xs" : "px-2 py-0.5 text-xs"} ${TONE[s.tone]}`}><I size={size === "sm" ? 11 : 13} className={s.spin ? "animate-spin" : ""} aria-hidden />{label ?? t("status." + status)}</span>;
}
export function Badge({ v, text }: { v: string; text?: string }) {
  const t = useT();
  if (STATUS[v]) return <StatusIndicator status={v} label={text} />;
  const tone: Tone = v === "claude" ? "claude" : v === "codex" ? "codex" : v === "open" ? "open" : AUTH[v] ?? CONF[v] ?? "neutral";
  const label = text ?? (v === "claude" ? "Claude" : v === "codex" ? "Codex" : v === "open" ? "Open source" : t("auth." + v) !== "auth." + v ? t("auth." + v) : v);
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${TONE[tone]}`}>{(v === "claude" || v === "codex" || v === "open") && <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden />}{label}</span>;
}
export const ProviderMark = ({ p }: { p: string }) => <Badge v={p} />;

export function Card({ title, sub, right, children, className = "", pad = true }: { title?: string; sub?: string; right?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean }) {
  return <section className={`card ${pad ? "p-5" : ""} ${className}`}>{(title || right) && <header className={`flex items-start justify-between gap-3 ${pad ? "mb-4" : "px-5 pt-5 mb-3"}`}><div><h2 className="text-[15px] font-semibold text-fg">{title}</h2>{sub && <p className="text-xs text-muted mt-0.5">{sub}</p>}</div>{right}</header>}{children}</section>;
}
export function MetricCard({ label, value, sub, tone, icon: I, hint }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string; icon?: any; hint?: string }) {
  return <div className="card p-4" title={hint}><div className="flex items-center gap-2 text-xs text-muted">{I && <I size={14} aria-hidden />}<span>{label}</span></div><div className={`text-[24px] leading-9 font-semibold tnum mt-1.5 whitespace-nowrap ${tone ?? "text-fg"}`}>{value}</div>{sub && <div className="text-xs text-muted mt-1 tnum">{sub}</div>}</div>;
}
export const Kpi = ({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string }) => <MetricCard label={label} value={value} sub={sub} tone={tone} />;

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: React.ReactNode }) {
  return <div className="flex items-end justify-between gap-4 mb-6 flex-wrap"><div><h1 className="text-[26px] leading-8 font-semibold tracking-tight text-fg">{title}</h1>{sub && <p className="text-[14px] text-fg2 mt-1">{sub}</p>}</div><div className="flex items-center gap-2 flex-wrap">{actions}</div></div>;
}
export const Page = ({ title, sub, actions, children, wide }: { title: string; sub?: string; actions?: React.ReactNode; children: React.ReactNode; wide?: boolean }) =>
  <div className={`anim-page px-8 py-7 mx-auto ${wide ? "max-w-none" : "max-w-[1360px]"}`}><PageHeader title={title} sub={sub} actions={actions} />{children}</div>;
export const SectionHeader = ({ title, right }: { title: string; right?: React.ReactNode }) => <div className="flex items-center justify-between mb-3"><h2 className="text-[17px] font-semibold">{title}</h2>{right}</div>;

export function EmptyState({ icon: I = Inbox, title, desc, action }: { icon?: any; title: string; desc?: string; action?: React.ReactNode }) {
  return <div className="flex flex-col items-center text-center py-14 px-6 anim-fade"><div className="w-11 h-11 rounded-xl bg-raised border border-line grid place-items-center text-muted mb-4"><I size={20} aria-hidden /></div><h3 className="text-[16px] font-semibold text-fg">{title}</h3>{desc && <p className="text-fg2 mt-1 max-w-md">{desc}</p>}{action && <div className="mt-5">{action}</div>}</div>;
}
export const Empty = ({ children }: { children: React.ReactNode }) => <div className="text-muted text-center py-10">{children}</div>;
export function ErrorState({ message, onRetry, hint }: { message: string; onRetry?: () => void; hint?: string }) {
  const t = useT();
  return <div role="alert" className="card p-5 border-[rgba(251,113,133,.3)] flex items-start gap-3"><AlertTriangle className="text-danger shrink-0 mt-0.5" size={18} aria-hidden /><div className="flex-1"><div className="font-medium">{t("error.generic")}</div><div className="text-fg2 text-[13px] mt-0.5">{message}</div>{hint && <div className="text-muted text-xs mt-1">{hint}</div>}</div>{onRetry && <button className="btn btn-sm" onClick={onRetry}><RefreshCw size={13} />{t("error.retry")}</button>}</div>;
}
export const Skeleton = ({ className = "h-4 w-full" }: { className?: string }) => <div className={`skeleton ${className}`} aria-hidden />;
export function LoadingSkeleton({ rows = 4, cards = 0 }: { rows?: number; cards?: number }) {
  return <div role="status" aria-label="Chargement" className="space-y-3">{cards > 0 && <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: cards }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>}{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>;
}
export const Disclaimer = () => { const t = useT(); return <div className="inline-flex items-center gap-2 text-xs text-warning bg-[var(--warning-subtle)] rounded-lg px-3 py-1.5"><AlertTriangle size={13} aria-hidden />{t("disclaimer.usd")}</div>; };

export function Bar({ pct, tone }: { pct: number | null; tone?: string }) {
  return <div className="h-1.5 rounded-full bg-raised overflow-hidden" role="progressbar" aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}><div className={`h-full rounded-full transition-[width] duration-300 ${tone ?? (pct != null && pct >= 90 ? "bg-danger" : pct != null && pct >= 70 ? "bg-warning" : "bg-accent")}`} style={{ width: `${Math.min(100, pct ?? 0)}%` }} /></div>;
}
export const ProgressIndicator = Bar;

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (v: T) => void }) {
  return <div role="tablist" className="flex gap-1 border-b border-line mb-4 overflow-x-auto max-w-full">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)} className={`shrink-0 whitespace-nowrap px-3 py-2 text-[13px] font-medium -mb-px border-b-2 transition-colors ${value === k ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}>{l}</button>)}</div>;
}
export function Segmented<T extends string>({ options, value, onChange, label }: { options: [T, React.ReactNode, string?][]; value: T; onChange: (v: T) => void; label?: string }) {
  return <div role="group" aria-label={label} className="inline-flex p-0.5 rounded-lg bg-bg border border-line">{options.map(([k, l, a]) => <button key={k} aria-pressed={value === k} aria-label={a} title={a} onClick={() => onChange(k)} className={`h-8 px-2.5 text-[13px] rounded-md transition-colors ${value === k ? "bg-raised text-fg" : "text-muted hover:text-fg"}`}>{l}</button>)}</div>;
}
export const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => { const id = useId(); return <div className="mb-4"><label htmlFor={id} className="label">{label}</label>{React.isValidElement(children) ? React.cloneElement(children as any, { id }) : children}{hint && <p className="text-xs text-muted mt-1">{hint}</p>}</div>; };

function useFocusTrap(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return; const prev = document.activeElement as HTMLElement | null; const el = ref.current;
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])') ?? []).filter((x) => !x.hasAttribute("disabled"));
    (el?.querySelector<HTMLElement>("[autofocus],input,textarea,select") ?? focusables()[0] ?? el)?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } else if (e.key === "Tab") { const f = focusables(); if (!f.length) return; const first = f[0]!, last = f[f.length - 1]!; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } } };
    document.addEventListener("keydown", k, true); return () => { document.removeEventListener("keydown", k, true); prev?.focus?.(); };
  }, [open]);
  return ref;
}
export function Modal({ open, onClose, title, children, width = "max-w-xl", footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; width?: string; footer?: React.ReactNode }) {
  const ref = useFocusTrap(open, onClose); const id = useId(); const t = useT();
  if (!open) return null;
  return <div className="fixed inset-0 z-50 bg-black/65 anim-fade flex items-center justify-center p-6" onMouseDown={onClose}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} className={`anim-pop w-full ${width} max-h-[88vh] flex flex-col bg-panel rounded-2xl`} style={{ boxShadow: "var(--shadow-pop)" }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between px-6 pt-5 pb-3"><h2 id={id} className="text-[17px] font-semibold">{title}</h2><button className="btn btn-ghost btn-icon" aria-label={t("common.close")} onClick={onClose}><X size={16} /></button></div>
      <div className="px-6 pb-2 overflow-auto flex-1">{children}</div>{footer && <div className="px-6 py-4 border-t border-line flex justify-end gap-2">{footer}</div>}</div></div>;
}
export function Drawer({ open, onClose, title, children, width = 480, actions }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; width?: number; actions?: React.ReactNode }) {
  const ref = useFocusTrap(open, onClose); const t = useT();
  if (!open) return null;
  return <div className="fixed inset-0 z-40 anim-fade" onMouseDown={onClose}><div className="absolute inset-0 bg-black/40" />
    <aside ref={ref} role="dialog" aria-modal="true" tabIndex={-1} onMouseDown={(e) => e.stopPropagation()} className="anim-slide absolute right-0 top-0 bottom-0 max-w-full bg-panel border-l border-line flex flex-col" style={{ width, boxShadow: "var(--shadow-pop)" }}>
      <div className="flex items-center gap-2 px-5 h-14 border-b border-line shrink-0"><div className="flex-1 min-w-0 font-semibold truncate">{title}</div>{actions}<button className="btn btn-ghost btn-icon" aria-label={t("common.close")} onClick={onClose}><X size={16} /></button></div>
      <div className="flex-1 overflow-auto p-5">{children}</div></aside></div>;
}
export const DetailDrawer = Drawer;

/** Carte interactive : halo lumineux qui suit le pointeur, léger soulèvement au survol. */
export function SpotCard({ children, className = "", as: Tag = "div", ...rest }: { children: React.ReactNode; className?: string; as?: any; [k: string]: any }) {
  const move = (e: React.MouseEvent<HTMLElement>) => { const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`); e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`); };
  return <Tag onMouseMove={move} className={`card spot lift ${className}`} {...rest}>{children}</Tag>;
}
