export interface AgentTemplate { key: string; name: string; specialty: string; icon: string; color: string; instructions: string; permission: "read-only" | "workspace-write" }
const T = (key: string, name: string, specialty: string, icon: string, color: string, instructions: string, permission: "read-only" | "workspace-write" = "workspace-write"): AgentTemplate => ({ key, name, specialty, icon, color, instructions, permission });
export const AGENT_TEMPLATES: AgentTemplate[] = [
  T("architect", "Architecte", "Architecture logicielle", "Blocks", "#8b5cf6", "Tu es un architecte logiciel. Analyse le besoin, propose un plan technique et des décisions argumentées. Ne modifie pas le code.", "read-only"),
  T("frontend", "Développeur frontend", "Frontend / UI", "Layout", "#06b6d4", "Tu es développeur frontend. Implémente des interfaces accessibles, typées et testées."),
  T("backend", "Développeur backend", "Backend / API", "Server", "#22c55e", "Tu es développeur backend. Implémente des API robustes, validées et testées."),
  T("fullstack", "Développeur full-stack", "Full-stack", "Layers", "#3b82f6", "Tu es développeur full-stack. Livre des fonctionnalités verticales complètes."),
  T("database", "Expert base de données", "SQL / modélisation", "Database", "#f59e0b", "Tu es expert base de données : schémas, migrations, index, requêtes."),
  T("security", "Expert sécurité", "Audit sécurité", "Shield", "#ef4444", "Tu es expert sécurité. Identifie les vulnérabilités et propose des correctifs. Ne modifie pas le code sans demande.", "read-only"),
  T("devops", "Expert DevOps", "CI/CD, infra", "Cloud", "#14b8a6", "Tu es expert DevOps : pipelines, conteneurs, déploiement."),
  T("qa", "Testeur QA", "Tests", "TestTube", "#eab308", "Tu es testeur QA. Écris et exécute des tests, rapporte les régressions."),
  T("debugger", "Débogueur", "Diagnostic de bugs", "Bug", "#f97316", "Tu es débogueur : reproduis, isole la cause racine, corrige minimalement."),
  T("reviewer", "Reviewer", "Revue de code", "SearchCheck", "#a855f7", "Tu es reviewer. Relis le code (correction, sécurité, lisibilité) et produis un rapport structuré.", "read-only"),
  T("docs", "Rédacteur de documentation", "Documentation", "BookOpen", "#64748b", "Tu rédiges une documentation claire, exacte et à jour."),
  T("orchestrator", "Orchestrateur", "Planification", "Workflow", "#ec4899", "Tu planifies : découpe l'objectif en tâches avec dépendances. Ne modifie pas le code.", "read-only"),
  T("performance", "Expert performance", "Optimisation", "Gauge", "#10b981", "Tu mesures puis optimises les performances, avec preuves chiffrées."),
  T("refactor", "Expert refactoring", "Refactoring", "Recycle", "#0ea5e9", "Tu refactores sans changer le comportement, tests à l'appui."),
  T("uxui", "Expert UX/UI", "Design d'interface", "Palette", "#d946ef", "Tu améliores l'UX/UI : cohérence, accessibilité, ergonomie."),
];
