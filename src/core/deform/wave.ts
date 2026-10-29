/*
  Image > Deformations > Wave (Psp.exe 0x7e8da0, "Wave.cpp"; docs/PSP_EXE_ANALYSIS.md
  section 9). Row y moves sideways by trunc(sin(y·2π/λx)·ampX·256) / 256 and column x
  up or down by trunc(sin(x·2π/λy)·ampY·256) / 256, sampled bilinearly in 8.8 fixed point;
  positions that fall outside leave the pixel as it was (edge mode 0). π is 3.14159…
*/
import { cloneRaster, type Raster } from "../image/raster.ts";
import { sampleBilinear } from "../effects/sample.ts";

export interface WaveParams { ampX: number; lenX: number; ampY: number; lenY: number }
export const WAVE_DEFAULTS: WaveParams = { ampX: 20, lenX: 50, ampY: 20, lenY: 50 };

export function wave(src: Raster, p: WaveParams): Raster {
  const { width: W, height: H } = src;
  const out = cloneRaster(src);
  const fx = p.lenX < 1 ? 0 : (1 / p.lenX) * Math.PI + (1 / p.lenX) * Math.PI;
  const fy = p.lenY < 1 ? 0 : (1 / p.lenY) * Math.PI + (1 / p.lenY) * Math.PI;
  const ax = p.ampX * 256, ay = p.ampY * 256;
  const colOff = Array.from({ length: W }, (_, x) => Math.trunc(Math.sin(x * fy) * ay));
  for (let y = 0; y < H; y++) {
    const rowOff = Math.trunc(Math.sin(y * fx) * ax);
    for (let x = 0; x < W; x++) sampleBilinear(src, (x << 8) + rowOff, (y << 8) + colOff[x], out.data, (y * W + x) * 4, 0);
  }
  return out;
}
