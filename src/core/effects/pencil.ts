/*
  Image > Effects > Black Pencil (Psp.exe 0x550240), Colored Pencil (0x552f10), Charcoal
  (0x5514d0) and Colored Chalk (0x5541a0); docs/PSP_EXE_ANALYSIS.md section 8. Per channel, an edge sum
    s = 200·(below − above) + 200·(right − left) + (101 − detail)·centre
  (edges repeated; "below" is the image row under the pixel) goes through a table: 255 when
  s > 0, 0 when s < −255·k, else 255 + trunc(s / k), with k = 101 − detail. Black Pencil takes
  the luminance (59 G + 30 R + 11 B) / 100 of the three results, Colored Pencil keeps them, and
  either is blended into the image by the opacity.
*/
import { cloneRaster, type Raster } from "../image/raster.ts";

export interface PencilParams {
  /** 1..100. */
  detail: number;
  /** 1..100 %. */
  opacity: number;
}

export const PENCIL_DEFAULTS: PencilParams = { detail: 90, opacity: 100 };

/* Charcoal is Black Pencil with its taps two pixels away. */
export function pencil(src: Raster, p: PencilParams, colored: boolean, reach = 1): Raster {
  const { width: W, height: H, data: s } = src;
  const out = cloneRaster(src), d = out.data;
  const k = Math.max(1, 101 - Math.trunc(p.detail));
  const o = Math.trunc((Math.trunc(p.opacity) * 255) / 100), io = 255 - o;
  const table = (sum: number) => (sum > 0 ? 255 : sum < -255 * k ? 0 : 255 + Math.trunc(sum / k));
  const at = (x: number, y: number, c: number) => s[((y < 0 ? 0 : y >= H ? H - 1 : y) * W + (x < 0 ? 0 : x >= W ? W - 1 : x)) * 4 + c];
  const t = [0, 0, 0];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    for (let c = 0; c < 3; c++) {
      t[c] = table(200 * (at(x, y + reach, c) - at(x, y - reach, c)) + 200 * (at(x + reach, y, c) - at(x - reach, y, c)) + k * at(x, y, c));
    }
    const i = (y * W + x) * 4;
    if (colored) for (let c = 0; c < 3; c++) d[i + c] = Math.trunc((t[c] * o + s[i + c] * io) / 255);
    else {
      const g = Math.trunc((t[1] * 59 + t[0] * 30 + t[2] * 11) / 100) * o;
      for (let c = 0; c < 3; c++) d[i + c] = Math.trunc((s[i + c] * io + g) / 255);
    }
  }
  return out;
}

/*
  Colored Chalk: the 5 x 5 kernel 36 18 9 4 2 two rows below, −2 −4 −9 −18 −36 two rows above,
  k = trunc((103 − detail) / 3) at the centre, through the same kind of table, per channel.
*/
export function coloredChalk(src: Raster, p: PencilParams): Raster {
  const { width: W, height: H, data: s } = src;
  const out = cloneRaster(src), d = out.data;
  const k = Math.max(1, Math.trunc((103 - Math.trunc(p.detail)) / 3));
  const o = Math.trunc((Math.trunc(p.opacity) * 255) / 100), io = 255 - o;
  const below = [36, 18, 9, 4, 2], above = [-2, -4, -9, -18, -36];
  const at = (x: number, y: number, c: number) => s[((y < 0 ? 0 : y >= H ? H - 1 : y) * W + (x < 0 ? 0 : x >= W ? W - 1 : x)) * 4 + c];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) {
      let sum = k * at(x, y, c);
      for (let j = 0; j < 5; j++) sum += below[j] * at(x + j - 2, y + 2, c) + above[j] * at(x + j - 2, y - 2, c);
      const t = sum > 0 ? 255 : sum < -255 * k ? 0 : 255 + Math.trunc(sum / k);
      d[i + c] = Math.trunc((t * o + s[i + c] * io) / 255);
    }
  }
  return out;
}
