/*
  Layers > New Adjustment Layer (Brightness/Contrast, Channel Mixer, Color Balance, Curves,
  Hue/Saturation, Invert, Levels, Posterize, Threshold) and editing an adjustment layer's
  settings from Layer Properties. The dialog changes the layer as you go, so the image is the
  preview; Cancel puts it back. The layer applies through core/layers/composite.ts with JLayer's
  routines (docs/PSP_EXE_ANALYSIS.md section 13).
*/
import type { Editor } from "./editor.ts";
import { CMD, type CommandRegistry } from "../ui/shell/commands.ts";
import { el } from "../shared/dom.ts";
import { openDialog } from "../ui/shell/dialog.ts";
import { activeLayer, rasterLayer, type ImageDoc, type Layer } from "../core/doc/image-doc.ts";
import { ADJUSTMENT_NAMES, defaultAdjustment, HUE_RANGES, type Adjustment, type LevelsChannel } from "../core/color/adjustments.ts";
import { createRaster } from "../core/image/raster.ts";
import { pspRgbToHsl } from "../core/color/color-space.ts";
import { nextLayerName } from "../core/layers/layer-ops.ts";

const slider = (label: string, value: number, min: number, max: number, on: (v: number) => void, step = 1) => {
  const num = el("input", { type: "number", class: "spin", value, min, max, step });
  const range = el("input", { type: "range", value, min, max, step });
  const set = (v: number) => { num.value = range.value = String(v); on(v); };
  num.addEventListener("change", () => set(Number(num.value) || 0));
  range.addEventListener("input", () => set(Number(range.value)));
  return el("label", { class: "pv-row" }, el("span", {}, label), range, num);
};
const check = (label: string, value: boolean, on: (v: boolean) => void) => {
  const c = el("input", { type: "checkbox", checked: value });
  c.addEventListener("change", () => on(c.checked));
  return el("label", { class: "opt-check" }, c, label);
};

/* A small curve editor: click to add a point, drag to move, drag off the box to remove. */
function curveEditor(points: () => number[][], set: (p: number[][]) => void): HTMLCanvasElement {
  const c = el("canvas", { width: 256, height: 256, class: "curve-editor" }) as HTMLCanvasElement;
  const g = c.getContext("2d")!;
  const draw = () => {
    g.fillStyle = "#fff"; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = "#ccc"; for (let i = 64; i < 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
    const p = [...points()].sort((a, b) => a[0] - b[0]);
    g.strokeStyle = "#000"; g.beginPath(); p.forEach(([x, y], i) => (i ? g.lineTo(x, 255 - y) : g.moveTo(x, 255 - y))); g.stroke();
    for (const [x, y] of p) g.strokeRect(x - 3, 255 - y - 3, 6, 6);
  };
  let drag = -1;
  const at = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return [Math.round(((e.clientX - r.left) / r.width) * 255), Math.round(255 - ((e.clientY - r.top) / r.height) * 255)]; };
  c.addEventListener("pointerdown", (e) => {
    const [x, y] = at(e), p = points();
    drag = p.findIndex(([px, py]) => Math.abs(px - x) < 6 && Math.abs(py - y) < 6);
    if (drag < 0) { p.push([x, y]); drag = p.length - 1; set(p); }
    c.setPointerCapture(e.pointerId);
  });
  c.addEventListener("pointermove", (e) => {
    if (drag < 0) return;
    const [x, y] = at(e), p = points();
    p[drag] = [Math.max(0, Math.min(255, x)), Math.max(0, Math.min(255, y))];
    set(p); draw();
  });
  c.addEventListener("pointerup", (e) => {
    const [x, y] = at(e), p = points();
    if (drag >= 0 && p.length > 2 && (x < -10 || x > 265 || y < -10 || y > 265)) { p.splice(drag, 1); set(p); }
    drag = -1; draw();
  });
  draw();
  return c;
}

