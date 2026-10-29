/*
  Image > Filter Browser (DIALOG 156) and Image > Deformations > Deformation Browser
  (DIALOG 155): the filters or deformations by name, a sample preview of the selected one on
  a small copy of the active layer with its default settings, and OK running that command
  (with its own dialog when it has one).
*/
import type { Editor } from "./editor.ts";
import type { Colors } from "./colors.ts";
import { CMD, plainLabel, type CommandRegistry } from "../ui/shell/commands.ts";
import { el } from "../shared/dom.ts";
import { openDialog } from "../ui/shell/dialog.ts";
import { targetLayer } from "../core/edit/apply-filter.ts";
import { resample } from "../core/image/resample.ts";
import type { Raster } from "../core/image/raster.ts";
import { convolve, KERNELS, FILTER_CODES } from "../core/filters/convolve.ts";
import { addNoise, despeckle, gaussianBlur, mosaic, motionBlur, rank3, unsharpMask, hotWax } from "../core/filters/filters.ts";
import { circle } from "../core/deform/circle.ts";
import { pentagon } from "../core/deform/pentagon.ts";
import { wind } from "../core/deform/wind.ts";
import { perspectiveHorizontal, perspectiveVertical } from "../core/deform/perspective.ts";
import { skew } from "../core/deform/skew.ts";
import { wave, WAVE_DEFAULTS } from "../core/deform/wave.ts";
import { ripple, RIPPLE_DEFAULTS } from "../core/deform/ripple.ts";
import { twirl } from "../core/deform/twirl.ts";
import { cylinderHorizontal, cylinderVertical, pinch, punch } from "../core/deform/pinch.ts";
import { CURLY_DEFAULTS, curlyQs, HALO_DEFAULTS, rotatingMirror, spikyHalo, warp, WARP_DEFAULTS } from "../core/deform/mirror.ts";

type Op = (r: Raster) => Raster;

