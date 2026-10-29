/*
  Colors > Decrease Color Depth: palettes and how pixels are put on them
  (docs/PSP_EXE_ANALYSIS.md section 5).

  Palettes
    median cut  PSP's own (Psp.exe 0x7fa9f0, 0x7fb7f0): colors counted at 5 bits per channel,
                the distinct colors split recursively on their widest channel, each box's
                palette entry the plain (unweighted) average of its colors
    octree      PSP's ("OctTree.cpp", 0x692560-0x6941b0): depth 8, reduced as it fills
    standard    the Windows colors (16), PSP's web-safe cube (256: 216 colors, blue outermost)
    windows     the 20 Windows static colors, kept when "Include Windows colors" is on

  Reduction (jdib's 0x7f7cf0 for the 256, 16 and X colors commands)
    nearest     the closest palette color (squared RGB distance, ties to the lower index)
    ordered     PSP's 16 x 16 threshold matrix, on the web cube or the 16 Windows colors
    error       PSP's Floyd-Steinberg: integer shares of each error, top down, left to right;
                "Reduce color bleeding" carries 3/4 of the error
  The 2 colors command keeps its own choices (an 8 x 8 Bayer matrix, Floyd-Steinberg, Burkes,
  Stucki).
*/
import type { Raster } from "../image/raster.ts";

export const WINDOWS_16 = [0, 0, 0, 128, 0, 0, 0, 128, 0, 128, 128, 0, 0, 0, 128, 128, 0, 128, 0, 128, 128, 192, 192, 192, 128, 128, 128, 255, 0, 0, 0, 255, 0, 255, 255, 0, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255];
/* The four extra static colors of the Windows 256-color palette. */
export const WINDOWS_EXTRA = [192, 220, 192, 166, 202, 240, 255, 251, 240, 160, 160, 164];

/** PSP's web-safe cube: entry r + 6g + 36b (0x7f7cf0 builds it blue outermost). */
export function webSafePalette(): Uint8Array {
  const p = new Uint8Array(216 * 3);
  let i = 0;
  for (let b = 0; b < 6; b++) for (let g = 0; g < 6; g++) for (let r = 0; r < 6; r++) { p[i++] = r * 51; p[i++] = g * 51; p[i++] = b * 51; }
  return p;
}

/* The Windows static colors as PSP places them around an optimized palette (0x692980): 10 first, 10 last. */
const WINDOWS_FIRST = [0, 0, 0, 128, 0, 0, 0, 128, 0, 128, 128, 0, 0, 0, 128, 128, 0, 128, 0, 128, 128, 192, 192, 192, 192, 220, 192, 166, 202, 240];
const WINDOWS_LAST = [255, 251, 240, 160, 160, 164, 128, 128, 128, 255, 0, 0, 0, 255, 0, 255, 255, 0, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255];

interface OctNode { leaf: boolean; count: number; r: number; g: number; b: number; kids: (OctNode | null)[] }

/**
  PSP's octree palette (0x693b20 inserts, 0x694480 reduces, 0x6941b0 reads out). Pixels go in
  bottom row first, as the bitmap stores them; whenever there are more leaves than colors, the
  newest node of the deepest level that has any becomes a leaf holding its children. Each
  leaf's color is its integer average. `include` puts the 20 Windows colors around at most 236.
*/
export function octreePalette(r: Raster, colors: number, include = false): Uint8Array {
  const max = Math.max(1, Math.min(include ? 236 : 256, colors)), LEAF = 8;
  const reducible: OctNode[][] = Array.from({ length: LEAF }, () => []);
  let leaves = 0;
  const node = (level: number): OctNode => {
    const n: OctNode = { leaf: level === LEAF, count: 0, r: 0, g: 0, b: 0, kids: [null, null, null, null, null, null, null, null] };
    if (n.leaf) leaves++;
    else reducible[level].push(n);
    return n;
  };
  const root = node(0);
  const reduce = () => {
    let level = LEAF - 1;
    while (level > 0 && !reducible[level].length) level--;
    const n = reducible[level].pop();
    if (!n) return;
    let kids = 0, sr = 0, sg = 0, sb = 0;
    for (let k = 0; k < 8; k++) {
      const c = n.kids[k];
      if (!c) continue;
      sr += c.r; sg += c.g; sb += c.b; n.count += c.count; kids++;
      n.kids[k] = null;
    }
    n.r = sr; n.g = sg; n.b = sb; n.leaf = true;
    leaves += 1 - kids;
  };
  const { width: W, height: H, data: d } = r;
  for (let y = H - 1; y >= 0; y--) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, R = d[i], G = d[i + 1], B = d[i + 2];
    let n = root, level = 0;
    while (!n.leaf) {
      const shift = 7 - level, k = (((R >> shift) & 1) << 2) | (((G >> shift) & 1) << 1) | ((B >> shift) & 1);
      n = n.kids[k] ??= node(level + 1);
      level++;
    }
    n.count++; n.r += R; n.g += G; n.b += B;
    while (leaves > max) reduce();
  }
  const pal: number[] = [];
  const walk = (n: OctNode) => {
    if (n.leaf) { if (n.count) pal.push(Math.trunc(n.r / n.count), Math.trunc(n.g / n.count), Math.trunc(n.b / n.count)); return; }
    for (const c of n.kids) if (c) walk(c);
  };
  walk(root);
  return Uint8Array.from(include ? [...WINDOWS_FIRST, ...pal, ...WINDOWS_LAST] : pal);
}

