import type { ProviderId } from "./types.js";
export type ExperienceMode = "chat" | "work" | "code";
export type CodeSubmode = "direct" | "multi_agent";
export const EXPERIENCE_MODES: ExperienceMode[] = ["chat", "work", "code"];
export interface ModePolicy {
  mode: ExperienceMode; label: string; requiresProject: boolean; allowAgents: boolean;
  /** Outils autorisés : aucun (chat), dossier de travail isolé (work), projet complet (code). */
  tools: "none" | "workdir" | "project"; cwd: "sandbox" | "work" | "project";
  claude: { toolsFlag?: string; permissionMode: "default" | "acceptEdits" | "plan" };
  codex: { sandbox: "read-only" | "workspace-write"; approvalPolicy: "never" | "on-request" };
  /** Surveillance : interrompre l'exécution si un outil est utilisé alors que la politique l'interdit. */
  monitorTools: boolean;
}
export const ChatPolicy: ModePolicy = { mode: "chat", label: "Chat", requiresProject: false, allowAgents: false, tools: "none", cwd: "sandbox", claude: { toolsFlag: "", permissionMode: "default" }, codex: { sandbox: "read-only", approvalPolicy: "never" }, monitorTools: true };
export const WorkPolicy: ModePolicy = { mode: "work", label: "Work", requiresProject: false, allowAgents: false, tools: "workdir", cwd: "work", claude: { permissionMode: "acceptEdits" }, codex: { sandbox: "workspace-write", approvalPolicy: "never" }, monitorTools: false };
export const CodePolicy: ModePolicy = { mode: "code", label: "Code", requiresProject: true, allowAgents: true, tools: "project", cwd: "project", claude: { permissionMode: "acceptEdits" }, codex: { sandbox: "workspace-write", approvalPolicy: "never" }, monitorTools: false };
export const policyFor = (m: ExperienceMode): ModePolicy => (m === "chat" ? ChatPolicy : m === "work" ? WorkPolicy : CodePolicy);

export interface PolicyDescription { guaranteed: string[]; bestEffort: string[]; notGuaranteed: string[] }
/** Description honnête de ce qui est réellement appliqué, par fournisseur. Rien n'est promis au-delà du mécanisme réel. */
export function describePolicy(mode: ExperienceMode, provider: ProviderId): PolicyDescription {
  if (provider === "open") {
    const common = ["Pas de CLI ni d'agent externe : AI Command Center envoie lui-même les messages à votre point d'accès (API compatible OpenAI).", "Point d'accès hébergé (OpenRouter, Groq…) : refusé tant que la facturation à l'usage n'est pas autorisée dans les Paramètres."];
    if (mode === "chat") return { guaranteed: ["Aucun outil n'est transmis au modèle : ni fichiers, ni commandes, ni web.", ...common], bestEffort: [], notGuaranteed: ["Extensions MCP et recherche web non prises en charge par ce fournisseur."] };
    return { guaranteed: [`Outils limités à ${mode === "work" ? "l'espace de travail" : "dossier du projet"} : lister, lire${mode === "work" ? " et écrire" : ", et écrire si le projet n'est pas en lecture seule"} des fichiers texte. Chemins hors dossier et dossier .git refusés.`, "Aucune commande système, aucun accès réseau donné au modèle.", ...common], bestEffort: ["Un modèle qui ne gère pas les outils répond sans accès aux fichiers (signalé dans le journal)."], notGuaranteed: ["La qualité dépend fortement du modèle : les petits modèles locaux suivent mal les consignes complexes.", "Extensions MCP non prises en charge."] };
  }
  if (mode === "chat") return provider === "claude"
    ? { guaranteed: ["Outils intégrés, serveurs MCP et skills de Claude Code désactivés, réglages utilisateur (hooks, mémoire) non chargés : ni commandes, ni lecture ou écriture de fichiers.", "Exécution dans un dossier vide et isolé, sans projet ni dépôt Git.", "Aucun agent autonome."], bestEffort: [], notGuaranteed: ["Ce n'est pas le Chat natif de claude.ai : c'est le moteur Claude Code utilisé en conversation seule.", "Si vous activez des extensions MCP pour le Chat, leurs outils deviennent disponibles : c'est un choix explicite de votre part, limité à ces serveurs."] }
    : { guaranteed: ["Exécution dans un dossier vide et isolé, sans projet ni dépôt Git.", "Bac à sable en lecture seule, aucune approbation automatique.", "Aucun agent autonome."], bestEffort: ["Codex ne permet pas de désactiver ses outils : tout usage d'outil est détecté et l'exécution est interrompue immédiatement."], notGuaranteed: ["Le fournisseur ne garantit pas l'absence de lecture de fichiers en lecture seule avant l'interruption.", "Ce n'est pas le ChatGPT Chat natif : c'est le moteur Codex utilisé en conversation seule.", "Les outils des extensions MCP que vous activez pour le Chat sont autorisés (et eux seuls)."] };
  if (mode === "work") return { guaranteed: ["Dossier de travail dédié : les sources copiées par vous et les livrables y sont stockés.", provider === "claude" ? "Écritures automatiques limitées au dossier de travail (mode acceptEdits)." : "Bac à sable workspace-write centré sur le dossier de travail.", "Aucun accès au Chat ou Work natifs : mode Work local propre à AI Command Center."], bestEffort: [], notGuaranteed: ["Le fournisseur ne garantit pas formellement l'interdiction de lire hors du dossier de travail.", "Actions externes (web, commandes dangereuses) non autorisées par défaut ; les approbations Codex nécessitent le mode « sur demande »."] };
  return { guaranteed: ["Accès limité au projet sélectionné (dossier de travail).", provider === "claude" ? "Modifications de fichiers autorisées dans le projet (mode acceptEdits)." : "Bac à sable workspace-write dans le projet."], bestEffort: [], notGuaranteed: ["Les approbations interactives ne sont disponibles qu'avec Codex en mode « sur demande » ; Claude Code en mode structuré ne peut pas demander d'approbation."] };
}