/* The controls for one adjustment; `changed` re-renders the image. */
function controls(a: Adjustment, changed: () => void): Node {
  const box = el("div", { class: "layer-props" });
  const ch = <T>(o: T, k: keyof T) => (v: number) => { (o[k] as unknown as number) = v; changed(); };
  switch (a.type) {
    case "brightnessContrast": box.append(slider("Brightness", a.brightness, -255, 255, ch(a, "brightness")), slider("Contrast", a.contrast, -100, 100, ch(a, "contrast"))); break;
    case "hueSaturationLightness": box.append(slider("Hue", a.hue, -100, 100, ch(a, "hue")), slider("Saturation", a.saturation, -100, 100, ch(a, "saturation")), slider("Lightness", a.lightness, -100, 100, ch(a, "lightness"))); break;
    case "hueSaturation": {
      // DIALOG 27051: Edit (Master or a hue range), Colorize, Hue, Saturation, Luminance
      // (Psp.exe 0x430310: −180..180, −100..100, −100..100; colorizing 0..360, 0..100).
      const pick = el("select", {}, ...["Master", ...HUE_RANGES.map(([n]) => n)].map((n) => el("option", {}, n)));
      const colorize = el("input", { type: "checkbox", checked: a.colorize });
      const holder = el("div");
      const show = () => {
        pick.disabled = colorize.checked;
        const v = colorize.checked ? a.colorizeValues : pick.selectedIndex === 0 ? a.master : a.ranges[pick.selectedIndex - 1];
        const hueRange: [number, number] = colorize.checked ? [0, 360] : [-180, 180];
        holder.replaceChildren(
          slider("Hue", v[0], hueRange[0], hueRange[1], (n) => { v[0] = n; changed(); }),
          slider("Saturation", v[1], colorize.checked ? 0 : -100, 100, (n) => { v[1] = n; changed(); }),
          slider("Luminance", v[2], -100, 100, (n) => { v[2] = n; changed(); }));
      };
      pick.addEventListener("change", show);
      colorize.addEventListener("change", () => { a.colorize = colorize.checked; if (colorize.checked) pick.selectedIndex = 0; show(); changed(); });
      show();
      box.append(el("label", { class: "form-row" }, el("span", {}, "Edit:"), pick, el("label", { class: "opt-check" }, colorize, "Colorize")), holder);
      break;
    }
    case "posterize": box.append(slider("Levels", a.levels, 2, 255, ch(a, "levels"))); break;
    case "threshold": box.append(slider("Threshold", a.threshold, 1, 255, ch(a, "threshold"))); break;
    case "invert": box.append(el("p", { class: "opt-hint" }, "Inverts the colors of the layers below.")); break;
    case "channelMixer": {
      const rows: [string, number[]][] = [["Red", a.red], ["Green", a.green], ["Blue", a.blue]];
      for (const [name, row] of rows) {
        const f = el("fieldset", { class: "opt-group" }, el("legend", {}, `Output channel: ${name}`));
        ["Red", "Green", "Blue", "Constant"].forEach((s, i) => f.append(slider(s, row[i], -200, 200, (v) => { row[i] = v; changed(); })));
        box.append(f);
      }
      box.append(check("Monochrome", a.monochrome, (v) => { a.monochrome = v; changed(); }));
      break;
    }
    case "colorBalance": {
      for (const [name, vals] of [["Shadows", a.shadows], ["Midtones", a.midtones], ["Highlights", a.highlights]] as [string, number[]][]) {
        const f = el("fieldset", { class: "opt-group" }, el("legend", {}, name));
        ["Cyan - Red", "Magenta - Green", "Yellow - Blue"].forEach((s, i) => f.append(slider(s, vals[i], -100, 100, (v) => { vals[i] = v; changed(); })));
        box.append(f);
      }
      box.append(check("Preserve luminosity", a.preserveLuminosity, (v) => { a.preserveLuminosity = v; changed(); }));
      break;
    }
    case "levels": {
      const pick = el("select", {}, ...["RGB", "Red", "Green", "Blue"].map((n) => el("option", {}, n)));
      const holder = el("div");
      const show = () => {
        const c: LevelsChannel = [a.rgb, a.red, a.green, a.blue][pick.selectedIndex];
        holder.replaceChildren(
          slider("Input black", c[0], 0, 254, (v) => { c[0] = v; changed(); }), slider("Input white", c[1], 1, 255, (v) => { c[1] = v; changed(); }),
          slider("Gamma", c[2], 0.1, 9.99, (v) => { c[2] = v; changed(); }, 0.01),
          slider("Output black", c[3], 0, 255, (v) => { c[3] = v; changed(); }), slider("Output white", c[4], 0, 255, (v) => { c[4] = v; changed(); }));
      };
      pick.addEventListener("change", show); show();
      box.append(el("label", { class: "form-row" }, el("span", {}, "Channel:"), pick), holder);
      break;
    }
    case "curves": {
      const pick = el("select", {}, ...["RGB", "Red", "Green", "Blue"].map((n) => el("option", {}, n)));
      const keys = ["rgb", "red", "green", "blue"] as const;
      const holder = el("div");
      const show = () => holder.replaceChildren(curveEditor(() => a[keys[pick.selectedIndex]], (p) => { a[keys[pick.selectedIndex]] = p; changed(); }));
      pick.addEventListener("change", show); show();
      box.append(el("label", { class: "form-row" }, el("span", {}, "Channel:"), pick), holder, el("p", { class: "opt-hint" }, "Click to add a point; drag a point out of the box to remove it."));
      break;
    }
    default: break;
  }
  return box;
}

