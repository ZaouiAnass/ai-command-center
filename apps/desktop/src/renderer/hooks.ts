import { useEffect, useRef, useState, useCallback, useSyncExternalStore } from "react";
import { api } from "./api";

/** Charge des données ; se rafraîchit (debounce) sur événements du bus et/ou à intervalle. Expose loading/err. */
export function useData<T>(method: string, args: unknown[] = [], opts: { events?: RegExp; every?: number; enabled?: boolean } = {}) {
  const [data, setData] = useState<T | undefined>(); const [err, setErr] = useState<string>(); const [loading, setLoading] = useState(true);
  const key = JSON.stringify(args); const t = useRef<any>(); const alive = useRef(true);
  const load = useCallback(() => api(method, ...JSON.parse(key)).then((d) => { if (alive.current) { setData(d); setErr(undefined); } }).catch((e) => alive.current && setErr(String(e.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""))).finally(() => alive.current && setLoading(false)), [method, key]);
  useEffect(() => {
    alive.current = true; if (opts.enabled !== false) load();
    const off = opts.events ? window.acc.onEvent((e: any) => { if (opts.events!.test(e.type)) { clearTimeout(t.current); t.current = setTimeout(load, 350); } }) : undefined;
    const iv = opts.every ? setInterval(load, opts.every) : undefined;
    return () => { alive.current = false; off?.(); iv && clearInterval(iv); clearTimeout(t.current); };
  }, [load, opts.enabled]);
  return { data, err, loading, reload: load };
}

// ---- flux d'événements en direct (tampon borné, sans tokens de streaming) ----
export interface LiveEvent { id: string; ts: string; type: string; provider?: string; projectId?: string; agentId?: string; taskId?: string; executionId?: string; payload: any }
let buf: LiveEvent[] = []; const subs = new Set<() => void>(); let started = false; let pending = false;
function start() {
  if (started || typeof window === "undefined" || !window.acc) return; started = true;
  window.acc.onEvent((e: LiveEvent) => {
    if (e.type === "execution.text" || e.type === "provider.status") return;
    buf = [e, ...buf].slice(0, 120);
    if (!pending) { pending = true; setTimeout(() => { pending = false; subs.forEach((f) => f()); }, 200); }
  });
}
export function useLiveEvents(): LiveEvent[] { start(); return useSyncExternalStore((cb) => (subs.add(cb), () => subs.delete(cb)), () => buf); }
