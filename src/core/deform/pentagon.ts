/*
  Image > Deformations > Pentagon (Psp.exe 0x63fa70; docs/PSP_EXE_ANALYSIS.md section 9).
  A regular pentagon, point up: half width R0 = W/2 when W < trunc(343·H/330), else
  trunc(H·0.5257311); a = trunc(R0·1.0514622), side c = trunc(a·1.1755705), height
  ph = min(a + trunc(a·0.809017), H), lower sides L = trunc(c·0.9510565) tall, bottom corners
  bl, br = R0 ∓ trunc(c/2), right shoulder sx = min(br + trunc(c·0.309017), W).

  In pentagon coordinates (x from the left, rows from the bottom) the four slanted sides are
    s1 = L / −bl          through (0, L)
    s2 = (ph − L) / R0    through (0, L)
    s3 = (L − ph) / (sx − R0), intercept c3 = ph − trunc(R0·s3)
    s4 = L / (sx − br),        intercept c4 = L − trunc(sx·s4)
  A pixel (x, row) is left out when, with t = row − L:
    x < trunc(t / s1) and row < trunc(x·s1 + L)
    x < trunc(t / s2) and row > trunc(x·s2 + L)
    x > trunc((row − c3) / s3) and row > trunc(x·s3 + c3)
    x > trunc((row − c4) / s4) and row < trunc(x·s4 + c4)
  and, a quirk kept, the top row of the pentagon (and the image's own top row) is background
  when the width is even. Each row is squeezed between its edges (the lower or the upper
  pair) and the rows over the height, by PSP's area average; outside, the background color.
*/
import { cloneRaster, type Raster } from "../image/raster.ts";
import { areaSample, spanStart } from "./area.ts";

export function pentagon(src: Raster, bg: readonly [number, number, number]): Raster {
  const { width: W, height: H } = src;
  const out = cloneRaster(src), d = out.data;
  if (W < 5 || H < 5) return out;
  const R0 = W < Math.trunc((343 * H) / 330) ? Math.trunc(W / 2) : Math.trunc(H * 0.5257311211268731);
  const a = Math.trunc(R0 * 1.0514622422537463);
  const c = Math.trunc(a * 1.1755705);
  const half = Math.trunc(c / 2), bl = R0 - half, br = R0 + half;
  const inset = Math.trunc(c * 0.309017), L = Math.trunc(c * 0.9510565);
  const ph = Math.min(a + Math.trunc(a * 0.809017), H);
  const sx = Math.min(br + inset, W);
  const pw = Math.ceil(2 * R0);
  const s1 = L / -bl, s2 = (ph - L) / R0, s3 = (L - ph) / (sx - R0), s4 = L / (sx - br);
  const c3 = ph - Math.trunc(R0 * s3), c4 = L - Math.trunc(sx * s4);
  const ox = Math.abs(Math.trunc((pw - W) / 2)), oy = Math.abs(Math.trunc((ph - H) / 2));
  const px = [0, 0, 0];
  for (let m = 0; m < H; m++) {
    const row = m - oy, t = row - L, lower = row <= L;
    const left = Math.trunc(t / (lower ? s1 : s2));
    const right = lower ? Math.trunc((row - c4) / s4) : Math.trunc((row - c3) / s3);
    const span = Math.max(1, right - left);
    const y = H - 1 - m;
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4, xl = x - ox;
      let inside = m >= oy && m <= oy + ph && x >= ox && x <= ox + pw && m <= H - oy && x <= W - ox;
      if (inside && ((m >= oy + ph - 1 && !(pw & 1)) || (row >= H - 1 && !(W & 1)))) inside = false;
      if (inside) {
        if (xl < Math.trunc(t / s1) && row < Math.trunc(xl * s1 + L)) inside = false;
        else if (xl < Math.trunc(t / s2) && row > Math.trunc(xl * s2 + L)) inside = false;
        else if (xl > Math.trunc((row - c3) / s3) && row > Math.trunc(xl * s3 + c3)) inside = false;
        else if (xl > Math.trunc((row - c4) / s4) && row < Math.trunc(xl * s4 + c4)) inside = false;
      }
      if (!inside) { d[o] = bg[0]; d[o + 1] = bg[1]; d[o + 2] = bg[2]; continue; }
      const [sxi, fx, pctX] = spanStart(W, xl - left, span);
      const [syb, fy, pctY] = spanStart(H, row, ph);
      areaSample(src, sxi, fx, pctX, syb, fy, pctY, px);
      d[o] = px[0]; d[o + 1] = px[1]; d[o + 2] = px[2];
    }
  }
  return out;
}
