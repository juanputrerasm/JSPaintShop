/*
  Scitex Continuous Tone (.sct, .ct) (jff.dll DecodeSCT 0x10080da0 and EncodeSCT 0x10080e10,
  a codec class at 0x10139d00). docs/PSP_EXE_ANALYSIS.md section 18.

    0x000   1024 bytes: a name, then "CT" ending the text (PSP writes "%-80s" and "CT").
    0x400   units (0 mm, 1 inch), channel count (3 CMY, 4 CMYK), a 0, the channel mask
            (bits 1, 2, 4 and 8 for black, all required); then fixed-width text fields:
            0x404 height and 0x412 width in the units (14 characters, "+.DDDDDDDDE+XX"),
            0x420 lines and 0x42c pixels a line (12 characters, "%+012ld").
    0x800   the lines top down; each line is one row of every channel in turn, a row padded
            to an even length when the width is odd and the file says so by its size.

  Inks are stored inverted (255 = no ink). PSP converts them in floating point (0x10025bf0):
  ink = 1 - v / 255, then for CMYK each of C, M, Y becomes min(1, ink * (1 - K) + K), and
  each RGB byte is trunc(255 * (1 - ink)). Saving takes K = min(C, M, Y) of 1 - RGB / 255 and
  takes it out of each ink. PSP 6 only subtracts it (0x10025eea), which its own reader does not
  undo, so its files open lighter wherever there is black; here each ink is (ink - K) / (1 - K),
  the inverse of the reader. Single-precision stores are kept with Math.fround.
*/
import type { Raster } from "../image/raster.ts";
import type { DecodedImage } from "./bmp.ts";

const f = Math.fround;
const text = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n)).replace(/\0.*$/s, "");

export function isSct(b: Uint8Array): boolean {
  if (b.length < 0x800) return false;
  let end = 0;
  while (end < 0x400 && b[end]) end++;
  return end < 0x400 && end > 2 && text(b, end - 2, 2).toUpperCase() === "CT" && (b[0x401] === 3 || b[0x401] === 4) && b[0x400] < 2;
}

/** CMYK (inverted inks) to RGB, as PSP's mode 1 with the inverted flag. */
export function sctCmykToRgb(C: number, M: number, Y: number, K: number): [number, number, number] {
  const c = 1 - C / 255, m = f(1 - f(M / 255)), y = f(1 - f(Y / 255)), k = f(1 - f(K / 255));
  const w = 1 - k;
  const cc = Math.min(1, c * w + k), mm = f(Math.min(1, m * w + k)), yy = Math.min(1, y * w + k);
  return [Math.trunc(255 * (1 - cc)), Math.trunc(255 * f(1 - mm)), Math.trunc(255 * f(1 - yy))];
}

/** CMY (inverted) to RGB, PSP's mode 2. */
export function sctCmyToRgb(C: number, M: number, Y: number): [number, number, number] {
  const one = (v: number) => Math.trunc(255 * f(1 - f(1 - f(v / 255))));
  return [one(C), one(M), one(Y)];
}

export function decodeSct(b: Uint8Array): DecodedImage {
  if (!isSct(b)) throw new Error("Not a Scitex CT file.");
  const units = b[0x400], channels = b[0x401], mask = b[0x403];
  if ((mask & 7) !== 7 || (channels === 4 && !(mask & 8))) throw new Error("This Scitex CT file's channels are not supported.");
  const heightUnits = parseFloat(text(b, 0x404, 14)), lines = parseInt(text(b, 0x420, 12), 10), pixels = parseInt(text(b, 0x42c, 12), 10);
  if (!(lines > 0 && pixels > 0)) throw new Error("This Scitex CT file has no image size.");
  const pad = pixels & 1 && b.length - channels * lines * pixels !== 0x800 ? 1 : 0, stride = pixels + pad;
  if (b.length < 0x800 + stride * channels * lines) throw new Error("The Scitex CT file is shorter than its image.");
  const data = new Uint8ClampedArray(pixels * lines * 4);
  for (let y = 0; y < lines; y++) {
    const base = 0x800 + y * stride * channels;
    for (let x = 0; x < pixels; x++) {
      const v = (c: number) => b[base + c * stride + x];
      const [r, g, bl] = channels === 4 ? sctCmykToRgb(v(0), v(1), v(2), v(3)) : sctCmyToRgb(v(0), v(1), v(2));
      const o = (y * pixels + x) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = bl; data[o + 3] = 255;
    }
  }
  // Lines per unit of height: per mm for units 0 (PSP keeps it per cm), per inch for 1.
  const perUnit = heightUnits > 0 ? lines / heightUnits : 0;
  const dpi = units === 1 ? perUnit : perUnit * 25.4;
  return { raster: { width: pixels, height: lines, data }, depth: 24, greyscale: false, palette: null, dpi: Math.round(dpi) };
}

/* "+.DDDDDDDDE+XX": eight significant digits after the point and the decimal exponent, as _fcvt gives them. */
export function sctNumber(v: number): string {
  if (!(v > 0)) return "+.00000000E+00";
  let exp = Math.floor(Math.log10(v)) + 1;
  let digits = Math.round(v * 10 ** (8 - exp));
  if (digits >= 1e8) { digits = Math.round(digits / 10); exp++; }
  return `+.${String(digits).padStart(8, "0")}E${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
}

/** PSP's RGB to inverted CMYK (mode 3) or CMY (mode 4). */
export function sctFromRgb(r: number, g: number, bl: number, cmyk: boolean): number[] {
  const c = f(1 - r / 255), m = f(1 - g / 255), y = f(1 - bl / 255);
  if (!cmyk) return [Math.trunc(255 * (1 - c)), Math.trunc(255 * f(1 - m)), Math.trunc(255 * f(1 - y))];
  const k = Math.min(c, m, y), w = 1 - k;
  const cc = w > 0 ? (c - k) / w : 0, mm = w > 0 ? f((m - k) / w) : 0, yy = w > 0 ? f((y - k) / w) : 0;
  return [Math.trunc(255 * (1 - cc)), Math.trunc(255 * f(1 - mm)), Math.trunc(255 * f(1 - yy)), Math.trunc(255 * (1 - k))];
}

/** Save as Scitex CT, CMYK by default, in inches. */
export function encodeSct(r: Raster, dpi: number, name = "", cmyk = true): Uint8Array {
  const { width: W, height: H, data } = r, ch = cmyk ? 4 : 3;
  const pad = W & 1, stride = W + pad, out = new Uint8Array(0x800 + stride * ch * H);
  const put = (at: number, s: string) => { for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i) & 0xff; };
  put(0, name.slice(0, 80).padEnd(80, " ") + "CT");
  const res = dpi > 0 ? dpi : 72;
  out[0x400] = 1; out[0x401] = ch; out[0x402] = 0; out[0x403] = cmyk ? 0x0f : 0x07;
  put(0x404, sctNumber(H / res).slice(0, 14));
  put(0x412, sctNumber(W / res).slice(0, 14));
  const long = (v: number) => (v < 0 ? "-" : "+") + String(Math.abs(v)).padStart(11, "0");
  put(0x420, long(H)); put(0x42c, long(W));
  for (let y = 0; y < H; y++) {
    const base = 0x800 + y * stride * ch;
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4, v = sctFromRgb(data[o], data[o + 1], data[o + 2], cmyk);
      for (let c = 0; c < ch; c++) out[base + c * stride + x] = v[c];
    }
  }
  return out;
}
