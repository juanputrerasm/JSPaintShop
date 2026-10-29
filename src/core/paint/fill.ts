/*
  Flood Fill: the region the click picks (by Match mode and Tolerance, or everything with
  Match mode None), kept inside the selection, filled with the fill style (a solid color, a
  pattern, or one of the four gradients) through a blend mode and opacity.

  A gradient spans the region's bounding box, as PSP's does.
*/
import { maskBounds, type Mask, type Raster, type Rgba } from "../image/raster.ts";
import { blendPixel, MUL } from "../layers/blend.ts";
import { floodRegion, type MatchMode } from "../select/selection.ts";
import { gradientPosition, type GradientFill } from "./gradient.ts";

export type FillSource =
  | { kind: "solid"; color: Rgba }
  | { kind: "gradient"; table: Uint8ClampedArray; fill: GradientFill }
  | { kind: "pattern"; pattern: Raster; offsetX: number; offsetY: number };

export interface FillOptions {
  /** null: Match mode None (fill the whole selection or layer). */
  match: MatchMode | null;
  tolerance: number;
  blend: number;
  /** 0..1. */
  opacity: number;
  /** What the match is read from: the layer, or the merged image (Sample merged). */
  sample: Raster;
  selection: Mask | null;
  lockTransparency: boolean;
  paper?: { width: number; height: number; data: Uint8Array } | null;
}

/** The pixels a fill at (x, y) covers, 0..255. */
export function fillRegion(x: number, y: number, o: FillOptions): Mask {
  const { width: w, height: h } = o.sample;
  const region = o.match ? floodRegion(o.sample, x, y, o.match, o.tolerance) : { width: w, height: h, data: new Uint8Array(w * h).fill(255) };
  if (o.selection) for (let p = 0; p < region.data.length; p++) region.data[p] = Math.min(region.data[p], o.selection.data[p]);
  return region;
}

/** A fill source's color at a pixel, for a region with the given bounds. */
export function sourceColor(src: FillSource, x: number, y: number, b: { minX: number; minY: number; maxX: number; maxY: number }, out: number[]): void {
  if (src.kind === "solid") { out[0] = src.color[0]; out[1] = src.color[1]; out[2] = src.color[2]; out[3] = src.color[3]; return; }
  if (src.kind === "gradient") {
    const t = gradientPosition(src.fill, x - b.minX + 0.5, y - b.minY + 0.5, b.maxX - b.minX + 1, b.maxY - b.minY + 1);
    const i = Math.round(t * 255) * 4;
    out[0] = src.table[i]; out[1] = src.table[i + 1]; out[2] = src.table[i + 2]; out[3] = src.table[i + 3];
    return;
  }
  const pw = src.pattern.width, ph = src.pattern.height;
  const px = (((x - src.offsetX) % pw) + pw) % pw, py = (((y - src.offsetY) % ph) + ph) % ph;
  const i = (py * pw + px) * 4;
  out[0] = src.pattern.data[i]; out[1] = src.pattern.data[i + 1]; out[2] = src.pattern.data[i + 2]; out[3] = src.pattern.data[i + 3];
}

/** Fill `target` (a copy is returned) with `src` over the region. */
export function floodFill(target: Raster, region: Mask, src: FillSource, o: FillOptions): Raster {
  const out: Raster = { width: target.width, height: target.height, data: new Uint8ClampedArray(target.data) };
  const b = maskBounds(region);
  if (!b) return out;
  const c = [0, 0, 0, 0], w = target.width;
  for (let y = b.minY; y <= b.maxY; y++) for (let x = b.minX; x <= b.maxX; x++) {
    const p = y * w + x;
    let cover = region.data[p];
    if (o.paper) cover = MUL[cover * o.paper.data[(y % o.paper.height) * o.paper.width + (x % o.paper.width)]];
    if (cover === 0) continue;
    sourceColor(src, x, y, b, c);
    blendPixel(out.data, p * 4, o.blend, c[0], c[1], c[2], MUL[c[3] * cover], Math.round(o.opacity * 255), x, y, o.lockTransparency);
  }
  return out;
}
