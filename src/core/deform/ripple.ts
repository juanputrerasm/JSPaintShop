/*
  Image > Deformations > Ripple (Psp.exe 0x7427a0; docs/PSP_EXE_ANALYSIS.md section 9).
  Around the origin (a percentage of the size), every pixel whose squared distance lies
  between the amplitude and max(W, H)² moves along its radius: with r its distance,
  k = sin(r·2π/λ)·amp·256 / r, it samples (x·256 + trunc(dx·k), y·256 + trunc(dy·k));
  positions outside the image leave it as it was. π is 3.14159…
*/
import { cloneRaster, type Raster } from "../image/raster.ts";
import { sampleBilinear } from "../effects/sample.ts";

export interface RippleParams { originX: number; originY: number; amplitude: number; wavelength: number }
export const RIPPLE_DEFAULTS: RippleParams = { originX: 50, originY: 50, amplitude: 10, wavelength: 40 };

export function ripple(src: Raster, p: RippleParams): Raster {
  const { width: W, height: H } = src;
  const out = cloneRaster(src);
  const A = Math.trunc(p.amplitude), L = Math.trunc(p.wavelength);
  if (A < 1 || L < 1) return out;
  const cx = Math.trunc((Math.trunc(p.originX) * W) / 100), cy = Math.trunc((Math.trunc(p.originY) * H) / 100);
  const big = Math.max(W, H), max2 = big * big;
  const f = (1 / L) * Math.PI * 2, a256 = A << 8;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
    if (d2 < A || d2 > max2) continue;
    const r = Math.sqrt(d2), k = (Math.sin(r * f) * a256) / r;
    sampleBilinear(src, (x << 8) + Math.trunc(dx * k), (y << 8) + Math.trunc(dy * k), out.data, (y * W + x) * 4, 0);
  }
  return out;
}
