/*
  The Colors menu: the adjustments (each in a preview dialog, with Proof), Colorize, Grey
  Scale, the histogram functions, Negative, Posterize, Solarize, the palette commands and
  Count Colors Used. Formulas: core/color/adjustments.ts (docs/PSP_EXE_ANALYSIS.md section 3).

  Every adjustment runs on the floating selection or the active layer, inside the selection
  (core/edit/apply-filter.ts), as one undo step.
*/
import type { AppState } from "./state.ts";
import type { Editor } from "./editor.ts";
import type { ImageDocument } from "./image-document.ts";
import { CMD, type CommandRegistry } from "../ui/shell/commands.ts";
import { showPreviewDialog, type ControlDef, type Values } from "../ui/dialogs/preview-dialog.ts";
import { alertDialog } from "../ui/shell/dialog.ts";
import { applyAdjustment, equalize, stretch, type Adjustment } from "../core/color/adjustments.ts";
import { filterLayer, targetLayer, applyOp, type PixelOp } from "../core/edit/apply-filter.ts";
import { luminance } from "../core/color/color-space.ts";
import { activeLayer } from "../core/doc/image-doc.ts";
import type { Raster } from "../core/image/raster.ts";

/* An adjustment as a pixel operation. */
const adjust = (a: Adjustment): PixelOp => (r) => { applyAdjustment(r.data, a); };

export interface PreviewedCommand {
  title: string;
  controls: ControlDef[];
  defaults: Values;
  op(v: Values): PixelOp;
  margin?: number;
  /** The operation uses the selection itself: do not clip it to the selection. */
  unclipped?: boolean;
}

/** Show a preview dialog for an operation on the active image, then run it as one undo step. */
export async function runPreviewed(ed: Editor, c: PreviewedCommand, remembered: Map<string, Values>): Promise<void> {
  const image = ed.image;
  if (!image) return;
  const layer = targetLayer(image.doc);
  const original = layer.raster;
  let proofing = false;
  const proof = (v: Values | null) => {
    if (v === null) {
      if (proofing) { layer.raster = original; image.changed({ layers: true }); proofing = false; }
      return;
    }
    layer.raster = applyOp(original, c.op(v), c.unclipped ? null : image.doc.selection, layer.lockTransparency);
    proofing = true;
    image.changed({ layers: true });
  };
  const v = await showPreviewDialog({
    title: c.title, source: original, controls: c.controls, defaults: c.defaults, initial: remembered.get(c.title), margin: c.margin,
    run: (r: Raster, values: Values) => { const op = c.op(values); return op(r) ?? r; },
    proof,
  });
  if (!v) return;
  remembered.set(c.title, v);
  ed.run(c.title, (d) => filterLayer(d, c.op(v), c.unclipped), image);
}

const range = (key: string, label: string, min: number, max: number, group?: string): ControlDef => ({ key, label, type: "range", min, max, group });

