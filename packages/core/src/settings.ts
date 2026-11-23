import { DB, one, run } from "./db.js";
export function getSetting<T = unknown>(db: DB, key: string, def: T): T { const r = one<{ value: string }>(db, "SELECT value FROM app_settings WHERE key=?", key); if (!r) return def; try { return JSON.parse(r.value) as T; } catch { return def; } }
export function setSetting(db: DB, key: string, value: unknown) { run(db, "INSERT INTO app_settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, JSON.stringify(value)); }
