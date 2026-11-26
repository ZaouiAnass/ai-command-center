import { DB, one, run, uid, now, tx } from "./db.js";
import { calculateCost } from "./pricing.js";
import type { UsageReport, ProviderId, Tokens } from "./types.js";
import { zeroTokens } from "./types.js";

export interface UsageCtx { executionId: string; provider: ProviderId; taskId?: string | null; agentId?: string | null; projectId?: string | null }
export interface RecordedUsage { eventId: string; delta: Tokens; usd: number | null; duplicate: boolean; note?: string; confidence: string }

const sub = (a: Tokens, b: Tokens): Tokens => ({ input: a.input - b.input, output: a.output - b.output, cacheRead: a.cacheRead - b.cacheRead, cacheWrite: a.cacheWrite - b.cacheWrite, reasoning: a.reasoning - b.reasoning, total: a.total - b.total, cacheWrite1h: (a.cacheWrite1h ?? 0) - (b.cacheWrite1h ?? 0) });
const neg = (t: Tokens) => t.input < 0 || t.output < 0 || t.cacheRead < 0 || t.cacheWrite < 0 || t.total < 0;

/** Convertit incrémental / cumulatif / final en deltas imputables, sans double comptage (clé d'idempotence unique). */
export class UsageNormalizer {
  constructor(private db: DB) {}
  record(ctx: UsageCtx, r: UsageReport): RecordedUsage {
    const idem = `${ctx.provider}:${r.counterKey}:${r.eventKey}`;
    return tx(this.db, () => {
      if (one(this.db, "SELECT 1 x FROM usage_events WHERE idem_key=?", idem)) return { eventId: "", delta: zeroTokens(), usd: null, duplicate: true, confidence: r.confidence };
      let delta = r.tokens; let note: string | undefined; let confidence: string = r.confidence;
      if (r.mode === "cumulative") {
        const snap = one<any>(this.db, "SELECT * FROM usage_snapshots WHERE counter_key=?", r.counterKey);
        let prev: Tokens;
        if (!snap && r.fresh) { prev = zeroTokens(); confidence = "calculated"; }
        else if (snap) prev = { input: snap.input, output: snap.output, cacheRead: snap.cache_read, cacheWrite: snap.cache_write, reasoning: snap.reasoning, total: snap.total };
        else if (r.lastStep) { prev = sub(r.tokens, r.lastStep); note = "Session reprise : base déduite (total - dernier pas) ; fiable pour le premier appel modèle."; confidence = "calculated"; }
        else { prev = r.tokens; delta = zeroTokens(); note = "Base historique inconnue : aucune consommation imputée (incertain)."; confidence = "unknown"; }
        if (snap || r.lastStep || r.fresh) {
          delta = sub(r.tokens, prev);
          if (neg(delta)) { delta = zeroTokens(); note = "Compteur cumulatif en recul (reset) : delta ignoré, incertain."; confidence = "unknown"; }
          else if (confidence === "reported") confidence = "calculated";
        }
        run(this.db, `INSERT INTO usage_snapshots VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(counter_key) DO UPDATE SET input=excluded.input,output=excluded.output,cache_read=excluded.cache_read,cache_write=excluded.cache_write,reasoning=excluded.reasoning,total=excluded.total,updated_at=excluded.updated_at`,
          r.counterKey, ctx.executionId, r.tokens.input, r.tokens.output, r.tokens.cacheRead, r.tokens.cacheWrite, r.tokens.reasoning, r.tokens.total, null, now());
      }
      const id = uid();
      run(this.db, `INSERT INTO usage_events (id,idem_key,execution_id,provider,model,task_id,agent_id,project_id,input,output,cache_read,cache_write,cache_write_1h,reasoning,total,confidence,source,note,provider_cost_usd,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, idem, ctx.executionId, ctx.provider, r.model, ctx.taskId ?? null, ctx.agentId ?? null, ctx.projectId ?? null, delta.input, delta.output, delta.cacheRead, delta.cacheWrite, delta.cacheWrite1h ?? 0, delta.reasoning, delta.total, confidence, `${ctx.provider}:${r.mode}`, note ?? null, r.providerCostUsd ?? null, now());
      const hasTokens = delta.total > 0;
      // Modèles open source : pas de grille tarifaire de référence. Local = 0 $ réel ; hébergé = coût rapporté par le fournisseur s'il le donne (OpenRouter), sinon inconnu.
      const c = !hasTokens ? { usd: 0, status: "calculated" as const, detail: "aucun token imputé" }
        : ctx.provider === "open" ? (r.providerCostUsd != null ? { usd: r.providerCostUsd, status: "calculated" as const, detail: r.providerCostUsd === 0 ? "modèle local : gratuit" : "coût réel rapporté par le fournisseur (facturé)" } : { usd: null, status: "price_unavailable" as const, detail: "Prix non rapporté par ce fournisseur hébergé" })
        : calculateCost(this.db, ctx.provider, r.model, delta);
      run(this.db, "INSERT INTO cost_estimates VALUES (?,?,?,?,?,?,?)", id, (c as any).pricingId ?? null, (c as any).pricingVersion ?? null, c.usd, c.status, c.detail, now());
      return { eventId: id, delta, usd: c.usd, duplicate: false, note, confidence };
    });
  }
}