export function bindColorCommands(app: AppState, registry: CommandRegistry, ed: Editor): void {
  const remembered = new Map<string, Values>();
  const has = () => ed.image !== null;
  // Adjustments need 16 million colors or greyscale, as in PSP 6.
  const trueColor = () => { const d = ed.image?.doc; return Boolean(d && (d.depth === 24 || d.greyscale)); };
  const dialog = (id: number, c: PreviewedCommand) => registry.bind(id, () => runPreviewed(ed, c, remembered), { enabled: trueColor });
  const direct = (id: number, label: string, op: PixelOp) => registry.bind(id, () => ed.run(label, (d) => filterLayer(d, op)), { enabled: trueColor });

  dialog(CMD.COLORS_ADJUST_BRIGHTNESS_CONTRAST, {
    title: "Brightness/Contrast", controls: [range("brightness", "Brightness", -255, 255), range("contrast", "Contrast", -100, 100)],
    defaults: { brightness: 0, contrast: 0 },
    op: (v) => adjust({ type: "brightnessContrast", brightness: Number(v.brightness), contrast: Number(v.contrast) }),
  });
  dialog(CMD.COLORS_ADJUST_GAMMA_CORRECTION, {
    title: "Gamma Correction",
    controls: [{ key: "link", label: "Link", type: "check" }, { key: "red", label: "Red", type: "number", min: 0.01, max: 5, step: 0.01 }, { key: "green", label: "Green", type: "number", min: 0.01, max: 5, step: 0.01 }, { key: "blue", label: "Blue", type: "number", min: 0.01, max: 5, step: 0.01 }],
    defaults: { link: true, red: 1, green: 1, blue: 1 },
    op: (v) => adjust({ type: "gamma", red: Number(v.red), green: Number(v.link ? v.red : v.green), blue: Number(v.link ? v.red : v.blue) }),
  });
  dialog(CMD.COLORS_ADJUST_HIGHLIGHT_MIDTONE_SHADOW, {
    title: "Adjust HMS",
    controls: [
      { key: "method", label: "Method", type: "select", choices: ["Linear adjustment method", "Dynamic adjustment method"] },
      range("shadow", "Shadow", -100, 100), range("midtone", "Midtone", -100, 100), range("highlight", "Highlight", -100, 100),
    ],
    defaults: { method: "Linear adjustment method", shadow: 0, midtone: 50, highlight: 100 },
    op: (v) => adjust({ type: "highlightMidtoneShadow", dynamic: v.method !== "Linear adjustment method", shadow: Number(v.shadow), midtone: Number(v.midtone), highlight: Number(v.highlight) }),
  });
  dialog(CMD.COLORS_ADJUST_HUE_SATURATION_LIGHTNESS, {
    title: "Hue/Saturation/Lightness", controls: [range("hue", "Hue", -100, 100), range("saturation", "Saturation", -100, 100), range("lightness", "Lightness", -100, 100)],
    defaults: { hue: 0, saturation: 0, lightness: 0 },
    op: (v) => adjust({ type: "hueSaturationLightness", hue: Number(v.hue), saturation: Number(v.saturation), lightness: Number(v.lightness) }),
  });
  dialog(CMD.COLORS_ADJUST_HUE_MAP, {
    title: "Hue Map",
    controls: [...Array.from({ length: 10 }, (_, i) => range(`t${i}`, `${i * 36}°`, 0, 359, "Hue Shift")), range("saturation", "Saturation Shift", -100, 100), range("lightness", "Lightness Shift", -100, 100)],
    defaults: { ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`t${i}`, i * 36])), saturation: 0, lightness: 0 },
    op: (v) => adjust({ type: "hueMap", targets: Array.from({ length: 10 }, (_, i) => Number(v[`t${i}`])), saturation: Number(v.saturation), lightness: Number(v.lightness) }),
  });
  dialog(CMD.COLORS_ADJUST_RED_GREEN_BLUE, {
    title: "Red/Green/Blue", controls: [range("red", "Red", -100, 100), range("green", "Green", -100, 100), range("blue", "Blue", -100, 100)],
    defaults: { red: 0, green: 0, blue: 0 },
    op: (v) => adjust({ type: "redGreenBlue", red: Number(v.red), green: Number(v.green), blue: Number(v.blue) }),
  });
  dialog(CMD.COLORS_COLORIZE, {
    title: "Colorize", controls: [range("hue", "Hue", 0, 255), range("saturation", "Saturation", 0, 255)],
    defaults: { hue: 0, saturation: 128 },
    op: (v) => adjust({ type: "colorize", hue: Number(v.hue), saturation: Number(v.saturation) }),
  });
  dialog(CMD.COLORS_POSTERIZE, {
    title: "Posterize", controls: [range("levels", "Levels", 2, 255)], defaults: { levels: 4 },
    op: (v) => adjust({ type: "posterize", levels: Number(v.levels) }),
  });
  dialog(CMD.COLORS_SOLARIZE, {
    title: "Solarize", controls: [range("threshold", "Threshold", 0, 255)], defaults: { threshold: 128 },
    op: (v) => adjust({ type: "solarize", threshold: Number(v.threshold) }),
  });

  direct(CMD.COLORS_NEGATIVE_IMAGE, "Negative Image", adjust({ type: "negative" }));
  direct(CMD.COLORS_HISTOGRAM_FUNCTIONS_EQUALIZE, "Equalize", (r) => equalize(r.data));
  direct(CMD.COLORS_HISTOGRAM_FUNCTIONS_STRETCH, "Stretch", (r) => stretch(r.data));

  // Grey Scale converts the whole image, every layer, to 256 greys (Psp.exe 0x801df0).
  registry.bind(CMD.COLORS_GREY_SCALE, () => ed.run("Grey Scale", (d) => {
    for (const l of d.layers) {
      const r = { ...l.raster, data: new Uint8ClampedArray(l.raster.data) };
      for (let i = 0; i < r.data.length; i += 4) { const y = luminance(r.data[i], r.data[i + 1], r.data[i + 2]); r.data[i] = r.data[i + 1] = r.data[i + 2] = y; }
      l.raster = r;
    }
    d.greyscale = true;
    d.depth = 8;
    d.palette = Uint8Array.from({ length: 768 }, (_, i) => Math.floor(i / 3));
    return { image: true };
  }), { enabled: () => Boolean(ed.image && !ed.image.doc.greyscale) });

  registry.bind(CMD.COLORS_COUNT_COLORS_USED, async () => {
    const image: ImageDocument | null = ed.image;
    if (!image) return;
    const c = image.composite.data, seen = new Set<number>();
    for (let i = 0; i < c.length; i += 4) seen.add((c[i] << 16) | (c[i + 1] << 8) | c[i + 2]);
    await alertDialog("JSPaintShop", `Number of colors: ${seen.size}`);
  }, { enabled: has });

  void app; void activeLayer;
}
