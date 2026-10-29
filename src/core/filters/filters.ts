/*
  The filters of Image > Blur, Noise, Sharpen and Other, and Hot Wax Coating, as Psp.exe runs
  them (docs/PSP_EXE_ANALYSIS.md section 7). PSP works on the layer's 24-bit colors; the
  transparency of a layer acts as the mask its filters take (only pixels with some opacity
  are sampled) and is kept, except by the Gaussian blurs, which blur it like a fifth channel.

    Gaussian Blur   0x7f21e0: integer weights trunc(63 exp(-i^2 / 2r^2)), rescaled to a power of
                    two, a vertical then a horizontal pass, each truncated; edges repeat
    Motion Blur     0x674ba0: 8.8 fixed-point steps, half the intensity behind, half ahead
    Unsharp Mask    0x8056b0: orig + trunc((orig - gauss) * strength / 100) where |diff| >= clipping
    Add Noise       0x803e10: MSVC rand(), each pixel drawing blue, green, red
    Despeckle       0x808660: per channel, the 3 x 3 median where the 8-neighbour mean is 49 or more away
    Median, Dilate, Erode  0x806200: per channel 3 x 3 median, max, min; edges repeat
    Mosaic          0x805a50: the truncated average of each block, blocks from the top-left
    Hot Wax         0x541350: the grey image blurred (radius 1) and lit, times the foreground color
*/
import { cloneRaster, type Raster } from "../image/raster.ts";
import { luminance } from "../color/color-space.ts";

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.trunc(v));

/* MSVC rand(), as PSP draws its noise. One generator for the whole program, seeded 1. */
let seed = 1;
export function msvcRand(): number {
  seed = (Math.imul(seed, 214013) + 2531011) >>> 0;
  return (seed >>> 16) & 0x7fff;
}

export interface GaussKernel {
  /** Weights from the centre out: w[0] the centre, w[i] both i pixels away. */
  w: number[];
  /** Their total (centre + 2 * the others); a power of two divides by a shift. */
  sum: number;
}

/* The kernel exactly as 0x7f21e0 builds it, including its rounding fix-up (see the doc). */
export function gaussianKernel(radius: number): GaussKernel {
  const two = 2 * radius * radius;
  const half = Math.ceil(Math.sqrt(-(Math.LN2 * Math.log2(1 / 63)) * two));
  const size = 2 * half + 1;
  const w = [63];
  let total = 63;
  for (let i = 1; i <= half; i++) { w[i] = Math.trunc(63 * Math.exp(-(i * i) / two)); total += 2 * w[i]; }
  let p = half, cum = w[0];
  for (let i = 1; i <= half; i++) { cum += 2 * w[i]; if (cum / total >= 1) { p = i; break; } }
  if (w[p] === 0) p--;
  let sum = total;
  if ((total & (total - 1)) !== 0) {
    let pow = 1;
    while (pow < total && pow < 0x40000000) pow *= 2;
    const scale = pow / total;
    const round = (v: number) => (v > 0 ? Math.floor(v + 0.5) : Math.floor(v - 0.5));
    w[0] = round(scale * w[0]);
    let s = w[0];
    for (let i = 1; i <= p; i++) { w[i] = round(w[i] * scale); s += 2 * w[i]; }
    const diff = pow - s;
    if (diff !== 0) {
      // PSP's counter here starts at the kernel size, not at the difference.
      const step = diff > 0 ? 1 : -1;
      let cnt = size;
      if (Math.abs(diff) & 1) { w[0] += step; cnt -= step; }
      for (let i = 1; i <= p && cnt !== 0; i++) { w[i] += step; cnt -= 2 * step; }
      if (cnt !== 0) w[0] += cnt;
    }
    if (w[p] === 0) p--;
    sum = w[0];
    for (let i = 1; i <= p; i++) sum += 2 * w[i];
  }
  return { w: w.slice(0, p + 1), sum };
}

/* One pass of a symmetric integer kernel over a plane of bytes, edges repeated, truncated. */
function pass1d(src: Uint8Array, w: number, h: number, k: GaussKernel, vertical: boolean): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(src.length), r = k.w.length - 1, len = vertical ? h : w;
  const shift = (k.sum & (k.sum - 1)) === 0 ? Math.log2(k.sum) : -1;
  for (let line = 0; line < (vertical ? w : h); line++) {
    const at = (i: number) => src[vertical ? (i < 0 ? 0 : i >= len ? len - 1 : i) * w + line : line * w + (i < 0 ? 0 : i >= len ? len - 1 : i)];
    for (let i = 0; i < len; i++) {
      let acc = k.w[0] * at(i);
      for (let j = 1; j <= r; j++) acc += k.w[j] * (at(i - j) + at(i + j));
      out[vertical ? i * w + line : line * w + i] = shift >= 0 ? acc >>> shift : Math.trunc(acc / k.sum);
    }
  }
  return out;
}

