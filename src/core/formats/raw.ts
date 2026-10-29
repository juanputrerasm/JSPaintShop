/*
  RAW files (jff.dll DecodeRAW 0x1007c610 and EncodeRAW 0x1007d2c0; DIALOG 8015 "RAW Options"
  when opening, DIALOG 468 "RAW" when saving). docs/PSP_EXE_ANALYSIS.md section 18.

  A RAW file has no header of its own: PSP asks for the size and layout.

    Opening    an optional header of any length is skipped, then rows of width x height:
               Single channel (greyscale): a byte per pixel, opened as 8-bit greyscale.
               Three channel (RGB): interleaved RGB RGB... or BGR BGR..., or planar
               (all R, then all G, then all B, or B, G, R).
               Three channel (CMY), Four channel (CMYK): interleaved, ink 255 = full ink.
               Rows run top down unless Flipped (bottom up). A short file fails.
    Saving     the header size as zero bytes, then 8-bit images as one palette index per pixel
               and the others as 24-bit RGB (interleaved or planar, RGB or BGR order), top down
               unless flipped.

  Additions for game art (Terminal Reality's .RAW textures are unheadered palette indices):
  the size guesses offered for a byte count (OpenPhotex's square texture sides, then JSPod's
  known screen sizes and the factor pairs closest to square), and .ACT palettes, read with
  OpenPhotex's 6-bit rule (docs/RAW_ACT.md there).
*/
import type { Raster } from "../image/raster.ts";
import type { DecodedImage } from "./bmp.ts";

export type RawChannels = "grey" | "rgb" | "cmy" | "cmyk";
export const RAW_CHANNEL_BYTES: Record<RawChannels, number> = { grey: 1, rgb: 3, cmy: 3, cmyk: 4 };

export interface RawReadOptions {
  width: number;
  height: number;
  channels: RawChannels;
  /** Bytes skipped at the start, 0..32767. */
  header: number;
  /** RGB only: RRR GGG BBB instead of RGB RGB. */
  planar: boolean;
  /** RGB only: BGR order. */
  bgr: boolean;
  /** Rows bottom up. */
  flipped: boolean;
  /** Single channel: the palette to show the indices through (an addition); greys when absent. */
  palette?: Uint8Array | null;
}

export interface RawWriteOptions {
  header: number;
  flipped: boolean;
  bgr: boolean;
  planar: boolean;
}

export const RAW_READ_DEFAULTS: RawReadOptions = { width: 256, height: 256, channels: "grey", header: 0, planar: false, bgr: false, flipped: false };
export const RAW_WRITE_DEFAULTS: RawWriteOptions = { header: 0, flipped: false, bgr: false, planar: false };
export const RAW_MAX_SIDE = 0x7fff;

const GREYS = Uint8Array.from({ length: 768 }, (_, i) => Math.floor(i / 3));

export function decodeRaw(bytes: Uint8Array, o: RawReadOptions): DecodedImage {
  const W = Math.trunc(o.width), H = Math.trunc(o.height), header = Math.max(0, Math.trunc(o.header));
  if (W < 1 || H < 1 || W > RAW_MAX_SIDE || H > RAW_MAX_SIDE) throw new Error(`A RAW image is 1 to ${RAW_MAX_SIDE} pixels each way, not ${W} x ${H}.`);
  if (bytes.length < header) throw new Error(`The file is ${bytes.length} bytes, shorter than its ${header}-byte header.`);
  const bpp = RAW_CHANNEL_BYTES[o.channels], need = header + W * H * bpp;
  if (bytes.length < need) throw new Error(`A ${W} x ${H} ${o.channels.toUpperCase()} RAW image needs ${need} bytes; the file has ${bytes.length}.`);
  const data = new Uint8ClampedArray(W * H * 4);
  const out = (fileRow: number) => (o.flipped ? H - 1 - fileRow : fileRow) * W * 4;
  const src = bytes.subarray(header);
  let indices: Uint8Array | undefined;
  if (o.channels === "grey") {
    const pal = o.palette && o.palette.length >= 3 ? o.palette : GREYS;
    indices = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const d = out(y), s = y * W;
      for (let x = 0; x < W; x++) {
        const v = src[s + x], p = Math.min(v, pal.length / 3 - 1) * 3;
        indices[d / 4 + x] = v;
        data[d + x * 4] = pal[p]; data[d + x * 4 + 1] = pal[p + 1]; data[d + x * 4 + 2] = pal[p + 2]; data[d + x * 4 + 3] = 255;
      }
    }
    const palette = new Uint8Array(768);
    palette.set(pal.subarray(0, 768));
    return { raster: { width: W, height: H, data }, depth: 8, greyscale: !o.palette, palette, dpi: 0, indices };
  }
  for (let y = 0; y < H; y++) {
    const d = out(y);
    for (let x = 0; x < W; x++) {
      const q = d + x * 4;
      let r: number, g: number, b: number;
      if (o.channels === "rgb") {
        if (o.planar) {
          const plane = W * H, i = y * W + x, first = src[i], second = src[plane + i], third = src[2 * plane + i];
          [r, g, b] = o.bgr ? [third, second, first] : [first, second, third];
        } else {
          const i = (y * W + x) * 3;
          [r, g, b] = o.bgr ? [src[i + 2], src[i + 1], src[i]] : [src[i], src[i + 1], src[i + 2]];
        }
      } else if (o.channels === "cmy") {
        const i = (y * W + x) * 3;
        r = 255 - src[i]; g = 255 - src[i + 1]; b = 255 - src[i + 2];
      } else {
        // PSP: each ink plus black, capped at full ink (its blue wraps instead; see the docs).
        const i = (y * W + x) * 4, k = src[i + 3];
        r = 255 - Math.min(255, src[i] + k); g = 255 - Math.min(255, src[i + 1] + k); b = 255 - Math.min(255, src[i + 2] + k);
      }
      data[q] = r; data[q + 1] = g; data[q + 2] = b; data[q + 3] = 255;
    }
  }
  return { raster: { width: W, height: H, data }, depth: 24, greyscale: false, palette: null, dpi: 0 };
}

