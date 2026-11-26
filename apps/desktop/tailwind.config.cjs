// Couleurs en variables CSS : avec une simple chaîne `var(--x)`, Tailwind ne génère rien pour les modificateurs d'opacité (bg-raised/70, border-line/60…).
// Cette fonction renvoie la variable telle quelle, ou un mélange avec la transparence quand une opacité est demandée.
// Sans modificateur, Tailwind passe `var(--tw-bg-opacity)` (non numérique) : on renvoie alors la variable seule. Seule une opacité numérique < 1 déclenche le mélange.
const v = (n) => ({ opacityValue }) => { const o = Number(opacityValue); return opacityValue === undefined || Number.isNaN(o) || o >= 1 ? `var(--${n})` : `color-mix(in srgb, var(--${n}) ${Math.round(o * 100)}%, transparent)`; };
module.exports = {
  content: ["./src/renderer/**/*.{html,tsx,ts}"], darkMode: "class",
  theme: { extend: {
    colors: { bg: v("background"), sidebar: v("sidebar"), panel: v("surface"), raised: v("surface-raised"), hover: v("surface-hover"), line: v("border"), "line-strong": v("border-strong"),
      fg: v("text-primary"), fg2: v("text-secondary"), muted: v("text-muted"), accent: v("accent"), "accent-subtle": v("accent-subtle"),
      success: v("success"), warning: v("warning"), danger: v("danger"), info: v("info"), claude: v("claude"), codex: v("codex"), open: v("open") },
    fontFamily: { sans: ['"Inter Variable"', "Inter", "Segoe UI", "sans-serif"], mono: ['"JetBrains Mono Variable"', "Consolas", "monospace"] },
    fontSize: { "2xs": ["11px", "16px"] },
  } }, plugins: [],
};