/** A Gaussian blur of one 8-bit plane, as PSP blurs masks and greys. */
export function gaussianPlane(plane: Uint8Array<ArrayBuffer>, w: number, h: number, radius: number): Uint8Array<ArrayBuffer> {
  if (radius <= 0 || !w || !h) return plane.slice();
  const k = gaussianKernel(radius);
  return pass1d(pass1d(plane, w, h, k, true), w, h, k, false);
}

function planes(r: Raster): Uint8Array[] {
  const n = r.width * r.height, p = [0, 1, 2, 3].map(() => new Uint8Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < 4; c++) p[c][i] = r.data[i * 4 + c];
  return p;
}

export function gaussianBlur(src: Raster, radius: number): Raster {
  if (radius <= 0) return cloneRaster(src);
  const k = gaussianKernel(radius), out = cloneRaster(src), { width: w, height: h } = src;
  planes(src).forEach((pl, c) => {
    const b = pass1d(pass1d(pl, w, h, k, true), w, h, k, false);
    for (let i = 0; i < b.length; i++) out.data[i * 4 + c] = b[i];
  });
  return out;
}

export function unsharpMask(src: Raster, radius: number, strength: number, clipping: number): Raster {
  const blur = gaussianBlur(src, radius), out = cloneRaster(src), s = src.data, b = blur.data, d = out.data;
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) {
    const diff = s[i + c] - b[i + c];
    if (Math.abs(diff) >= clipping) d[i + c] = clamp(s[i + c] + Math.trunc((diff * strength) / 100));
  }
  return out;
}

/* The 8.8 step of Motion Blur for an angle in degrees (0x674ba0). */
export function motionStep(angle: number): [number, number] {
  const deg = 0.017453292522222223;
  let a = 450 - angle;
  if (a > 360) a = 90 - angle;
  if (a > 180) a -= 180;
  if (a >= 0 && a <= 89) {
    return [Math.trunc((Math.trunc(Math.cos(a * deg) * 1000) * 256) / 1000), Math.trunc((Math.trunc(Math.sin(a * deg) * 1000) * 256) / 1000)];
  }
  if (a > 90 && a < 180) {
    const b = (180 - a) * deg;
    return [-Math.trunc((Math.trunc(Math.cos(b) * 1000) * 256) / 1000), Math.trunc((Math.trunc(Math.sin(b) * 1000) * 256) / 1000)];
  }
  if (a === 90) return [0, 256];
  if (a === 180) return [-256, 0];
  return [0, 0];
}

export function motionBlur(src: Raster, angle: number, intensity: number): Raster {
  const { width: w, height: h, data: s } = src;
  const out = cloneRaster(src), d = out.data;
  const [cx, cy] = motionStep(angle);
  const behind = Math.trunc(intensity / 2), ahead = intensity - behind;
  for (let y = 0; y < h; y++) {
    const yb = h - 1 - y; // PSP walks its bottom-up bitmap: +y goes up the image
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let r = 0, g = 0, b = 0, n = 0;
      if (s[o + 3]) { r = s[o]; g = s[o + 1]; b = s[o + 2]; n = 1; }
      const take = (k: number): boolean => {
        const xx = ((x << 8) + k * cx) >> 8, yy = ((yb << 8) + k * cy) >> 8;
        if (xx < 0 || xx >= w || yy < 0 || yy >= h) return false;
        const p = ((h - 1 - yy) * w + xx) * 4;
        if (s[p + 3]) { r += s[p]; g += s[p + 1]; b += s[p + 2]; n++; }
        return true;
      };
      for (let k = 1; k <= behind; k++) if (!take(-k)) break;
      for (let k = 1; k <= ahead; k++) if (!take(k)) break;
      if (n) { d[o] = Math.trunc(r / n); d[o + 1] = Math.trunc(g / n); d[o + 2] = Math.trunc(b / n); }
    }
  }
  return out;
}

/* Add Noise (0x803e10). */
export function addNoise(src: Raster, percent: number, uniform: boolean): Raster {
  const out = cloneRaster(src), d = out.data;
  const delta = () => ((msvcRand() >> 7) & 0xff) - 128;
  for (let i = 0; i < d.length; i += 4) {
    let b: number, g: number, r: number;
    if (uniform) {
      b = Math.trunc((delta() * percent) / 100); g = Math.trunc((delta() * percent) / 100); r = Math.trunc((delta() * percent) / 100);
    } else if (Math.trunc((msvcRand() & 0x7fff) / 327) < percent) {
      b = delta(); g = delta(); r = delta();
    } else { b = g = r = 0; }
    d[i] = clamp(d[i] + r); d[i + 1] = clamp(d[i + 1] + g); d[i + 2] = clamp(d[i + 2] + b);
  }
  return out;
}

