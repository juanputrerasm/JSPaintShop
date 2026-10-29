/* A typed event bus, used by the app state and the shell. No DOM, so workers can use it too. */
export class Emitter<Events extends Record<string, unknown>> {
  private map = new Map<keyof Events, Set<(p: any) => void>>();
  on<K extends keyof Events>(event: K, fn: (payload: Events[K]) => void): () => void {
    let set = this.map.get(event);
    if (!set) this.map.set(event, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const fn of this.map.get(event) ?? []) fn(payload);
  }
}
