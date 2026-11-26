import { DB, all } from "./db.js";
import { getSetting } from "./settings.js";
import type { AgentProviderAdapter } from "./providers/common.js";
import { subscriptionBlocked, providerName } from "./providers/common.js";
import type { EffortOption, ModelInfo, ProviderId, ProviderStatus } from "./types.js";

export interface ProviderCatalog {
  provider: ProviderId; available: boolean; reason?: string; authMode?: string;
  models: ModelInfo[]; fetchedAt: string;
  /** Efforts connus pour le modèle par défaut du fournisseur (utile quand aucun modèle n'est choisi). */
  defaultEfforts?: EffortOption[];
  notes: string[];
}
export interface ConfigCheck { ok: boolean; error?: string; effortApplied: string | null; effortSource: "requested" | "provider_default" | "not_configurable" }

/** Catalogue dynamique : modèles et efforts viennent des interfaces officielles des CLI, jamais d'une liste codée en dur. */
export class AICatalog {
  private cache = new Map<ProviderId, { at: number; c: ProviderCatalog }>();
  constructor(private db: DB, private adapters: Record<ProviderId, AgentProviderAdapter>, private statusOf: (p: ProviderId) => Promise<ProviderStatus>) {}

  async get(provider: ProviderId, force = false): Promise<ProviderCatalog> {
    const hit = this.cache.get(provider); if (!force && hit && Date.now() - hit.at < 5 * 60_000) return hit.c;
    const st = await this.statusOf(provider); const exclusive = !!getSetting(this.db, "billing.exclusive", true);
    const base: ProviderCatalog = { provider, available: true, authMode: st.authMode, models: [], fetchedAt: new Date().toISOString(), notes: [] };
    if (!st.installed) { base.available = false; base.reason = provider === "open" ? "Aucun point d'accès configuré : ajoutez Ollama, LM Studio ou un service hébergé dans Paramètres › Modèles open source." : `${providerName(provider)} n'est pas détecté sur cet ordinateur. Vérifiez son installation.`; }
    else if (!st.authenticated) { base.available = false; base.reason = provider === "open" ? (st.blockedReason ?? "Aucun point d'accès joignable : le serveur de modèles est-il démarré ?") : "Authentification requise : connectez-vous avec le CLI officiel."; }
    else if (subscriptionBlocked(st, exclusive)) { base.available = false; base.reason = `Mode abonnement exclusif : authentification « ${st.authMode} » non vérifiée comme abonnement.`; }
    if (base.available) {
      let models = await this.adapters[provider].getSupportedModels().catch(() => [] as ModelInfo[]);
      if (provider === "claude") {
        const known = new Set(models.map((m) => m.id)); const eff = models.find((m) => m.efforts)?.efforts;
        for (const r of all<{ model: string }>(this.db, "SELECT DISTINCT model FROM usage_events WHERE provider='claude' AND model IS NOT NULL")) if (r.model && !known.has(r.model)) models.push({ id: r.model, displayName: r.model, source: "observed", efforts: eff, description: "Modèle déjà utilisé avec votre compte (observé)." });
        base.notes.push("Claude Code n'expose pas la liste des modèles de votre compte : alias officiels du CLI et modèles déjà observés. Un niveau d'effort refusé par un modèle est signalé par le CLI.");
      }
      if (provider === "open") { base.notes.push("Modèles listés par vos points d'accès. Local = gratuit ; hébergé = facturé à l'usage par ce fournisseur. Outils fichiers (lecture/écriture dans le dossier de travail) en Work et Code, sans commandes système."); for (const w of st.warnings) base.notes.push(w); }
      if (!models.length) base.notes.push("Aucun modèle n'a pu être lu auprès du fournisseur : le modèle par défaut du CLI sera utilisé.");
      base.models = models; base.defaultEfforts = (models.find((m) => m.isDefault) ?? models[0])?.efforts;
    }
    this.cache.set(provider, { at: Date.now(), c: base }); return base;
  }

  /** Valide un triplet fournisseur/modèle/effort : une valeur non exposée par le fournisseur n'est jamais envoyée. */
  async validate(provider: ProviderId, model?: string | null, effort?: string | null): Promise<ConfigCheck> {
    const cat = await this.get(provider);
    if (!cat.available) return { ok: false, error: cat.reason, effortApplied: null, effortSource: "not_configurable" };
    const m = model ? cat.models.find((x) => x.id === model) : cat.models.find((x) => x.isDefault) ?? cat.models.find((x) => x.id === "");
    if (model && !m) return { ok: false, error: `Le modèle « ${model} » n'est pas disponible pour ce compte (indisponible, retiré ou inconnu).`, effortApplied: null, effortSource: "not_configurable" };
    const efforts = m?.efforts ?? (model ? undefined : cat.defaultEfforts);
    if (!effort) return { ok: true, effortApplied: m?.defaultEffort ?? null, effortSource: m?.defaultEffort ? "provider_default" : efforts ? "provider_default" : "not_configurable" };
    if (!efforts?.length) return { ok: false, error: "Ce modèle n'expose pas de réglage d'effort : il est géré par le fournisseur.", effortApplied: null, effortSource: "not_configurable" };
    if (!efforts.some((e) => e.value === effort)) return { ok: false, error: `Effort « ${effort} » non pris en charge par ce modèle (valeurs : ${efforts.map((e) => e.value).join(", ")}).`, effortApplied: null, effortSource: "not_configurable" };
    return { ok: true, effortApplied: effort, effortSource: "requested" };
  }
  invalidate() { this.cache.clear(); }
}
