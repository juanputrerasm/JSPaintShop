/*
  Image > Effects > Cutout (Psp.exe 0x53f480, DIALOG 27009; docs/PSP_EXE_ANALYSIS.md
  section 8): the selection becomes a hole, its inside filled (or left as it is) and shaded by
  the shadow the outside casts: the selection mask grown by the larger of the blur (rounded up)
  and each offset, blurred with a Gaussian of a third of the blur, and sampled back by the offset.

  The layer's own transparency path in PSP is not read yet: transparent layers are treated as
  opaque and keep their alpha.
*/
import { MUL } from "../layers/blend.ts";
import { gaussianPlane } from "../filters/filters.ts";
import { cloneRaster, maskBounds, type Mask, type Raster } from "../image/raster.ts";

export interface CutoutParams {
  fill: boolean;
  interior: readonly [number, number, number];
  shadow: readonly [number, number, number];
  /** 1..100 %. */
  opacity: number;
  blur: number;
  horizontal: number;
  vertical: number;
}

export const CUTOUT_DEFAULTS: CutoutParams = { fill: true, interior: [255, 255, 255], shadow: [0, 0, 0], opacity: 50, blur: 5, horizontal: 10, vertical: 10 };

export function cutout(layer: Raster, selection: Mask, p: CutoutParams): Raster {
  const W = layer.width;
  const out = cloneRaster(layer);
  const r = maskBounds(selection);
  if (!r) return out;
  const w = r.maxX - r.minX + 1, h = r.maxY - r.minY + 1;
  const op = Math.trunc((Math.max(1, Math.min(100, p.opacity)) * 255) / 100);
  const b = Math.trunc(p.blur + 0.99);
  const ox = Math.trunc(p.horizontal), oy = Math.trunc(p.vertical);
  const px = Math.max(b, Math.abs(ox)), py = Math.max(b, Math.abs(oy));
  const sw = w + 2 * px, sh = h + 2 * py;
  let s = new Uint8Array(sw * sh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) s[(y + py) * sw + x + px] = selection.data[(r.minY + y) * W + r.minX + x];
  if (b > 0) s = gaussianPlane(s, sw, sh, p.blur / 3);
  const d = out.data;
  for (let y = r.minY; y <= r.maxY; y++) for (let x = r.minX; x <= r.maxX; x++) {
    const sel = selection.data[y * W + x];
    if (!sel) continue;
    const o = (y * W + x) * 4;
    const base = p.fill ? p.interior : [d[o], d[o + 1], d[o + 2]];
    const v = s[(y - r.minY + py - oy) * sw + (x - r.minX + px - ox)];
    let c: number[];
    if (v === 255) c = [base[0], base[1], base[2]];
    else {
      const k = MUL[(255 - v) * op];
      c = [0, 1, 2].map((i) => MUL[k * p.shadow[i] + (255 - k) * base[i]]);
    }
    for (let i = 0; i < 3; i++) d[o + i] = sel === 255 ? c[i] : MUL[c[i] * sel + d[o + i] * (255 - sel)];
  }
  return out;
}
