/*
  Image > Effects > Blinds (Psp.exe 0x555c10, DIALOG 27029; docs/PSP_EXE_ANALYSIS.md section 8).
  Strips `width` pixels wide ramp between the image and the color. The phase runs on whole-image
  coordinates: columns from the left, or for horizontal blinds rows from the bottom (PSP's
  bitmaps are bottom-up).
*/
import { cloneRaster, type Raster } from "../image/raster.ts";

export interface BlindsParams {
  width: number;
  /** 1..100 %. */
  opacity: number;
  horizontal: boolean;
  lightFromLeftTop: boolean;
  color: readonly [number, number, number];
}

export const BLINDS_DEFAULTS: BlindsParams = { width: 20, opacity: 100, horizontal: true, lightFromLeftTop: false, color: [0, 0, 0] };

export function blinds(src: Raster, p: BlindsParams): Raster {
  const { width: W, height: H } = src;
  const out = cloneRaster(src), d = out.data;
  const o = Math.trunc((Math.trunc(p.opacity) * 255) / 100), io = 255 - o;
  const n = Math.max(2, Math.trunc(p.width)), n1 = n - 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = p.horizontal ? (H - 1 - y) % n : x % n;
    // How much of the color: vertical blinds lit from the left fade it in, the rest fade it out.
    const colorShare = p.horizontal ? (p.lightFromLeftTop ? n1 - k : k) : (p.lightFromLeftTop ? k : n1 - k);
    const at = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) {
      const v = d[at + c];
      d[at + c] = Math.trunc((Math.trunc(((p.color[c] * colorShare + v * (n1 - colorShare)) * o) / n1) + io * v) / 255);
    }
  }
  return out;
}
