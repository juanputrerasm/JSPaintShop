/*
  Image > Effects > Drop Shadow (Psp.exe 0x53d860, DIALOG 199; docs/PSP_EXE_ANALYSIS.md
  section 8). The shadow's shape is the selection, or the layer's transparency when nothing is
  selected; it is grown by the blur (rounded up), blurred with a Gaussian of a third of it,
  offset, and laid on the layer everywhere but over the shape itself.

  A layer without transparency (the background) mixes the shadow color into its pixels; a
  layer with transparency lays the shadow over them and gains its opacity.
*/
import { MUL } from "../layers/blend.ts";
import { gaussianPlane } from "../filters/filters.ts";
import { cloneRaster, maskBounds, type Mask, type Raster } from "../image/raster.ts";

export interface DropShadowParams {
  color: readonly [number, number, number];
  /** 1..100 in the dialog; PSP keeps trunc(percent · 255 / 100). */
  opacity: number;
  /** 0..100 in tenths. */
  blur: number;
  /** Offsets, -100..100; positive goes right and down. */
  horizontal: number;
  vertical: number;
}

export const DROP_SHADOW_DEFAULTS: DropShadowParams = { color: [0, 0, 0], opacity: 50, blur: 5, horizontal: 10, vertical: 10 };

/**
  The layer with its shadow. `shape` is the selection (canvas-sized) or null for the layer's
  transparency; `opaque` says the layer has no transparency of its own (the background).
*/
export function dropShadow(layer: Raster, shape: Mask | null, opaque: boolean, p: DropShadowParams, lockAlpha = false): Raster {
  const { width: W, height: H } = layer;
  const src = shape ?? (opaque ? null : alphaMask(layer));
  const out = cloneRaster(layer);
  if (!src) return out;
  const r = maskBounds(src);
  if (!r) return out;
  const w = r.maxX - r.minX + 1, h = r.maxY - r.minY + 1;
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = src.data[(r.minY + y) * W + r.minX + x];

  const op = Math.trunc((Math.max(1, Math.min(100, p.opacity)) * 255) / 100);
  let b = 0, sw = w, sh = h, s = m;
  if (p.blur > 0) {
    b = Math.trunc(p.blur + 0.99);
    sw = w + 2 * b; sh = h + 2 * b;
    const grown = new Uint8Array(sw * sh);
    for (let y = 0; y < h; y++) grown.set(m.subarray(y * w, y * w + w), (y + b) * sw + b);
    s = gaussianPlane(grown, sw, sh, p.blur / 3);
  }
  const [cr, cg, cb] = p.color, d = out.data;
  const ox = r.minX - b + Math.trunc(p.horizontal), oy = r.minY - b + Math.trunc(p.vertical);
  for (let j = 0; j < sh; j++) {
    const y = oy + j;
    if (y < 0 || y >= H) continue;
    for (let i = 0; i < sw; i++) {
      const x = ox + i, v = s[j * sw + i];
      if (!v || x < 0 || x >= W) continue;
      let a = MUL[v * op];
      // Not over the shape itself.
      if (x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY) a = MUL[(255 - m[(y - r.minY) * w + x - r.minX]) * a];
      const o = (y * W + x) * 4;
      if (opaque) {
        d[o] = MUL[a * cr + (255 - a) * d[o]];
        d[o + 1] = MUL[a * cg + (255 - a) * d[o + 1]];
        d[o + 2] = MUL[a * cb + (255 - a) * d[o + 2]];
      } else {
        const A = d[o + 3], nA = MUL[(255 - A) * a] + A;
        if (!nA) continue;
        if (!lockAlpha) d[o + 3] = nA;
        const t = Math.floor((a * 65536) / nA), u = 65536 - t;
        d[o] = (d[o] * u + 0x8000 + t * cr) >>> 16;
        d[o + 1] = (d[o + 1] * u + 0x8000 + t * cg) >>> 16;
        d[o + 2] = (d[o + 2] * u + 0x8000 + t * cb) >>> 16;
      }
    }
  }
  return out;
}

function alphaMask(r: Raster): Mask {
  const data = new Uint8Array(r.width * r.height);
  for (let i = 0; i < data.length; i++) data[i] = r.data[i * 4 + 3];
  return { width: r.width, height: r.height, data };
}