/**
 * Write a RAW file. `indices` (with its image paletted) writes a byte per pixel; otherwise the
 * image's RGB is written as 24-bit.
 */
export function encodeRaw(r: Raster, o: RawWriteOptions, indices?: Uint8Array | null): Uint8Array {
  const { width: W, height: H, data } = r, header = Math.max(0, Math.min(RAW_MAX_SIDE, Math.trunc(o.header)));
  const bpp = indices ? 1 : 3, out = new Uint8Array(header + W * H * bpp), dst = out.subarray(header);
  const row = (fileRow: number) => (o.flipped ? H - 1 - fileRow : fileRow);
  for (let y = 0; y < H; y++) {
    const sy = row(y);
    for (let x = 0; x < W; x++) {
      const i = sy * W + x;
      if (indices) { dst[y * W + x] = indices[i]; continue; }
      const rr = data[i * 4], gg = data[i * 4 + 1], bb = data[i * 4 + 2];
      const [a, b, c] = o.bgr ? [bb, gg, rr] : [rr, gg, bb];
      if (o.planar) { const plane = W * H, k = y * W + x; dst[k] = a; dst[plane + k] = b; dst[2 * plane + k] = c; }
      else { const k = (y * W + x) * 3; dst[k] = a; dst[k + 1] = b; dst[k + 2] = c; }
    }
  }
  return out;
}

/* ---- Size guesses (additions) ---- */

export interface RawGuess { width: number; height: number; channels: RawChannels; why: string }

/*
  Known sizes, best first, for a byte count:
  1. A square power-of-two texture, 8 to 2048 a side: OpenPhotex's rawTextureSide (the classic
     games use 32..1024, 4x4 Evolution 8..2048).
  2. JSPod's known screen sizes: 320 x 200, 640 x 400, 640 x 480.
  3. Any other square.
  The same three for three bytes a pixel (RGB). Then the factor pairs of the single-channel
  count closest to square, a power-of-two pair first, wider before taller (JSPod's
  suggestDimensions, which also puts JSPod's preferred widths 320, 256, 160, 128, 80, 64 first
  among equally square pairs of the same orientation).
*/
const SCREENS: [number, number][] = [[320, 200], [640, 400], [640, 480]];
const PREFERRED_WIDTHS = [320, 256, 160, 128, 80, 64];
const isPow2 = (n: number) => n > 0 && (n & (n - 1)) === 0;

function exactFor(pixels: number, channels: RawChannels, out: RawGuess[]): void {
  const side = Math.round(Math.sqrt(pixels));
  if (side * side === pixels && isPow2(side) && side >= 8 && side <= 2048) out.push({ width: side, height: side, channels, why: "square texture" });
  for (const [w, h] of SCREENS) if (w * h === pixels) out.push({ width: w, height: h, channels, why: "screen size" });
  if (side * side === pixels && !(isPow2(side) && side >= 8 && side <= 2048)) out.push({ width: side, height: side, channels, why: "square" });
}

export function rawSizeGuesses(byteLength: number, header = 0, limit = 16): RawGuess[] {
  const n = byteLength - Math.max(0, header);
  const out: RawGuess[] = [];
  if (n <= 0) return out;
  exactFor(n, "grey", out);
  if (n % 3 === 0) exactFor(n / 3, "rgb", out);
  // Factor pairs of the byte count, as single channel.
  const pairs: { w: number; h: number; score: number }[] = [];
  for (let a = 1; a * a <= n; a++) {
    if (n % a) continue;
    const b = n / a;
    if (b > RAW_MAX_SIDE) continue;
    for (const [w, h] of a === b ? [[a, b]] : [[b, a], [a, b]]) {
      if (w > RAW_MAX_SIDE) continue;
      const squareness = Math.min(w, h) / Math.max(w, h);
      const score = squareness + (isPow2(w) && isPow2(h) ? 1 : 0) + (PREFERRED_WIDTHS.includes(w) ? 0.001 : 0) + (w >= h ? 0.002 : 0);
      pairs.push({ w, h, score });
    }
  }
  pairs.sort((p, q) => q.score - p.score);
  for (const p of pairs) {
    if (out.some((g) => g.width === p.w && g.height === p.h && g.channels === "grey")) continue;
    out.push({ width: p.w, height: p.h, channels: "grey", why: isPow2(p.w) && isPow2(p.h) ? "power-of-two sides" : "factor pair" });
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

/* ---- .ACT palettes (addition) ---- */

/*
  256 RGB triples; longer files carry other data after them. 6-bit VGA palettes are told apart
  by their brightest channel byte being exactly 63 (OpenPhotex decodeActPalette) and scaled
  with round((v * 255 + 31) / 63); every other palette is used as stored. null when shorter
  than 768 bytes.
*/
export function decodeActPalette(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 768) return null;
  const raw = bytes.subarray(0, 768);
  let max = 0;
  for (const v of raw) if (v > max) max = v;
  if (max !== 63) return raw.slice();
  return Uint8Array.from(raw, (v) => Math.round((v * 255 + 31) / 63));
}
