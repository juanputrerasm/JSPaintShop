/*
  The main thread's side of a worker: calls that resolve with the worker's reply.

  From JSTraxx (ported there from OpenMTM2 src/shared/worker-client.js). The protocol is
  `{ id, type, payload }` out and `{ id, ok, payload | error }` back, with two extra
  messages from the worker: `{ ready: true }` once its module graph has loaded, and
  `{ event, payload }` for anything sent outside a reply (progress, mostly).
*/

type Deferred = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type Listener = (payload: unknown) => void;

export type WorkerReply =
  | { ready: true }
  | { event: string; payload: unknown }
  | { id: number; ok: true; payload: unknown }
  | { id: number; ok: false; error: string };

export class WorkerClient {
  readonly worker: Worker;
  private pending = new Map<number, Deferred>();
  private nextId = 1;
  private failure: Error | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private readyWaiters: (() => void)[] = [];
  ready = false;

  constructor(worker: Worker) {
    this.worker = worker;
    worker.addEventListener("message", (e: MessageEvent) => this.handle(e.data as WorkerReply));
    /*
      A module worker whose imports fail to load never runs its handler, so every call would
      hang. The error event is the only notice, so it fails everything waiting.
    */
    worker.addEventListener("error", (e: ErrorEvent) => {
      if (!this.ready) {
        this.fail(new Error(
          "Worker script failed to load: its module graph did not evaluate. This is almost "
          + "always a stale cached module. Reload with the cache disabled."));
        return;
      }
      const where = e.filename ? ` (${e.filename}:${e.lineno})` : "";
      this.fail(new Error(`Worker failed: ${e.message || "script error"}${where}`));
    });
    worker.addEventListener("messageerror", () => this.fail(new Error("Worker sent a message that could not be read")));
  }

  /** Resolves once the worker has announced itself. */
  whenReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve) => this.readyWaiters.push(resolve));
  }

  /** Listen to `{ event, payload }` messages. Returns the unsubscribe function. */
  on(event: string, listener: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener);
    return () => set.delete(listener);
  }

  call<T = unknown>(type: string, payload?: unknown, transfer: Transferable[] = []): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      // Registered before posting, so a synchronous failure still finds it.
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      try {
        this.worker.postMessage({ id, type, payload }, transfer);
      } catch (err) {
        this.pending.delete(id);
        reject(err as Error);
      }
    });
  }

  terminate(): void {
    this.worker.terminate();
    this.fail(new Error("Worker terminated."));
  }

  private fail(error: Error): void {
    this.failure = error;
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  private handle(msg: WorkerReply): void {
    if ("ready" in msg) {
      this.ready = true;
      for (const resolve of this.readyWaiters.splice(0)) resolve();
      return;
    }
    if ("event" in msg) {
      for (const listener of this.listeners.get(msg.event) ?? []) listener(msg.payload);
      return;
    }
    const deferred = this.pending.get(msg.id);
    if (!deferred) return;
    this.pending.delete(msg.id);
    if (msg.ok) deferred.resolve(msg.payload);
    else deferred.reject(new Error(msg.error ?? "Worker error"));
  }
}
