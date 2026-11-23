import { randomUUID } from "node:crypto";
export interface AppEvent { id: string; ts: string; type: string; provider?: string; projectId?: string; agentId?: string; taskId?: string; executionId?: string; correlationId?: string; payload: Record<string, unknown> }
type Handler = (e: AppEvent) => void;
export class EventBus {
  private handlers = new Set<Handler>();
  on(h: Handler) { this.handlers.add(h); return () => this.handlers.delete(h); }
  emit(type: string, payload: Record<string, unknown> = {}, ctx: Partial<AppEvent> = {}) {
    const e: AppEvent = { id: randomUUID(), ts: new Date().toISOString(), type, payload, ...ctx };
    for (const h of this.handlers) { try { h(e); } catch { /* listener errors never break the bus */ } }
    return e;
  }
}
