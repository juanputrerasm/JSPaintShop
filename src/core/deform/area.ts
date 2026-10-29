/*
  PSP's area resampling for the polygon deformations (Psp.exe 0x63e800, 0x63fa70): a target
  pixel covers `pct` percent of a source pixel each way; the first source pixel counts only its
  covered part (`first`), the rest whole percents until 100 are used; the sum is divided by
  10000. Positions clamp to the image; `yb` counts rows from the bottom as PSP does.
*/
import type { Raster } from "../image/raster.ts";

export function areaSample(src: Raster, sx: number, firstX: number, pctX: number, syb: number, firstY: number, pctY: number, out: number[]): void {
  const { width: W, height: H, data: s } = src;
  out[0] = out[1] = out[2] = 0;
  let remX = 100, fx = firstX, x = sx;
  do {
    const wx = fx >= 1 ? fx : Math.min(remX, pctX);
    fx = 0;
    const xx = x < 0 ? 0 : x >= W - 1 ? W - 1 : x;
    let remY = 100, used = false, y = syb;
    do {
      let wy: number;
      if (firstY < 1 || used) wy = Math.min(remY, pctY);
      else { used = true; wy = firstY; }
      const yy = y < 0 ? 0 : y > H - 1 ? H - 1 : y;
      remY -= wy;
      const p = ((H - 1 - yy) * W + xx) * 4;
      out[0] += s[p] * wy * wx; out[1] += s[p + 1] * wy * wx; out[2] += s[p + 2] * wy * wx;
      y++;
    } while (remY > 0);
    remX -= wx;
    x++;
  } while (remX > 0);
  out[0] = Math.trunc(out[0] / 10000); out[1] = Math.trunc(out[1] / 10000); out[2] = Math.trunc(out[2] / 10000);
}

/** The source start and first-pixel weight for target offset `t` in a span `span` of `size`. */
export function spanStart(size: number, t: number, span: number): [number, number, number] {
  const n = size * t, pct = Math.max(1, Math.trunc((span * 100) / size));
  return [Math.trunc(n / span), Math.trunc(((100 - Math.trunc(((n % span) * 100) / span)) * pct) / 100), pct];
}
