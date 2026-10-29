/*
  The worker's side of WorkerClient: routes `{ id, type, payload }` to a handler and posts
  the reply. A handler returns its result, or `transfer(result, buffers)` to move buffers
  instead of copying them. `emit` posts an event outside any reply.

  No DOM here: this runs inside module workers.
*/

export type Transfer<T> = { result: T; transfer: Transferable[]; __transfer: true };
export type Handler = (payload: any) => unknown | Promise<unknown>;

export function transfer<T>(result: T, buffers: Transferable[]): Transfer<T> {
  return { result, transfer: buffers, __transfer: true };
}

interface Port {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (e: MessageEvent) => void): void;
}

export function emit(event: string, payload: unknown): void {
  (self as unknown as Port).postMessage({ event, payload });
}

/** Start serving `handlers` on this worker and announce readiness. */
export function serve(handlers: Record<string, Handler>): void {
  const port = self as unknown as Port;
  port.addEventListener("message", async (e: MessageEvent) => {
    const { id, type, payload } = e.data as { id: number; type: string; payload: unknown };
    const handler = handlers[type];
    try {
      if (!handler) throw new Error(`Unknown worker request "${type}"`);
      const out = await handler(payload);
      if (out && typeof out === "object" && (out as Transfer<unknown>).__transfer) {
        const t = out as Transfer<unknown>;
        port.postMessage({ id, ok: true, payload: t.result }, t.transfer);
      } else {
        port.postMessage({ id, ok: true, payload: out });
      }
    } catch (err) {
      port.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
  port.postMessage({ ready: true });
}
