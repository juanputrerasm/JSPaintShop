/*
  The Deformation tool's transform (Psp.exe "DeformCtrl.cpp" 0x51c270; docs/PSP_EXE_ANALYSIS.md
  section 12): a 3 x 3 projective matrix m00..m22 (the registry keys) that maps each target
  pixel back to the source: x' = (m00·x + m01·y + m02) / w, y' = (m10·x + m11·y + m12) / w,
  w = m20·x + m21·y + m22. The matrix comes from the four corners the user drags.

  While dragging PSP draws the nearest pixel (0x51aa10); positions outside the source are left
  clear. Applying samples bilinearly (0x51b160), in 1/1024 pixels on the bottom-up DIB rows:
    - affine (|m20|, |m21| < 1e-12 and |m22 − 1| < 1e-12): X = trunc(1024·m00·x) +
      trunc(1024·m01·y) + trunc(1024·m02), and the row V = 1024·(H − 1) − trunc(1024·m10·x) −
      trunc(1024·m11·y) − trunc(1024·m12);
    - otherwise q = 1024 / (m20·x + m21·y + m22), X = trunc((m00·x + m01·y + m02)·q) and
      V = 1024·(H − 1) − trunc((m10·x + m11·y + m12)·q);
    - i = X >> 10, fx = X & 1023, and the same for V. When i < −1, the row < −1 or either is past
      the image, the pixel is 0 (the background PSP passes is 0, and the mask's 0 is clear);
    - the four taps (i, row), (i + 1, row), (i, row + 1), (i + 1, row + 1), 0 when outside;
      top = a + ((b − a)·fx >> 10), bottom = c + ((d − c)·fx >> 10), and the value
      top + ((bottom − top)·fv >> 10), for the color and the transparency alike.
*/
import { createRaster, type Raster } from "../image/raster.ts";

export type Point = [number, number];
export type Matrix = [number, number, number, number, number, number, number, number, number];

/* The matrix taking the unit square's corners (0,0) (1,0) (1,1) (0,1) to the quad. */
function squareToQuad(q: Point[]): Matrix {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0, 1];
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}

function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1e-12;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

function multiply(m: Matrix, n: Matrix): Matrix {
  const r = new Array(9).fill(0) as Matrix;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += m[i * 3 + k] * n[k * 3 + j];
  return r;
}

/** The target-to-source matrix for a source rectangle `src` placed on the quad `q` (corners clockwise from the top left). */
export function quadMatrix(src: { x: number; y: number; w: number; h: number }, q: Point[]): Matrix {
  const toQuad = squareToQuad(q);
  const fromRect: Matrix = [1 / src.w, 0, -src.x / src.w, 0, 1 / src.h, -src.y / src.h, 0, 0, 1];
  return invert(multiply(toQuad, fromRect));
}

/** Warp `src` onto a width x height canvas through the target-to-source matrix. */
export function warpProjective(src: Raster, m: Matrix, width: number, height: number, smooth: boolean): Raster {
  if (smooth) return warpBilinear(src, m, width, height);
  const out = createRaster(width, height);
  const affine = Math.abs(m[6]) < 1e-9 && Math.abs(m[7]) < 1e-9 && Math.abs(m[8] - 1) < 1e-9;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const w = affine ? 1 : m[6] * x + m[7] * y + m[8];
    if (w <= 0) continue;
    const sx = (m[0] * x + m[1] * y + m[2]) / w, sy = (m[3] * x + m[4] * y + m[5]) / w;
    const o = (y * width + x) * 4;
    const ix = Math.trunc(sx), iy = Math.trunc(sy);
    if (ix < 0 || iy < 0 || ix >= src.width || iy >= src.height) continue;
    const p = (iy * src.width + ix) * 4;
    out.data[o] = src.data[p]; out.data[o + 1] = src.data[p + 1]; out.data[o + 2] = src.data[p + 2]; out.data[o + 3] = src.data[p + 3];
  }
  return out;
}

/* Psp.exe 0x51b160: the apply's bilinear sampling (see the header). */
function warpBilinear(src: Raster, m: Matrix, width: number, height: number): Raster {
  const out = createRaster(width, height), d = out.data, s = src.data, W = src.width, H = src.height;
  const affine = Math.abs(m[6]) < 1e-12 && Math.abs(m[7]) < 1e-12 && Math.abs(m[8] - 1) < 1e-12;
  const base = (H - 1) * 1024;
  const colX = new Float64Array(width), colY = new Float64Array(width), rowX = new Float64Array(height), rowY = new Float64Array(height);
  if (affine) {
    for (let x = 0; x < width; x++) { colX[x] = Math.trunc(x * m[0] * 1024); colY[x] = Math.trunc(x * m[3] * 1024); }
    for (let y = 0; y < height; y++) { rowX[y] = Math.trunc(y * m[1] * 1024); rowY[y] = Math.trunc(y * m[4] * 1024); }
  }
  const ox = Math.trunc(m[2] * 1024), oy = Math.trunc(m[5] * 1024);
  const tap = (i: number, row: number, c: number) => (i < 0 || i >= W || row < 0 || row >= H ? 0 : s[((H - 1 - row) * W + i) * 4 + c]);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let X: number, V: number;
    if (affine) {
      X = colX[x] + rowX[y] + ox;
      V = base - colY[x] - rowY[y] - oy;
    } else {
      const q = 1024 / (m[7] * y + m[6] * x + m[8]);
      X = Math.trunc((m[1] * y + m[0] * x + m[2]) * q);
      V = base - Math.trunc((m[4] * y + m[3] * x + m[5]) * q);
    }
    if (!Number.isFinite(X) || !Number.isFinite(V)) continue;
    const i = Math.floor(X / 1024), row = Math.floor(V / 1024);
    if (i < -1 || row < -1 || i >= W || row >= H) continue;
    const fx = X - i * 1024, fv = V - row * 1024, o = (y * width + x) * 4;
    for (let c = 0; c < 4; c++) {
      const a = tap(i, row, c), b = tap(i + 1, row, c), cc = tap(i, row + 1, c), dd = tap(i + 1, row + 1, c);
      const top = a + (((b - a) * fx) >> 10), bottom = cc + (((dd - cc) * fx) >> 10);
      d[o + c] = (top + (((bottom - top) * fv) >> 10)) & 255;
    }
  }
  return out;
}
