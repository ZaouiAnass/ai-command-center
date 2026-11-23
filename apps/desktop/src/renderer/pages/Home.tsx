import { Link, useNavigate } from "react-router-dom";
import { MessageSquare, Briefcase, Code2, ArrowUpRight, Command, Clock, Asterisk } from "lucide-react";
import { useData } from "../hooks"; import { ago } from "../api"; import { SpotCard } from "../ui";

const MODES: [string, any, string, string, string, string][] = [
  ["chat", MessageSquare, "Chat", "Posez une question, rédigez, analysez une idée.", "Aucun projet requis", "/chat"],
  ["work", Briefcase, "Work", "Un travail structuré avec vos documents et des livrables.", "Plan et livrables", "/work"],
  ["code", Code2, "Code", "Programmez sur un projet, seul ou avec plusieurs agents.", "Projet local et Git", "/code"],
];
const greeting = () => { const h = new Date().getHours(); return h < 5 ? "Bonne nuit" : h < 18 ? "Bonjour" : "Bonsoir"; };
export default function Home() {
  const nav = useNavigate(); const { data: cfg } = useData<any>("settings.all", []); const name = String(cfg?.["profile.name"] ?? "").trim();
  const { data: chats } = useData<any[]>("conv.list", [{ mode: "chat" }], { events: /conversation/ }); const { data: works } = useData<any[]>("work.list", [{ status: "active" }], { events: /work|conversation/ }); const { data: codes } = useData<any[]>("conv.list", [{ mode: "code", submode: "direct" }], { events: /conversation/ });
  const recent = [...(chats ?? []).map((x) => ({ ...x, m: "chat" })), ...(works ?? []).map((x) => ({ ...x, m: "work" })), ...(codes ?? []).map((x) => ({ ...x, m: "code" }))].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 6);
  const href = (m: string, x: any) => m === "work" ? `/work?open=${x.id}` : `/${m}?open=${x.id}`; const ICON: Record<string, any> = { chat: MessageSquare, work: Briefcase, code: Code2 };
  return <div className="h-full overflow-auto"><div className="max-w-[920px] mx-auto px-8 pt-14 pb-12">
    <div className="anim-page"><h1 className="text-[38px] leading-tight flex items-center gap-3"><Asterisk size={34} strokeWidth={2.4} className="text-accent shrink-0" aria-hidden />{greeting()}{name ? `, ${name}` : ""}</h1><p className="text-fg2 mt-1.5 text-[15px]">Que voulez-vous faire ? Tout fonctionne avec vos abonnements Claude et ChatGPT.</p></div>
    <div className="grid md:grid-cols-3 gap-4 mt-8">{MODES.map(([m, I, t, d, hint, to], i) => <SpotCard key={m} as="button" type="button" onClick={() => nav(`${to}?new=1`)} className="p-5 text-left flex flex-col group cursor-pointer anim-page" style={{ animationDelay: `${60 + i * 60}ms`, animationFillMode: "both" }}>
      <div className="flex items-start justify-between"><span className="w-11 h-11 rounded-xl bg-accent-subtle text-accent grid place-items-center transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3"><I size={22} aria-hidden /></span><ArrowUpRight size={18} className="text-muted transition-all duration-200 group-hover:text-fg group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden /></div>
      <h2 className="text-[21px] font-display mt-5">{t}</h2><p className="text-[13px] text-fg2 mt-1 min-h-[40px]">{d}</p><span className="mt-4 text-2xs text-muted">{hint}</span></SpotCard>)}</div>
    <div className="mt-10"><div className="flex items-center gap-2 text-xs font-semibold text-muted uppercase tracking-wider mb-3"><Clock size={12} />Reprendre</div>
      {!recent.length ? <p className="text-[13px] text-muted">Vos conversations récentes apparaîtront ici.</p> : <div className="grid md:grid-cols-2 gap-x-6">{recent.map((x) => { const I = ICON[x.m]; return <Link key={`${x.m}${x.id}`} to={href(x.m, x)} className="group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-raised transition-colors"><I size={15} className="text-muted shrink-0 group-hover:text-accent transition-colors" aria-hidden /><span className="truncate flex-1 text-[13.5px]">{x.title}</span><span className="text-2xs text-muted tnum shrink-0">{ago(x.updated_at)}</span></Link>; })}</div>}</div>
    <div className="mt-10 flex flex-wrap items-center gap-2 text-xs text-muted">{[["Ctrl 1", "Chat"], ["Ctrl 2", "Work"], ["Ctrl 3", "Code"], ["Ctrl N", "Nouveau"], ["Ctrl K", "Recherche"]].map(([k, l]) => <span key={k} className="inline-flex items-center gap-1.5"><span className="kbd">{k}</span>{l}</span>)}<span className="ml-auto inline-flex items-center gap-1.5"><Command size={12} />Données locales sur votre ordinateur</span></div>
  </div></div>;
}
