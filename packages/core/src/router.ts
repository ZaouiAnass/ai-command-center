import { DB, all, one } from "./db.js";
import type { ProviderId, ProviderStatus, QuotaStatus } from "./types.js";

export interface ProviderAdvice { provider: ProviderId; available: boolean; reason?: string; state: string; maxUsedPercent: number | null; resetsAt?: string; limited: boolean; successRate: number | null; runs: number }
export interface RouterAdvice { providers: Record<ProviderId, ProviderAdvice>; recommended: ProviderId | null; message?: string }

/** Routeur de fournisseur : recommande, ne contourne jamais une limite et ne change jamais de fournisseur silencieusement. */
export async function routerAdvice(db: DB, statusOf: (p: ProviderId) => Promise<ProviderStatus>, quotaOf: (p: ProviderId) => Promise<QuotaStatus>, preferred?: ProviderId): Promise<RouterAdvice> {
  const providers = {} as Record<ProviderId, ProviderAdvice>;
  for (const p of ["claude", "codex"] as ProviderId[]) {
    const st = await statusOf(p).catch(() => undefined); const q = await quotaOf(p).catch(() => undefined);
    const pct = q?.windows?.length ? Math.max(...q.windows.map((w) => w.usedPercent ?? 0)) : null; const soon = q?.windows?.filter((w) => (w.usedPercent ?? 0) >= 90 && w.resetsAt).map((w) => w.resetsAt!).sort()[0];
    const s = one<any>(db, "SELECT COUNT(*) n, SUM(status='completed') ok FROM (SELECT status FROM agent_executions WHERE provider=? AND status IN ('completed','failed') ORDER BY created_at DESC LIMIT 30)", p);
    const available = !!st?.installed && !!st.authenticated && (st.authMode === "subscription" || false);
    const limited = q?.state === "exhausted" || q?.state === "limited" || (pct ?? 0) >= 90;
    providers[p] = { provider: p, available, reason: !st?.installed ? "non installé" : !st.authenticated ? "connexion requise" : st.authMode !== "subscription" ? "mode d'authentification non vérifié comme abonnement" : undefined, state: q?.state ?? "unknown", maxUsedPercent: pct, resetsAt: soon, limited, successRate: s?.n ? Math.round((s.ok / s.n) * 100) : null, runs: s?.n ?? 0 };
  }
  const ok = (["claude", "codex"] as ProviderId[]).filter((p) => providers[p].available && !providers[p].limited);
  const recommended = preferred && ok.includes(preferred) ? preferred : ok[0] ?? null;
  let message: string | undefined;
  if (preferred && providers[preferred].limited) { const other: ProviderId = preferred === "claude" ? "codex" : "claude"; message = providers[other].available && !providers[other].limited ? `${preferred === "claude" ? "Claude" : "Codex"} approche ou a atteint sa limite d'abonnement${providers[preferred].resetsAt ? ` (réinitialisation ${new Date(providers[preferred].resetsAt!).toLocaleString("fr-FR")})` : ""}. Vous pouvez basculer sur ${other === "claude" ? "Claude" : "Codex"}.` : `${preferred} est limité et l'autre fournisseur n'est pas disponible : attendez la réinitialisation de la fenêtre.`; }
  return { providers, recommended, message };
}
export { all };
