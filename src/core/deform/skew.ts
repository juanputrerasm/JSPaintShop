/*
  Image > Deformations > Skew (Psp.exe 0x640c80; docs/PSP_EXE_ANALYSIS.md section 9).
  A nonzero horizontal angle skews the rows (the vertical angle is then ignored), else the
  vertical angle skews the columns. With a the angle's size and π = 3.1415927:

    D = max(1, trunc(tan(a · π / 180) · side))   side = height for rows, width for columns

  Rows (bitmap rows m counted from the bottom; the result is D wider, centred back into the
  image by trunc(D / 2)):
    slope s = H / D (positive angle) or −H / D (negative), and two offsets:
      positive  A = 0,                B = trunc(−W · s)
      negative  A = trunc(−(D · s)),  B = trunc(−((W + D) · s))
    row m covers the columns trunc((m − A) / s) .. trunc((m − B) / s); a column x there takes
    the source column x − start (held inside the image), the background color elsewhere.

  Columns (column c from the left; the result is D taller, centred the same way):
    slope s = D / W (positive) or −D / W (negative)
      positive  rows trunc(c · s) .. trunc(H + c · s)
      negative  rows trunc(c · s) + D .. trunc(H + D + c · s)
    and a bitmap row r there takes the source row r − start.
*/
import { cloneRaster, type Raster } from "../image/raster.ts";

export interface SkewParams { horizontal: number; vertical: number }
export const SKEW_DEFAULTS: SkewParams = { horizontal: 25, vertical: 25 };

const PI = 3.1415927;

export function skew(src: Raster, p: SkewParams, bg: readonly [number, number, number]): Raster {
  const { width: W, height: H, data: s } = src;
  const out = cloneRaster(src), d = out.data;
  const horizontal = Math.trunc(p.horizontal) !== 0;
  const angle = horizontal ? Math.trunc(p.horizontal) : Math.trunc(p.vertical);
  if (!angle || W < 5 || H < 5) return out;
  const a = Math.abs(angle), neg = angle < 0;
  const D = Math.max(1, Math.trunc(Math.tan(a * PI * (1 / 180)) * (horizontal ? H : W)));
  const offset = Math.trunc(D / 2);
  const put = (x: number, y: number, sx: number, sy: number) => {
    const o = (y * W + x) * 4;
    if (sx < 0) { d[o] = bg[0]; d[o + 1] = bg[1]; d[o + 2] = bg[2]; return; }
    const q = (sy * W + sx) * 4;
    d[o] = s[q]; d[o + 1] = s[q + 1]; d[o + 2] = s[q + 2]; d[o + 3] = s[q + 3];
  };
  if (horizontal) {
    const slope = neg ? (H * -1) / D : H / D;
    const A = neg ? Math.trunc(-(D * slope)) : 0;
    const B = neg ? Math.trunc(-((W + D) * slope)) : Math.trunc(-(W * slope));
    for (let m = 0; m < H; m++) {
      const start = Math.trunc((m - A) / slope), end = Math.trunc((m - B) / slope), y = H - 1 - m;
      for (let x = 0; x < W; x++) {
        const X = x + offset;
        put(x, y, X < start || X > end ? -1 : Math.max(0, Math.min(W - 1, X - start)), y);
      }
    }
  } else {
    const slope = neg ? (D * -1) / W : D / W;
    for (let c = 0; c < W; c++) {
      const t = c * slope;
      const start = Math.trunc(t) + (neg ? D : 0), end = Math.trunc((neg ? H + D : H) + t);
      for (let r = 0; r < H; r++) {
        const R = r + offset, y = H - 1 - r;
        put(c, y, R < start || R > end ? -1 : c, H - 1 - Math.max(0, Math.min(H - 1, R - start)));
      }
    }
  }
  return out;
}
