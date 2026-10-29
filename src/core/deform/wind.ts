/*
  Image > Deformations > Wind (Psp.exe 0x8043d0, "WIND.CPP"; docs/PSP_EXE_ANALYSIS.md
  section 9). Along each row, from the side the wind comes from, every channel trails the one
  before it: v = p + trunc((v − p)·k / 100) with k = 78 + strength (strength above 20 counts
  as 0), clipped at 255. The layer's transparency trails the same way.
*/
import { cloneRaster, type Raster } from "../image/raster.ts";

export interface WindParams {
  /** 1..20. */
  strength: number;
  fromRight: boolean;
}

export const WIND_DEFAULTS: WindParams = { strength: 10, fromRight: true };

export function wind(src: Raster, p: WindParams): Raster {
  const { width: W, height: H } = src;
  const out = cloneRaster(src), d = out.data;
  let st = Math.trunc(p.strength);
  if (st > 20) st = 0;
  const k = st + 78;
  for (let y = 0; y < H; y++) for (let c = 0; c < 4; c++) {
    const start = p.fromRight ? W - 1 : 0, step = p.fromRight ? -1 : 1;
    let v = d[(y * W + start) * 4 + c];
    for (let i = 0, x = start; i < W; i++, x += step) {
      const o = (y * W + x) * 4 + c, px = d[o];
      v = px + Math.trunc(((v - px) * k) / 100);
      if (v > 255) v = 255;
      d[o] = v;
    }
  }
  return out;
}
