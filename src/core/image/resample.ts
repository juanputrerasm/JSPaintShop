/*
  Resampling a raster to a new size, as PSP 6's image library does it (docs/PSP_EXE_ANALYSIS.md
  section 4): every channel, alpha included, is resampled on its own, as PSP resizes the
  transparency mask as a separate 8-bit image.

    pixel     jff.dll ResizeDIB: nearest pixel through an integer scale
              S = trunc(dst/src · 10000), source index trunc(i · 10000 / S), rows counted
              from the bottom
    bilinear  the box filter of RESAMPLE.CPP (Psp.exe 0x7f0900): each output pixel the average
              of the source area it covers, in 1/256-pixel fixed point
    bicubic   bicummx.cpp (Psp.exe 0x816170), the MMX version PSP runs on any MMX processor:
              bicubic.cpp's cubic convolution (a = -1, columns of four rows, then across) in
              16-bit words that wrap, with the fraction cut to 15 bits
    smart     Resize's rule (Psp.exe 0x5ee800): the axis whose percentage is further from 100
              decides; above 100 (truncated) bicubic, else the box filter

  Resize Type's list is Smart size, Bilinear resample, Bicubic resample, Pixel resize (DLGINIT
  of DIALOG 120). Images that are neither 24-bit nor greyscale only allow Smart size (which
  then means Pixel resize) and Pixel resize; the other two give string 23583.
*/
import { createRaster, type Mask, type Raster } from "./raster.ts";

export type ResampleMethod = "pixel" | "bilinear" | "bicubic" | "smart";

export function resample(src: Raster, w: number, h: number, method: ResampleMethod = "smart"): Raster {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  if (w === src.width && h === src.height) return { width: w, height: h, data: new Uint8ClampedArray(src.data) };
  if (method === "smart") method = smartMethod(src.width, src.height, w, h);
  if (method === "pixel") return nearest(src, w, h);
  if (method === "bicubic") return bicubic(src, w, h);
  return box(src, w, h);
}

/** What Smart size does for this change of size (Psp.exe 0x5ee800). */
export function smartMethod(W: number, H: number, w: number, h: number): "bicubic" | "bilinear" {
  const px = (w / W) * 100, py = (h / H) * 100;
  const p = Math.abs(Math.trunc(100 - px)) > Math.abs(Math.trunc(100 - py)) ? px : py;
  return Math.trunc(p) > 100 ? "bicubic" : "bilinear";
}

/** An 8-bit mask through the same resampler (PSP resizes a layer's mask on its own). */
export function resampleMask(m: Mask, w: number, h: number, method: ResampleMethod = "smart"): Mask {
  const r = createRaster(m.width, m.height);
  for (let i = 0; i < m.data.length; i++) r.data[i * 4] = m.data[i];
  const o = resample(r, w, h, method), data = new Uint8Array(o.width * o.height);
  for (let i = 0; i < data.length; i++) data[i] = o.data[i * 4];
  return { width: o.width, height: o.height, data };
}

/* jff.dll ResizeDIB: the scale in 1/10000 and the source index for each output index. */
function pixelIndex(n: number, src: number): Int32Array {
  const S = Math.trunc((n / src) * 10000) || 1, out = new Int32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.min(src - 1, Math.trunc((i * 10000) / S));
  return out;
}

function nearest(src: Raster, w: number, h: number): Raster {
  const out = createRaster(w, h), s = src.data, d = out.data;
  const cols = pixelIndex(w, src.width), rows = pixelIndex(h, src.height);
  for (let y = 0; y < h; y++) {
    // Rows count from the bottom, as in the DIB.
    const sy = src.height - 1 - rows[h - 1 - y];
    for (let x = 0; x < w; x++) {
      const sx = cols[x];
      const i = (sy * src.width + sx) * 4, o = (y * w + x) * 4;
      d[o] = s[i]; d[o + 1] = s[i + 1]; d[o + 2] = s[i + 2]; d[o + 3] = s[i + 3];
    }
  }
  return out;
}

/* Per output column (or row): the first source index and the weight (out of 256) of its first pixel. */
function boxStarts(n: number, scale: number): { start: Int32Array; first: Int32Array } {
  const start = new Int32Array(n), first = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i / scale, ip = Math.trunc(pos);
    start[i] = ip;
    first[i] = Math.trunc(256.5 - (pos - ip) * 256);
  }
  return { start, first };
}

