import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar as RBar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Bot, Activity, CheckCircle2, Cpu, DollarSign, Plug, Plus, FolderPlus, TerminalSquare, ArrowUpRight, ShieldAlert } from "lucide-react";
import { useData } from "../hooks"; import { fmt, usd, dur, ago } from "../api"; import { useT } from "../i18n";
import { Card, MetricCard, Page, StatusIndicator, Badge, Disclaimer, EmptyState, ErrorState, LoadingSkeleton, Segmented, Bar, SectionHeader } from "../ui";

const RANGES: [string, string][] = [["1", "24 h"], ["7", "7 j"], ["30", "30 j"]];
export const TT = { contentStyle: { background: "#18181d", border: "1px solid #36363f", borderRadius: 10, fontSize: 12 }, labelStyle: { color: "#b0b0ba" } };
const AX = { stroke: "#85858f", fontSize: 11, tickLine: false, axisLine: false } as const;

export default function Dashboard() {
  const t = useT(); const nav = useNavigate(); const [range, setRange] = useState("7"); const [metric, setMetric] = useState<"tokens" | "usd">("tokens");
  const since = useMemo(() => new Date(Date.now() - Number(range) * 864e5).toISOString(), [range]);
  const ev = { events: /execution|usage|task|notification/ as RegExp };
  const { data: d, err, loading, reload } = useData<any>("dashboard", [], ev);
  const { data: tot } = useData<any>("analytics.totals", [{ since }], { events: /usage/ });
  const { data: series } = useData<any[]>("analytics.series", [range === "1" ? "hour" : "day", { since }], { events: /usage/ });
  const { data: execs } = useData<any[]>("executions.list", [{ limit: 60 }], ev);
  const { data: notifs } = useData<any[]>("notifications.list", [], { events: /notification/ });
  const { data: prov } = useData<any>("providers.all", []);
  const { data: cq } = useData<any>("providers.quota", ["codex"], { every: 60000 }); const { data: lq } = useData<any>("providers.quota", ["claude"], { events: /quota/ });
  const { data: appr } = useData<any[]>("approvals.pending", [], { events: /approval|execution/ });

  const chart = useMemo(() => Object.values((series ?? []).reduce((a: any, r: any) => { const x = (a[r.bucket] ??= { b: r.bucket, claude: 0, codex: 0, claudeUsd: 0, codexUsd: 0 }); x[r.provider] = r.total; x[r.provider + "Usd"] = r.usd; return a; }, {})) as any[], [series]);
  const active = (execs ?? []).filter((e) => ["preparing", "running", "waiting_approval"].includes(e.status));
  const timeline = useMemo(() => [...(notifs ?? []).slice(0, 8).map((n) => ({ id: "n" + n.id, at: n.created_at, title: n.title, body: n.body, tone: n.level })), ...(execs ?? []).slice(0, 8).filter((e) => e.status === "running").map((e) => ({ id: "r" + e.id, at: e.started_at ?? e.created_at, title: "Agent démarré", body: e.prompt.slice(0, 80), tone: "info" }))].sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 8), [notifs, execs]);
  const actions = <><Segmented label="Période" value={range} onChange={setRange} options={RANGES.map(([k, l]) => [k, l] as [string, string])} /><button className="btn" onClick={() => nav("/agents?new=1")}><Plus size={15} />{t("common.newAgent")}</button><button className="btn btn-primary" onClick={() => nav("/tasks?new=1")}><Plus size={15} />{t("common.newTask")}</button></>;

  if (err && !d) return <Page title={t("overview.title")} sub={t("overview.sub")}><ErrorState message={err} onRetry={reload} hint="Les autres écrans restent disponibles." /></Page>;
  if (loading && !d) return <Page title={t("overview.title")} sub={t("overview.sub")}><LoadingSkeleton cards={4} rows={3} /></Page>;
  const okProv = (["claude", "codex"] as const).filter((k) => prov?.[k]?.authenticated && prov[k].authMode === "subscription").length;
  const first = !d.counts.projects && !d.counts.agents && !d.all.total;

  return <Page title={t("overview.title")} sub={t("overview.sub")} actions={actions}>
    {first ? <Card><EmptyState icon={FolderPlus} title={t("projects.empty.title")} desc="Ajoutez un projet, créez un agent, puis lancez votre première tâche. Claude Code et Codex utilisent vos abonnements existants." action={<div className="flex gap-2"><button className="btn btn-primary" onClick={() => nav("/projects?new=1")}>{t("projects.empty.cta")}</button><button className="btn" onClick={() => nav("/agents?new=1")}>{t("agents.empty.cta")}</button></div>} /></Card> : <>
    <div className="grid grid-cols-2 xl:grid-cols-6 gap-3 mb-6">
      <MetricCard icon={Bot} label="Agents actifs" value={d.counts.running} tone={d.counts.running ? "text-success" : undefined} sub={`${d.counts.agents} profil${d.counts.agents > 1 ? "s" : ""}`} />
      <MetricCard icon={Activity} label="Tâches en file" value={d.counts.queued} sub={d.counts.waiting ? <span className="text-warning">{d.counts.waiting} en attente d'approbation</span> : "—"} />
      <MetricCard icon={CheckCircle2} label="Terminées" value={d.counts.completed} sub={d.counts.failed ? <span className="text-danger">{d.counts.failed} en échec</span> : "aucun échec"} />
      <MetricCard icon={Cpu} label="Tokens" value={fmt(tot?.total)} sub={`${fmt(tot?.input)} in · ${fmt(tot?.output)} out`} hint="Tokens mesurés sur la période (input non caché + output + cache)." />
      <MetricCard icon={DollarSign} label="Éq. API (USD)" value={usd(tot?.usd)} sub="non facturé" hint={t("disclaimer.usd")} />
      <MetricCard icon={Plug} label="Fournisseurs" value={`${okProv}/2`} sub={okProv === 2 ? "abonnements connectés" : "vérifier les connexions"} tone={okProv === 2 ? undefined : "text-warning"} />
    </div>

    {(appr?.length ?? 0) > 0 && <div className="card border-[rgba(251,191,36,.35)] bg-[var(--warning-subtle)] p-4 mb-6 flex items-center gap-3"><ShieldAlert className="text-warning" size={18} /><div className="flex-1"><div className="font-medium">{appr!.length} approbation{appr!.length > 1 ? "s" : ""} en attente</div><div className="text-fg2 text-[13px]">Un agent attend votre décision pour continuer.</div></div><Link to={`/sessions?open=${appr![0].execution_id}`} className="btn btn-sm">Examiner</Link></div>}

    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6 [&>*]:min-w-0">
      <Card className="xl:col-span-2" title="Utilisation" sub="Claude et Codex sur la période" right={<Segmented label="Métrique" value={metric} onChange={setMetric} options={[["tokens", "Tokens"], ["usd", "USD éq."]]} />}>
        {chart.length === 1 ? <div className="h-[260px]"><ResponsiveContainer><BarChart data={chart} margin={{ left: -10 }}><CartesianGrid stroke="#27272e" vertical={false} /><XAxis dataKey="b" {...AX} /><YAxis {...AX} tickFormatter={(v) => metric === "usd" ? "$" + v : v >= 1000 ? Math.round(v / 1000) + "k" : v} /><Tooltip {...TT} cursor={{ fill: "#ffffff08" }} formatter={(v: any, n: any) => [metric === "usd" ? "≈ $" + Number(v).toFixed(4) : fmt(v), n]} /><RBar dataKey={metric === "usd" ? "claudeUsd" : "claude"} name="Claude" fill="#f59e6b" radius={[4, 4, 0, 0]} maxBarSize={72} /><RBar dataKey={metric === "usd" ? "codexUsd" : "codex"} name="Codex" fill="#67c1f5" radius={[4, 4, 0, 0]} maxBarSize={72} /></BarChart></ResponsiveContainer></div> : chart.length ? <div className="h-[260px]"><ResponsiveContainer><AreaChart data={chart} margin={{ left: -10, right: 4, top: 4 }}>
          <defs>{[["c", "#f59e6b"], ["x", "#67c1f5"]].map(([id, c]) => <linearGradient key={id} id={"g" + id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={c} stopOpacity={0.28} /><stop offset="100%" stopColor={c} stopOpacity={0} /></linearGradient>)}</defs>
          <CartesianGrid stroke="#27272e" vertical={false} /><XAxis dataKey="b" {...AX} /><YAxis {...AX} tickFormatter={(v) => metric === "usd" ? "$" + v : v >= 1000 ? Math.round(v / 1000) + "k" : v} />
          <Tooltip {...TT} formatter={(v: any, n: any) => [metric === "usd" ? "≈ $" + Number(v).toFixed(4) : fmt(v), n]} />
          <Area type="monotone" dataKey={metric === "usd" ? "claudeUsd" : "claude"} name="Claude" stroke="#f59e6b" strokeWidth={2} fill="url(#gc)" /><Area type="monotone" dataKey={metric === "usd" ? "codexUsd" : "codex"} name="Codex" stroke="#67c1f5" strokeWidth={2} fill="url(#gx)" /></AreaChart></ResponsiveContainer></div>
          : <EmptyState icon={Cpu} title={t("analytics.empty.title")} />}
        {metric === "usd" && <div className="mt-3"><Disclaimer /></div>}</Card>
      <Card title="Fournisseurs" sub="Abonnements et quotas mesurés">
        {(["claude", "codex"] as const).map((p) => { const s = prov?.[p]; const q = p === "codex" ? cq : lq; return <div key={p} className="py-3 first:pt-0 last:pb-0 border-b border-line last:border-0">
          <div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2"><Badge v={p} />{s ? <Badge v={s.authMode} /> : null}</div><span className="text-xs text-muted tnum">{s?.installed === false ? "non détecté" : s?.version}</span></div>
          {s && !s.installed ? <p className="text-xs text-warning">{p === "claude" ? "Claude Code" : "Codex"} {t("provider.missing")}</p> : q?.windows?.length ? q.windows.map((w: any) => <div key={w.label} className="mb-1.5"><div className="flex justify-between text-xs text-muted mb-1"><span>{w.label}</span><span className="tnum">{w.usedPercent ?? "?"} %</span></div><Bar pct={w.usedPercent} /></div>) : <p className="text-xs text-muted">{!q ? "Mesure en cours…" : q.note ?? t("common.unavailable")}</p>}</div>; })}
        <Link to="/quotas" className="text-xs text-accent inline-flex items-center gap-1 mt-3">Détails<ArrowUpRight size={12} /></Link></Card></div>

    <SectionHeader title="Agents actifs" right={<Link to="/sessions" className="text-[13px] text-accent">Toutes les sessions</Link>} />
    {active.length ? <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3 mb-6">{active.map((e) => <Link key={e.id} to={`/sessions?open=${e.id}`} className={`card p-4 hover:border-line-strong transition-colors ${e.status === "waiting_approval" ? "!border-[rgba(251,191,36,.45)]" : ""}`}>
      <div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2 min-w-0"><Badge v={e.provider} /><span className="font-medium truncate">{e.agent_name ?? "Sans agent"}</span></div><StatusIndicator status={e.status} size="sm" /></div>
      <p className="text-[13px] text-fg2 line-clamp-2 min-h-[40px]">{e.task_title ?? e.prompt}</p>
      <div className="flex justify-between text-xs text-muted mt-3 tnum"><span>{e.model ?? "modèle par défaut"}</span><span>{fmt(e.tokens)} tok · {dur(e.started_at ? Date.now() - new Date(e.started_at).getTime() : null)}</span></div></Link>)}</div>
      : <div className="card mb-6"><EmptyState icon={TerminalSquare} title="Aucun agent en cours" desc="Lancez une tâche pour voir vos agents travailler ici en direct." action={<button className="btn btn-primary" onClick={() => nav("/sessions?new=1")}>{t("sessions.empty.cta")}</button>} /></div>}

    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 [&>*]:min-w-0">
      <Card className="xl:col-span-2" title="Activité récente" pad>
        {timeline.length ? <ol className="relative border-l border-line ml-2 space-y-4">{timeline.map((x) => <li key={x.id} className="ml-5 relative"><span className={`absolute -left-[26px] top-1.5 w-2 h-2 rounded-full ${x.tone === "error" ? "bg-danger" : x.tone === "warn" ? "bg-warning" : "bg-success"}`} aria-hidden /><div className="flex justify-between gap-3"><span className="font-medium text-[13px]">{x.title}</span><span className="text-xs text-muted tnum shrink-0">{ago(x.at)}</span></div>{x.body && <div className="text-xs text-muted truncate">{x.body}</div>}</li>)}</ol> : <p className="text-muted text-[13px]">Aucune activité pour le moment.</p>}</Card>
      <Card title="Accès rapide"><div className="grid gap-2">{[["Créer un agent", "/agents?new=1", Bot], ["Nouvelle tâche", "/tasks?new=1", Plus], ["Ouvrir un projet", "/projects", FolderPlus], ["Nouvelle session", "/sessions?new=1", TerminalSquare]].map(([l, to, I]: any) => <Link key={l} to={to} className="btn justify-start"><I size={15} className="text-muted" />{l}</Link>)}</div>
        <div className="mt-4 text-xs text-muted">Modèle le plus utilisé : <span className="text-fg2">{d.topModel?.label ?? "—"}</span><br />Projet le plus actif : <span className="text-fg2">{d.topProject?.label ?? "—"}</span></div></Card></div></>}
  </Page>;
}
