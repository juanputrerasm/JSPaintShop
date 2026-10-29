/*
  Image > Deformations > Rotating Mirror (Psp.exe 0x73b1d0; docs/PSP_EXE_ANALYSIS.md
  section 9). Around the center (offsets in percent of the half size), each pixel's offset is
  turned by −angle, its first coordinate mirrored (absolute value), turned back, and the image
  sampled there, folded into [1, size − 2] (bilinear, edge mode 3). Defaults all 0.
*/
import { cloneRaster, type Raster } from "../image/raster.ts";
import { fold, sampleBilinear } from "../effects/sample.ts";

export interface MirrorParams { horizontal: number; vertical: number; rotation: number }

export function rotatingMirror(src: Raster, p: MirrorParams): Raster {
  const { width: W, height: H } = src;
  const out = cloneRaster(src);
  if (W < 4 || H < 4) return out;
  const cx = (p.horizontal * 0.01 + 1) * W * 0.5, cy = (p.vertical * 0.01 + 1) * H * 0.5;
  const a = Math.trunc(p.rotation) * 0.017453292519943295, sn = Math.sin(a), cs = Math.cos(a);
  for (let y = 0; y < H; y++) {
    const dy = y - cy;
    for (let x = 0; x < W; x++) {
      const dx = x - cx;
      const u = Math.abs(cs * dx + sn * dy), w = cs * dy - sn * dx;
      const sx = fold(cx + (cs * u - sn * w), 1, W - 2), sy = fold(cs * w + sn * u + cy, 1, H - 2);
      sampleBilinear(src, Math.trunc(sx * 256), Math.trunc(sy * 256), out.data, (y * W + x) * 4, 3);
    }
  }
  return out;
}

/*
  Image > Deformations > Warp (Psp.exe 0x770480): within R = size% of the distance from the
  center to the farthest corner, a point at distance d (r = d / R) samples its offset divided by
  (z − 1)·(2r − 3)·r² + z with z = 15^(strength/100), bulging the middle; outside R it is left
  where it is. Folded into the image, bilinear, edge mode 3. Defaults size 50, strength 50.
*/
export interface WarpParams { horizontal: number; vertical: number; size: number; strength: number }
export const WARP_DEFAULTS: WarpParams = { horizontal: 0, vertical: 0, size: 50, strength: 50 };

export function warp(src: Raster, p: WarpParams): Raster {
  const { width: W, height: H } = src;
  const out = cloneRaster(src);
  if (W < 4 || H < 4) return out;
  const hx = W * 0.5, hy = H * 0.5;
  const cx = (p.horizontal * 0.01 + 1) * hx, cy = (p.vertical * 0.01 + 1) * hy;
  const ex = 2 * hx - cx, ey = 2 * hy - cy;
  const far = Math.max(Math.hypot(cy, ex), Math.hypot(cx, cy), Math.hypot(ey, ex), Math.hypot(cx, ey));
  const R = Math.trunc(p.size) * far * 0.01, z = Math.pow(15, Math.trunc(p.strength) * 0.01);
  for (let y = 0; y < H; y++) {
    const dy = y - cy;
    for (let x = 0; x < W; x++) {
      let dx = x - cx, oy = dy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < R) {
        const r = dist / R, f = (z - 1) * (2 * r - 3) * r * r + z;
        dx /= f; oy /= f;
      }
      const sx = fold(cx + dx, 1, W - 2), sy = fold(cy + oy, 1, H - 2);
      sampleBilinear(src, Math.trunc(sx * 256), Math.trunc(sy * 256), out.data, (y * W + x) * 4, 3);
    }
  }
  return out;
}

/*
  Image > Deformations > CurlyQs (Psp.exe 0x504240): columns x rows swirls. In each tile, with
  rMax the shortest distance from the center to the tile's edges and R = size%·rMax, a point
  at distance d ≤ R turns by (d − R)²·k, k = ±a²/R² with a = (strength + 15)·0.1 (negated
  when clockwise), and samples tile + center + (cos θ·d, sin θ·d), folded, bilinear, mode 3.
  Defaults: 10 x 10, strength 15, size 100, clockwise.
*/
export interface CurlyParams { columns: number; rows: number; horizontal: number; vertical: number; strength: number; size: number; clockwise: boolean }
export const CURLY_DEFAULTS: CurlyParams = { columns: 10, rows: 10, horizontal: 0, vertical: 0, strength: 15, size: 100, clockwise: true };