export function bindBrowseCommands(registry: CommandRegistry, ed: Editor, colors: Colors): void {
  const bg = (): [number, number, number] => [colors.bg[0], colors.bg[1], colors.bg[2]];
  const fg = (): [number, number, number] => [colors.fg[0], colors.fg[1], colors.fg[2]];
  const k = (code: number): Op => (r) => convolve(r, KERNELS[code]);
  const filters: [number, Op][] = [
    [CMD.IMAGE_BLUR_BLUR, k(FILTER_CODES.blur)], [CMD.IMAGE_BLUR_BLUR_MORE, k(FILTER_CODES.blurMore)], [CMD.IMAGE_BLUR_GAUSSIAN_BLUR, (r) => gaussianBlur(r, 1)],
    [CMD.IMAGE_BLUR_MOTION_BLUR, (r) => motionBlur(r, 0, 4)], [CMD.IMAGE_BLUR_SOFTEN, k(FILTER_CODES.soften)], [CMD.IMAGE_BLUR_SOFTEN_MORE, k(FILTER_CODES.softenMore)],
    [CMD.IMAGE_EDGE_ENHANCE, k(FILTER_CODES.enhance)], [CMD.IMAGE_EDGE_ENHANCE_MORE, k(FILTER_CODES.enhanceMore)], [CMD.IMAGE_EDGE_FIND_ALL, k(FILTER_CODES.findAll)],
    [CMD.IMAGE_EDGE_FIND_HORIZONTAL, k(FILTER_CODES.findHorizontal)], [CMD.IMAGE_EDGE_FIND_VERTICAL, k(FILTER_CODES.findVertical)], [CMD.IMAGE_EDGE_TRACE_CONTOUR, k(FILTER_CODES.trace)],
    [CMD.IMAGE_NOISE_ADD, (r) => addNoise(r, 50, false)], [CMD.IMAGE_NOISE_DESPECKLE, despeckle], [CMD.IMAGE_NOISE_MEDIAN_CUT, (r) => rank3(r, "median")],
    [CMD.IMAGE_SHARPEN_SHARPEN, k(FILTER_CODES.sharpen)], [CMD.IMAGE_SHARPEN_SHARPEN_MORE, k(FILTER_CODES.sharpenMore)], [CMD.IMAGE_SHARPEN_UNSHARP_MASK, (r) => unsharpMask(r, 2, 100, 5)],
    [CMD.IMAGE_OTHER_DILATE, (r) => rank3(r, "dilate")], [CMD.IMAGE_OTHER_EMBOSS, k(FILTER_CODES.emboss)], [CMD.IMAGE_OTHER_ERODE, (r) => rank3(r, "erode")],
    [CMD.IMAGE_OTHER_HOT_WAX_COATING, (r) => hotWax(r, fg())], [CMD.IMAGE_OTHER_MOSAIC, (r) => mosaic(r, 5, 5)],
  ];
  const deformations: [number, Op][] = [
    [CMD.IMAGE_DEFORMATIONS_CIRCLE, (r) => circle(r, bg())], [CMD.IMAGE_DEFORMATIONS_CYLINDER_HORIZONTAL, (r) => cylinderHorizontal(r, 50)],
    [CMD.IMAGE_DEFORMATIONS_CYLINDER_VERTICAL, (r) => cylinderVertical(r, 50)], [CMD.IMAGE_DEFORMATIONS_CURLYQS, (r) => curlyQs(r, CURLY_DEFAULTS)],
    [CMD.IMAGE_DEFORMATIONS_PENTAGON, (r) => pentagon(r, bg())], [CMD.IMAGE_DEFORMATIONS_PERSPECTIVE_HORIZONTAL, (r) => perspectiveHorizontal(r, 45, bg())],
    [CMD.IMAGE_DEFORMATIONS_PERSPECTIVE_VERTICAL, (r) => perspectiveVertical(r, 45, bg())], [CMD.IMAGE_DEFORMATIONS_PINCH, (r) => pinch(r, 50)],
    [CMD.IMAGE_DEFORMATIONS_PUNCH, (r) => punch(r, 50)], [CMD.IMAGE_DEFORMATIONS_RIPPLE, (r) => ripple(r, RIPPLE_DEFAULTS)],
    [CMD.IMAGE_DEFORMATIONS_ROTATING_MIRROR, (r) => rotatingMirror(r, { horizontal: 0, vertical: 0, rotation: 0 })], [CMD.IMAGE_DEFORMATIONS_SKEW, (r) => skew(r, { horizontal: 25, vertical: 25 }, bg())],
    [CMD.IMAGE_DEFORMATIONS_SPIKY_HALO, (r) => spikyHalo(r, HALO_DEFAULTS)], [CMD.IMAGE_DEFORMATIONS_TWIRL, (r) => twirl(r, 180)],
    [CMD.IMAGE_DEFORMATIONS_WARP, (r) => warp(r, WARP_DEFAULTS)], [CMD.IMAGE_DEFORMATIONS_WAVE, (r) => wave(r, WAVE_DEFAULTS)],
    [CMD.IMAGE_DEFORMATIONS_WIND, (r) => wind(r, { strength: 10, fromRight: true })],
  ];

  const browse = async (title: string, label: string, items: [number, Op][]) => {
    const image = ed.image;
    if (!image) return;
    const src = targetLayer(image.doc).raster;
    const scale = Math.min(1, 160 / Math.max(src.width, src.height));
    const sample = scale < 1 ? resample(src, Math.max(4, Math.round(src.width * scale)), Math.max(4, Math.round(src.height * scale)), "smart") : src;
    const named = items.map(([id, op]) => ({ id, op, name: plainLabel(registry.get(id)?.label ?? String(id)).replace(/\.\.\.$/, "") })).sort((a, b) => a.name.localeCompare(b.name));
    const list = el("select", { size: 12, class: "browser-list" }, ...named.map((n) => el("option", { value: String(n.id) }, n.name)));
    const canvas = el("canvas", { width: sample.width, height: sample.height, class: "browser-preview" }) as HTMLCanvasElement;
    const show = () => {
      const item = named.find((n) => String(n.id) === list.value);
      if (!item) return;
      const r = item.op(sample);
      canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
    };
    list.addEventListener("change", show);
    list.value = String(named[0]?.id ?? "");
    show();
    const v = await openDialog({
      title, body: el("div", { class: "browser-body" }, el("label", { class: "form-row" }, el("span", {}, label), list), el("fieldset", { class: "opt-group" }, el("legend", {}, "Sample preview"), canvas)),
      buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    });
    if (v === "ok" && list.value) registry.get(Number(list.value))?.run?.();
  };
  const has = () => ed.image !== null;
  registry.bind(CMD.IMAGE_FILTER_BROWSER, () => browse("Filter Browser", "Filter name:", filters), { enabled: has });
  registry.bind(CMD.IMAGE_DEFORMATIONS_DEFORMATION_BROWSER, () => browse("Deformation Browser", "Deformation name:", deformations), { enabled: has });
}
