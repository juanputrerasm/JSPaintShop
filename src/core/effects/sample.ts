/*
  PSP's bilinear sampler for the geometric effects and deformations (Psp.exe 0x445df0): the
  position in 8.8 fixed point, each corner weight truncated to 8 bits, the sum truncated. A pixel
  on a whole position is copied. Positions not strictly inside (x, y > 0 and below the last
  pixel) go to the edge mode the effect chose (0x445c00):
    0  leave the target pixel as it is (sampleBilinear returns false)
    1  wrap around (0x446670)
    2  PSP clamps (0x446930) and then falls through to mode 3, so it behaves as 3
    3  neighbours outside the image take the background color (0x4469b0)
*/
import type { Raster } from "../image/raster.ts";

export type EdgeMode = 0 | 1 | 2 | 3;

export function sampleBilinear(r: Raster, x256: number, y256: number, out: number[] | Uint8ClampedArray, at = 0, mode: EdgeMode = 3, bg: readonly number[] = [0, 0, 0]): boolean {
  const { width: W, height: H, data: s } = r;
  const ix = x256 >> 8, iy = y256 >> 8, fx = x256 & 0xff, fy = y256 & 0xff;
  const inside = x256 > 0 && y256 > 0 && x256 < (W - 1) * 256 && y256 < (H - 1) * 256;
  if (inside && !fx && !fy) {
    const p = (iy * W + ix) * 4;
    out[at] = s[p]; out[at + 1] = s[p + 1]; out[at + 2] = s[p + 2]; out[at + 3] = s[p + 3];
    return true;
  }
  if (!inside && mode === 0) return false;
  const w00 = ((256 - fy) * (256 - fx)) >> 8, w10 = ((256 - fy) * fx) >> 8, w01 = ((256 - fx) * fy) >> 8, w11 = (fy * fx) >> 8;
  const wrap = (v: number, n: number) => ((v % n) + n) % n;
  const get = (x: number, y: number, c: number): number => {
    if (inside) return s[(y * W + x) * 4 + c];
    if (mode === 1) return s[(wrap(y, H) * W + wrap(x, W)) * 4 + c];
    if (x < 0 || y < 0 || x >= W || y >= H) return c < 3 ? bg[c] : 255;
    return s[(y * W + x) * 4 + c];
  };
  for (let c = 0; c < 4; c++) out[at + c] = (get(ix, iy, c) * w00 + get(ix + 1, iy, c) * w10 + get(ix, iy + 1, c) * w01 + get(ix + 1, iy + 1, c) * w11) >> 8;
  return true;
}

/* Mirror `v` back into [lo, hi] as PSP's folding loops do. */
export function fold(v: number, lo: number, hi: number): number {
  if (hi <= lo) return lo;
  for (let i = 0; i < 64 && (v > hi || v < lo); i++) {
    if (v > hi) v = 2 * hi - v;
    if (v < lo) v = 2 * lo - v;
  }
  return Math.max(lo, Math.min(hi, v));
}
