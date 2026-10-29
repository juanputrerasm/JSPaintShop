/*
  Image > Effects > Kaleidoscope (Psp.exe 0x6200c0, DIALOG 537; docs/PSP_EXE_ANALYSIS.md
  section 8). Around a center (offset in percent of the half size), each pixel's distance is
  scaled by 5^(−scale/100) and folded by mirroring into a ring, its angle folded into one petal
  of π/petals starting at the rotation angle; the image is sampled there (folded back inside).
*/
import { cloneRaster, type Raster } from "../image/raster.ts";
import { fold, sampleBilinear } from "./sample.ts";

export interface KaleidoscopeParams {
  horizontal: number;
  vertical: number;
  rotation: number;
  scale: number;
  petals: number;
  orbits: number;
  suction: number;
}

export const KALEIDOSCOPE_DEFAULTS: KaleidoscopeParams = { horizontal: 0, vertical: 0, rotation: 0, scale: 0, petals: 10, orbits: 0, suction: 0 };

const PI = 3.1415926;

export function kaleidoscope(src: Raster, p: KaleidoscopeParams, cols = 1, rows = 1): Raster {
  const { width: W, height: H } = src;
  const out = cloneRaster(src);
  if (W < 4 || H < 4) return out;
  const tw = Math.max(1, Math.trunc(W / cols)), th = Math.max(1, Math.trunc(H / rows));
  const hx = tw * 0.5, hy = th * 0.5;
  const cx = (p.horizontal * 0.01 + 1) * hx, cy = (p.vertical * 0.01 + 1) * hy;
  const ex = 2 * hx - cx, ey = 2 * hy - cy;
  const maxDist = Math.max(Math.hypot(cx, cy), Math.hypot(cy, ex), Math.hypot(ey, ex), Math.hypot(cx, ey));
  const a0 = p.rotation * PI * (1 / 180), sector = PI / Math.max(1, p.petals);
  const rIn = p.suction * maxDist * 0.01, rOut = (hx / (p.orbits + 0.01)) * 0.5 + rIn;
  const zoom = Math.pow(2, Math.LN2 * Math.log2(5) * p.scale * -0.01 * Math.LOG2E);
  const px = [0, 0, 0, 0];
  for (let y = 0; y < H; y++) {
    const dy = (y % th) - hy;
    for (let x = 0; x < W; x++) {
      const dx = (x % tw) - hx;
      const r = fold(Math.sqrt(dx * dx + dy * dy) * zoom, rIn, rOut);
      const t = fold(Math.atan2(dy, dx), a0, a0 + sector);
      const sx = fold(Math.trunc(x / tw) * tw + cx + Math.cos(t) * r, 1, W - 2);
      const sy = fold(Math.trunc(y / th) * th + cy + Math.sin(t) * r, 1, H - 2);
      sampleBilinear(src, Math.trunc(sx * 256), Math.trunc(sy * 256), px);
      const o = (y * W + x) * 4;
      out.data[o] = px[0]; out.data[o + 1] = px[1]; out.data[o + 2] = px[2];
    }
  }
  return out;
}

/*
  Image > Effects > Pattern (Psp.exe 0x699510, DIALOG 27038): each pixel's offset from the
  center, scaled by 5^(−scale/100) and shifted, is folded by mirroring into one cell of
  `columns` x `rows`, rotated by rotation·0.01 radians (PSP's unit), and sampled there.
*/
export interface PatternParams {
  horizontal: number;
  vertical: number;
  rotation: number;
  scale: number;
  columns: number;
  rows: number;
  hShift: number;
  vShift: number;
}

export const PATTERN_DEFAULTS: PatternParams = { horizontal: 0, vertical: 0, rotation: 90, scale: 0, columns: 3, rows: 3, hShift: 0, vShift: 0 };

export function pattern(src: Raster, p: PatternParams, tilesX = 1, tilesY = 1): Raster {
  const { width: W, height: H } = src;
  const out = cloneRaster(src);
  if (W < 4 || H < 4) return out;
  const tw = Math.max(1, Math.trunc(W / tilesX)), th = Math.max(1, Math.trunc(H / tilesY));
  const hx = tw * 0.5, hy = th * 0.5;
  const cx = (p.horizontal * 0.01 + 1) * hx, cy = (p.vertical * 0.01 + 1) * hy;
  const ax = (hx * 0.5) / Math.max(1, p.columns), ay = (hy * 0.5) / Math.max(1, p.rows);
  const rot = p.rotation * 0.01, sn = Math.sin(rot), cs = Math.cos(rot);
  const zoom = Math.pow(5, -p.scale * 0.01);
  const sx0 = p.hShift * hx * 0.01, sy0 = p.vShift * hy * 0.01;
  const px = [0, 0, 0, 0];
  for (let y = 0; y < H; y++) {
    const v = fold(((y % th) - hy) * zoom + sy0, -ay, ay);
    for (let x = 0; x < W; x++) {
      const u = fold(((x % tw) - hx) * zoom + sx0, -ax, ax);
      const sx = fold(Math.trunc(x / tw) * tw + cx + sn * v + cs * u, 1, W - 2);
      const sy = fold(Math.trunc(y / th) * th + cy + (cs * v - sn * u), 1, H - 2);
      sampleBilinear(src, Math.trunc(sx * 256), Math.trunc(sy * 256), px);
      const o = (y * W + x) * 4;
      out.data[o] = px[0]; out.data[o + 1] = px[1]; out.data[o + 2] = px[2];
    }
  }
  return out;
}
