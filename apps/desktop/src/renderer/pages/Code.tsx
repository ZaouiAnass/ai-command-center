import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FolderGit2, Bot, KanbanSquare, TerminalSquare, Share2, GitBranch, SquareTerminal, Workflow, Columns, Plus, ArrowRight, Users } from "lucide-react";
import { useData } from "../hooks"; import { Segmented, Badge } from "../ui";
import { ConversationList, ConversationView } from "../components/Conversations"; import { NewConversationComposer } from "./Chat";

const LS = "acc.code.project"; const lsGet = () => { try { return localStorage.getItem(LS) ?? ""; } catch { return ""; } }; const lsSet = (v: string) => { try { localStorage.setItem(LS, v); } catch { /* ok */ } };

function CodeChat() {
  const [sp, setSp] = useSearchParams(); const { data: projects } = useData<any[]>("projects.list", [], { events: /project/ });
  const [pid, setPid] = useState(lsGet()); const [sel, setSel] = useState<string | undefined>(); const [bump, setBump] = useState(0);
  useEffect(() => { if (projects?.length && !projects.some((p) => p.id === pid)) { setPid(projects[0].id); lsSet(projects[0].id); } }, [projects]);
  useEffect(() => { const o = sp.get("open"); if (o) { setSel(o); sp.delete("open"); setSp(sp, { replace: true }); } if (sp.get("new")) { setSel(undefined); sp.delete("new"); setSp(sp, { replace: true }); } }, [sp]);
  const project = projects?.find((p) => p.id === pid);
  return <div className="flex-1 flex min-h-0">
    <div className="flex flex-col"><div className="w-[272px] border-r border-b border-line p-3"><label className="label" htmlFor="code-project">Projet</label>
      {projects?.length ? <select id="code-project" className="input" value={pid} onChange={(e) => { setPid(e.target.value); lsSet(e.target.value); setSel(undefined); }}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : <Link to="/projects?new=1" className="btn btn-sm w-full"><Plus size={14} />Ajouter un projet</Link>}
      {project && <p className="mono text-2xs text-muted mt-1.5 truncate" title={project.path}>{project.path}</p>}</div>
      <div className="flex-1 min-h-0 flex"><ConversationList key={bump + pid} mode="code" projectId={pid || undefined} selected={sel} onSelect={setSel} onNew={() => setSel(undefined)} newLabel="Nouvelle session" emptyHint="Aucune session de code pour ce projet." /></div></div>
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      {sel ? <ConversationView key={sel} id={sel} mode="code" placeholder="Décrivez la modification, le bug ou la question sur ce projet…" onDeleted={() => { setSel(undefined); setBump((b) => b + 1); }} />
        : <NewConversationComposer mode="code" projectId={pid || undefined} title="Que construisons-nous ?" subtitle={project ? `Session directe avec Claude Code ou Codex sur « ${project.name} » — aucun agent à configurer.` : "Ajoutez d'abord un projet pour démarrer une session de code."} placeholder="Ex. Ajoute une validation d'e-mail au formulaire d'inscription et des tests" disabledReason={!project ? "Sélectionnez ou ajoutez un projet pour utiliser Code Chat." : undefined} onCreated={(id) => { setSel(id); setBump((b) => b + 1); }} />}</div></div>;
}

function MultiAgent() {
  const { data: d } = useData<any>("dashboard", [], { events: /execution/ }); const { data: orchs } = useData<any[]>("orch.list", [], { events: /orchestration/ });
  const cards: [any, string, string, string, string?][] = [[Bot, "Agents", "Profils spécialisés (architecte, reviewer, QA…) réutilisables.", "/agents", `${d?.counts.agents ?? 0} profil(s)`], [KanbanSquare, "Tâches", "Kanban avec dépendances ; chaque lancement est une tentative traçable.", "/tasks", `${d?.counts.queued ?? 0} en file`], [TerminalSquare, "Sessions", "Exécutions en direct, plusieurs agents en parallèle.", "/sessions", `${d?.counts.running ?? 0} en cours`],
    [Share2, "Orchestrateur", "Un objectif → un plan en graphe → agents Claude et Codex avec handoffs.", "/orchestrator", `${orchs?.filter((o) => o.status === "running").length ?? 0} active(s)`], [GitBranch, "Git et worktrees", "Branches isolées par agent, diff, fusion confirmée.", "/git"], [SquareTerminal, "Terminal", "Claude Code et Codex en interface interactive officielle.", "/terminal"], [Workflow, "Workflows", "Enchaînements réutilisables.", "/workflows", "Bientôt"], [Columns, "Comparaison IA", "Même tâche, Claude contre Codex.", "/compare", "Bientôt"]];
  return <div className="flex-1 overflow-auto px-8 py-7"><div className="max-w-[1100px] mx-auto"><h2 className="text-[20px] font-semibold mb-1">Multi-Agent Workspace</h2><p className="text-fg2 mb-6 max-w-2xl">Pour les travaux qui demandent plusieurs agents, des tâches parallèles, des worktrees et des handoffs. Pour une petite modification, <b>Code Chat</b> suffit : une seule session, sans profil d'agent à configurer.</p>
    <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">{cards.map(([I, t, desc, to, meta]) => <Link key={t} to={to} className="card p-4 hover:border-line-strong transition-colors flex flex-col"><div className="flex items-center justify-between mb-3"><span className="w-9 h-9 rounded-xl bg-raised border border-line grid place-items-center text-fg2"><I size={17} /></span>{meta && <span className="text-xs text-muted">{meta}</span>}</div><div className="font-semibold mb-1 flex items-center gap-1.5">{t}<ArrowRight size={13} className="text-muted" /></div><p className="text-xs text-muted">{desc}</p></Link>)}</div></div></div>;
}

export default function Code() {
  const [tab, setTab] = useState<"chat" | "multi">((typeof localStorage !== "undefined" && localStorage.getItem("acc.code.tab") as any) || "chat");
  const set = (t: "chat" | "multi") => { setTab(t); try { localStorage.setItem("acc.code.tab", t); } catch { /* ok */ } };
  return <div className="h-full flex flex-col min-h-0 anim-page">
    <div className="h-14 shrink-0 border-b border-line flex items-center gap-4 px-6"><h1 className="font-semibold text-[17px]">Code</h1><Segmented label="Expérience de code" value={tab} onChange={set} options={[["chat", "Code Chat"], ["multi", <span key="m" className="inline-flex items-center gap-1.5"><Users size={13} />Multi-Agent Workspace</span>]]} /><Badge v="subscription" text="Abonnement" /></div>
    {tab === "chat" ? <CodeChat /> : <MultiAgent />}</div>;
}