/** Edit an adjustment layer's settings; true when kept. */
export async function editAdjustment(ed: Editor, doc: ImageDoc, layer: Layer, title: string): Promise<boolean> {
  if (!layer.adjustment) return false;
  const image = ed.image;
  const before = structuredClone(layer.adjustment);
  const working = structuredClone(layer.adjustment);
  layer.adjustment = working;
  const refresh = () => image?.changed({ layers: true });
  const v = await openDialog({ title, body: controls(working, refresh), buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }] });
  layer.adjustment = before;
  refresh();
  if (v !== "ok") return false;
  ed.run(title, () => { layer.adjustment = working; return { layers: true }; });
  void doc;
  return true;
}

const TYPES: [number, Adjustment["type"]][] = [
  [CMD.LAYERS_NEW_ADJUSTMENT_LAYER_BRIGHTNESS_CONTRAST, "brightnessContrast"], [CMD.LAYERS_NEW_ADJUSTMENT_LAYER_CHANNEL_MIXER, "channelMixer"],
  [CMD.LAYERS_NEW_ADJUSTMENT_LAYER_COLOR_BALANCE, "colorBalance"], [CMD.LAYERS_NEW_ADJUSTMENT_LAYER_CURVES, "curves"],
  [CMD.LAYERS_NEW_ADJUSTMENT_LAYER_HUE_SATURATION, "hueSaturation"], [CMD.LAYERS_NEW_ADJUSTMENT_LAYER_INVERT, "invert"],
  [CMD.LAYERS_NEW_ADJUSTMENT_LAYER_LEVELS, "levels"], [CMD.LAYERS_NEW_ADJUSTMENT_LAYER_POSTERIZE, "posterize"],
  [CMD.LAYERS_NEW_ADJUSTMENT_LAYER_THRESHOLD, "threshold"],
];

export function bindAdjustmentLayerCommands(registry: CommandRegistry, ed: Editor, fg: () => readonly number[] = () => [0, 0, 0]): void {
  const trueColor = () => { const d = ed.image?.doc; return Boolean(d && (d.depth === 24 || d.greyscale)); };
  for (const [id, type] of TYPES) registry.bind(id, async () => {
    const image = ed.image;
    if (!image) return;
    const doc = image.doc;
    const a = defaultAdjustment(type);
    // PSP starts Colorize at the foreground color's hue in degrees (0x42fc90).
    if (a.type === "hueSaturation") { const c = fg(), hsl = [0, 0, 0]; pspRgbToHsl(c[0], c[1], c[2], hsl); a.colorizeValues[0] = Math.trunc((hsl[0] * 359) / 255); }
    const name = ADJUSTMENT_NAMES[type];
    // A temporary layer shows the settings while the dialog is open.
    const layer: Layer = { ...rasterLayer(nextLayerName(doc, name), createRaster(doc.width, doc.height)), kind: "adjustment", adjustment: a };
    doc.layers.splice(doc.active + 1, 0, layer);
    const refresh = () => image.changed({ layers: true });
    refresh();
    const v = await openDialog({ title: `${name} Adjustment Layer`, body: controls(a, refresh), buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }] });
    doc.layers.splice(doc.layers.indexOf(layer), 1);
    refresh();
    if (v !== "ok") return;
    ed.run(`New ${name} Adjustment Layer`, (d) => { d.layers.splice(d.active + 1, 0, layer); d.active += 1; return { layers: true }; });
  }, { enabled: trueColor });
  void activeLayer;
}
