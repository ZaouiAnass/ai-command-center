import { useState } from "react";
import { Link } from "react-router-dom";
import { Search, ListChecks, BarChart3, GitBranch, Code2, Image as ImageIcon, Library as LibIcon, Copy, Check, MessageSquare, ArrowUpRight } from "lucide-react";
import { api, ago } from "../api"; import { useData } from "../hooks"; import { useT } from "../i18n"; import { toast } from "../overlay";
import { Page, Card, EmptyState, ErrorState, LoadingSkeleton, Modal, Tabs } from "../ui"; import { richBlock, RichScope } from "../components/RichBlocks";

type Kind = "" | "quiz" | "chart" | "diagram" | "page" | "image";
const KINDS: [Kind, string][] = [["", "Tout"], ["quiz", "QCM et choix"], ["chart", "Graphiques"], ["diagram", "Diagrammes"], ["page", "Pages"], ["image", "Images"]];
const ICON: Record<string, any> = { quiz: ListChecks, chart: BarChart3, diagram: GitBranch, page: Code2, image: ImageIcon };
const KLABEL: Record<string, string> = { quiz: "QCM", chart: "Graphique", diagram: "Diagramme", page: "Page HTML", image: "Image SVG" };
const MODE: Record<string, string> = { chat: "Chat", work: "Work", code: "Code" };
const openHash = (mode: string, id: string) => (mode === "work" ? "/work" : `/${mode}?open=${id}`);

/** Bibliothèque : tout ce que vos conversations ont produit d'interactif, retrouvable sans rouvrir chaque échange. Les aperçus ne sont chargés qu'à l'ouverture. */
export default function Library() {
  const t = useT(); const [kind, setKind] = useState<Kind>(""); const [q, setQ] = useState(""); const [openId, setOpenId] = useState<string | null>(null); const [ok, setOk] = useState(false);
  const { data: items, err, loading, reload } = useData<any[]>("lib.list", [{ kind: kind || undefined, q: q || undefined }], { events: /conversation/ });
  const { data: cur, err: curErr } = useData<any>("lib.get", [openId ?? ""], { enabled: !!openId });
  const copy = () => { if (!cur) return; void navigator.clipboard?.writeText(cur.code); setOk(true); setTimeout(() => setOk(false), 1500); };
  return <Page title={t("nav.library")} sub="Vos QCM, graphiques, diagrammes, pages et images, retrouvés dans toutes les conversations.">
    <div className="flex flex-wrap items-center gap-3 mb-5"><Tabs tabs={KINDS} value={kind} onChange={(k: Kind) => setKind(k)} />
      <div className="relative ml-auto"><Search size={14} className="absolute left-3 top-2.5 text-muted" /><input className="input !pl-9 !w-64" aria-label="Rechercher dans la bibliothèque" placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
    {err && !items ? <ErrorState message={err} onRetry={reload} /> : loading && !items ? <LoadingSkeleton cards={6} rows={0} />
      : !items?.length ? <Card><EmptyState icon={LibIcon} title={q || kind ? "Aucun résultat" : "Rien dans la bibliothèque pour l'instant"} desc={q || kind ? "Essayez un autre type ou un autre mot." : "Demandez par exemple « fais-moi un QCM sur… », « trace un graphique de… » ou « fais un schéma de… » dans un chat : le résultat apparaîtra ici."} /></Card>
      : <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 [&>*]:min-w-0">{items.map((it) => { const I = ICON[it.kind] ?? Code2; return <button key={it.id} onClick={() => setOpenId(it.id)} className="card lift text-left p-4 flex flex-col cursor-pointer group">
        <div className="flex items-center gap-2 text-2xs text-muted mb-2"><span className="w-7 h-7 rounded-lg bg-accent-subtle text-accent grid place-items-center shrink-0"><I size={14} /></span><span className="font-medium text-fg2">{KLABEL[it.kind]}</span><span className="ml-auto tnum">{ago(it.createdAt)}</span></div>
        <div className="text-[14px] font-medium leading-snug line-clamp-2 min-h-[40px]">{it.title}</div>
        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted min-w-0"><MessageSquare size={12} className="shrink-0" /><span className="truncate">{it.conversationTitle}</span><span className="shrink-0 border border-line rounded px-1.5">{MODE[it.mode] ?? it.mode}</span></div></button>; })}</div>}
    <Modal open={!!openId} onClose={() => setOpenId(null)} width="max-w-4xl" title={cur?.title ?? "Artefact"} footer={cur ? <><span className="mr-auto text-xs text-muted truncate">Dans « {cur.conversationTitle} »</span><button className="btn" onClick={copy}>{ok ? <Check size={14} /> : <Copy size={14} />}{ok ? "Copié" : "Copier le code"}</button><Link className="btn btn-primary" to={openHash(cur.mode, cur.conversationId)} onClick={() => setOpenId(null)}>Ouvrir la conversation<ArrowUpRight size={14} /></Link></> : undefined}>
      {curErr ? <p role="alert" className="text-danger text-[13px]">{curErr}</p> : !cur ? <LoadingSkeleton cards={1} rows={0} /> : <RichScope.Provider value={{ scope: cur.messageId, streaming: false }}><div className="-my-2">{richBlock(cur.lang, cur.code) ?? <pre className="bg-bg border border-line rounded-xl p-4 overflow-auto text-[12.5px]">{cur.code}</pre>}</div></RichScope.Provider>}</Modal></Page>;
}
