/*
  The fixed-kernel filters of Image > Blur, Edge, Sharpen and Other, as PSP 6 runs them
  (Psp.exe 0x802df0 and 0x7db180, 3 x 3 and 5 x 5 routines; docs/PSP_EXE_ANALYSIS.md
  section 7): each channel's weighted sum, divided (integer) by the kernel's divisor, plus
  its bias, clamped. Edge pixels repeat. Transparent pixels count by their opacity: colors
  are weighted by alpha and divided back by the filtered alpha.

  The kernels are PSP's own, by its filter codes, rows as PSP stores them. PSP's bitmaps run
  bottom-up, so a kernel's first row weighs the image row below the pixel and its last row the
  row above: convolve() samples them that way.
*/
import { createRaster, type Raster } from "../image/raster.ts";

export interface Kernel { size: number; k: number[]; div: number; bias: number }

const k3 = (k: number[], div: number, bias = 0): Kernel => ({ size: 3, k, div, bias });
const k5 = (k: number[], div: number, bias = 0): Kernel => ({ size: 5, k, div, bias });

/* PSP's kernels by filter code, the 3 x 3 ones read from the top-left of its 5 x 5 table. */
export const KERNELS: Record<number, Kernel> = {
  1: k3([-1, 0, 0, 0, 0, 0, 0, 0, 1], 1, 128),
  2: k3([1, 0, 0, 0, 0, 0, 0, 0, -1], 1, 128),
  10: k5([1, 1, 2, 1, 1, 1, 2, 2, 2, 1, 2, 2, 8, 2, 2, 1, 2, 2, 2, 1, 1, 1, 2, 1, 1], 44),
  11: k5(new Array(25).fill(1), 25),
  20: k3([0, -1, 0, -1, 10, -1, 0, -1, 0], 6),
  21: k5([-1, -1, -1, -1, -1, -1, -2, -2, -2, -1, -1, -2, 64, -2, -1, -1, -2, -2, -2, -1, -1, -1, -1, -1, -1], 32),
  30: k3([6, 12, 6, 12, 25, 12, 6, 12, 6], 97),
  31: k3([1, 1, 1, 1, 1, 1, 1, 1, 1], 9),
  // Trace Contour: Enhance More's kernel with divisor 1 and bias 255 (the case enters past the 0 bias).
  40: k3([-1, -1, -1, -1, 9, -1, -1, -1, -1], 1, 255),
  50: k3([0, 1, 0, 1, -5, 1, 0, 1, 0], -1),
  51: k3([-1, -1, -1, -1, 9, -1, -1, -1, -1], 1),
  61: k3([-1, -1, -1, -1, 8, -1, -1, -1, -1], 1),
  62: k3([-1, -1, -1, 0, 0, 0, 1, 1, 1], 1),
  63: k3([-1, 0, 1, -1, 0, 1, -1, 0, 1], 1),
};

/** The filters by command: their PSP filter codes. */
export const FILTER_CODES = {
  blur: 10, blurMore: 11, soften: 30, softenMore: 31, sharpen: 20, sharpenMore: 21,
  enhance: 50, enhanceMore: 51, findAll: 61, findHorizontal: 62, findVertical: 63, emboss: 1, trace: 40,
} as const;

export function convolve(src: Raster, kern: Kernel): Raster {
  const { width: w, height: h, data: s } = src;
  const out = createRaster(w, h), d = out.data;
  const r = kern.size >> 1, n = kern.size;
  const div = kern.div || 1;
  const at = (x: number, y: number) => ((y < 0 ? 0 : y >= h ? h - 1 : y) * w + (x < 0 ? 0 : x >= w ? w - 1 : x)) * 4;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sa = 0, sr = 0, sg = 0, sb = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const c = kern.k[j * n + i];
      if (!c) continue;
      const p = at(x + i - r, y + r - j), a = s[p + 3];
      sa += a * c;
      sr += s[p] * a * c; sg += s[p + 1] * a * c; sb += s[p + 2] * a * c;
    }
    const o = (y * w + x) * 4;
    // Sums of alpha-weighted colors: divided back out by 255 (opaque) or by the filtered alpha.
    const col = (v: number) => clamp(Math.trunc(Math.trunc(v / 255) / div) + kern.bias);
    if (isOpaqueAround(s, at, x, y, r)) {
      d[o] = col(sr); d[o + 1] = col(sg); d[o + 2] = col(sb); d[o + 3] = 255;
    } else {
      const alpha = clamp(Math.trunc(sa / div));
      const a = alpha || 1;
      d[o] = clamp((col(sr) * 255) / a); d[o + 1] = clamp((col(sg) * 255) / a); d[o + 2] = clamp((col(sb) * 255) / a);
      d[o + 3] = alpha;
    }
  }
  return out;
}

function isOpaqueAround(s: Uint8ClampedArray, at: (x: number, y: number) => number, x: number, y: number, r: number): boolean {
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (s[at(x + i, y + j) + 3] !== 255) return false;
  return true;
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.trunc(v);
}

/** Image > User Defined Filters: a 7 x 7 matrix (PSP 6; 5 x 5 in older files), division factor and bias. */
export function userFilter(src: Raster, matrix: number[], div: number, bias: number): Raster {
  return convolve(src, { size: Math.round(Math.sqrt(matrix.length)), k: matrix, div: div || 1, bias });
}
