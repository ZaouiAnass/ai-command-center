import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Briefcase, FileText, Paperclip, Trash2, ArrowUp, ArrowDown, ExternalLink, Wand2, Download, Search, Info, X, Circle, CircleDot, CheckCircle2, Ban } from "lucide-react";
import { api, fmt, usd, ago } from "../api"; import { useData } from "../hooks"; import { toast, confirmDialog } from "../overlay";
import { Card, Modal, Drawer, Field, EmptyState, ErrorState, LoadingSkeleton, Segmented, Tabs, Bar, Badge, Disclaimer } from "../ui";
import { AIModelConfiguration, useDefaultConfig, PROVIDER_LABEL, effortLabel, type ProviderId } from "../components/AIModelConfiguration"; import { ConversationView } from "../components/Conversations"; import { Md } from "./Sessions";

const SSTATUS: Record<string, [string, any, string]> = { todo: ["À faire", Circle, "text-muted"], doing: ["En cours", CircleDot, "text-info"], done: ["Terminée", CheckCircle2, "text-success"], blocked: ["Bloquée", Ban, "text-danger"] };
const WEVT: Record<string, string> = { created: "Travail créé", status: "Statut modifié", step_added: "Étape ajoutée", step_status: "Étape mise à jour", plan_imported: "Plan IA importé", file_added: "Source ajoutée", file_removed: "Source retirée", deliverable: "Livrable détecté" };
const NOTE = "Work local à AI Command Center : ce n'est pas le Work natif de ChatGPT ou de Claude, qu'aucune intégration officielle n'expose. Il n'utilise que les capacités réelles de Claude Code et de Codex dans un dossier de travail dédié.";