function box(src: Raster, w: number, h: number): Raster {
  const sx = w / src.width, sy = h / src.height;
  const fx = Math.trunc(256 / sx + 0.5), fy = Math.trunc(256 / sy + 0.5);
  const cols = boxStarts(w, sx), rows = boxStarts(h, sy);
  const out = createRaster(w, h), s = src.data, d = out.data, W = src.width, H = src.height;
  const area = fx * fy;
  const sum = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      sum[0] = sum[1] = sum[2] = sum[3] = 0;
      let rowLeft = fy, rowWeight = rows.first[y], row = rows.start[y];
      for (;;) {
        let rw: number, after: number;
        if (rowWeight < rowLeft) { rw = rowWeight; after = rowLeft - rowWeight; } else { rw = rowLeft; after = 0; }
        const ry = Math.min(H - 1, row);
        let colLeft = fx, weight = cols.first[x], col = cols.start[x];
        while (weight < colLeft) {
          const i = (ry * W + Math.min(W - 1, col)) * 4, k = weight * rw;
          sum[0] += s[i] * k; sum[1] += s[i + 1] * k; sum[2] += s[i + 2] * k; sum[3] += s[i + 3] * k;
          colLeft -= weight;
          col++;
          weight = 256;
        }
        const i = (ry * W + Math.min(W - 1, col)) * 4, k = colLeft * rw;
        sum[0] += s[i] * k; sum[1] += s[i + 1] * k; sum[2] += s[i + 2] * k; sum[3] += s[i + 3] * k;
        if (after === 0) break;
        row++;
        rowLeft = after;
        rowWeight = 256;
      }
      const o = (y * w + x) * 4;
      d[o] = Math.floor(sum[0] / area); d[o + 1] = Math.floor(sum[1] / area); d[o + 2] = Math.floor(sum[2] / area); d[o + 3] = Math.floor(sum[3] / area);
    }
  }
  return out;
}

/* A signed 16-bit word, as MMX keeps it. */
const w16 = (v: number) => (v << 16) >> 16;
/* pmulhw of (v << 1) by the 15-bit fraction t. */
const mulT = (v: number, t: number) => (w16(v << 1) * t) >> 16;

/*
  One cubic step on four values (x16) at fraction t (0..32767), as bicummx.cpp computes it in
  words: ((((p3 - p0 - p2 + p1)·t + (p2 - p3) + 2(p0 - p1))·t + (p2 - p0))·t + p1.
*/
function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  let v = mulT(w16(p3 - p0 - p2 + p1), t);
  v = w16(v + w16(p2 - p3) + w16(w16(p0 - p1) << 1));
  v = w16(mulT(v, t) + w16(p2 - p0));
  return w16(mulT(v, t) + p1);
}

/* The four source indexes around integer position i (clamped as PSP clamps them). */
function taps(i: number, n: number): [number, number, number, number] {
  if (i < 1) return [0, 0, 1 < n ? 1 : 0, 2 < n ? 2 : n - 1];
  let p1 = i, p2 = i + 1, p3 = i + 2;
  if (p3 >= n) { p3 = n - 1; if (p1 >= n) p1 = p3; if (p2 >= n) p2 = p3; }
  return [i - 1, p1, p2, p3];
}

function bicubic(src: Raster, w: number, h: number): Raster {
  const W = src.width, H = src.height, s = src.data;
  const stepX = Math.trunc((W / w) * 65536), stepY = Math.trunc((H / h) * 65536);
  const out = createRaster(w, h), d = out.data;
  const col = new Int32Array(4);
  for (let y = 0, fy = 0; y < h; y++, fy += stepY) {
    const iy = fy >> 16, ty = (fy >> 1) & 0x7fff;
    const r1 = Math.min(iy, H - 1), r0 = iy > 0 ? iy - 1 : r1;
    const r2 = iy + 1 < H ? iy + 1 : r1, r3 = iy + 2 < H ? iy + 2 : r2;
    for (let x = 0, fx = 0; x < w; x++, fx += stepX) {
      const ix = fx >> 16, tx = (fx >> 1) & 0x7fff;
      const cs = taps(ix, W);
      for (let c = 0; c < 4; c++) {
        for (let k = 0; k < 4; k++) {
          const cx = cs[k];
          col[k] = cubic(s[(r0 * W + cx) * 4 + c] * 16, s[(r1 * W + cx) * 4 + c] * 16, s[(r2 * W + cx) * 4 + c] * 16, s[(r3 * W + cx) * 4 + c] * 16, ty);
        }
        const v = cubic(col[0], col[1], col[2], col[3], tx) >> 4;
        d[(y * w + x) * 4 + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  return out;
}

/** A paletted image's index buffer through Pixel resize (the only resize such images take). */
export function resampleIndices(idx: Uint8Array, W: number, H: number, w: number, h: number): Uint8Array<ArrayBuffer> {
  const cols = pixelIndex(w, W), rows = pixelIndex(h, H), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = H - 1 - rows[h - 1 - y];
    for (let x = 0; x < w; x++) out[y * w + x] = idx[sy * W + cols[x]];
  }
  return out;
}
