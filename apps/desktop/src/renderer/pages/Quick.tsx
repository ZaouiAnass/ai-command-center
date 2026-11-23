import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, Asterisk } from "lucide-react";
import { api } from "../api"; import { useDefaultConfig, PROVIDER_LABEL, type ProviderId } from "../components/AIModelConfiguration";

/**
 * Lanceur rapide (raccourci global) : une question, Entrée, et la conversation s'ouvre dans la fenêtre principale.
 * Fenêtre sans cadre et transparente : seule la carte arrondie est visible.
 */
export default function Quick() {
  const [cfg, setCfg, ready] = useDefaultConfig("chat"); const [text, setText] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { document.documentElement.style.background = "transparent"; document.body.style.background = "transparent"; }, []);
  useEffect(() => { const f = () => { setText(""); setErr(""); setBusy(false); ta.current?.focus(); }; f(); window.addEventListener("focus", f); return () => window.removeEventListener("focus", f); }, []);
  useEffect(() => { const t = ta.current; if (t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 110) + "px"; } }, [text]);
  const go = async () => {
    const t = text.trim(); if (!t || busy || !ready) return; setBusy(true); setErr("");
    try { const id = await api("conv.create", { mode: "chat", provider: cfg.provider, model: cfg.model, effort: cfg.effort }); await api("conv.send", id, t, cfg, [], []); await api("app.openConversation", "chat", id); }
    catch (e: any) { setErr(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")); setBusy(false); }
  };
  const other: ProviderId = cfg.provider === "claude" ? "codex" : "claude";
  return <div className="h-screen p-3 select-none" onKeyDown={(e) => { if (e.key === "Escape") void api("app.hideQuick"); }}>
    <div className="rounded-[22px] border border-line-strong bg-panel overflow-hidden" style={{ boxShadow: "0 18px 60px rgba(0,0,0,.55)" }}>
      <div className="flex items-start gap-3 px-4 pt-4 pb-2"><Asterisk size={22} strokeWidth={2.5} className="text-accent mt-1 shrink-0" aria-hidden />
        <textarea ref={ta} autoFocus rows={1} className="flex-1 bg-transparent outline-none resize-none text-[16px] leading-7 placeholder:text-muted select-text" placeholder="Posez une question…" aria-label="Votre question" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void go(); } }} /></div>
      {err && <p role="alert" className="px-4 pb-1 text-xs text-danger">{err}</p>}
      <div className="flex items-center gap-2 px-3 pb-3 pt-1"><button type="button" className="chip" onClick={() => setCfg({ provider: other, model: null, effort: null })} title="Changer de fournisseur"><span className={`w-2 h-2 rounded-full ${cfg.provider === "claude" ? "bg-claude" : "bg-codex"}`} />{PROVIDER_LABEL[cfg.provider]}</button>
        <span className="text-2xs text-muted"><span className="kbd">Entrée</span> envoyer · <span className="kbd">Échap</span> fermer</span>
        <button type="button" aria-label="Envoyer" disabled={!text.trim() || busy || !ready} onClick={() => void go()} className="ml-auto h-9 w-9 rounded-full grid place-items-center bg-[var(--btn-primary)] text-white disabled:bg-raised disabled:text-muted disabled:cursor-not-allowed hover:bg-[var(--btn-primary-hover)] transition-colors">{busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={18} strokeWidth={2.4} />}</button></div>
    </div></div>;
}
