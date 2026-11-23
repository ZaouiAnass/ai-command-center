import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown"; import remarkGfm from "remark-gfm"; import remarkMath from "remark-math"; import rehypeKatex from "rehype-katex"; import rehypeHighlight from "rehype-highlight";
import "katex/dist/katex.min.css"; import { richBlock, RICH_LANGS } from "../components/RichBlocks";
import { Plus, Search, Send, Square, ChevronRight, Terminal, FilePen, FileSearch, Globe, Wrench, Copy, Check, PanelRight, ShieldAlert, Loader2, CheckCircle2, XCircle, MessageSquare, Cpu } from "lucide-react";
import { api, fmt, usd, dur, ago } from "../api"; import { useData } from "../hooks"; import { useT } from "../i18n"; import { toast } from "../overlay";
import { Page, Card, Modal, Field, EmptyState, ErrorState, LoadingSkeleton, Badge, StatusIndicator, Disclaimer } from "../ui";

const ACTIVE = ["queued", "preparing", "running", "waiting_approval"];
const THREAD = (e: any) => e.provider_session_id ?? e.id;

const textOf = (n: any): string => typeof n === "string" ? n : Array.isArray(n) ? n.map(textOf).join("") : n?.props ? textOf(n.props.children) : "";
function CodeBlock({ children }: { children: any }) {
  const [ok, setOk] = useState(false); const text = textOf((children as any)?.props?.children).replace(/\n$/, "");
  return <div className="relative group my-3"><pre className="bg-bg border border-line rounded-xl p-4 overflow-auto text-[12.5px] leading-relaxed">{children}</pre>
    <button aria-label="Copier le code" className="btn btn-sm absolute top-2 right-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => { navigator.clipboard?.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }}>{ok ? <Check size={12} /> : <Copy size={12} />}{ok ? "Copié" : "Copier"}</button></div>;
}
export const Md = React.memo(function Md({ text }: { text: string }) {
  return <div className="prose-chat"><ReactMarkdown remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]} rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: false, ignoreMissing: true, plainText: ["quiz", "qcm", "choices", "chart", "mermaid", "artifact", "svg"] }]]} components={{
    pre: ({ children }) => { const el: any = children; const lang = /language-([\w-]+)/.exec(el?.props?.className ?? "")?.[1]; if (lang && RICH_LANGS.has(lang)) { const rb = richBlock(lang, textOf(el.props.children).replace(/\n$/, "")); if (rb) return <>{rb}</>; } return <CodeBlock>{children}</CodeBlock>; },
    code: ({ className, children }) => className ? <code className={`${className} mono`}>{children}</code> : <code className="mono text-[12.5px] bg-raised px-1.5 py-0.5 rounded-md">{children}</code>,
    table: ({ children }) => <div className="overflow-auto my-3"><table className="w-full text-[13px] border border-line rounded-lg">{children}</table></div>, th: ({ children }) => <th className="th bg-panel">{children}</th>, td: ({ children }) => <td className="td">{children}</td>,
    a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline">{children}</a>, ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>, ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>,
    p: ({ children }) => <p className="my-2 leading-7">{children}</p>, h1: ({ children }) => <h3 className="text-[17px] font-semibold mt-4 mb-2">{children}</h3>, h2: ({ children }) => <h3 className="text-[16px] font-semibold mt-4 mb-2">{children}</h3>, h3: ({ children }) => <h4 className="font-semibold mt-3 mb-1">{children}</h4>,
    blockquote: ({ children }) => <blockquote className="border-l-2 border-line-strong pl-4 text-fg2 my-2">{children}</blockquote>,
  }}>{text}</ReactMarkdown></div>;
});

const toolIcon = (n: string) => /shell|bash|powershell|command/i.test(n) ? Terminal : /write|edit|patch|apply/i.test(n) ? FilePen : /read|grep|glob|search|list/i.test(n) ? FileSearch : /web|fetch/i.test(n) ? Globe : Wrench;
const toolLabel = (n: string) => /shell|bash|powershell/i.test(n) ? "Exécution de commande" : /write|edit|patch|apply/i.test(n) ? "Écriture de fichiers" : /read/i.test(n) ? "Lecture de fichiers" : /grep|glob|search/i.test(n) ? "Recherche dans le code" : /web|fetch/i.test(n) ? "Accès web" : n || "Outil";
export function ToolCallBlock({ tool }: { tool: any }) {
  const [open, setOpen] = useState(false); const I = toolIcon(tool.name); const S = tool.state === "started" ? <Loader2 size={13} className="animate-spin text-info" /> : tool.state === "failed" ? <XCircle size={13} className="text-danger" /> : <CheckCircle2 size={13} className="text-success" />;
  return <div className="my-1.5"><button onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-2 text-[13px] text-fg2 hover:text-fg w-full text-left rounded-lg px-2 py-1.5 min-w-0 hover:bg-raised transition-colors"><ChevronRight size={13} className={`transition-transform ${open ? "rotate-90" : ""}`} /><I size={14} className="text-muted" /><span className="font-medium whitespace-nowrap shrink-0">{toolLabel(tool.name)}</span><span className="text-muted truncate flex-1 min-w-0 mono text-xs">{tool.summary.slice(0, 90)}</span>{S}<span className="sr-only">{tool.state}</span></button>
    {open && <pre className="anim-fade mt-1 ml-5 bg-bg border border-line rounded-lg p-3 text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto">{tool.name}\n{tool.summary}</pre>}</div>;
}

