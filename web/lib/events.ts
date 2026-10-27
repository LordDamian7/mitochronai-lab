import { EventEmitter } from "node:events";

/** In-process change feed. Every signed-in browser listens through /api/events and refreshes when something changes. */
declare global {
  // eslint-disable-next-line no-var
  var __mclBus: EventEmitter | undefined;
}
export const bus: EventEmitter = globalThis.__mclBus ?? (globalThis.__mclBus = new EventEmitter().setMaxListeners(500));

export type LabEvent = { kind: string; orderId?: string; by?: string; at: string };
export function publish(kind: string, orderId?: string, by?: string) {
  bus.emit("change", { kind, orderId, by, at: new Date().toISOString() } satisfies LabEvent);
}
