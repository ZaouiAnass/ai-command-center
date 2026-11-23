import { DB, uid } from "./db.js";
import { getSetting } from "./settings.js";

export const MAX_ABOUT = 1000; export const MAX_HOWTO = 1000; export const MAX_STYLE_PROMPT = 600; export const MAX_CUSTOM_STYLES = 12;
export interface Style { id: string; name: string; prompt: string; builtin?: boolean }

/** Styles fournis : une consigne d'une ligne chacun (quelques dizaines de tokens). « Par défaut » n'ajoute rien. */
export const BUILTIN_STYLES: Style[] = [
  { id: "concis", name: "Concis", prompt: "Réponds de façon très concise, va droit au but, sans introduction ni conclusion inutiles.", builtin: true },
  { id: "formel", name: "Formel", prompt: "Adopte un ton formel et professionnel, avec vouvoiement et des phrases soignées.", builtin: true },
  { id: "pedagogue", name: "Pédagogue", prompt: "Explique pas à pas avec des exemples simples, comme à quelqu'un qui découvre le sujet.", builtin: true },
  { id: "technique", name: "Technique", prompt: "Sois précis et technique : termes exacts, détails d'implémentation, exemples de code courts.", builtin: true },
  { id: "decontracte", name: "Décontracté", prompt: "Adopte un ton chaleureux et décontracté, avec tutoiement et des phrases courtes.", builtin: true },
];

const clean = (s: unknown, max: number) => String(s ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);

export class Profile {
  constructor(private db: DB, private setSetting: (k: string, v: unknown) => void) {}
  get() { return { about: clean(getSetting(this.db, "profile.about", ""), MAX_ABOUT), howto: clean(getSetting(this.db, "profile.howto", ""), MAX_HOWTO), defaultStyle: getSetting<string>(this.db, "styles.default", "") }; }
  save(p: { about?: string; howto?: string; defaultStyle?: string }) {
    if (p.about !== undefined) this.setSetting("profile.about", clean(p.about, MAX_ABOUT)); if (p.howto !== undefined) this.setSetting("profile.howto", clean(p.howto, MAX_HOWTO));
    if (p.defaultStyle !== undefined) { if (p.defaultStyle && !this.find(p.defaultStyle)) throw new Error("Style inconnu."); this.setSetting("styles.default", p.defaultStyle); }
  }
  custom(): Style[] { const v = getSetting<unknown>(this.db, "styles.custom", []); return Array.isArray(v) ? v.filter((s: any) => s && typeof s.id === "string" && typeof s.name === "string" && typeof s.prompt === "string") : []; }
  list(): Style[] { return [...BUILTIN_STYLES, ...this.custom()]; }
  find(id?: string | null): Style | undefined { return id ? this.list().find((s) => s.id === id) : undefined; }
  /** Enregistre les styles personnalisés (nom unique, longueurs bornées). Les styles fournis ne sont pas modifiables. */
  saveCustom(styles: { id?: string; name: string; prompt: string }[]): Style[] {
    if (!Array.isArray(styles) || styles.length > MAX_CUSTOM_STYLES) throw new Error(`${MAX_CUSTOM_STYLES} styles personnalisés maximum.`);
    const names = new Set(BUILTIN_STYLES.map((s) => s.name.toLowerCase())); const out: Style[] = [];
    for (const s of styles) { const name = clean(s.name, 40), prompt = clean(s.prompt, MAX_STYLE_PROMPT); if (!name || !prompt) throw new Error("Un style a besoin d'un nom et d'une consigne."); if (names.has(name.toLowerCase())) throw new Error(`Le nom « ${name} » est déjà utilisé.`); names.add(name.toLowerCase()); out.push({ id: s.id && /^[\w-]{3,40}$/.test(s.id) ? s.id : "u-" + uid().slice(0, 8), name, prompt }); }
    this.setSetting("styles.custom", out); const d = getSetting<string>(this.db, "styles.default", ""); if (d && !this.find(d)) this.setSetting("styles.default", ""); return out;
  }
  /** Texte ajouté à l'invite système : préférences de l'utilisateur et style de la conversation (celui de la conversation, sinon le style par défaut). Vide si rien n'est renseigné. */
  textFor(convStyle?: string | null): string {
    const p = this.get(); const st = this.find(convStyle || p.defaultStyle || null); const parts: string[] = [];
    if (p.about || p.howto) parts.push("[Préférences de l'utilisateur]" + (p.about ? `\nÀ savoir sur l'utilisateur : ${p.about}` : "") + (p.howto ? `\nManière de répondre souhaitée : ${p.howto}` : ""));
    if (st) parts.push(`[Style de réponse : ${st.name}] ${st.prompt}`);
    return parts.join("\n");
  }
}
