/*
  Image > Effects > Texture (Psp.exe 0x795710, DIALOG 480) and Sculpture (0x74dab0, DIALOG 479);
  docs/PSP_EXE_ANALYSIS.md section 8. Both tile a resource from the top-left (GenerateTiles,
  0x58a820; resized to Size % first when it is not 100) and light with the shared model:
    Texture    the texture (grey) is the height map, the image is lit
    Sculpture  the image's grey is the height map, the pattern (or a solid color) is lit
  The height map gets a one-pixel border of zeros and, with Smoothness, a Gaussian of
  smoothness/10; without smoothness the outermost pixels get the flat lighting.
*/
import { cloneRaster, createRaster, type Raster } from "../image/raster.ts";
import { luminance } from "../color/color-space.ts";
import { resample } from "../image/resample.ts";
import { gaussianPlane } from "../filters/filters.ts";
import { lightSurface, LIGHT_DEFAULTS, type Light } from "./bevel.ts";

export interface SurfaceParams extends Light {
  /** Size %, 10..500. */
  size: number;
  smoothness: number;
}

export const TEXTURE_DEFAULTS: SurfaceParams = { ...LIGHT_DEFAULTS, depth: 1, size: 100, smoothness: 0 };
export const SCULPTURE_DEFAULTS: SurfaceParams = { ...LIGHT_DEFAULTS, size: 100, smoothness: 0 };
/** Sculpture's default pattern: the solid color "|4365769". */
export const SCULPTURE_COLOR: [number, number, number] = [201, 157, 66];

/* Tile `src` over w x h from the top-left, resized to size % first. */
export function tile(src: Raster, w: number, h: number, size: number): Raster {
  const s = Math.trunc(size) === 100 ? src : resample(src, Math.max(1, Math.trunc((src.width * Math.trunc(size)) / 100)), Math.max(1, Math.trunc((src.height * Math.trunc(size)) / 100)), "smart");
  const out = createRaster(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (((y % s.height) * s.width) + (x % s.width)) * 4;
    out.data.set(s.data.subarray(p, p + 4), (y * w + x) * 4);
  }
  return out;
}

function heightFrom(grey: Uint8Array, W: number, H: number, smoothness: number): Uint8Array {
  const P = new Uint8Array((W + 2) * (H + 2));
  for (let y = 0; y < H; y++) P.set(grey.subarray(y * W, y * W + W), (y + 1) * (W + 2) + 1);
  return smoothness > 0 ? gaussianPlane(P, W + 2, H + 2, smoothness * 10 * 0.01) : P;
}

const greyOf = (r: Raster) => { const g = new Uint8Array(r.width * r.height); for (let i = 0; i < g.length; i++) g[i] = luminance(r.data[i * 4], r.data[i * 4 + 1], r.data[i * 4 + 2]); return g; };

/** Texture: `tex` is the texture (a grey or color bitmap). */
export function texture(image: Raster, tex: Raster, p: SurfaceParams, selection: Uint8Array | null): Raster {
  const { width: W, height: H } = image;
  const Hm = heightFrom(greyOf(tile(tex, W, H, p.size)), W, H, p.smoothness);
  return lightSurface(image, Hm, p, selection, undefined, p.smoothness ? 0 : 1);
}

/** Sculpture: `pattern` is a pattern bitmap or a solid color. */
export function sculpture(image: Raster, pattern: Raster | readonly [number, number, number], p: SurfaceParams, selection: Uint8Array | null): Raster {
  const { width: W, height: H } = image;
  const g = greyOf(image);
  for (let i = 0; i < g.length; i++) g[i] = Math.trunc((g[i] * image.data[i * 4 + 3]) / 255);
  const Hm = heightFrom(g, W, H, p.smoothness);
  const surface = "data" in pattern ? tile(pattern, W, H, p.size) : createRaster(W, H, [pattern[0], pattern[1], pattern[2], 255]);
  const lit = lightSurface(surface, Hm, p, selection, undefined, p.smoothness ? 0 : 1);
  // Keep the layer's own transparency.
  const out = cloneRaster(image);
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = lit.data[i]; out.data[i + 1] = lit.data[i + 1]; out.data[i + 2] = lit.data[i + 2]; }
  return out;
}
