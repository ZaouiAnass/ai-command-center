export interface AccApi { call(method: string, ...args: unknown[]): Promise<any>; onEvent(cb: (e: any) => void): () => void; onTerminal(cb: (e: { id: string; data?: string; end?: number; exit?: { code: number | null } }) => void): () => void }
declare global { interface Window { acc: AccApi } }
export const api = (m: string, ...a: unknown[]) => window.acc.call(m, ...a);
export const fmt = (n: number | null | undefined) => n == null ? "—" : new Intl.NumberFormat("fr-FR").format(Math.round(n));
export const usd = (n: number | null | undefined) => n == null ? "Prix non disponible" : "≈ $" + (n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2));
export const dur = (ms?: number | null) => ms == null ? "—" : ms < 1000 ? ms + " ms" : ms < 60000 ? (ms / 1000).toFixed(1) + " s" : Math.floor(ms / 60000) + " min " + Math.round((ms % 60000) / 1000) + " s";
export const ago = (iso?: string | null) => { if (!iso) return "—"; const s = (Date.now() - new Date(iso).getTime()) / 1000; return s < 60 ? "à l'instant" : s < 3600 ? Math.floor(s / 60) + " min" : s < 86400 ? Math.floor(s / 3600) + " h" : Math.floor(s / 86400) + " j"; };
