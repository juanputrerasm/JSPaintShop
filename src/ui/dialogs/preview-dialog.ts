/*
  PSP 6's preview dialogs (DlgWithPreview / DlgWithZoomPreview): the before and after previews
  of the same part of the image at 1:1, zoom in and out, drag in the before preview to look
  elsewhere, Proof (show the result in the image window), Auto Proof (show it after every
  change), Reset (back to the defaults), and the dialog's own controls. Every Colors
  adjustment, filter and effect uses it.

  The preview runs the operation on a crop with a margin, so filters that read their
  neighbours look right at the crop's edges.
*/
import { el } from "../../shared/dom.ts";
import { openDialog } from "../shell/dialog.ts";
import { cloneRaster, createRaster, type Raster } from "../../core/image/raster.ts";
import { extract } from "../../core/image/geometry.ts";

export type Values = Record<string, number | boolean | string>;

export interface ControlDef {
  key: string;
  label: string;
  type: "range" | "number" | "check" | "select" | "color" | "radio";
  min?: number;
  max?: number;
  step?: number;
  choices?: readonly string[];
  /** A select shown as pictures too: draws choice `i` on a small canvas (the bevel list). */
  pictures?: (i: number, g: CanvasRenderingContext2D, size: number) => void;
  /** Hidden unless this returns true. */
  when?: (v: Values) => boolean;
  group?: string;
}

export interface PreviewOptions {
  title: string;
  /** The pixels the operation will run on (the target layer), and the selection. */
  source: Raster;
  controls: ControlDef[];
  defaults: Values;
  initial?: Values;
  /** The operation on a raster (a crop for the preview, the whole layer for Proof). */
  run(r: Raster, v: Values): Raster;
  /** Show the result in the image window (Proof); null restores it. */
  proof?(v: Values | null): void;
  /** How far the operation reads around a pixel (for the preview's margin). */
  margin?: number;
  /** Extra rows above the controls (presets). */
  header?: (get: () => Values, set: (v: Values) => void) => HTMLElement;
}

const SIZE = 150;