const expand5 = (c: number) => (c << 3) + (c >> 2);

interface Entry { count: number; color: number }

/* PSP's recursive split (Psp.exe 0x7fb7f0). Writes `budget` palette entries from `out`. */
function split(e: Entry[], start: number, n: number, budget: number, out: number, pal: number[]): void {
  if (budget <= 0 || n <= 0) return;
  if (budget === 1) {
    let r = 0, g = 0, b = 0;
    for (let i = start; i < start + n; i++) { const c = e[i].color; r += expand5((c >> 10) & 31); g += expand5((c >> 5) & 31); b += expand5(c & 31); }
    pal[out * 3] = Math.trunc(r / n); pal[out * 3 + 1] = Math.trunc(g / n); pal[out * 3 + 2] = Math.trunc(b / n);
    return;
  }
  if (n === budget) {
    for (let i = 0; i < n; i++) split(e, start + i, 1, 1, out + i, pal);
    return;
  }
  let rLo = 32, rHi = 0, gLo = 32, gHi = 0, bLo = 32, bHi = 0;
  for (let i = start; i < start + n; i++) {
    const c = e[i].color, r = (c >> 10) & 31, g = (c >> 5) & 31, b = c & 31;
    if (r < rLo) rLo = r; if (r > rHi) rHi = r;
    if (g < gLo) gLo = g; if (g > gHi) gHi = g;
    if (b < bLo) bLo = b; if (b > bHi) bHi = b;
  }
  let axis = 0, widest = rHi - rLo;
  if (gHi - gLo > widest) { axis = 1; widest = gHi - gLo; }
  if (bHi - bLo > widest) axis = 2;
  const key = (c: number) => {
    const r = (c >> 10) & 31, g = (c >> 5) & 31, b = c & 31;
    return axis === 0 ? (r << 10) | (g << 5) | b : axis === 1 ? (g << 10) | (b << 5) | r : (b << 10) | (r << 5) | g;
  };
  const part = e.slice(start, start + n).sort((x, y) => key(x.color) - key(y.color));
  for (let i = 0; i < n; i++) e[start + i] = part[i];

  let half = budget >> 1;
  let L = start, sumL = e[start].count;
  while (L - start + 1 < half) { L++; sumL += e[L].count; }
  let R = start + n - 1, sumR = e[R].count;
  while (start + n - R < half) { R--; sumR += e[R].count; }
  const step = Math.trunc((R - L) / 8);
  for (let k = 0; k < step; k++) { L++; sumL += e[L].count; }
  for (let k = 0; k < step; k++) { R--; sumR += e[R].count; }
  while (L < R) {
    if (sumL < sumR) { L++; sumL += e[L].count; } else { R--; sumR += e[R].count; }
  }
  let cut: number;
  if (sumR < sumL) { half = budget - half; cut = L - start + 1; } else cut = L - start;
  if (cut === 0) cut = 1;
  else if (cut === n) cut = n - 1;
  if (cut < half) half = cut;
  while (n - cut < budget - half) half++;
  split(e, start, cut, half, out, pal);
  split(e, start + cut, n - cut, budget - half, out + half, pal);
}

