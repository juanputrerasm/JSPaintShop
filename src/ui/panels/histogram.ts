/*
  The Histogram window (H): the active image's red, green, blue and luminance histograms
  over 0..255, each switchable (MENU 212's Red, Green, Blue, Luminance), with the statistics
  line PSP shows under the pointer: "Max: %i (%i%%) Min: %i Avg: %i".
*/
import { el, clear } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";
import type { Editor } from "../../app/editor.ts";
import type { FloatingPanel } from "../shell/panel.ts";
import { luminance } from "../../core/color/color-space.ts";

const CHANNELS = [["Red", "#e03030"], ["Green", "#20a020"], ["Blue", "#3050e0"], ["Luminance", "#808080"]] as const;

export function histogramPanel(app: AppState, ed: Editor, panel: FloatingPanel): void {
  const on = [true, true, true, true];
  const canvas = el("canvas", { class: "histo", width: 256, height: 120 });
  const stats = el("div", { class: "histo-stats" });
  const boxes = CHANNELS.map(([name, color], k) => {
    const input = el("input", { type: "checkbox", checked: true });
    input.addEventListener("change", () => { on[k] = input.checked; draw(); });
    return el("label", { class: "opt-check", style: { color } }, input, name);
  });
  clear(panel.body);
  panel.body.append(el("div", { class: "histo-wrap" }, canvas, el("div", { class: "histo-boxes" }, ...boxes), stats));
  let hist: Float64Array[] = [];
  const compute = () => {
    hist = CHANNELS.map(() => new Float64Array(256));
    const img = ed.image?.composite;
    if (!img) return;
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      hist[0][d[i]]++; hist[1][d[i + 1]]++; hist[2][d[i + 2]]++; hist[3][luminance(d[i], d[i + 1], d[i + 2])]++;
    }
  };
  const draw = () => {
    const g = canvas.getContext("2d")!;
    g.clearRect(0, 0, 256, 120);
    const max = Math.max(1, ...hist.flatMap((h, k) => (on[k] ? [...h] : [0])));
    CHANNELS.forEach(([, color], k) => {
      if (!on[k] || !hist[k]) return;
      g.strokeStyle = color;
      g.beginPath();
      for (let v = 0; v < 256; v++) { const y = 120 - (hist[k][v] / max) * 118; v ? g.lineTo(v + 0.5, y) : g.moveTo(0.5, y); }
      g.stroke();
    });
  };
  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    const v = Math.max(0, Math.min(255, Math.floor(((e.clientX - r.left) / r.width) * 256)));
    const h = hist[3];
    if (!h) return;
    let total = 0, sum = 0, lo = 255, hi = 0, peak = 0;
    for (let i = 0; i < 256; i++) { total += h[i]; sum += h[i] * i; if (h[i]) { lo = Math.min(lo, i); hi = Math.max(hi, i); } peak = Math.max(peak, h[i]); }
    stats.textContent = `Level ${v}: ${h[v]}  Max: ${hi} (${total ? Math.round((h[v] * 100) / total) : 0}%) Min: ${lo} Avg: ${total ? Math.round(sum / total) : 0}`;
    void peak;
  });
  let timer: ReturnType<typeof setTimeout> | null = null;
  app.on("image", () => {
    if (!panel.visible) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { compute(); draw(); }, 120);
  });
  compute();
  draw();
}