export async function showPreviewDialog(o: PreviewOptions): Promise<Values | null> {
  let v: Values = { ...o.defaults, ...(o.initial ?? {}) };
  let zoom = 1;
  let cx = Math.floor(o.source.width / 2), cy = Math.floor(o.source.height / 2);
  const before = el("canvas", { class: "pv-canvas", width: SIZE, height: SIZE, title: "Drag to look at another part of the image" });
  const after = el("canvas", { class: "pv-canvas", width: SIZE, height: SIZE });
  const zoomLabel = el("span", { class: "pv-zoom" }, "1:1");
  const auto = el("input", { type: "checkbox" });
  let timer: ReturnType<typeof setTimeout> | null = null;

  const crop = () => {
    const span = Math.ceil(SIZE / zoom), m = o.margin ?? 8;
    const x0 = Math.max(0, cx - Math.floor(span / 2) - m), y0 = Math.max(0, cy - Math.floor(span / 2) - m);
    const x1 = Math.min(o.source.width - 1, cx + Math.ceil(span / 2) + m), y1 = Math.min(o.source.height - 1, cy + Math.ceil(span / 2) + m);
    return { r: extract(o.source, { minX: x0, minY: y0, maxX: x1, maxY: y1 }), x0, y0 };
  };
  const paint = (c: HTMLCanvasElement, r: Raster, x0: number, y0: number) => {
    const g = c.getContext("2d")!;
    g.fillStyle = "#808080";
    g.fillRect(0, 0, SIZE, SIZE);
    const tmp = el("canvas", { width: r.width, height: r.height });
    tmp.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
    g.imageSmoothingEnabled = zoom < 1;
    const ox = SIZE / 2 - (cx - x0) * zoom, oy = SIZE / 2 - (cy - y0) * zoom;
    g.drawImage(tmp, ox, oy, r.width * zoom, r.height * zoom);
  };
  const draw = () => {
    const { r, x0, y0 } = crop();
    paint(before, r, x0, y0);
    let res: Raster;
    try { res = o.run(cloneRaster(r), v); } catch (err) { console.error(err); res = createRaster(1, 1); }
    paint(after, res, x0, y0);
    zoomLabel.textContent = zoom >= 1 ? `${zoom}:1` : `1:${Math.round(1 / zoom)}`;
  };
  const changed = () => {
    draw();
    if (auto.checked && o.proof) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => o.proof!(v), 150);
    }
  };

  // Dragging the before preview moves both.
  before.addEventListener("pointerdown", (e) => {
    before.setPointerCapture(e.pointerId);
    let lx = e.clientX, ly = e.clientY;
    const move = (m: PointerEvent) => {
      cx = Math.max(0, Math.min(o.source.width - 1, cx - Math.round((m.clientX - lx) / zoom)));
      cy = Math.max(0, Math.min(o.source.height - 1, cy - Math.round((m.clientY - ly) / zoom)));
      lx = m.clientX; ly = m.clientY;
      draw();
    };
    const up = () => { before.removeEventListener("pointermove", move); before.removeEventListener("pointerup", up); };
    before.addEventListener("pointermove", move);
    before.addEventListener("pointerup", up);
  });

  const inputs = new Map<string, { set(x: unknown): void; row: HTMLElement; def: ControlDef }>();
  const control = (d: ControlDef) => {
    if (d.type === "check") {
      const input = el("input", { type: "checkbox" });
      input.addEventListener("change", () => { v[d.key] = input.checked; refreshWhen(); changed(); });
      const row = el("label", { class: "opt-check" }, input, d.label);
      inputs.set(d.key, { set: (x) => { input.checked = Boolean(x); }, row, def: d });
      return row;
    }
    if (d.type === "select" || d.type === "radio") {
      const select = el("select", {}, ...(d.choices ?? []).map((c) => el("option", { value: c }, c)));
      select.addEventListener("change", () => { v[d.key] = select.value; refreshWhen(); changed(); });
      let row: HTMLElement = el("label", { class: "form-row" }, el("span", {}, d.label), select);
      let mark = (_x: string) => {};
      if (d.pictures) {
        const size = 32;
        const cells = (d.choices ?? []).map((c, i) => {
          const canvas = el("canvas", { width: size, height: size }) as HTMLCanvasElement;
          d.pictures!(i, canvas.getContext("2d")!, size);
          const b = el("button", { type: "button", class: "picture-choice", title: c, "aria-label": c, onclick: () => { select.value = c; v[d.key] = c; mark(c); refreshWhen(); changed(); } }, canvas);
          return { c, b };
        });
        mark = (x) => { for (const { c, b } of cells) b.setAttribute("aria-pressed", String(c === x)); };
        select.addEventListener("change", () => mark(select.value));
        row = el("div", {}, row, el("div", { class: "picture-list", role: "group", "aria-label": d.label }, ...cells.map((x) => x.b)));
      }
      inputs.set(d.key, { set: (x) => { select.value = String(x); mark(String(x)); }, row, def: d });
      return row;
    }
    if (d.type === "color") {
      const input = el("input", { type: "color" });
      input.addEventListener("input", () => { v[d.key] = input.value; changed(); });
      const row = el("label", { class: "form-row" }, el("span", {}, d.label), input);
      inputs.set(d.key, { set: (x) => { input.value = String(x); }, row, def: d });
      return row;
    }
    const num = el("input", { type: "number", class: "spin", min: d.min ?? 0, max: d.max ?? 100, step: d.step ?? 1 });
    const range = d.type === "range" ? el("input", { type: "range", min: d.min ?? 0, max: d.max ?? 100, step: d.step ?? 1 }) : null;
    const set = (x: number) => { const c = Math.max(d.min ?? -Infinity, Math.min(d.max ?? Infinity, x)); v[d.key] = c; num.value = String(c); if (range) range.value = String(c); };
    num.addEventListener("change", () => { set(Number(num.value) || 0); changed(); });
    range?.addEventListener("input", () => { set(Number(range.value)); changed(); });
    const row = el("label", { class: "pv-row" }, el("span", {}, d.label), range ?? el("span", {}), num);
    inputs.set(d.key, { set: (x) => set(Number(x)), row, def: d });
    return row;
  };
  const refreshWhen = () => { for (const { row, def } of inputs.values()) row.hidden = Boolean(def.when && !def.when(v)); };
  const fill = () => { for (const [k, i] of inputs) i.set(v[k]); refreshWhen(); };
  const groups = new Map<string, HTMLElement>();
  const controls = el("div", { class: "pv-controls" });
  for (const d of o.controls) {
    const node = control(d);
    if (d.group) {
      let g = groups.get(d.group);
      if (!g) { g = el("fieldset", { class: "opt-group" }, el("legend", {}, d.group)); groups.set(d.group, g); controls.append(g); }
      g.append(node);
    } else controls.append(node);
  }
  fill();
  const header = o.header?.(() => v, (nv) => { v = { ...v, ...nv }; fill(); changed(); });
  const button = (label: string, run: () => void) => el("button", { type: "button", class: "mini", onclick: run }, label);
  const body = el("div", { class: "pv" },
    header ?? null,
    el("div", { class: "pv-previews" }, before,
      el("div", { class: "pv-zooms" }, button("+", () => { zoom = Math.min(8, zoom * 2); draw(); }), zoomLabel, button("−", () => { zoom = Math.max(1 / 8, zoom / 2); draw(); })),
      after),
    controls,
    el("div", { class: "pv-proof" },
      button("Reset", () => { v = { ...o.defaults }; fill(); changed(); }),
      o.proof ? button("Proof", () => o.proof!(v)) : null,
      o.proof ? el("label", { class: "opt-check" }, auto, "Auto Proof") : null));
  draw();
  const result = await openDialog({ title: o.title, body, className: "pv-dialog", buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }] });
  if (timer) clearTimeout(timer);
  o.proof?.(null);
  return result === "ok" ? v : null;
}
