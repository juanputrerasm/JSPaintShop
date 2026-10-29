/*
  Image > Effects > Chrome (Psp.exe 0x54f940; docs/PSP_EXE_ANALYSIS.md section 8). The grey
  level of each pixel, trunc((R + G + B) / 3), goes through a triangle wave with `flaws` peaks;
  the wave scales the color (or, with "Use original color", the pixel itself) and Brightness is
  added, clipped at 255.
*/
import { cloneRaster, type Raster } from "../image/raster.ts";

export interface ChromeParams {
  flaws: number;
  brightness: number;
  color: readonly [number, number, number];
  useOriginal: boolean;
}

export const CHROME_DEFAULTS: ChromeParams = { flaws: 4, brightness: 50, color: [255, 255, 255], useOriginal: false };

export function chromeWave(flaws: number): Uint8Array {
  const P = Math.trunc(0xfe01 / Math.max(1, Math.trunc(flaws))), half = Math.trunc(P / 2);
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let v = (i << 8) % P;
    if (v > half) v = P - v;
    t[i] = half ? Math.trunc((v * 255) / half) : 0;
  }
  return t;
}

export function chrome(src: Raster, p: ChromeParams): Raster {
  const out = cloneRaster(src), d = out.data, wave = chromeWave(p.flaws), add = Math.trunc(p.brightness);
  for (let i = 0; i < d.length; i += 4) {
    const u = wave[Math.trunc((d[i] + d[i + 1] + d[i + 2]) / 3)];
    for (let c = 0; c < 3; c++) d[i + c] = Math.min(255, Math.trunc((u * (p.useOriginal ? d[i + c] : p.color[c])) / 255) + add);
  }
  return out;
}
