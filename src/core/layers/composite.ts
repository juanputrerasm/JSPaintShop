/*
  The composite: the visible layers merged bottom first into one raster the size of the
  canvas, what the image window shows and what a flat file format saves.

  Each layer goes over what is under it with its blend mode, scaled by its opacity and, when
  enabled, its layer mask. An adjustment layer changes the colors of everything under it
  instead, as much as its opacity and mask allow. Layers > View > Current Only shows the
  active layer alone (`only`).
*/
import type { Rect } from "../edit/history.ts";
import { createRaster, type Raster } from "../image/raster.ts";
import type { ImageDoc, Layer } from "../doc/image-doc.ts";
import { blendPixel, MUL } from "./blend.ts";
import { applyAdjustment } from "../color/adjustments.ts";

export interface CompositeOptions { only?: number }

/** Merge into `out` (canvas-sized) within `rect`, or the whole canvas. */
export function composite(doc: ImageDoc, rect?: Rect, out: Raster = createRaster(doc.width, doc.height), options: CompositeOptions = {}): Raster {
  const r = rect ?? { minX: 0, minY: 0, maxX: doc.width - 1, maxY: doc.height - 1 };
  const d = out.data;
  for (let y = r.minY; y <= r.maxY; y++) d.fill(0, (y * doc.width + r.minX) * 4, (y * doc.width + r.maxX + 1) * 4);
  doc.layers.forEach((layer, i) => {
    if (options.only !== undefined ? i !== options.only : !layer.visible) return;
    if (layer.opacity <= 0) return;
    if (layer.kind === "adjustment") adjust(layer, r, out);
    else over(layer, r, out);
  });
  return out;
}

/** The visible layers from `layers` merged into one raster, as Merge Visible and Copy Merged make. */
export function mergeLayers(doc: ImageDoc, layers: Layer[]): Raster {
  return composite({ ...doc, layers }, undefined, createRaster(doc.width, doc.height));
}

function over(layer: Layer, r: Rect, out: Raster): void {
  const src = layer.raster, s = src.data, d = out.data, W = out.width;
  const mask = layer.mask && layer.maskEnabled ? layer.mask.data : null;
  const x0 = Math.max(r.minX, layer.x), x1 = Math.min(r.maxX, layer.x + src.width - 1);
  const y0 = Math.max(r.minY, layer.y), y1 = Math.min(r.maxY, layer.y + src.height - 1);
  const mode = layer.blend, a = layer.opacity;
  for (let y = y0; y <= y1; y++) {
    let si = ((y - layer.y) * src.width + (x0 - layer.x)) * 4;
    let di = (y * W + x0) * 4;
    for (let x = x0; x <= x1; x++, si += 4, di += 4) {
      const sa = mask ? MUL[s[si + 3] * mask[y * W + x]] : s[si + 3];
      if (sa === 0) continue;
      blendPixel(d, di, mode, s[si], s[si + 1], s[si + 2], sa, a, x, y);
    }
  }
}

/* An adjustment layer: the adjusted colors mixed with the originals by opacity and mask. */
function adjust(layer: Layer, r: Rect, out: Raster): void {
  if (!layer.adjustment) return;
  const W = out.width, d = out.data, k = layer.opacity / 255;
  const mask = layer.mask && layer.maskEnabled ? layer.mask.data : null;
  const w = r.maxX - r.minX + 1;
  const row = new Uint8ClampedArray(w * 4);
  for (let y = r.minY; y <= r.maxY; y++) {
    const at = (y * W + r.minX) * 4;
    row.set(d.subarray(at, at + w * 4));
    applyAdjustment(row, layer.adjustment);
    for (let x = 0; x < w; x++) {
      const t = mask ? k * (mask[y * W + r.minX + x] / 255) : k;
      if (t <= 0) continue;
      const o = at + x * 4, q = x * 4;
      d[o] += (row[q] - d[o]) * t; d[o + 1] += (row[q + 1] - d[o + 1]) * t; d[o + 2] += (row[q + 2] - d[o + 2]) * t;
    }
  }
}
