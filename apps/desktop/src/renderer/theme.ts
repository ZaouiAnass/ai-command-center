import { api } from "./api";

export type ThemeMode = "system" | "light" | "dark";
const KEY = "acc.theme";
/** Lu de façon synchrone avant le premier affichage (pas de flash sombre) ; la même valeur est aussi enregistrée dans les réglages pour la fenêtre native. */
export const getThemeMode = (): ThemeMode => { try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : "system"; } catch { return "system"; } };
const prefersLight = () => window.matchMedia("(prefers-color-scheme: light)").matches;
export const resolveTheme = (m: ThemeMode): "light" | "dark" => (m === "system" ? (prefersLight() ? "light" : "dark") : m);
export const currentTheme = (): "light" | "dark" => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
export function applyTheme(m: ThemeMode) { document.documentElement.dataset.theme = resolveTheme(m); window.dispatchEvent(new Event("acc-theme")); }
export function initTheme() {
  applyTheme(getThemeMode());
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (getThemeMode() === "system") applyTheme("system"); });
}
export async function setThemeMode(m: ThemeMode) { try { localStorage.setItem(KEY, m); } catch { /* indisponible */ } applyTheme(m); await api("app.setTheme", m).catch(() => {}); }
