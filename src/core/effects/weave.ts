/*
  Image > Effects > Weave (Psp.exe 0x54e5c0, DIALOG 447; docs/PSP_EXE_ANALYSIS.md section 8).
  Strands `width` wide with `gap` between them, over and under each other in a period of
  2 (gap + width), on whole-image coordinates (rows from the bottom). Each strand is shaded
  round, sh(d) = trunc(B + sqrt(R² − trunc(d·R / half)²)) with B = trunc((100 − opacity)·255/100),
  R = 255 − B and half = (width + 2·gap) / 2; the pixel becomes
  trunc((pixel·sh + weaveColor·(255 − sh)) / 255). Gaps take the gap color when "Fill gaps" is on.
*/
import { cloneRaster, type Raster } from "../image/raster.ts";

export interface WeaveParams {
  gap: number;
  width: number;
  /** 1..100 %. */
  opacity: number;
  weaveColor: readonly [number, number, number];
  gapColor: readonly [number, number, number];
  fillGaps: boolean;
}

export const WEAVE_DEFAULTS: WeaveParams = { gap: 25, width: 75, opacity: 100, weaveColor: [0, 0, 0], gapColor: [0, 0, 0], fillGaps: true };

export function weave(src: Raster, p: WeaveParams): Raster {
  const { width: Wd, height: H } = src;
  const out = cloneRaster(src), d = out.data;
  const G = Math.max(0, Math.trunc(p.gap)), S = Math.max(1, Math.trunc(p.width));
  const GS = G + S, period = 2 * GS, half = Math.max(1, Math.trunc((S + 2 * G) / 2));
  const B = Math.trunc(((100 - Math.trunc(p.opacity)) * 255) / 100), R = 255 - B, R2 = R * R;
  const sh = (dd: number) => {
    const q = Math.trunc((dd * R) / half);
    return Math.trunc(B + Math.sqrt(Math.max(0, R2 - q * q)));
  };
  // The shade across a strand by its phase.
  const across = (t: number) => (t < G ? sh(t - G + half) : t < GS ? sh(half - t) : t < 2 * G + S ? sh(half - t + GS) : sh(t - GS - half));

  for (let y = 0; y < H; y++) {
    const j = (H - 1 - y) % period;
    for (let x = 0; x < Wd; x++) {
      const i = x % period;
      let s: number | "gap" | null = null;
      if (j < G) s = i < G || (i >= GS && i < 2 * G + S) ? "gap" : i < GS ? sh(j - G + half) : sh(half - j);
      else if (j < GS) s = i < 2 * G + S ? across(i) : sh(half - j);
      else if (j < 2 * G + S) s = i < G || (i >= GS && i < 2 * G + S) ? "gap" : i < GS ? sh(half - j + GS) : sh(j - half);
      else s = i < G || i >= GS ? across(i) : sh(j - GS - half);
      const o = (y * Wd + x) * 4;
      if (s === "gap") {
        if (p.fillGaps) { d[o] = p.gapColor[0]; d[o + 1] = p.gapColor[1]; d[o + 2] = p.gapColor[2]; }
        continue;
      }
      if (s === null) continue;
      for (let c = 0; c < 3; c++) d[o + c] = Math.trunc((d[o + c] * s + p.weaveColor[c] * (255 - s)) / 255);
    }
  }
  return out;
}
