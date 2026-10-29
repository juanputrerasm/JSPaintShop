/*
  Image > Blur, Edge, Noise, Sharpen and Other: the fixed kernels (core/filters/convolve.ts),
  the filters with dialogs (Gaussian Blur DIALOG 318, Motion Blur 202, Unsharp Mask 152, Add
  Noise 125, Mosaic 148) and the ones without (core/filters/filters.ts). Defaults are the ones
  each command's constructor sets in Psp.exe (docs/PSP_EXE_ANALYSIS.md section 7).

  Every filter runs on the floating selection or the active layer, inside the selection, as
  one undo step, like the Colors menu.
*/
import type { Editor } from "./editor.ts";
import type { Colors } from "./colors.ts";
import { CMD, type CommandRegistry } from "../ui/shell/commands.ts";
import { runPreviewed } from "./color-commands.ts";
import type { ControlDef, Values } from "../ui/dialogs/preview-dialog.ts";
import { filterLayer, type PixelOp } from "../core/edit/apply-filter.ts";
import { convolve, KERNELS, FILTER_CODES } from "../core/filters/convolve.ts";
import { addNoise, despeckle, gaussianBlur, hotWax, mosaic, motionBlur, rank3, unsharpMask } from "../core/filters/filters.ts";

const kernel = (code: number): PixelOp => (r) => convolve(r, KERNELS[code]);
const num = (key: string, label: string, min: number, max: number, step = 1): ControlDef => ({ key, label, type: "number", min, max, step });
const range = (key: string, label: string, min: number, max: number): ControlDef => ({ key, label, type: "range", min, max });

export function bindFilterCommands(registry: CommandRegistry, ed: Editor, colors: Colors): void {
  const remembered = new Map<string, Values>();
  // Filters need 16 million colors or greyscale, as in PSP 6.
  const trueColor = () => { const d = ed.image?.doc; return Boolean(d && (d.depth === 24 || d.greyscale)); };
  const direct = (id: number, label: string, op: PixelOp) => registry.bind(id, () => ed.run(label, (d) => filterLayer(d, op)), { enabled: trueColor });

  direct(CMD.IMAGE_BLUR_BLUR, "Blur", kernel(FILTER_CODES.blur));
  direct(CMD.IMAGE_BLUR_BLUR_MORE, "Blur More", kernel(FILTER_CODES.blurMore));
  direct(CMD.IMAGE_BLUR_SOFTEN, "Soften", kernel(FILTER_CODES.soften));
  direct(CMD.IMAGE_BLUR_SOFTEN_MORE, "Soften More", kernel(FILTER_CODES.softenMore));
  direct(CMD.IMAGE_SHARPEN_SHARPEN, "Sharpen", kernel(FILTER_CODES.sharpen));
  direct(CMD.IMAGE_SHARPEN_SHARPEN_MORE, "Sharpen More", kernel(FILTER_CODES.sharpenMore));
  direct(CMD.IMAGE_EDGE_ENHANCE, "Edge Enhance", kernel(FILTER_CODES.enhance));
  direct(CMD.IMAGE_EDGE_ENHANCE_MORE, "Edge Enhance More", kernel(FILTER_CODES.enhanceMore));
  direct(CMD.IMAGE_EDGE_FIND_ALL, "Find Edges", kernel(FILTER_CODES.findAll));
  direct(CMD.IMAGE_EDGE_FIND_HORIZONTAL, "Find Horizontal Edges", kernel(FILTER_CODES.findHorizontal));
  direct(CMD.IMAGE_EDGE_FIND_VERTICAL, "Find Vertical Edges", kernel(FILTER_CODES.findVertical));
  direct(CMD.IMAGE_EDGE_TRACE_CONTOUR, "Trace Contour", kernel(FILTER_CODES.trace));
  direct(CMD.IMAGE_OTHER_EMBOSS, "Emboss", kernel(FILTER_CODES.emboss));
  direct(CMD.IMAGE_NOISE_DESPECKLE, "Despeckle", despeckle);
  direct(CMD.IMAGE_NOISE_MEDIAN_CUT, "Median Cut", (r) => rank3(r, "median"));
  direct(CMD.IMAGE_OTHER_DILATE, "Dilate", (r) => rank3(r, "dilate"));
  direct(CMD.IMAGE_OTHER_ERODE, "Erode", (r) => rank3(r, "erode"));
  direct(CMD.IMAGE_OTHER_HOT_WAX_COATING, "Hot Wax Coating", (r) => hotWax(r, [colors.fg[0], colors.fg[1], colors.fg[2]]));

  const dialog = (id: number, c: Parameters<typeof runPreviewed>[1]) => registry.bind(id, () => runPreviewed(ed, c, remembered), { enabled: trueColor });

  dialog(CMD.IMAGE_BLUR_GAUSSIAN_BLUR, {
    title: "Gaussian Blur", controls: [num("radius", "Radius", 0.01, 100, 0.01)], defaults: { radius: 1 },
    op: (v) => (r) => gaussianBlur(r, Number(v.radius)),
  });
  dialog(CMD.IMAGE_BLUR_MOTION_BLUR, {
    title: "Motion Blur", controls: [range("angle", "Angle", 0, 359), range("intensity", "Intensity (pixels)", 1, 40)], defaults: { angle: 0, intensity: 4 },
    op: (v) => (r) => motionBlur(r, Number(v.angle), Number(v.intensity)),
  });
  dialog(CMD.IMAGE_SHARPEN_UNSHARP_MASK, {
    title: "Unsharp Mask",
    controls: [num("radius", "Radius", 0.01, 100, 0.01), num("strength", "Strength (%)", 1, 500), num("clipping", "Clipping", 0, 100)],
    defaults: { radius: 2, strength: 100, clipping: 5 },
    op: (v) => (r) => unsharpMask(r, Number(v.radius), Number(v.strength), Number(v.clipping)),
  });
  dialog(CMD.IMAGE_NOISE_ADD, {
    title: "Add Noise",
    controls: [range("noise", "% Noise", 0, 100), { key: "mode", label: "Type", type: "radio", choices: ["Random", "Uniform"] }],
    defaults: { noise: 50, mode: "Random" },
    op: (v) => (r) => addNoise(r, Number(v.noise), v.mode === "Uniform"),
  });
  dialog(CMD.IMAGE_OTHER_MOSAIC, {
    title: "Mosaic",
    controls: [range("width", "Block Width", 1, 100), range("height", "Block Height", 1, 100), { key: "symmetric", label: "Symmetric", type: "check" }],
    defaults: { width: 1, height: 1, symmetric: true },
    op: (v) => (r) => mosaic(r, Number(v.width), Number(v.symmetric ? v.width : v.height)),
  });
}
