import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info } from "lucide-react";
import { Modal } from "./ui"; import { useT } from "./i18n";

type ToastTone = "success" | "error" | "info" | "warning";
interface ToastItem { id: number; msg: string; tone: ToastTone }
interface ConfirmReq { title: string; body: string; confirmLabel?: string; danger?: boolean; resolve: (v: boolean) => void }
let tid = 0; const listeners = new Set<(s: { toasts: ToastItem[]; confirm?: ConfirmReq }) => void>();
let state: { toasts: ToastItem[]; confirm?: ConfirmReq } = { toasts: [] };
const push = (s: typeof state) => { state = s; listeners.forEach((l) => l(state)); };
export function toast(msg: string, tone: ToastTone = "info") { const id = ++tid; push({ ...state, toasts: [...state.toasts, { id, msg, tone }] }); setTimeout(() => push({ ...state, toasts: state.toasts.filter((x) => x.id !== id) }), tone === "error" ? 7000 : 4000); }
/** Remplace window.confirm : dialogue accessible, résout true/false. */
export const confirmDialog = (o: Omit<ConfirmReq, "resolve">) => new Promise<boolean>((resolve) => push({ ...state, confirm: { ...o, resolve } }));

const ICON = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
const COL = { success: "text-success", error: "text-danger", info: "text-info", warning: "text-warning" };
export function OverlayHost() {
  const [s, setS] = useState(state); const t = useT();
  useEffect(() => { listeners.add(setS); return () => void listeners.delete(setS); }, []);
  const c = s.confirm; const done = (v: boolean) => { c?.resolve(v); push({ ...state, confirm: undefined }); };
  return <>
    <div className="fixed bottom-5 right-5 z-[70] flex flex-col gap-2 w-[360px]" aria-live="polite">{s.toasts.map((x) => { const I = ICON[x.tone]; return <div key={x.id} role={x.tone === "error" ? "alert" : "status"} className="anim-pop flex gap-2.5 items-start bg-raised border border-line-strong rounded-xl px-4 py-3" style={{ boxShadow: "var(--shadow-pop)" }}><I size={16} className={`${COL[x.tone]} mt-0.5 shrink-0`} aria-hidden /><div className="text-[13px] text-fg">{x.msg}</div></div>; })}</div>
    <Modal open={!!c} onClose={() => done(false)} title={c?.title ?? ""} width="max-w-md" footer={<><button className="btn" onClick={() => done(false)}>{t("common.cancel")}</button><button autoFocus className={`btn ${c?.danger ? "btn-danger" : "btn-primary"}`} onClick={() => done(true)}>{c?.confirmLabel ?? t("common.confirm")}</button></>}><p className="text-fg2 pb-3">{c?.body}</p></Modal>
  </>;
}
