import { DB, all, one, run, uid, now, tx } from "./db.js";
import type { Tokens, ProviderId } from "./types.js";

export const PRICING_VERSION_LABEL = "official-2026-11-22";
export const CLAUDE_URL = "https://platform.claude.com/docs/en/about-claude/pricing";
export const OPENAI_URL = "https://developers.openai.com/api/docs/pricing";
export const DISCLAIMER = "Équivalent estimé au tarif API — non facturé en plus de votre abonnement.";

interface Seed { provider: ProviderId; id: string; aliases?: string[]; family: string; inp: number; out: number; cr?: number; cw?: number; cw1h?: number; longAt?: number; lin?: number; lout?: number; lcr?: number; lcw?: number; note?: string }
const slug = (n: string) => "claude-" + n.toLowerCase().replace(/\./g, "-").replace(/\s+/g, "-");
// [name, input, 5m write, 1h write, cache hit, output]  — Claude page, verified 2026-11-22
const CLAUDE: [string, number, number, number, number, number][] = [
  ["fable 5.2", 8, 10, 16, 0.2, 40], ["mythos 5.2", 8, 10, 16, 0.2, 40], ["fable 5.1", 10, 12.5, 20, 0.25, 50], ["mythos 5.1", 10, 12.5, 20, 0.25, 50],
  ["fable 5", 10, 12.5, 20, 1, 50], ["mythos 5", 10, 12.5, 20, 1, 50],
  ["opus 5.5", 4, 5, 8, 0.2, 20], ["opus 5", 5, 6.25, 10, 0.5, 25], ["opus 4.8", 5, 6.25, 10, 0.5, 25], ["opus 4.7", 5, 6.25, 10, 0.5, 25],
  ["opus 4.6", 5, 6.25, 10, 0.5, 25], ["opus 4.5", 5, 6.25, 10, 0.5, 25], ["opus 4.1", 15, 18.75, 30, 1.5, 75], ["opus 4", 15, 18.75, 30, 1.5, 75],
  ["sonnet 5.5", 2, 2.5, 4, 0.1, 10], ["sonnet 5", 2, 2.5, 4, 0.2, 10], ["sonnet 4.6", 3, 3.75, 6, 0.3, 15], ["sonnet 4.5", 3, 3.75, 6, 0.3, 15], ["sonnet 4", 3, 3.75, 6, 0.3, 15],
  ["haiku 4.5", 1, 1.25, 2, 0.1, 5],
];
// [id, in, out, cached, 30m write, long in, long out, long cached]  — OpenAI page
const OAI: [string, number, number, number, number | undefined, number | undefined, number | undefined, number | undefined][] = [
  ["gpt-6.2-astra", 8, 40, 0.4, 10, 16, 60, 0.8], ["gpt-6.2-sol", 2, 10, 0.1, 2.5, 4, 15, 0.2], ["gpt-6-astra", 10, 50, 1, 12.5, 20, 75, 2],
  ["gpt-6.1-sol", 2, 10, 0.1, 2.5, 4, 15, 0.2], ["gpt-6.1-terra", 1, 5, 0.05, 1.25, 2, 7.5, 0.1], ["gpt-6-luna", 0.1, 0.5, 0.01, 0.125, 0.2, 0.75, 0.02],
  ["gpt-6-sol", 2, 10, 0.2, 2.5, 4, 15, 0.4], ["gpt-5.6-sol", 4, 20, 0.4, 5, 8, 30, 0.8], ["gpt-5.6-terra", 2, 12, 0.2, 2.5, 4, 18, 0.4],
  ["gpt-5.6-luna", 0.2, 1.2, 0.02, 0.25, 0.4, 1.8, 0.04], ["gpt-5.5", 5, 30, 0.5, undefined, 10, 45, 1], ["gpt-5.4", 2.5, 15, 0.25, undefined, 5, 22.5, 0.5],
  ["gpt-5.4-mini", 0.75, 4.5, 0.075, undefined, undefined, undefined, undefined], ["gpt-5.4-nano", 0.2, 1.25, 0.02, undefined, undefined, undefined, undefined],
  ["gpt-5.3-codex", 1.75, 14, 0.175, undefined, undefined, undefined, undefined], ["gpt-5.2", 1.75, 14, 0.175, undefined, undefined, undefined, undefined],
  ["gpt-5.1", 1.25, 10, 0.125, undefined, undefined, undefined, undefined], ["gpt-5", 1.25, 10, 0.125, undefined, undefined, undefined, undefined],
  ["gpt-5-mini", 0.25, 2, 0.025, undefined, undefined, undefined, undefined],
];
export function builtinSeeds(): Seed[] {
  const s: Seed[] = CLAUDE.map(([n, i, w5, w1, cr, o]) => ({ provider: "claude", id: slug("claude " + n).replace("claude-claude-", "claude-"), family: n.split(" ")[0]!, inp: i, out: o, cr, cw: w5, cw1h: w1 }));
  s.push({ provider: "claude", id: "claude-haiku-5-5", family: "haiku", inp: 0.1, out: 0.5, cr: 0.01, cw: 0.125, cw1h: 0.2, longAt: 100_000, lin: 0.5, lout: 2.5, lcr: 0.05, lcw: 0.625, note: "Tier long contexte > 100k tokens de prompt" });
  for (const [id, i, o, c, w, li, lo, lc] of OAI) s.push({ provider: "codex", id, family: id.split("-").slice(0, 2).join("-"), inp: i, out: o, cr: c, cw: w, longAt: li ? 272_000 : undefined, lin: li, lout: lo, lcr: lc });
  return s;
}
export function seedPricing(db: DB) {
  if (one(db, "SELECT 1 x FROM pricing_versions WHERE label=?", PRICING_VERSION_LABEL)) return;
  tx(db, () => {
    const vid = uid();
    run(db, "INSERT INTO pricing_versions VALUES (?,?,?,?,?)", vid, PRICING_VERSION_LABEL, `${CLAUDE_URL} ; ${OPENAI_URL}`, "2026-11-22", now());
    for (const s of builtinSeeds())
      run(db, `INSERT INTO model_pricing (id,version_id,provider,model_id,aliases,family,input_per_m,output_per_m,cache_read_per_m,cache_write_per_m,cache_write_1h_per_m,long_ctx_threshold,long_input_per_m,long_output_per_m,long_cache_read_per_m,long_cache_write_per_m,source_url,note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        uid(), vid, s.provider, s.id, JSON.stringify(s.aliases ?? []), s.family, s.inp, s.out, s.cr ?? null, s.cw ?? null, s.cw1h ?? null, s.longAt ?? null, s.lin ?? null, s.lout ?? null, s.lcr ?? null, s.lcw ?? null, s.provider === "claude" ? CLAUDE_URL : OPENAI_URL, s.note ?? null);
  });
}
export const normalizeModelId = (m: string) => m.toLowerCase().replace(/\[.*\]$/, "").replace(/-\d{8}$/, "").trim();

export interface CostResult { usd: number | null; status: "calculated" | "price_unavailable" | "partial"; pricingId?: string; pricingVersion?: string; detail: string }
/** Équivalent API théorique. `tokens.input` = tokens d'entrée NON cachés ; cacheRead/cacheWrite sont des catégories séparées. */
export function calculateCost(db: DB, provider: ProviderId, model: string | undefined, t: Tokens): CostResult {
  if (!model) return { usd: null, status: "price_unavailable", detail: "Modèle inconnu" };
  const id = normalizeModelId(model);
  const row = one<any>(db, `SELECT mp.*, pv.label vlabel FROM model_pricing mp JOIN pricing_versions pv ON pv.id=mp.version_id WHERE mp.provider=? AND mp.model_id=? ORDER BY pv.created_at DESC LIMIT 1`, provider, id);
  if (!row) return { usd: null, status: "price_unavailable", detail: "Prix non disponible" };
  const M = 1e6; const notes: string[] = [];
  let usd = (t.input * row.input_per_m + t.output * row.output_per_m) / M;
  let partial = false;
  if (t.cacheRead) { if (row.cache_read_per_m == null) { partial = true; notes.push("tarif cache lecture inconnu"); } else usd += t.cacheRead * row.cache_read_per_m / M; }
  if (t.cacheWrite) {
    const w1 = Math.min(t.cacheWrite1h ?? 0, t.cacheWrite), w5 = t.cacheWrite - w1;
    if (w5 && row.cache_write_per_m == null) { partial = true; notes.push("tarif cache écriture inconnu"); } else usd += w5 * (row.cache_write_per_m ?? 0) / M;
    if (w1) { if (row.cache_write_1h_per_m == null) { partial = true; notes.push("tarif cache écriture 1h inconnu"); } else usd += w1 * row.cache_write_1h_per_m / M; }
  }
  if (row.long_ctx_threshold) notes.push(`tier long contexte (> ${row.long_ctx_threshold} tokens/requête) non évalué : taille par requête inconnue`);
  return { usd, status: partial ? "partial" : "calculated", pricingId: row.id, pricingVersion: row.vlabel, detail: notes.join("; ") };
}
export const listPricing = (db: DB) => all(db, `SELECT mp.*, pv.label version FROM model_pricing mp JOIN pricing_versions pv ON pv.id=mp.version_id ORDER BY mp.provider, mp.model_id`);
