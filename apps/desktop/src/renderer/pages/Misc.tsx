import { useState } from "react";
import { Bell, GitBranch, Wrench, CheckCheck, Activity } from "lucide-react";
import { api, ago } from "../api"; import { useData, useLiveEvents } from "../hooks"; import { useT } from "../i18n"; import { toast, confirmDialog } from "../overlay";
import { Page, Card, EmptyState, ErrorState, LoadingSkeleton, Badge, StatusIndicator } from "../ui"; import { evtLabel, evtTone } from "../Shell";

export function Notifications() {
  const t = useT(); const { data: l, err, loading, reload } = useData<any[]>("notifications.list", [], { events: /notification/ }); const [cat, setCat] = useState("");
  const shown = (l ?? []).filter((n) => !cat || n.category === cat); const cats = [...new Set((l ?? []).map((n) => n.category))];
  return <Page title={t("notifications.title")} sub="Alertes des agents, des quotas et de l'authentification." actions={<button className="btn" onClick={async () => { await api("notifications.markRead"); reload(); }}><CheckCheck size={14} />Tout marquer comme lu</button>}>
    {err && !l ? <ErrorState message={err} onRetry={reload} /> : loading && !l ? <LoadingSkeleton rows={4} /> : !l?.length ? <Card><EmptyState icon={Bell} title="Aucune notification" desc="Les événements importants (tâche terminée, approbation requise, quota atteint…) apparaîtront ici." /></Card> : <>
      <div className="flex gap-1.5 mb-4 flex-wrap">{["", ...cats].map((c) => <button key={c} onClick={() => setCat(c)} aria-pressed={cat === c} className={`btn btn-sm ${cat === c ? "btn-primary" : ""}`}>{c || "Toutes"}</button>)}</div>
      <Card pad={false}><ul className="divide-y divide-line">{shown.map((n) => <li key={n.id} className={`flex gap-4 px-5 py-3.5 ${n.read ? "opacity-60" : ""}`}><StatusIndicator status={n.level === "error" ? "failed" : n.level === "warn" ? "waiting" : "completed"} label={n.category} size="sm" /><div className="flex-1 min-w-0"><div className="font-medium text-[13px]">{n.title}</div><div className="text-fg2 text-[13px] truncate">{n.body}</div></div><span className="text-xs text-muted tnum shrink-0">{ago(n.created_at)}</span></li>)}</ul></Card></>}</Page>;
}

export function ActivityPage() {
  const ev = useLiveEvents(); const { data: audit } = useData<any[]>("audit.list", []);
  return <Page title="Activité" sub="Événements en temps réel depuis le lancement de l'application.">
    {!ev.length ? <Card><EmptyState icon={Activity} title="Aucune activité pour le moment" desc="Les événements apparaîtront dès que vos agents travailleront." /></Card> : <Card pad={false}><ul className="divide-y divide-line">{ev.map((e) => <li key={e.id} className="flex gap-4 px-5 py-3 text-[13px]"><span className={`w-40 shrink-0 font-medium ${evtTone(e.type)}`}>{evtLabel(e.type)}</span><span className="flex-1 text-fg2 truncate">{e.provider ?? ""} {e.payload?.detail ?? e.payload?.title ?? ""}</span><span className="text-xs text-muted tnum">{new Date(e.ts).toLocaleTimeString("fr-FR")}</span></li>)}</ul></Card>}
    {audit && audit.length > 0 && <Card title="Journal d'audit" className="mt-4">{audit.map((a) => <div key={a.id} className="text-xs text-muted mono py-0.5">{a.at} · {a.type} · {a.payload}</div>)}</Card>}</Page>;
}

export function Git() {
  const t = useT(); const { data: w, err, loading, reload } = useData<any[]>("git.worktrees", [], { events: /git|execution/ }); const [sel, setSel] = useState<any>(); const [ch, setCh] = useState<any>(); const [diff, setDiff] = useState("");
  const open = async (x: any) => { setSel(x); setCh(undefined); try { setCh(await api("git.changes", x.path)); setDiff(await api("git.diff", x.path)); } catch (e: any) { toast("Impossible de lire ce worktree : " + e.message, "error"); } };
  const lines = diff.split("\n");
  return <Page title={t("git.title")} sub={t("git.sub")}>
    {err && !w ? <ErrorState message={err} onRetry={reload} /> : loading && !w ? <LoadingSkeleton rows={3} /> : !w?.length ? <Card><EmptyState icon={GitBranch} title="Aucun worktree" desc="Cochez « Isoler dans un worktree Git » en lançant une session : l'agent travaillera dans sa propre branche, sans toucher à vos fichiers." /></Card>
    : <div className="grid grid-cols-[320px_1fr] gap-4"><Card pad={false}><div className="p-2">{w.map((x) => <button key={x.id} onClick={() => open(x)} aria-pressed={sel?.id === x.id} className={`w-full text-left rounded-xl px-3 py-2.5 mb-0.5 ${sel?.id === x.id ? "bg-raised" : "hover:bg-raised/60"}`}><div className="mono text-[13px]">{x.branch}</div><div className="text-2xs text-muted truncate">{x.path}</div><div className="mt-1"><Badge v={x.status === "merged" ? "completed" : "running"} text={x.status === "merged" ? "Fusionné" : "Actif"} /></div></button>)}</div></Card>
      <Card title={sel?.branch ?? "Sélectionnez un worktree"} right={sel?.status === "active" && <button className="btn btn-primary btn-sm" onClick={async () => { if (!(await confirmDialog({ title: `Fusionner ${sel.branch} ?`, body: `Les changements seront fusionnés dans ${sel.base_branch}. Le dépôt principal doit être propre ; en cas de conflit, la fusion est annulée sans rien perdre.`, confirmLabel: "Fusionner" }))) return; const r = await api("git.merge", sel.id, true); toast(r.ok ? "Fusion réussie." : r.reason, r.ok ? "success" : "error"); reload(); }}>Fusionner…</button>}>
        {!sel ? <p className="text-muted text-[13px]">Choisissez un worktree pour afficher ses modifications.</p> : !ch ? <LoadingSkeleton rows={2} /> : <><div className="flex items-center gap-2 text-[13px] text-fg2 mb-3"><Wrench size={14} />{ch.files.length} fichier(s) modifié(s) non commité(s)</div>{ch.files.map((f: any) => <div key={f.path} className="mono text-xs py-0.5"><span className="text-warning w-6 inline-block">{f.status}</span>{f.path}</div>)}
          <div className="mt-4 bg-bg border border-line rounded-xl overflow-auto max-h-[460px] text-[12px] mono">{diff ? lines.map((l, i) => <div key={i} className={`px-3 whitespace-pre ${l.startsWith("+") && !l.startsWith("+++") ? "bg-[var(--success-subtle)] text-success" : l.startsWith("-") && !l.startsWith("---") ? "bg-[var(--danger-subtle)] text-danger" : l.startsWith("@@") ? "text-info" : "text-fg2"}`}>{l || " "}</div>) : <div className="p-3 text-muted">Aucune différence.</div>}</div></>}</Card></div>}</Page>;
}

export const Soon = ({ title, phase, text }: { title: string; phase: string; text: string }) => <Page title={title}><Card><EmptyState icon={Wrench} title={`Bientôt disponible — ${phase}`} desc={text} /></Card></Page>;