/* The 3 x 3 neighbourhood of channel c, edges repeated, row by row. */
function around(s: Uint8ClampedArray, w: number, h: number, x: number, y: number, c: number, v: number[]): void {
  let k = 0;
  for (let j = -1; j <= 1; j++) {
    const yy = y + j < 0 ? 0 : y + j >= h ? h - 1 : y + j;
    for (let i = -1; i <= 1; i++) v[k++] = s[(yy * w + (x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i)) * 4 + c];
  }
}

export type RankMode = "median" | "dilate" | "erode";

export function rank3(src: Raster, mode: RankMode): Raster {
  const { width: w, height: h, data: s } = src;
  const out = cloneRaster(src), d = out.data, v = new Array<number>(9);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    around(s, w, h, x, y, c, v);
    d[(y * w + x) * 4 + c] = mode === "dilate" ? Math.max(...v) : mode === "erode" ? Math.min(...v) : v.sort((a, b) => a - b)[4];
  }
  return out;
}

/* Despeckle (0x808660): each channel on its own. */
export function despeckle(src: Raster): Raster {
  const { width: w, height: h, data: s } = src;
  const out = cloneRaster(src), d = out.data, v = new Array<number>(9);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    around(s, w, h, x, y, c, v);
    const mean = (v[0] + v[1] + v[2] + v[3] + v[5] + v[6] + v[7] + v[8]) >> 3;
    if (Math.abs(mean - v[4]) >= 49) d[(y * w + x) * 4 + c] = v.sort((a, b) => a - b)[4];
  }
  return out;
}

/* Mosaic (0x805a50): 1 x 1 or a zero size leaves the image alone. */
export function mosaic(src: Raster, bw: number, bh: number): Raster {
  const { width: w, height: h, data: s } = src;
  const out = cloneRaster(src), d = out.data;
  if (bw <= 0 || bh <= 0 || (bw === 1 && bh === 1)) return out;
  for (let by = 0; by < h; by += bh) for (let bx = 0; bx < w; bx += bw) {
    let r = 0, g = 0, b = 0, n = 0;
    const ey = Math.min(h, by + bh), ex = Math.min(w, bx + bw);
    for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
      const p = (y * w + x) * 4;
      if (s[p + 3]) { r += s[p]; g += s[p + 1]; b += s[p + 2]; n++; }
    }
    if (!n) continue;
    r = Math.trunc(r / n); g = Math.trunc(g / n); b = Math.trunc(b / n);
    for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
      const p = (y * w + x) * 4;
      d[p] = r; d[p + 1] = g; d[p + 2] = b;
    }
  }
  return out;
}

/* Hot Wax's light: azimuth 270 degrees, elevation 100 degrees, as 0..255 integers. */
const EL = 1.7453292522222223, AZ = 4.712388981;
const LX = Math.trunc(Math.cos(EL) * Math.cos(AZ) * 255), LY = Math.trunc(Math.sin(AZ) * Math.cos(EL) * 255), LZ = Math.trunc(Math.sin(EL) * 255);

/* Hot Wax Coating (0x541350): `fg` is the foreground color. */
export function hotWax(src: Raster, fg: readonly [number, number, number]): Raster {
  const { width: w, height: h, data: s } = src;
  const grey = cloneRaster(src);
  for (let i = 0; i < s.length; i += 4) grey.data[i] = luminance(s[i], s[i + 1], s[i + 2]);
  const gp = new Uint8Array(w * h);
  for (let i = 0; i < gp.length; i++) gp[i] = grey.data[i * 4];
  const g = gaussianPlane(gp, w, h, 1);
  const at = (x: number, y: number) => g[y * w + x];
  const out = cloneRaster(src), d = out.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let dx: number, dy: number;
    const L = x > 0 ? x - 1 : x, R = x < w - 1 ? x + 1 : x;
    if (y > 0 && y < h - 1) {
      dx = 0; for (const yy of [y - 1, y, y + 1]) dx += at(L, yy) - at(R, yy);
      dy = 0; for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) dy += at(xx, y - 1) - at(xx, y + 1);
    } else {
      // The top and bottom rows look at one other row: up minus here at the bottom, down minus here at the top.
      const n = y === 0 ? Math.min(h - 1, 1) : y - 1;
      dx = at(L, y) - at(R, y) + at(L, n) - at(R, n);
      if (x === 0 || x === w - 1) dy = at(L, y) - at(R, y);
      else { dy = 0; for (let xx = x - 1; xx <= x + 1; xx++) dy += at(xx, n) - at(xx, y); }
    }
    let shade: number;
    if (dx === 0 && dy === 0) shade = LZ;
    else {
      const num = dx * LX + 30 * LZ + dy * LY;
      shade = num < 0 ? 0 : Math.trunc(num / Math.sqrt(dx * dx + dy * dy + 900));
    }
    const o = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) d[o + c] = Math.trunc((s[o + c] * fg[c] * shade) / 0xfe01);
  }
  return out;
}
