/*
  Image > Deformations > Perspective - Horizontal (Psp.exe 0x8099c0, "HPERSP") and
  Perspective - Vertical (0x80ad30); docs/PSP_EXE_ANALYSIS.md section 9.

  Horizontal: each column is squeezed into a band that narrows linearly toward one side.
  m = (H − max(1, trunc((100 − amount)·H / 100))) / 2 and s = m / W in single precision; column
  x gets [m − trunc(x·s), H − m + trunc(x·s)] for a negative amount (the left side narrow),
  [trunc(x·s), H − trunc(x·s)] for a positive one (the right side narrow). Inside the band each
  target pixel takes 100000 units from consecutive source pixels worth
  trunc((hi − lo)·100000 / H) each, starting at the bitmap's bottom row; outside, the
  background color. Amounts below 3 in size leave the image alone.

  Vertical is the same along rows; JSPaintShop transposes the horizontal logic (PSP's own sign
  handling there is not fully read).
*/
import { cloneRaster, type Raster } from "../image/raster.ts";

function squeezeLines(src: Raster, amount: number, bg: readonly [number, number, number], vertical: boolean): Raster {
  const { width: W, height: H, data: s } = src;
  const out = cloneRaster(src), d = out.data;
  const a = Math.abs(Math.trunc(amount));
  if (a < 3 || a > 100) return out;
  const L = vertical ? W : H; // length of a line being squeezed
  const N = vertical ? H : W; // number of lines
  const keep = Math.max(1, Math.trunc(((100 - a) * L) / 100));
  const m = Math.trunc((L - keep) / 2);
  const sl = Math.fround(Math.fround(m) / N);
  // Pixel `i` along line `n`, lines and positions as PSP walks them (rows from the bottom).
  const at = (n: number, i: number) => (vertical ? ((H - 1 - n) * W + i) : ((H - 1 - i) * W + n)) * 4;
  const acc = [0, 0, 0];
  for (let n = 0; n < N; n++) {
    const t = Math.trunc(n * sl);
    const lo = amount < 0 ? m - t : t, hi = amount < 0 ? L - m + t : L - t;
    const each = Math.max(1, Math.trunc(((hi - lo) * 100000) / L));
    let rem = each, src_i = 0;
    for (let i = 0; i < L; i++) {
      const o = at(n, i);
      if (i < lo || hi < i) { d[o] = bg[0]; d[o + 1] = bg[1]; d[o + 2] = bg[2]; continue; }
      acc[0] = acc[1] = acc[2] = 0;
      let need = 100000;
      do {
        const p = at(n, src_i);
        let w: number;
        if (rem < need) { w = rem; need -= rem; rem = each; src_i = Math.min(L - 1, src_i + 1); }
        else { w = need; rem -= need; need = 0; }
        acc[0] += s[p] * w; acc[1] += s[p + 1] * w; acc[2] += s[p + 2] * w;
      } while (need > 0);
      d[o] = Math.trunc(acc[0] / 100000); d[o + 1] = Math.trunc(acc[1] / 100000); d[o + 2] = Math.trunc(acc[2] / 100000);
    }
  }
  return out;
}

export const perspectiveHorizontal = (src: Raster, amount: number, bg: readonly [number, number, number]) => squeezeLines(src, amount, bg, false);
export const perspectiveVertical = (src: Raster, amount: number, bg: readonly [number, number, number]) => squeezeLines(src, amount, bg, true);