export function curlyQs(src: Raster, p: CurlyParams): Raster {
  const { width: W, height: H } = src;
  const out = cloneRaster(src);
  if (W < 4 || H < 4) return out;
  const tw = Math.max(1, Math.trunc(W / Math.max(1, p.columns))), th = Math.max(1, Math.trunc(H / Math.max(1, p.rows)));
  const hx = tw * 0.5, hy = th * 0.5;
  const cx = (p.horizontal * 0.01 + 1) * hx, cy = (p.vertical * 0.01 + 1) * hy;
  const rMax = Math.min(2 * hx - cx, 2 * hy - cy, cx, cy);
  let a = (Math.trunc(p.strength) + 15) * 0.1;
  if (p.clockwise) a = -a;
  const R = Math.trunc(p.size) * rMax * 0.01;
  const k = R ? (a > 0 ? (a * a) / (R * R) : a < 0 ? -((a * a) / (R * R)) : 0) : 0;
  for (let y = 0; y < H; y++) {
    const dy = (y % th) - cy, ty = Math.trunc(y / th) * th + cy;
    for (let x = 0; x < W; x++) {
      const dx = (x % tw) - cx, d = Math.sqrt(dx * dx + dy * dy);
      let t = Math.atan2(dy, dx);
      if (d <= R) t += (d - R) * (d - R) * k;
      const sx = fold(Math.trunc(x / tw) * tw + cx + Math.cos(t) * d, 1, W - 2), sy = fold(Math.sin(t) * d + ty, 1, H - 2);
      sampleBilinear(src, Math.trunc(sx * 256), Math.trunc(sy * 256), out.data, (y * W + x) * 4, 3);
    }
  }
  return out;
}

/*
  Image > Deformations > Spiky Halo (Psp.exe 0x73a430): beyond R0 = radius% of the distance to
  the farthest corner, a point's angle θ gains (d/R0 − 1)·sin(θ·waves·2π)·compression·0.001,
  spiking the outside into rays; it then samples (cos θ·d, sin θ·d) from the center, folded,
  bilinear, mode 3. Defaults compression 50, waves 20, radius 50.
*/
export interface HaloParams { horizontal: number; vertical: number; compression: number; waves: number; radius: number }
export const HALO_DEFAULTS: HaloParams = { horizontal: 0, vertical: 0, compression: 50, waves: 20, radius: 50 };

export function spikyHalo(src: Raster, p: HaloParams): Raster {
  const { width: W, height: H } = src;
  const out = cloneRaster(src);
  if (W < 4 || H < 4) return out;
  const hx = W * 0.5, hy = H * 0.5;
  const cx = (p.horizontal * 0.01 + 1) * hx, cy = (p.vertical * 0.01 + 1) * hy;
  const ex = 2 * hx - cx, ey = 2 * hy - cy;
  const far = Math.max(Math.hypot(cy, ex), Math.hypot(cx, cy), Math.hypot(ey, ex), Math.hypot(cx, ey));
  const k = Math.trunc(p.compression) * 0.001, n = Math.trunc(p.waves), R0 = Math.trunc(p.radius) * far * 0.01;
  for (let y = 0; y < H; y++) {
    const dy = y - cy;
    for (let x = 0; x < W; x++) {
      const dx = x - cx, d = Math.sqrt(dx * dx + dy * dy);
      let t = Math.atan2(dy, dx);
      if (R0 < d) t += (d / R0 - 1) * Math.sin(t * n * 6.283185307179586) * k;
      const sx = fold(cx + Math.cos(t) * d, 1, W - 2), sy = fold(Math.sin(t) * d + cy, 1, H - 2);
      sampleBilinear(src, Math.trunc(sx * 256), Math.trunc(sy * 256), out.data, (y * W + x) * 4, 3);
    }
  }
  return out;
}