/**
  A median cut palette of up to `colors` colors. `include` reserves the 20 Windows colors
  (at most 236 are chosen then); `boost` multiplies the counts of the colors under `marked`.
*/
export function medianCutPalette(r: Raster, colors: number, include = false, marked?: Uint8Array | null, boost = 1): Uint8Array {
  const budget = Math.min(include ? 236 : 256, colors);
  const counts = new Uint32Array(32768), d = r.data;
  for (let p = 0, i = 0; i < d.length; p++, i += 4) {
    const c = ((d[i] & 0xf8) << 7) | ((d[i + 1] & 0xf8) << 2) | (d[i + 2] >> 3);
    if (counts[c] < 0x7fffffff) counts[c] += marked && marked[p] ? boost : 1;
  }
  const e: Entry[] = [];
  for (let c = 0; c < 32768; c++) if (counts[c]) e.push({ count: counts[c], color: c });
  const n = Math.min(budget, e.length);
  const pal: number[] = [];
  split(e, 0, e.length, n, 0, pal);
  if (include) pal.push(...WINDOWS_16.slice(0, 24), ...WINDOWS_EXTRA, ...WINDOWS_16.slice(24));
  return Uint8Array.from(pal);
}

export function nearestIndex(pal: Uint8Array, r: number, g: number, b: number): number {
  let best = 0, bestD = Infinity;
  for (let k = 0; k < pal.length / 3; k++) {
    const dr = pal[k * 3] - r, dg = pal[k * 3 + 1] - g, db = pal[k * 3 + 2] - b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestD) { bestD = dist; best = k; if (!dist) break; }
  }
  return best;
}

const BAYER = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];

export type Reduction = "nearest" | "ordered" | "floyd" | "burkes" | "stucki";

const KERNELS: Record<"floyd" | "burkes" | "stucki", [number, number, number][]> = {
  floyd: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]],
  burkes: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]],
  stucki: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]],
};

/** Put every pixel of `r` on the palette (in place), returning the indexes. */
export function applyPalette(r: Raster, pal: Uint8Array, how: Reduction): Uint8Array {
  const { width: w, height: h, data: d } = r;
  const idx = new Uint8Array(w * h);
  const cache = new Map<number, number>();
  const near = (R: number, G: number, B: number) => {
    const key = (R << 16) | (G << 8) | B;
    let k = cache.get(key);
    if (k === undefined) { k = nearestIndex(pal, R, G, B); cache.set(key, k); }
    return k;
  };
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  if (how === "nearest" || how === "ordered") {
    const spread = 256 / Math.cbrt(pal.length / 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const t = how === "ordered" ? ((BAYER[(y & 7) * 8 + (x & 7)] + 0.5) / 64 - 0.5) * spread : 0;
      const k = near(clamp(d[i] + t), clamp(d[i + 1] + t), clamp(d[i + 2] + t));
      idx[y * w + x] = k;
      d[i] = pal[k * 3]; d[i + 1] = pal[k * 3 + 1]; d[i + 2] = pal[k * 3 + 2];
    }
    return idx;
  }
  const kernel = KERNELS[how], total = kernel.reduce((s, k) => s + k[2], 0);
  const err = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x, i = p * 4;
    const R = clamp(d[i] + err[p * 3]), G = clamp(d[i + 1] + err[p * 3 + 1]), B = clamp(d[i + 2] + err[p * 3 + 2]);
    const k = near(R, G, B);
    idx[p] = k;
    const er = R - pal[k * 3], eg = G - pal[k * 3 + 1], eb = B - pal[k * 3 + 2];
    d[i] = pal[k * 3]; d[i + 1] = pal[k * 3 + 1]; d[i + 2] = pal[k * 3 + 2];
    for (const [dx, dy, wgt] of kernel) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || xx >= w || yy >= h) continue;
      const q = (yy * w + xx) * 3;
      err[q] += (er * wgt) / total; err[q + 1] += (eg * wgt) / total; err[q + 2] += (eb * wgt) / total;
    }
  }
  return idx;
}

/** 32K and 64K colors: each channel cut to 5 bits (6 for green at 64K), as a 16-bit bitmap holds them. */
export function reduceBits(r: Raster, greenBits: 5 | 6): void {
  const d = r.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = expand5(d[i] >> 3);
    d[i + 1] = greenBits === 6 ? ((d[i + 1] >> 2) << 2) | (d[i + 1] >> 6) : expand5(d[i + 1] >> 3);
    d[i + 2] = expand5(d[i + 2] >> 3);
  }
}

