/*
  Image > Arithmetic (DIALOG 209, Psp.exe 0x48cdd0): two images combined channel by channel,
  `f(a, b) / divisor + bias` in integers, then clipped to 0..255 or wrapped (Clip color
  values off). a is image #1, b image #2. docs/PSP_EXE_ANALYSIS.md section 6.
*/
import { createRaster, type Raster } from "../image/raster.ts";

export const ARITHMETIC = ["Add", "Subtract", "AND", "Multiply", "Difference", "OR", "Darkest", "Lightest", "Average"] as const;
export type ArithmeticFn = typeof ARITHMETIC[number];

function f(fn: ArithmeticFn, a: number, b: number): number {
  switch (fn) {
    case "Add": return a + b;
    case "Subtract": return a - b;
    case "AND": return a & b;
    case "Multiply": return a * b;
    case "Difference": return Math.abs(a - b);
    case "OR": return a | b;
    case "Darkest": return Math.min(a, b);
    case "Lightest": return Math.max(a, b);
    case "Average": return (a + b) >> 1;
  }
}

/**
  Combine `a` and `b` (same size). `channels` null for all channels, else [channel of a,
  channel of b] (0 R, 1 G, 2 B) giving a greyscale result.
*/
export function arithmetic(a: Raster, b: Raster, fn: ArithmeticFn, divisor: number, bias: number, clip: boolean, channels: [number, number] | null): Raster {
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  const out = createRaster(w, h);
  const div = divisor || 1;
  const fit = (v: number) => (clip ? (v < 0 ? 0 : v > 255 ? 255 : v) : v & 255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ia = (y * a.width + x) * 4, ib = (y * b.width + x) * 4, o = (y * w + x) * 4;
    if (channels) {
      const v = fit(Math.trunc(f(fn, a.data[ia + channels[0]], b.data[ib + channels[1]]) / div) + bias);
      out.data.set([v, v, v, 255], o);
    } else {
      for (let c = 0; c < 3; c++) out.data[o + c] = fit(Math.trunc(f(fn, a.data[ia + c], b.data[ib + c]) / div) + bias);
      out.data[o + 3] = 255;
    }
  }
  return out;
}
