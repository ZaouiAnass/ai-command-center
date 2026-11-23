import { Gauge, ArrowRightLeft } from "lucide-react";
import { useData } from "../hooks"; import { PROVIDER_LABEL, ProviderId } from "./AIModelConfiguration";

/**
 * Alerte de limite d'abonnement : le fournisseur approche ou atteint sa fenêtre de quota.
 * La limite n'est jamais contournée ; on propose seulement de basculer vers l'autre fournisseur (action explicite de l'utilisateur).
 */
export function LimitBanner({ provider, onSwitch }: { provider: ProviderId; onSwitch?: (p: ProviderId) => void }) {
  const { data } = useData<any>("router.advice", [provider], { every: 90_000 });
  const me = data?.providers?.[provider]; if (!me?.limited) return null;
  const other: ProviderId = provider === "claude" ? "codex" : "claude"; const can = data.providers[other].available && !data.providers[other].limited;
  return <div role="status" className="flex items-center gap-3 text-[13px] bg-[var(--warning-subtle)] text-warning rounded-xl px-4 py-2.5 mb-3"><Gauge size={16} className="shrink-0" /><span className="flex-1">{data.message ?? `${PROVIDER_LABEL[provider]} approche de sa limite d'abonnement.`}{me.maxUsedPercent != null && <span className="text-xs text-muted ml-2 tnum">({me.maxUsedPercent} % utilisé)</span>}</span>
    {can && onSwitch && <button className="btn btn-sm shrink-0" onClick={() => onSwitch(other)}><ArrowRightLeft size={13} />Utiliser {PROVIDER_LABEL[other]}</button>}</div>;
}