function PlanTab({ work }: { work: any }) {
  const { data: steps, reload } = useData<any[]>("work.steps", [work.id], { events: /work/ }); const [t, setT] = useState(""); const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<any>, ok?: string) => { try { await fn(); if (ok) toast(ok, "success"); reload(); } catch (e: any) { toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "error"); } };
  const groups = ["doing", "todo", "blocked", "done"];
  return <div>
    <p className="text-xs text-muted mb-3">Les étapes sont gérées par vous. L'IA peut proposer un plan à votre demande ; elle ne met pas les étapes à jour automatiquement.</p>
    <div className="flex gap-2 mb-4"><input className="input" aria-label="Nouvelle étape" placeholder="Ajouter une étape…" value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && t.trim()) act(async () => { await api("work.addStep", work.id, t); setT(""); }); }} /><button className="btn" disabled={!t.trim()} onClick={() => act(async () => { await api("work.addStep", work.id, t); setT(""); })}><Plus size={14} /></button></div>
    {!steps?.length && <p className="text-muted text-[13px] mb-4">Aucune étape. Ajoutez-en, ou demandez un plan à l'IA.</p>}
    {groups.map((g) => { const items = (steps ?? []).filter((s) => s.status === g); if (!items.length) return null; return <div key={g} className="mb-4"><div className="label">{SSTATUS[g]![0]} ({items.length})</div>{items.map((s) => { const I = SSTATUS[s.status]![1]; return <div key={s.id} className="flex items-center gap-2 py-1.5 border-b border-line/60 group"><I size={15} className={SSTATUS[s.status]![2]} aria-hidden /><span className={`flex-1 text-[13px] ${s.status === "done" ? "line-through text-muted" : ""}`}>{s.title}{s.source === "ai" && <span className="text-2xs text-accent ml-1.5">IA</span>}</span>
      <select aria-label={`Statut de ${s.title}`} className="input !h-7 !w-auto !text-xs" value={s.status} onChange={(e) => act(() => api("work.setStep", s.id, { status: e.target.value }))}>{Object.entries(SSTATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select>
      <button aria-label="Monter" className="btn btn-ghost btn-icon !h-7 !w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => act(() => api("work.moveStep", s.id, -1))}><ArrowUp size={12} /></button><button aria-label="Descendre" className="btn btn-ghost btn-icon !h-7 !w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => act(() => api("work.moveStep", s.id, 1))}><ArrowDown size={12} /></button>
      <button aria-label="Supprimer l'étape" className="btn btn-ghost btn-icon !h-7 !w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => act(() => api("work.removeStep", s.id))}><X size={12} /></button></div>; })}</div>; })}
    <div className="flex flex-wrap gap-2 mt-2"><button className="btn btn-sm" disabled={busy} onClick={async () => { setBusy(true); try { await api("conv.send", work.conversation_id, await api("work.planPrompt", work.goal || work.title)); toast("Plan demandé : la réponse apparaît dans la conversation.", "info"); } catch (e: any) { toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "error"); } finally { setBusy(false); } }}><Wand2 size={13} />Demander un plan à l'IA</button>
      <button className="btn btn-sm" onClick={() => act(async () => { const n = await api("work.importPlan", work.id); toast(`${n} étape(s) importée(s).`, "success"); })}>Importer le plan proposé</button></div></div>;
}

function Deliverables({ work }: { work: any }) {
  const { data: list, reload } = useData<any[]>("work.deliverables", [work.id], { events: /conversation|work/, every: 5000 }); const [open, setOpen] = useState<any>(); const [content, setContent] = useState<string>();
  useEffect(() => { setContent(undefined); if (open?.previewable) api("work.readDeliverable", work.id, open.rel).then(setContent).catch((e) => setContent("Aperçu indisponible : " + e.message)); }, [open]);
  return <div><p className="text-xs text-muted mb-3">Fichiers réellement présents dans le dossier « livrables » de cet espace de travail.</p>
    {!list?.length ? <EmptyState icon={FileText} title="Aucun livrable pour le moment" desc="Demandez à l'IA de produire un document : il apparaîtra ici dès qu'il est écrit dans le dossier de livrables." /> : list.map((d) => <button key={d.rel} onClick={() => setOpen(d)} className="w-full flex items-center gap-3 py-2 border-b border-line/60 text-left hover:bg-raised/50 px-1 rounded"><FileText size={15} className="text-muted shrink-0" /><span className="flex-1 min-w-0"><span className="block text-[13px] truncate">{d.rel}</span><span className="block text-2xs text-muted tnum">{(d.size / 1024).toFixed(1)} Ko · {ago(d.modifiedAt)}</span></span></button>)}
    <Drawer open={!!open} onClose={() => setOpen(undefined)} width={620} title={open?.rel ?? ""} actions={open && <button className="btn btn-sm" onClick={() => api("work.openDeliverable", work.id, open.rel).catch((e) => toast(e.message, "error"))}><ExternalLink size={13} />Ouvrir</button>}>
      {open && (!open.previewable ? <p className="text-muted text-[13px]">Aperçu indisponible pour ce type de fichier : utilisez « Ouvrir ».</p> : content === undefined ? <p className="text-muted">Chargement…</p> : /\.md$/i.test(open.rel) ? <Md text={content} /> : <pre className="bg-bg border border-line rounded-lg p-3 text-xs whitespace-pre-wrap">{content}</pre>)}</Drawer></div>;
}

function Sources({ work }: { work: any }) {
  const { data: files, reload } = useData<any[]>("work.files", [work.id], { events: /work/ });
  const add = async () => { const paths = await api("dialog.files"); if (!paths?.length) return; const r = await api("work.addFiles", work.id, paths); if (r.added.length) toast(`${r.added.length} fichier(s) copié(s) dans les sources.`, "success"); r.errors.forEach((e: string) => toast(e, "warning")); reload(); };
  return <div><p className="text-xs text-muted mb-3">Seuls les fichiers que vous choisissez sont copiés dans l'espace de travail ; l'IA y travaille sur ces copies (vos originaux ne sont pas modifiés).</p>
    <button className="btn btn-sm mb-3" onClick={add}><Paperclip size={13} />Ajouter des fichiers</button>{!files?.length ? <p className="text-muted text-[13px]">Aucune source.</p> : files.map((f) => <div key={f.id} className="flex items-center gap-2 py-1.5 border-b border-line/60 group"><FileText size={14} className="text-muted" /><span className="flex-1 text-[13px] truncate" title={f.original_path}>{f.name}</span><button aria-label={`Retirer ${f.name}`} className="btn btn-ghost btn-icon !h-7 !w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={async () => { await api("work.removeFile", f.id); reload(); }}><Trash2 size={13} /></button></div>)}</div>;
}
function Activity({ work }: { work: any }) {
  const { data: ev } = useData<any[]>("work.events", [work.id], { events: /work|conversation/, every: 8000 });
  return <ol className="relative border-l border-line ml-2 space-y-3">{(ev ?? []).map((e) => <li key={e.id} className="ml-4"><div className="text-[13px] font-medium">{WEVT[e.type] ?? e.type}</div>{e.detail && <div className="text-xs text-fg2 truncate">{e.detail}</div>}<div className="text-2xs text-muted tnum">{ago(e.at)}</div></li>)}</ol>;
}

function WorkDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { data: w, reload } = useData<any>("work.get", [id], { events: /work|conversation|usage|execution/ }); const [tab, setTab] = useState<"plan" | "livrables" | "sources" | "activite">("plan");
  if (!w) return <div className="p-8"><LoadingSkeleton rows={3} /></div>;
  const pct = w.steps ? Math.round((w.steps_done / w.steps) * 100) : null;
  return <div className="h-full flex flex-col min-h-0">
    <div className="shrink-0 border-b border-line px-6 py-3.5"><div className="flex items-center gap-3"><button className="btn btn-ghost btn-sm" onClick={onBack}>← Travaux</button><h1 className="font-semibold text-[17px] truncate flex-1">{w.title}</h1>
      <Segmented label="Statut" value={w.status} onChange={async (s) => { await api("work.update", id, { status: s }); reload(); }} options={[["active", "Actif"], ["done", "Terminé"], ["archived", "Archivé"]]} />
      <button className="btn btn-ghost btn-icon" aria-label="Supprimer le travail" onClick={async () => { if (await confirmDialog({ title: "Supprimer ce travail ?", body: "La conversation, les étapes, les sources copiées ET les livrables de cet espace de travail seront supprimés du disque. Les statistiques de consommation sont conservées.", confirmLabel: "Supprimer", danger: true })) { try { await api("work.remove", id); toast("Travail supprimé.", "success"); onBack(); } catch (e: any) { toast(e.message, "error"); } } }}><Trash2 size={16} /></button></div>
      <div className="flex items-center gap-4 mt-2 text-xs text-muted flex-wrap"><span className="text-fg2 truncate max-w-[520px]">{w.goal || "Aucun objectif décrit"}</span><span>{PROVIDER_LABEL[w.provider as ProviderId]} · {w.model || "modèle par défaut"} · effort {w.effort ? effortLabel(w.effort) : "auto"}</span><span className="tnum">{fmt(w.tokens)} tok · {usd(w.usd)}</span>
        {pct !== null && <span className="flex items-center gap-2 w-40"><span className="flex-1"><Bar pct={pct} /></span><span className="tnum">{w.steps_done}/{w.steps}</span></span>}</div></div>
    <div className="flex-1 min-h-0 flex"><ConversationView key={w.conversation_id} id={w.conversation_id} mode="work" embedded placeholder="Décrivez ce que vous voulez analyser, rédiger ou produire…" />
      <aside className="w-[390px] shrink-0 border-l border-line flex flex-col min-h-0" aria-label="Plan, livrables, sources et activité"><div className="px-4 pt-3"><Tabs tabs={[["plan", "Plan"], ["livrables", "Livrables"], ["sources", "Sources"], ["activite", "Activité"]]} value={tab} onChange={setTab} /></div>
        <div className="flex-1 overflow-auto px-4 pb-4">{tab === "plan" ? <PlanTab work={w} /> : tab === "livrables" ? <Deliverables work={w} /> : tab === "sources" ? <Sources work={w} /> : <Activity work={w} />}</div></aside></div></div>;
}

function NewWork({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [cfg, setCfg, ready] = useDefaultConfig("work"); const [title, setTitle] = useState(""); const [goal, setGoal] = useState(""); const [start, setStart] = useState(true); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { const id = await api("work.create", { title, goal, provider: cfg.provider, model: cfg.model, effort: cfg.effort }); onCreated(id); onClose(); setTitle(""); setGoal(""); if (start && goal.trim()) { const w = await api("work.get", id); await api("conv.send", w.conversation_id, goal.trim()); } } catch (e: any) { toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "error"); } finally { setBusy(false); } };
  return <Modal open={open} onClose={onClose} width="max-w-lg" title="Nouveau travail" footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={!title.trim() || busy || !ready} onClick={go}>Créer</button></>}>
    <Field label="Nom du travail"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Rapport comparatif des offres" /></Field>
    <Field label="Objectif"><textarea className="input" rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Analyse ces trois documents et prépare un rapport comparatif." /></Field>
    <label className="flex items-center gap-2 text-[13px] text-fg2 mb-4"><input type="checkbox" checked={start} onChange={(e) => setStart(e.target.checked)} />Envoyer l'objectif comme premier message</label>
    {ready && <AIModelConfiguration mode="work" value={cfg} onChange={setCfg} />}</Modal>;
}

export default function Work() {
  const [sp, setSp] = useSearchParams(); const [sel, setSel] = useState<string | undefined>(sp.get("open") ?? undefined); const [creating, setCreating] = useState(false); const [status, setStatus] = useState("active"); const [q, setQ] = useState("");
  const { data: list, err, loading, reload } = useData<any[]>("work.list", [{ status, q: q || undefined }], { events: /work|conversation|usage/ });
  useEffect(() => { const o = sp.get("open"); if (o) { setSel(o); sp.delete("open"); setSp(sp, { replace: true }); } if (sp.get("new")) { setCreating(true); sp.delete("new"); setSp(sp, { replace: true }); } }, [sp]);
  if (sel) return <div className="h-full anim-page"><WorkDetail id={sel} onBack={() => { setSel(undefined); reload(); }} /></div>;
  return <div className="px-8 py-7 max-w-[1200px] mx-auto anim-page">
    <div className="flex items-end justify-between mb-5 gap-4 flex-wrap"><div><h1 className="text-[26px] leading-8 font-semibold tracking-tight">Work</h1><p className="text-fg2 mt-1">Des travaux structurés : documents, plan, livrables, consommation.</p></div><button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={15} />Nouveau travail</button></div>
    <div className="flex items-start gap-2 text-xs text-muted bg-raised border border-line rounded-xl px-4 py-2.5 mb-5"><Info size={14} className="mt-0.5 shrink-0" /><span>{NOTE}</span></div>
    <div className="flex flex-wrap items-center gap-2 mb-5"><div className="relative"><Search size={14} className="absolute left-3 top-2.5 text-muted" /><input className="input !pl-9 !w-64" aria-label="Rechercher un travail" placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} /></div><Segmented label="Statut" value={status} onChange={setStatus} options={[["active", "En cours"], ["done", "Terminés"], ["archived", "Archivés"]]} /></div>
    {err && !list ? <ErrorState message={err} onRetry={reload} /> : loading && !list ? <LoadingSkeleton rows={3} cards={3} /> : !list?.length ? <Card><EmptyState icon={Briefcase} title={status === "active" ? "Aucun travail en cours" : "Aucun travail ici"} desc="Créez un travail pour analyser des documents, préparer un rapport ou suivre un projet complexe, avec un plan et des livrables." action={status === "active" ? <button className="btn btn-primary" onClick={() => setCreating(true)}>Nouveau travail</button> : undefined} /></Card>
      : <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{list.map((w) => <button key={w.id} onClick={() => setSel(w.id)} className="card p-5 text-left hover:border-line-strong transition-colors"><h3 className="font-semibold truncate mb-1">{w.title}</h3><p className="text-[13px] text-fg2 line-clamp-2 min-h-[38px] mb-3">{w.goal || "Aucun objectif décrit"}</p>
        {w.steps > 0 && <div className="mb-3"><div className="flex justify-between text-xs text-muted mb-1 tnum"><span>Étapes</span><span>{w.steps_done}/{w.steps}</span></div><Bar pct={Math.round((w.steps_done / w.steps) * 100)} /></div>}
        <div className="flex items-center gap-2 text-xs text-muted tnum"><Badge v={w.provider} /><span>{w.files} source(s)</span><span>·</span><span>{fmt(w.tokens)} tok</span><span className="ml-auto">{ago(w.updated_at)}</span></div></button>)}</div>}
    <NewWork open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setSel(id); reload(); }} /></div>;
}