/** Un tour de conversation : prompt utilisateur puis réponse de l'agent (logs persistés, rafraîchis en direct). */
const Turn = React.memo(function Turn({ ex }: { ex: any }) {
  const live = ACTIVE.includes(ex.status);
  const { data: logs } = useData<any[]>("executions.logs", [ex.id], { events: /execution\./, every: live ? 2000 : undefined });
  const blocks = useMemo(() => { const out: any[] = []; const tools = new Map<string, any>(); for (const l of logs ?? []) { if (l.kind === "text") { const last = out[out.length - 1]; if (last?.k === "text") last.text += l.content; else out.push({ k: "text", text: l.content, id: l.id }); } else if (l.kind === "tool") { const t = JSON.parse(l.content); const ex = tools.get(t.id); if (ex) { ex.state = t.state; if (t.name) ex.name = ex.name || t.name; if (t.summary) ex.summary = ex.summary || t.summary; } else { const b = { k: "tool", ...t, bid: l.id }; tools.set(t.id, b); out.push(b); } } else if (l.kind === "error") out.push({ k: "err", text: l.content, id: l.id }); } return out; }, [logs]);
  return <div className="mb-8">
    <div className="flex justify-end mb-4"><div className="max-w-[78%] bg-raised border border-line rounded-2xl rounded-br-md px-4 py-2.5 text-[14px] whitespace-pre-wrap">{ex.prompt}</div></div>
    <div className="flex gap-3"><div className="shrink-0 mt-1"><Badge v={ex.provider} /></div><div className="min-w-0 flex-1 text-[14px]">
      {blocks.map((b, i) => b.k === "text" ? <Md key={"t" + b.id} text={b.text} /> : b.k === "tool" ? <ToolCallBlock key={"c" + b.bid} tool={b} /> : <div key={"e" + b.id} role="alert" className="text-danger text-[13px] my-2 flex gap-2"><XCircle size={15} className="mt-0.5 shrink-0" />{b.text}</div>)}
      {live && <div className="flex items-center gap-2 text-xs text-muted mt-2" role="status">{ex.status === "waiting_approval" ? <><ShieldAlert size={13} className="text-warning" />En attente d'approbation</> : ex.status === "queued" ? <><Loader2 size={13} className="animate-spin" />En file d'attente…</> : <><span className="flex gap-1">{[0, 1, 2].map((i) => <span key={i} className="w-1.5 h-1.5 rounded-full bg-accent pulse-dot" style={{ animationDelay: `${i * 0.2}s` }} />)}</span>L'agent travaille…</>}</div>}
      {!live && ex.status === "completed" && !blocks.some((b) => b.k === "text") && (ex.result_text ? <Md text={ex.result_text} /> : <p className="text-muted text-[13px]">Terminé sans réponse textuelle.</p>)}
      {ex.status === "failed" && ex.error && !blocks.some((b) => b.k === "err") && <div role="alert" className="text-danger text-[13px] mt-2 flex gap-2"><XCircle size={15} className="mt-0.5 shrink-0" />{ex.error}</div>}
      {ex.status === "cancelled" && <p className="text-muted text-xs mt-2">Exécution annulée.</p>}
    </div></div></div>;
});

function SidePanel({ turns, last, thread }: { turns: any[]; last: any; thread: any[] }) {
  const { data: u } = useData<any[]>("executions.usage", [last.id], { events: /usage/ });
  const { data: appr, reload } = useData<any[]>("approvals.pending", [], { events: /approval|execution/ }); const { data: logs } = useData<any[]>("executions.logs", [last.id], { events: /file_change|execution\.(completed|failed)/ });
  const files = [...new Set((logs ?? []).filter((l) => l.kind === "file_change").flatMap((l) => JSON.parse(l.content)))];
  const all = thread.flatMap(() => []); void all;
  const mine = (appr ?? []).filter((a) => turns.some((t) => t.id === a.execution_id));
  return <aside className="hidden min-[1200px]:block w-[300px] shrink-0 border-l border-line overflow-auto p-5 space-y-6 anim-slide" aria-label="Détails de la session">
    {mine.map((a) => <div key={a.id} className="card p-3 !border-[rgba(251,191,36,.4)]"><div className="flex items-center gap-2 text-warning font-medium text-[13px] mb-1"><ShieldAlert size={14} />Approbation requise</div><div className="mono text-xs break-all mb-3 text-fg2">{a.summary}</div><div className="flex gap-2"><button className="btn btn-sm btn-primary" onClick={async () => { await api("approval.resolve", a.id, true); reload(); }}>Autoriser</button><button className="btn btn-sm btn-danger" onClick={async () => { await api("approval.resolve", a.id, false); reload(); }}>Refuser</button></div></div>)}
    <section><h3 className="label">Consommation (dernier tour)</h3>{u?.length ? u.map((r) => <div key={r.id} className="text-[13px] space-y-1 tnum"><div className="flex justify-between"><span className="text-muted">Modèle</span><span className="truncate ml-2">{r.model}</span></div><div className="flex justify-between"><span className="text-muted">Input</span><span>{fmt(r.input)}</span></div><div className="flex justify-between"><span className="text-muted">Output</span><span>{fmt(r.output)}</span></div><div className="flex justify-between"><span className="text-muted">Cache</span><span>{fmt(r.cache_read + r.cache_write)}</span></div><div className="flex justify-between font-medium"><span>Total</span><span>{fmt(r.total)}</span></div><div className="flex justify-between"><span className="text-muted">Éq. API</span><span>{usd(r.calculated_usd)}</span></div><div className="flex justify-between items-center"><span className="text-muted">Fiabilité</span><Badge v={r.confidence} /></div>{r.note && <p className="text-xs text-muted">{r.note}</p>}</div>) : <p className="text-muted text-[13px]">Aucune mesure reçue pour l'instant.</p>}<div className="mt-2"><Disclaimer /></div></section>
    <section><h3 className="label">Fichiers modifiés</h3>{files.length ? files.map((f: any) => <div key={f} className="mono text-xs text-fg2 break-all py-0.5">{f}</div>) : <p className="text-muted text-[13px]">Aucun.</p>}</section>
    <section><h3 className="label">Contexte</h3><dl className="text-[13px] space-y-1.5"><div><dt className="text-muted text-xs">Dossier</dt><dd className="mono text-xs break-all">{last.cwd}</dd></div><div><dt className="text-muted text-xs">Modèle</dt><dd>{last.model ?? "défaut"}</dd></div><div><dt className="text-muted text-xs">Session fournisseur</dt><dd className="mono text-xs break-all">{last.provider_session_id ?? "—"}</dd></div><div><dt className="text-muted text-xs">Tours</dt><dd>{turns.length}</dd></div></dl></section>
  </aside>;
}

export default function Sessions() {
  const t = useT(); const [sp, setSp] = useSearchParams();
  const { data: list, err, loading, reload } = useData<any[]>("executions.list", [{ limit: 300, mode: "code" }], { events: /execution\.(?!text)/ });
  const { data: projects } = useData<any[]>("projects.list", []); const { data: agents } = useData<any[]>("agents.list", []);
  const [sel, setSel] = useState<string>(); const [q, setQ] = useState(""); const [creating, setCreating] = useState(false); const [panel, setPanel] = useState(true); const [text, setText] = useState(""); const [sending, setSending] = useState(false); const [presetAgent, setPresetAgent] = useState("");
  const scroller = useRef<HTMLDivElement>(null); const inner = useRef<HTMLDivElement>(null); const stick = useRef(true);
  useEffect(() => { if (sp.get("new")) { setPresetAgent(sp.get("agent") ?? ""); setCreating(true); sp.delete("new"); sp.delete("agent"); setSp(sp, { replace: true }); } }, [sp]);
  useEffect(() => { const o = sp.get("open"); if (o && list) { const e = list.find((x) => x.id === o); if (e) { setSel(THREAD(e)); sp.delete("open"); setSp(sp, { replace: true }); } } }, [sp, list]);
  const threads = useMemo(() => { const m = new Map<string, any[]>(); for (const e of list ?? []) { const k = THREAD(e); (m.get(k) ?? m.set(k, []).get(k)!).push(e); } return [...m.entries()].map(([k, es]) => { es.sort((a, b) => a.created_at.localeCompare(b.created_at)); return { key: k, turns: es, last: es[es.length - 1], first: es[0] }; }).sort((a, b) => b.last.created_at.localeCompare(a.last.created_at)); }, [list]);
  const shown = threads.filter((th) => !q || th.first.prompt.toLowerCase().includes(q.toLowerCase()) || (th.first.agent_name ?? "").toLowerCase().includes(q.toLowerCase()));
  useEffect(() => { if (!sel && threads.length) setSel(threads[0]!.key); }, [threads, sel]);
  const cur = threads.find((th) => th.key === sel); const busy = cur?.turns.some((x) => ACTIVE.includes(x.status));
  useEffect(() => { stick.current = true; scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [sel, cur?.turns.length]);
  useEffect(() => { const el = inner.current; if (!el) return; const ro = new ResizeObserver(() => { if (stick.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }); ro.observe(el); return () => ro.disconnect(); }, [sel, !!cur]);

  const send = async () => {
    if (!cur || !text.trim() || busy) return; setSending(true);
    try { const l = cur.last; const id = await api("run", { projectId: l.project_id, provider: l.provider, agentId: l.agent_id || undefined, model: l.model || undefined, prompt: text.trim(), resumeSessionId: l.provider_session_id || undefined }); setText(""); reload(); void id; if (!l.provider_session_id) toast("Cette session n'a pas d'identifiant de reprise : le message démarre une nouvelle session.", "warning"); }
    catch (e: any) { toast(e.message, "error"); } finally { setSending(false); }
  };
  const stop = async () => { const a = cur?.turns.find((x) => ACTIVE.includes(x.status)); if (a) { await api("cancel", a.id); toast("Arrêt demandé.", "info"); } };

  return <div className="h-full flex flex-col anim-page">
    <div className="px-8 pt-7 pb-4 flex items-end justify-between"><div><h1 className="text-[26px] leading-8 font-semibold tracking-tight">{t("sessions.title")}</h1><p className="text-fg2 mt-1">{t("sessions.sub")}</p></div><button className="btn btn-primary" onClick={() => { setPresetAgent(""); setCreating(true); }}><Plus size={15} />{t("sessions.empty.cta")}</button></div>
    {err && !list ? <div className="px-8"><ErrorState message={err} onRetry={reload} /></div> : loading && !list ? <div className="px-8"><LoadingSkeleton rows={4} /></div> : !threads.length ? <div className="px-8"><Card><EmptyState icon={MessageSquare} title={t("sessions.empty.title")} desc={t("sessions.empty.desc")} action={<button className="btn btn-primary" onClick={() => setCreating(true)}>{t("sessions.empty.cta")}</button>} /></Card></div>
    : <div className="flex-1 min-h-0 mx-8 mb-6 card flex overflow-hidden">
      <div className="w-[240px] min-[1100px]:w-[300px] shrink-0 border-r border-line flex flex-col"><div className="p-3"><div className="relative"><Search size={14} className="absolute left-3 top-2.5 text-muted" /><input className="input !pl-9" placeholder={t("common.search")} aria-label="Rechercher une session" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
        <div className="flex-1 overflow-auto px-2 pb-2" role="listbox" aria-label="Sessions">{shown.map((th) => <button key={th.key} role="option" aria-selected={sel === th.key} onClick={() => setSel(th.key)} className={`w-full text-left rounded-xl px-3 py-2.5 mb-0.5 transition-colors ${sel === th.key ? "bg-raised" : "hover:bg-raised/60"}`}>
          <div className="flex items-center gap-2 mb-1"><Badge v={th.last.provider} /><span className="ml-auto text-2xs text-muted">{ago(th.last.created_at)}</span></div><div className="truncate text-[13px] font-medium">{th.first.prompt}</div>
          <div className="flex items-center gap-2 mt-1"><StatusIndicator status={th.last.status} size="sm" /><span className="text-2xs text-muted truncate">{th.first.project_name}{th.turns.length > 1 ? ` · ${th.turns.length} tours` : ""}</span></div></button>)}</div></div>
      <div className="flex-1 flex flex-col min-w-0">{cur && <>
        <div className="h-14 shrink-0 border-b border-line flex items-center gap-3 px-5"><div className="min-w-0 flex-1"><div className="font-medium truncate">{cur.first.prompt}</div><div className="text-xs text-muted truncate">{cur.first.agent_name ?? "Sans agent"} · {cur.first.project_name} · {cur.last.model ?? "modèle par défaut"}</div></div>
          {busy && <button className="btn btn-sm btn-danger" onClick={stop}><Square size={12} />{t("common.stop")}</button>}{!busy && <button className="btn btn-sm" onClick={async () => { await api("retry", cur.last.id); reload(); }}>{t("common.retry")}</button>}
          <button className={`btn btn-ghost btn-icon ${panel ? "!bg-raised" : ""}`} aria-pressed={panel} aria-label="Afficher les détails" onClick={() => setPanel(!panel)}><PanelRight size={16} /></button></div>
        <div className="flex-1 min-h-0 flex"><div className="flex-1 flex flex-col min-w-0">
          <div ref={scroller} onScroll={(e) => { const s = e.currentTarget; stick.current = s.scrollHeight - s.scrollTop - s.clientHeight < 80; }} className="flex-1 overflow-auto px-8 py-6"><div ref={inner} className="max-w-[760px] mx-auto">{cur.turns.map((x) => <Turn key={x.id} ex={x} />)}</div></div>
          <div className="px-8 pb-5"><div className="max-w-[760px] mx-auto"><div className="rounded-2xl border border-line-strong bg-bg focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-subtle)] transition-shadow">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} aria-label="Message" disabled={sending} placeholder={busy ? "L'agent travaille… vous pourrez répondre ensuite." : "Écrivez un message de suivi…"} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} className="w-full bg-transparent resize-none outline-none px-4 pt-3 text-[14px] placeholder:text-muted disabled:opacity-60" />
            <div className="flex items-center gap-2 px-3 pb-2.5"><span className="inline-flex items-center gap-1.5 text-xs text-muted min-w-0 truncate"><Cpu size={12} className="shrink-0" />{cur.last.provider === "claude" ? "Claude Code" : "Codex"} · {cur.last.model ?? "défaut"} · {cur.first.project_name}</span><span className="ml-auto text-2xs text-muted hidden 2xl:inline"><span className="kbd">Entrée</span> envoyer · <span className="kbd">Maj</span>+<span className="kbd">Entrée</span> ligne</span><button className="btn btn-primary btn-sm" onClick={send} disabled={!text.trim() || busy || sending} aria-label="Envoyer"><Send size={13} />Envoyer</button></div></div></div></div></div>
          {panel && <SidePanel turns={cur.turns} last={cur.last} thread={cur.turns} />}</div></>}</div></div>}
    <NewSession open={creating} onClose={() => setCreating(false)} projects={projects ?? []} agents={agents ?? []} preset={presetAgent} onDone={(id: string) => { reload(); setSel(id); }} />
  </div>;
}

function NewSession({ open, onClose, projects, agents, preset, onDone }: any) {
  const [f, setF] = useState<any>({ projectId: "", provider: "claude", agentId: "", prompt: "" }); const [wt, setWt] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { const a = agents.find((x: any) => x.id === preset); setF((x: any) => ({ ...x, projectId: x.projectId || projects[0]?.id || "", agentId: preset || x.agentId, provider: a?.provider ?? x.provider })); } }, [open, preset, projects, agents]);
  const go = async () => { setBusy(true); try { const id = await api("run", { projectId: f.projectId, provider: f.provider, agentId: f.agentId || undefined, prompt: f.prompt, useWorktree: wt }); onDone(id); onClose(); setF({ ...f, prompt: "" }); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); } };
  return <Modal open={open} onClose={onClose} title="Nouvelle session" footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={!f.prompt.trim() || !f.projectId || busy} onClick={go}>Lancer</button></>}>
    {!projects.length ? <p className="text-fg2 pb-3">Ajoutez d'abord un projet pour démarrer une session.</p> : <>
      <Field label="Instruction"><textarea className="input" rows={4} value={f.prompt} onChange={(e) => setF({ ...f, prompt: e.target.value })} placeholder="Que souhaitez-vous demander à l'agent ?" /></Field>
      <div className="grid grid-cols-3 gap-3"><Field label="Projet"><select className="input" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}>{projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Agent"><select className="input" value={f.agentId} onChange={(e) => { const a = agents.find((x: any) => x.id === e.target.value); setF({ ...f, agentId: e.target.value, provider: a?.provider ?? f.provider }); }}><option value="">Aucun</option>{agents.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Fournisseur"><select className="input" value={f.provider} disabled={!!f.agentId} onChange={(e) => setF({ ...f, provider: e.target.value })}><option value="claude">Claude Code</option><option value="codex">Codex</option></select></Field></div>
      <label className="flex items-center gap-2 text-[13px] text-fg2 mb-3"><input type="checkbox" checked={wt} onChange={(e) => setWt(e.target.checked)} />Isoler dans un worktree Git (branche dédiée)</label></>}</Modal>;
}
