/*
  The progress strip: what the worker is doing, for loads and saves that take a moment
  (PSP's progress dialogs). Shown over the work area while a `{ event: "progress" }` stream runs.
*/
import { el } from "../../shared/dom.ts";
import type { WorkerClient } from "../../shared/worker-client.ts";

export function attachProgress(worker: WorkerClient, host: HTMLElement): void {
  const label = el("span", { class: "progress-label" });
  const bar = el("progress", { max: 100, value: 0 });
  const strip = el("div", { class: "progress-strip", role: "status", "aria-live": "polite", hidden: true }, label, bar);
  host.append(strip);
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  worker.on("progress", (p) => {
    const info = p as { label: string; done: number; total: number } | null;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (!info) { hideTimer = setTimeout(() => { strip.hidden = true; }, 250); return; }
    strip.hidden = false;
    label.textContent = info.label;
    bar.value = info.total ? (100 * info.done) / info.total : 0;
    if (info.done >= info.total) hideTimer = setTimeout(() => { strip.hidden = true; }, 400);
  });
}
