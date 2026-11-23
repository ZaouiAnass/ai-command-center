import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, XCircle, FileText } from "lucide-react";
import { api, fmt } from "../api"; import { toast } from "../overlay"; import { Modal } from "../ui";
import type { Attach } from "./Composer";

const errMsg = (e: any) => String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
const baseName = (p: string) => p.split(String.fromCharCode(92)).join("/").split("/").pop() ?? p;

/** Fenêtre d'installation du convertisseur Microsoft MarkItDown : confirmation explicite, progression en direct, résultat. */
export function ConverterSetupModal({ names, onDone }: { names: string[]; onDone: (ok: boolean) => void }) {
  const [phase, setPhase] = useState<"ask" | "run" | "ok" | "fail">("ask"); const [lines, setLines] = useState<string[]>([]); const [err, setErr] = useState(""); const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (phase !== "run") return; return window.acc.onEvent((e: any) => { if (e.type === "convert.progress") setLines((l) => [...l.slice(-60), String(e.payload?.line ?? "")]); }); }, [phase]);
  useEffect(() => { box.current?.scrollTo({ top: 1e6 }); }, [lines]);
  const start = async () => { setPhase("run"); setLines([]); try { const s = await api("doc.install"); if (s.installed) { setPhase("ok"); setTimeout(() => onDone(true), 700); } else { setErr(s.error ?? "Installation échouée."); setPhase("fail"); } } catch (e: any) { setErr(errMsg(e)); setPhase("fail"); } };
  return <Modal open onClose={() => phase !== "run" && onDone(false)} title="Convertir vos documents en Markdown" footer={phase === "ask" ? <><button className="btn" onClick={() => onDone(false)}>Annuler</button><button className="btn btn-primary" onClick={start}>Installer le convertisseur</button></> : phase === "fail" ? <><button className="btn" onClick={() => onDone(false)}>Fermer</button><button className="btn btn-primary" onClick={start}>Réessayer</button></> : undefined}>
    <div className="flex items-start gap-3 mb-4"><span className="w-10 h-10 rounded-xl bg-accent-subtle text-accent grid place-items-center shrink-0"><FileText size={20} /></span>
      <p className="text-[13px] text-fg2">{names.length === 0 ? <>Les documents (PDF, Word, PowerPoint, Excel…) seront convertis</> : names.length === 1 ? <>« <b>{names[0]}</b> » doit être converti</> : <>{names.length} documents doivent être convertis</>} en Markdown avant l'envoi : c'est <b>beaucoup moins coûteux en tokens</b> que le fichier brut. L'application utilise pour cela <b>MarkItDown</b>, l'outil open source de Microsoft.</p></div>
    {phase === "ask" && <ul className="text-xs text-muted space-y-1.5 list-disc pl-5"><li>Installation <b>unique</b>, dans un environnement Python <b>isolé</b> du dossier de données de l'application : rien n'est modifié sur le reste de l'ordinateur.</li><li>Nécessite <b>Python 3.10 ou plus récent</b> et une connexion Internet (téléchargement de quelques centaines de Mo).</li><li>La conversion se fait ensuite <b>localement</b> : vos documents ne quittent pas votre ordinateur avant l'envoi au modèle.</li></ul>}
    {phase === "run" && <><div className="flex items-center gap-2 text-[13px] mb-2"><Loader2 size={15} className="animate-spin text-accent" />Installation en cours… (1 à 3 minutes)</div><div ref={box} className="mono text-2xs text-muted bg-bg border border-line rounded-lg p-2.5 h-36 overflow-auto whitespace-pre-wrap break-all" aria-live="polite">{lines.length ? lines.join("\n") : "Démarrage…"}</div></>}
    {phase === "ok" && <div className="flex items-center gap-2 text-success text-[13px]"><CheckCircle2 size={16} />Convertisseur installé.</div>}
    {phase === "fail" && <div role="alert" className="flex items-start gap-2 text-danger text-[13px]"><XCircle size={16} className="mt-0.5 shrink-0" /><span>{err}</span></div>}
  </Modal>;
}

/**
 * Ajout de pièces jointes : sélecteur ou glisser-déposer → texte lu tel quel, documents (PDF, Word, PowerPoint, Excel, HTML, EPUB) convertis en Markdown.
 * `element` (la fenêtre d'installation du convertisseur) doit être rendu une fois par la page.
 */
export function useAttachFlow(setAttach: (f: (a: Attach[]) => Attach[]) => void) {
  const [setup, setSetup] = useState<{ names: string[]; resolve: (ok: boolean) => void } | null>(null);
  const ensure = (names: string[]) => new Promise<boolean>((resolve) => setSetup({ names, resolve }));
  const load = async (paths: string[]) => {
    try {
      let res = await api("doc.load", paths);
      if (res.needsConverter.length) {
        const ok = await ensure(res.needsConverter.map(baseName));
        if (ok) { const again = await api("doc.load", res.needsConverter); res = { files: [...res.files, ...again.files], skipped: [...res.skipped, ...again.skipped], needsConverter: [] }; }
        else res.skipped.push(...res.needsConverter.map((p: string) => ({ name: baseName(p), reason: "Convertisseur non installé : document non ajouté." })));
      }
      if (res.files.length) { setAttach((a) => [...a, ...res.files.map((f: any) => ({ name: f.name, content: f.content, meta: f.meta }))].slice(0, 5));
        const conv = res.files.filter((f: any) => f.meta.kind === "converted"); if (conv.length) toast(`${conv.length === 1 ? "Document converti" : conv.length + " documents convertis"} en Markdown (≈ ${fmt(conv.reduce((s: number, f: any) => s + f.meta.tokens, 0))} tokens).`, "success"); }
      for (const s of res.skipped) toast(`${s.name} : ${s.reason}`, "error");
    } catch (e: any) { toast(errMsg(e), "error"); }
  };
  const add = async () => { try { const paths = await api("doc.pick"); if (paths?.length) await load(paths); } catch (e: any) { toast(errMsg(e), "error"); } };
  /** Dépôt de fichiers : les chemins viennent du glisser-déposer authentique (enregistré par le preload). Les images vont dans `onImages`. */
  const drop = async (files: File[], onImages?: (paths: string[]) => void) => {
    const paths = files.map((f) => window.acc.pathForFile(f)).filter(Boolean); const isImg = (p: string) => /\.(png|jpe?g|gif|webp)$/i.test(p);
    const imgs = paths.filter(isImg), docs = paths.filter((p) => !isImg(p)); if (imgs.length) onImages?.(imgs); if (docs.length) { await new Promise((r) => setTimeout(r, 60)); await load(docs); }
  };
  const element = setup ? <ConverterSetupModal names={setup.names} onDone={(ok) => { setup.resolve(ok); setSetup(null); }} /> : null;
  return { add, drop, element };
}
