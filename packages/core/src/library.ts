import { DB, all, one } from "./db.js";

export type ArtifactKind = "quiz" | "chart" | "diagram" | "page" | "image";
export interface LibraryItem { id: string; messageId: string; conversationId: string; conversationTitle: string; mode: string; kind: ArtifactKind; lang: string; title: string; createdAt: string; size: number }

/** Langages de blocs rendus de façon interactive. Mêmes règles que l'interface : ```html n'est un artefact que pour un document complet, ```svg que s'il contient <svg>. */
const LANGS: Record<string, ArtifactKind> = { quiz: "quiz", qcm: "quiz", choices: "quiz", chart: "chart", mermaid: "diagram", artifact: "page", html: "page", svg: "image" };
const KIND_LABEL: Record<ArtifactKind, string> = { quiz: "QCM", chart: "Graphique", diagram: "Diagramme", page: "Page HTML", image: "Image SVG" };
const FENCE = /(^|\n)(`{3,})([\w-]+)[ \t]*\n([\s\S]*?)\n\2(?=\n|$)/g;

export function isArtifact(lang: string, code: string): boolean {
  if (!LANGS[lang]) return false;
  if (lang === "html") return /^\s*(<!doctype html|<html[\s>])/i.test(code);
  if (lang === "svg") return /<\s*svg\b/i.test(code);
  return code.trim().length > 0;
}
function titleOf(lang: string, code: string): string {
  try {
    if (lang === "quiz" || lang === "qcm") { const j = JSON.parse(code); const qs = Array.isArray(j) ? j : j?.questions; const t = j?.title ?? qs?.[0]?.q ?? qs?.[0]?.question; return `QCM${qs?.length ? ` (${qs.length} question${qs.length > 1 ? "s" : ""})` : ""}${t ? ` : ${String(t).slice(0, 70)}` : ""}`; }
    if (lang === "choices") { const j = JSON.parse(code); return `Choix : ${String(j?.question ?? "").slice(0, 80) || "question"}`; }
    if (lang === "chart") { const j = JSON.parse(code); return `Graphique${j?.title ? ` : ${String(j.title).slice(0, 80)}` : ""}`; }
  } catch { /* JSON invalide : titre générique */ }
  if (lang === "mermaid") return `Diagramme (${code.trim().split("\n")[0]!.trim().slice(0, 30)})`;
  if (lang === "svg") return "Image SVG";
  const m = /<title[^>]*>([^<]{1,80})<\/title>/i.exec(code) ?? /<h1[^>]*>([^<]{1,80})<\/h1>/i.exec(code); return m ? `Page : ${m[1]!.trim()}` : "Page HTML";
}
/** Extrait les blocs enrichis d'un message, dans l'ordre. */
export function extractBlocks(content: string): { index: number; lang: string; code: string }[] {
  const out: { index: number; lang: string; code: string }[] = []; let i = 0; FENCE.lastIndex = 0; let m: RegExpExecArray | null;
  while ((m = FENCE.exec(content))) { const lang = m[3]!.toLowerCase(); const code = m[4]!; if (isArtifact(lang, code)) out.push({ index: i, lang, code }); i++; }
  return out;
}

/** Bibliothèque : tous les artefacts produits dans vos conversations (QCM, graphiques, diagrammes, pages, images), retrouvés dans les messages sans copie ni stockage séparé. */
export class Library {
  constructor(private db: DB) {}
  private rows(kind?: ArtifactKind) {
    const langs = Object.keys(LANGS).filter((l) => !kind || LANGS[l] === kind); const like = langs.map(() => "m.content LIKE ?").join(" OR ");
    return all<any>(this.db, `SELECT m.id, m.content, m.created_at, c.id cid, c.title ctitle, c.mode FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.role='assistant' AND m.status='completed' AND (${like}) ORDER BY m.created_at DESC, m.rowid DESC`, ...langs.map((l) => "%```" + l + "%"));
  }
  list(f: { kind?: ArtifactKind; q?: string; limit?: number } = {}): LibraryItem[] {
    const items: LibraryItem[] = []; const q = (f.q ?? "").trim().toLowerCase(); const limit = Math.min(Math.max(f.limit ?? 120, 1), 500);
    for (const r of this.rows(f.kind)) for (const b of extractBlocks(r.content)) {
      const kind = LANGS[b.lang]!; if (f.kind && kind !== f.kind) continue; const title = titleOf(b.lang, b.code);
      if (q && !(title.toLowerCase().includes(q) || String(r.ctitle).toLowerCase().includes(q) || b.code.toLowerCase().includes(q))) continue;
      items.push({ id: `${r.id}:${b.index}`, messageId: r.id, conversationId: r.cid, conversationTitle: r.ctitle, mode: r.mode, kind, lang: b.lang, title, createdAt: r.created_at, size: b.code.length });
      if (items.length >= limit) return items;
    }
    return items;
  }
  /** Contenu complet d'un artefact (pour l'afficher). */
  get(id: string): LibraryItem & { code: string } {
    const [mid, idx] = String(id).split(":"); const r = one<any>(this.db, "SELECT m.id, m.content, m.created_at, c.id cid, c.title ctitle, c.mode FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.id=?", mid);
    const b = r ? extractBlocks(r.content).find((x) => String(x.index) === idx) : undefined; if (!r || !b) throw new Error("Artefact introuvable (le message a peut-être été supprimé).");
    return { id, messageId: r.id, conversationId: r.cid, conversationTitle: r.ctitle, mode: r.mode, kind: LANGS[b.lang]!, lang: b.lang, title: titleOf(b.lang, b.code), createdAt: r.created_at, size: b.code.length, code: b.code };
  }
  static label(k: ArtifactKind) { return KIND_LABEL[k]; }
}