/* PSP's error shares for an error e in -255..255 (0x7f7cf0): 1/16, 3/16, 5/16 and the rest (7/16). */
const SHARE = (() => {
  const t = { one: new Int8Array(511), three: new Int8Array(511), five: new Int8Array(511), seven: new Int8Array(511) };
  for (let i = 0; i < 511; i++) {
    const e = i - 255, one = Math.trunc((e + 8) / 16), r1 = e - one;
    const three = Math.trunc((r1 * 2 + 5) / 10), r2 = r1 - three;
    const five = Math.trunc((r2 * 5 + 6) / 12);
    t.one[i] = one; t.three[i] = three; t.five[i] = five; t.seven[i] = r2 - five;
  }
  return t;
})();

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/* PSP's 16 x 16 thresholds, [x mod 16][bitmap row mod 16]: scale 3.125 for the cube, 15.875 for 16 colors. */
function thresholds(scale: number): Uint8Array {
  const t = new Uint8Array(256);
  for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c++) {
    const outer = BAYER4[(r & 3) * 4 + (c & 3)], inner = BAYER4[(r >> 2) * 4 + (c >> 2)];
    t[r * 16 + c] = Math.trunc((outer + inner / 16) * scale + 0.5);
  }
  return t;
}
const T_CUBE = thresholds(3.125), T_VGA = thresholds(15.875);

export type PspReduction = "nearest" | "ordered" | "error";

/**
  Put `r` on the first `count` entries of `pal` as PSP's jdib does (in place), returning the
  indexes. Ordered dither works on PSP's web cube (`pal` from webSafePalette) or on the 16
  Windows colors (WINDOWS_16), picking the entry from the thresholds without a search.
*/
export function pspDither(r: Raster, pal: Uint8Array, how: PspReduction, bleeding = false, count = pal.length / 3): Uint8Array {
  const { width: w, height: h, data: d } = r;
  const idx = new Uint8Array(w * h);
  const cache = new Map<number, number>();
  const near = (R: number, G: number, B: number) => {
    const key = (R << 16) | (G << 8) | B;
    let k = cache.get(key);
    if (k === undefined) { k = nearestIndex(pal.subarray(0, count * 3), R, G, B); cache.set(key, k); }
    return k;
  };
  const put = (p: number, k: number) => { idx[p] = k; d[p * 4] = pal[k * 3]; d[p * 4 + 1] = pal[k * 3 + 1]; d[p * 4 + 2] = pal[k * 3 + 2]; };
  if (how === "nearest") {
    for (let p = 0; p < w * h; p++) put(p, near(d[p * 4], d[p * 4 + 1], d[p * 4 + 2]));
    return idx;
  }
  if (how === "ordered") {
    const vga = count <= 16;
    const T = vga ? T_VGA : T_CUBE;
    for (let y = 0; y < h; y++) {
      const row = (h - 1 - y) & 15;
      for (let x = 0; x < w; x++) {
        const p = y * w + x, R = d[p * 4], G = d[p * 4 + 1], B = d[p * 4 + 2], t = T[(x & 15) * 16 + row];
        let k: number;
        if (!vga) {
          const level = (v: number) => Math.floor(v / 51) + (t < v % 51 ? 1 : 0);
          k = level(R) + level(G) * 6 + level(B) * 36;
        } else if (R === G && G === B) {
          k = R < 128 ? (R <= t >> 1 ? 0 : 8) : R < 192 ? (R <= (t >> 2) + 128 ? 8 : 7) : R < (t >> 2) + 192 ? 7 : 15;
        } else {
          k = (R > t ? 1 : 0) + (G > t ? 2 : 0) + (B > t ? 4 : 0) + (R > 128 || G > 128 || B > 128 ? 8 : 0);
        }
        put(p, k);
      }
    }
    return idx;
  }
  // Error diffusion: this row's errors (from the row above), the next row's, and the carry to the right.
  let cur = new Int16Array((w + 2) * 3), next = new Int16Array((w + 2) * 3);
  const scale = bleeding ? 192 : 256;
  for (let y = 0; y < h; y++) {
    [cur, next] = [next, cur];
    next[3] = next[4] = next[5] = 0;
    let cr = 0, cg = 0, cb = 0;
    for (let x = 0; x < w; x++) {
      const p = y * w + x, s = (x + 1) * 3;
      let R = cr + cur[s], G = cg + cur[s + 1], B = cb + cur[s + 2];
      if (bleeding) { R = Math.floor((R * scale) / 256); G = Math.floor((G * scale) / 256); B = Math.floor((B * scale) / 256); }
      R = Math.max(0, Math.min(255, R + d[p * 4])); G = Math.max(0, Math.min(255, G + d[p * 4 + 1])); B = Math.max(0, Math.min(255, B + d[p * 4 + 2]));
      const k = near(R, G, B);
      put(p, k);
      const spread = (v: number, c: number) => {
        const e = v - pal[k * 3 + c] + 255;
        next[s - 3 + c] += SHARE.three[e];
        next[s + c] += SHARE.five[e];
        next[s + 3 + c] = SHARE.one[e];
        return SHARE.seven[e];
      };
      cr = spread(R, 0); cg = spread(G, 1); cb = spread(B, 2);
    }
  }
  return idx;
}
