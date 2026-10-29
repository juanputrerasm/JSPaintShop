/*
  Image > Effects > Glowing Edges (Psp.exe 0x557fc0) and Neon Glow (0x556d60);
  docs/PSP_EXE_ANALYSIS.md section 8. Rows are PSP's: "below" is the image row under the
  pixel; edges repeat. Channels are named in PSP's blue, green, red order where it matters.
*/
import { cloneRaster, type Raster } from "../image/raster.ts";
import { convolve, KERNELS } from "../filters/convolve.ts";

export interface GlowingEdgesParams { intensity: number; sharpness: number }
export const GLOWING_EDGES_DEFAULTS: GlowingEdgesParams = { intensity: 3, sharpness: 20 };

/* Soften first, then four rotated edge sums per channel, each floored at 0, totalled. */
export function glowingEdges(src: Raster, p: GlowingEdgesParams): Raster {
  const soft = convolve(src, KERNELS[30]);
  const { width: W, height: H } = src, s = soft.data;
  const out = cloneRaster(src), d = out.data;
  const w = Math.trunc(p.intensity), threshold = Math.trunc((Math.trunc(p.sharpness) * 255) / 100);
  const at = (x: number, y: number, c: number) => s[((y < 0 ? 0 : y >= H ? H - 1 : y) * W + (x < 0 ? 0 : x >= W ? W - 1 : x)) * 4 + c];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
    const b = at(x, y + 1, c), l = at(x - 1, y, c), r = at(x + 1, y, c), a = at(x, y - 1, c);
    const sums = [w * b - w * l + w * r - w * a, -w * b - w * l + w * r + w * a, -w * b + w * l - w * r + w * a, w * b + w * l - w * r - w * a];
    let t = 0;
    for (const v of sums) if (v > 0) t += v;
    if (t < threshold) t = 0;
    d[(y * W + x) * 4 + c] = Math.min(255, Math.trunc((t * 150) / 100));
  }
  return out;
}

export interface NeonGlowParams { intensity: number; opacity: number }
export const NEON_GLOW_DEFAULTS: NeonGlowParams = { intensity: 50, opacity: 50 };

/*
  The pencil kernel (−200 below, 200 left, k centre, −200 right, 200 above, k = 101 − intensity)
  divided by k, clamped, inverted and blended by the opacity. PSP reads some taps from the wrong
  channel (blue's sum takes red at the centre and left, green's and red's take the left pixel's
  previous channel); that is kept.
*/
export function neonGlow(src: Raster, p: NeonGlowParams): Raster {
  const { width: W, height: H, data: s } = src;
  const out = cloneRaster(src), d = out.data;
  const k = Math.max(1, 101 - Math.trunc(p.intensity));
  const o = Math.trunc((Math.trunc(p.opacity) * 255) / 100), io = 255 - o;
  // PSP channel 0 = blue (RGBA index 2), 1 = green, 2 = red (index 0).
  const at = (x: number, y: number, pc: number) => s[((y < 0 ? 0 : y >= H ? H - 1 : y) * W + (x < 0 ? 0 : x >= W ? W - 1 : x)) * 4 + 2 - pc];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sums = [
      -200 * at(x, y + 1, 0) + 200 * at(x - 1, y, 0) + k * at(x - 1, y, 2) - 200 * at(x, y, 2) + 200 * at(x, y - 1, 0),
      -200 * at(x, y + 1, 1) + 200 * at(x - 1, y, 0) + k * at(x, y, 0) - 200 * at(x + 1, y, 0) + 200 * at(x, y - 1, 1),
      -200 * at(x, y + 1, 2) + 200 * at(x - 1, y, 1) + k * at(x, y, 1) - 200 * at(x + 1, y, 1) + 200 * at(x, y - 1, 2),
    ];
    const i = (y * W + x) * 4;
    for (let pc = 0; pc < 3; pc++) {
      let v = Math.trunc(sums[pc] / k);
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      const c = 2 - pc;
      d[i + c] = Math.trunc(((255 - v) * o + s[i + c] * io) / 255);
    }
  }
  return out;
}
