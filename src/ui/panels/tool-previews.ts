/*
  The Tool Options palette's pictures (app/tools/options.ts): the brush tip (DIALOGs 702/703,
  control 1227), the current tube (829/830), the preset shape (an addition), and the picture
  buttons for line caps and joins (bitmaps 956-961, drawn on PSP's 192 grey, which is keyed out).
*/
import { el } from "../../shared/dom.ts";
import { makeTip } from "../../core/paint/brush.ts";
import { flattenContour, presetShapeContour } from "../../core/vector/path.ts";
import { previewSources, type OptionValue } from "../../app/tools/options.ts";

/* PSP's picture is 30 x 30 dialog units; about 46 pixels at the standard font. */
const SIDE = 46;

export function previewCanvas(kind: "brush" | "shape" | "tube", label: string): { node: HTMLElement; update(values: Record<string, OptionValue>): void } {
  const canvas = el("canvas", { class: "tool-preview", width: SIDE, height: SIDE, role: "img", "aria-label": label }) as HTMLCanvasElement;
  const g = canvas.getContext("2d")!;
  let ticket = 0;
  const update = (v: Record<string, OptionValue>) => {
    const css = getComputedStyle(canvas);
    const ink = css.getPropertyValue("--text").trim() || "#1d1d1b";
    g.clearRect(0, 0, SIDE, SIDE);
    if (kind === "brush") drawTip(g, v, ink);
    else if (kind === "shape") drawShape(g, v, ink, css.getPropertyValue("--accent").trim() || "#2f6fd0");
    else {
      const mine = ++ticket, name = String(v.tube ?? "");
      if (!name || name === "(none)" || !previewSources.tube) return;
      void previewSources.tube(name).then((cell) => { if (cell && mine === ticket) drawFit(g, cell); });
    }
  };
  return { node: el("div", { class: "tool-preview-box" }, canvas), update };
}

/* The tip's coverage in the text color, scaled down to fit when it is larger than the box. */
function drawTip(g: CanvasRenderingContext2D, v: Record<string, OptionValue>, ink: string): void {
  const shape = String(v.shape ?? "Round");
  const tip = makeTip(shape, Number(v.size ?? 10), Number(v.hardness ?? 50), previewSources.customBrush?.(shape));
  const img = new ImageData(tip.size, tip.size);
  const [r, gg, b] = parseColor(ink);
  for (let i = 0; i < tip.data.length; i++) {
    img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = Math.round(tip.data[i] * 255);
  }
  drawFit(g, { width: tip.size, height: tip.size, data: img.data }, false);
}

function drawShape(g: CanvasRenderingContext2D, v: Record<string, OptionValue>, ink: string, accent: string): void {
  const pad = 5, style = String(v.style ?? "Filled");
  const pts = flattenContour(presetShapeContour(String(v.shape ?? "Rectangle"), pad, pad, SIDE - pad, SIDE - pad));
  if (!pts.length) return;
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
  g.closePath();
  if (style !== "Stroked") { g.fillStyle = accent; g.fill(); }
  if (style !== "Filled") { g.strokeStyle = ink; g.lineWidth = Math.max(1, Math.min(4, Number(v.width ?? 1))); g.stroke(); }
}

/* An image centered in the box, scaled down (never up, unless `grow`) to fit. */
function drawFit(g: CanvasRenderingContext2D, r: { width: number; height: number; data: ArrayLike<number> }, grow = false): void {
  const c = document.createElement("canvas");
  c.width = r.width; c.height = r.height;
  c.getContext("2d")!.putImageData(new ImageData(Uint8ClampedArray.from(r.data), r.width, r.height), 0, 0);
  const k = Math.min((SIDE - 4) / r.width, (SIDE - 4) / r.height, grow ? Infinity : 1);
  const w = r.width * k, h = r.height * k;
  g.imageSmoothingEnabled = k < 1;
  g.drawImage(c, (SIDE - w) / 2, (SIDE - h) / 2, w, h);
}

function parseColor(css: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(css);
  if (m) { const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  return [29, 29, 27];
}

/* A BITMAP resource with PSP's 192 grey made transparent, as a data URL (cached). */
const icons = new Map<number, Promise<string>>();
function iconUrl(id: number): Promise<string> {
  let p = icons.get(id);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.width; c.height = img.height;
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height);
        for (let i = 0; i < d.data.length; i += 4) if (d.data[i] === 192 && d.data[i + 1] === 192 && d.data[i + 2] === 192) d.data[i + 3] = 0;
        g.putImageData(d, 0, 0);
        resolve(c.toDataURL());
      };
      img.onerror = () => resolve("");
      img.src = `${import.meta.env.BASE_URL}ui/bmp/${id}.png`;
    });
    icons.set(id, p);
  }
  return p;
}

/** A list as a row of picture buttons (PSP's Cap and Join buttons). */
export function iconChoices(label: string, choices: readonly string[], ids: readonly number[], value: string, set: (v: string) => void): HTMLElement {
  const buttons = choices.map((c, i) => {
    const img = el("img", { alt: "", width: 18, height: 18, class: "tool-icon-img" }) as HTMLImageElement;
    void iconUrl(ids[i]).then((u) => { if (u) img.src = u; });
    const b = el("button", { type: "button", class: "tool-icon", title: c, "aria-label": c, "aria-pressed": String(c === value) }, img);
    b.addEventListener("click", () => {
      for (const o of buttons) o.setAttribute("aria-pressed", String(o === b));
      set(c);
    });
    return b;
  });
  return el("div", { class: "tool-row" }, el("span", {}, label), el("div", { class: "tool-icons", role: "group", "aria-label": label }, ...buttons));
}
