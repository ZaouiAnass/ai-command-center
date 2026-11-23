const v = (n) => `var(--${n})`;
module.exports = {
  content: ["./src/renderer/**/*.{html,tsx,ts}"], darkMode: "class",
  theme: { extend: {
    colors: { bg: v("background"), sidebar: v("sidebar"), panel: v("surface"), raised: v("surface-raised"), hover: v("surface-hover"), line: v("border"), "line-strong": v("border-strong"),
      fg: v("text-primary"), fg2: v("text-secondary"), muted: v("text-muted"), accent: v("accent"), "accent-subtle": v("accent-subtle"),
      success: v("success"), warning: v("warning"), danger: v("danger"), info: v("info"), claude: v("claude"), codex: v("codex") },
    fontFamily: { sans: ['"Inter Variable"', "Inter", "Segoe UI", "sans-serif"], mono: ['"JetBrains Mono Variable"', "Consolas", "monospace"] },
    fontSize: { "2xs": ["11px", "16px"] },
  } }, plugins: [],
};
