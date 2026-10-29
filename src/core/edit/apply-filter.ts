/*
  Running a pixel operation (an adjustment, a filter, an effect) on the image as PSP does:
  on the floating selection when there is one, else on the active layer; inside a selection
  only, its partly selected pixels mixed by the selection; never changing alpha on a layer
  with its transparency locked. The operation gets a copy of the whole layer (filters read
  their neighbours) and returns the new pixels.
*/
import type { ImageDoc, Layer } from "../doc/image-doc.ts";
import { cloneRaster, type Raster } from "../image/raster.ts";
import { floatingIndex } from "../select/floating.ts";

export type PixelOp = (r: Raster) => Raster | void;

export function targetLayer(doc: ImageDoc): Layer {
  const f = floatingIndex(doc);
  return doc.layers[f >= 0 ? f : doc.active];
}

/** The operation's result, inside the selection, on a copy of `src`. */
export function applyOp(src: Raster, op: PixelOp, selection: { data: Uint8Array } | null, lockAlpha: boolean): Raster {
  const work = cloneRaster(src);
  const res = op(work) ?? work;
  if (!selection && !lockAlpha && res.width === src.width && res.height === src.height) return res;
  const out = cloneRaster(src), s = src.data, r = res.data, d = out.data;
  for (let p = 0; p < src.width * src.height; p++) {
    const m = selection ? selection.data[p] : 255;
    if (!m) continue;
    const i = p * 4, k = m / 255;
    for (let c = 0; c < 3; c++) d[i + c] = s[i + c] + (r[i + c] - s[i + c]) * k;
    if (!lockAlpha) d[i + 3] = s[i + 3] + (r[i + 3] - s[i + 3]) * k;
  }
  return out;
}

/**
  Run `op` on the target layer of `doc` (as one undo step when called inside Editor.run).
  `unclipped` is for effects that use the selection themselves and paint outside it (Drop
  Shadow, Cutout, Chisel).
*/
export function filterLayer(doc: ImageDoc, op: PixelOp, unclipped = false): void {
  const layer = targetLayer(doc);
  // A floating selection's own shape already limits it.
  const sel = unclipped || floatingIndex(doc) >= 0 ? null : doc.selection;
  layer.raster = applyOp(layer.raster, op, sel, layer.lockTransparency);
}
