/*
  Image > Effects > Feedback (Psp.exe 0x5599a0, DIALOG 27030; docs/PSP_EXE_ANALYSIS.md
  section 8): the image drawn again and again into ever smaller rectangles closing on the
  center, like a hall of mirrors. Each step keeps k = 100 − (intensity·80/100 + 10) percent of
  the distance from each edge to the center; every copy is the whole original, sampled nearest,
  blended by the opacity. It stops when the rectangle stops shrinking.

  Elliptical draws a pixel only inside the ellipse of its own rectangle and inside the first
  step's ellipse: each ellipse has its foci on the longer side's axis, `c = trunc(sqrt(a² − b²))`
  from the integer centre with integer half sides, and a pixel is in when the truncated sum of
  its distances to the foci is at most the longer side (rows counted from the pixel's lower
  edge, as PSP walks them).
*/
import { cloneRaster, type Raster } from "../image/raster.ts";

export interface FeedbackParams {
  /** 1..100 %. */
  opacity: number;
  intensity: number;
  /** Center as a percentage of the width and height, from the top left. */
  horizontal: number;
  vertical: number;
  elliptical: boolean;
}

export const FEEDBACK_DEFAULTS: FeedbackParams = { opacity: 100, intensity: 30, horizontal: 50, vertical: 50, elliptical: false };

export function feedback(src: Raster, p: FeedbackParams): Raster {
  const { width: W, height: H, data: s } = src;
  const out = cloneRaster(src), d = out.data;
  const step = Math.trunc((Math.trunc(p.intensity) * 80) / 100) + 10, k = 100 - step;
  const o = Math.trunc((Math.trunc(p.opacity) * 255) / 100), io = 255 - o;
  const cx = Math.trunc((W * Math.trunc(p.horizontal)) / 100), cy = Math.trunc((H * Math.trunc(p.vertical)) / 100);
  let L = 0, T = 0, R = W, B = H, oldW = W + 1, oldH = H + 1;
  let first: { foci: number[]; w: number; h: number } | null = null;
  for (let guard = 0; guard < 10000; guard++) {
    const width = R - L;
    if (!width || B === T || oldW <= width || oldH <= B - T) break;
    oldW = width; oldH = B - T;
    const nL = L + Math.trunc(((cx - L) * k) / 100), nT = T + Math.trunc(((cy - T) * k) / 100);
    const nR = R + Math.trunc(((cx - R) * k) / 100), nB = B + Math.trunc(((cy - B) * k) / 100);
    L = nL; T = nT; R = nR; B = nB;
    if (R <= L || B <= T) break;
    const w = R - L, h = B - T, tall = w < h;
    const ccx = Math.trunc((L + R) / 2), cyy = Math.trunc((B + T) / 2);
    const c = Math.trunc(Math.sqrt(tall ? Math.trunc(h / 2) ** 2 - Math.trunc(w / 2) ** 2 : Math.trunc(w / 2) ** 2 - Math.trunc(h / 2) ** 2));
    const foci = tall ? [ccx, cyy + c, ccx, cyy - c] : [ccx + c, cyy, ccx - c, cyy];
    if (!first) first = { foci, w, h };
    const sum = (f: number[], x: number, y: number) => Math.trunc(Math.hypot(f[0] - x, f[1] - y) + Math.hypot(f[2] - x, f[3] - y));
    for (let y = B - 1; y >= T; y--) {
      if (y < 0 || y >= H) continue;
      // Source rows come from the bottom up, as PSP walks its bitmaps.
      const sy = H - 1 - Math.trunc(((B - 1 - y) * (H - 1)) / (B - T));
      for (let x = L; x < R; x++) {
        if (x < 0 || x >= W) continue;
        if (p.elliptical && (sum(foci, x, y + 1) > (tall ? h : w) || sum(first.foci, x, y + 1) > (tall ? first.h : first.w))) continue;
        const sx = Math.trunc(((x - L) * (W - 1)) / (R - L));
        const so = (Math.max(0, Math.min(H - 1, sy)) * W + sx) * 4, o2 = (y * W + x) * 4;
        for (let c = 0; c < 3; c++) d[o2 + c] = Math.trunc((s[so + c] * o + io * d[o2 + c]) / 255);
      }
    }
  }
  return out;
}
