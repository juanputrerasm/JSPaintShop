/*
  Windows and OS/2 bitmaps (.bmp, .dib, .rle), read and written.

  Reading takes every header PSP 6 opens: OS/2 1.x (12 bytes), Windows 3 (40), and the later
  V4/V5 headers; 1, 4, 8, 16, 24 and 32 bits; uncompressed, RLE4, RLE8 and bit fields.
  Writing makes a Windows 3 bitmap, 24 bits, or 1, 4 or 8 bits with a palette for a
  paletted image, uncompressed.
*/
import { createRaster, type Raster } from "../image/raster.ts";
import type { ColorDepth } from "../doc/image-doc.ts";

export interface DecodedImage {
  raster: Raster;
  depth: ColorDepth;
  greyscale: boolean;
  palette: Uint8Array | null;
  /** Pixels per inch, 0 when the file does not say. */
  dpi: number;
  /** The palette entry the file marks transparent (GIF), whose pixels come back clear. */
  transparent?: number;
  /** Paletted images: each pixel's palette index as the file had it (see ImageDoc.indices). */
  indices?: Uint8Array;
}

export function isBmp(b: Uint8Array): boolean {
  return b.length > 26 && b[0] === 0x42 && b[1] === 0x4d;
}

const fail = (why: string): never => { throw new Error(`Not a readable bitmap: ${why}.`); };

export function decodeBmp(b: Uint8Array): DecodedImage {
  if (!isBmp(b)) fail("no BM signature");
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const pixelOffset = v.getUint32(10, true);
  const h0 = 14;
  const headerSize = v.getUint32(h0, true);
  let width: number, height: number, bits: number, compression = 0, colorsUsed = 0, ppm = 0;
  if (headerSize === 12) {
    width = v.getUint16(h0 + 4, true); height = v.getInt16(h0 + 6, true); bits = v.getUint16(h0 + 10, true);
  } else if (headerSize >= 40) {
    width = v.getInt32(h0 + 4, true); height = v.getInt32(h0 + 8, true); bits = v.getUint16(h0 + 14, true);
    compression = v.getUint32(h0 + 16, true); ppm = v.getInt32(h0 + 24, true); colorsUsed = v.getUint32(h0 + 32, true);
  } else return fail(`unknown header size ${headerSize}`);
  const topDown = height < 0;
  height = Math.abs(height);
  if (width <= 0 || height <= 0 || width > 32767 || height > 32767) fail("bad size");
  if (![1, 4, 8, 16, 24, 32].includes(bits)) fail(`${bits} bits per pixel`);

  // Bit field masks: in the header from V4 on, else in the 12 bytes after a 40-byte header.
  let masks: number[] | null = null;
  if (compression === 3 || compression === 6) {
    const at = headerSize >= 52 ? h0 + 40 : h0 + headerSize;
    masks = [v.getUint32(at, true), v.getUint32(at + 4, true), v.getUint32(at + 8, true), compression === 6 || headerSize >= 56 ? v.getUint32(at + 12, true) : 0];
  } else if (bits === 16) masks = [0x7c00, 0x03e0, 0x001f, 0];
  else if (bits === 32) masks = [0xff0000, 0xff00, 0xff, 0];

  let palette: Uint8Array | null = null;
  if (bits <= 8) {
    const entry = headerSize === 12 ? 3 : 4;
    const count = Math.min(1 << bits, colorsUsed || 1 << bits);
    const at = h0 + headerSize + (compression === 3 && headerSize === 40 ? 12 : 0);
    palette = new Uint8Array(count * 3);
    for (let i = 0; i < count; i++) {
      palette[i * 3] = b[at + i * entry + 2]; palette[i * 3 + 1] = b[at + i * entry + 1]; palette[i * 3 + 2] = b[at + i * entry];
    }
  }

  const raster = createRaster(width, height);
  const d = raster.data;
  const put = (x: number, row: number, r: number, g: number, bl: number, a = 255) => {
    const y = topDown ? row : height - 1 - row;
    const o = (y * width + x) * 4;
    d[o] = r; d[o + 1] = g; d[o + 2] = bl; d[o + 3] = a;
  };
  const putIndex = (x: number, row: number, i: number) => {
    const p = palette!;
    if (i * 3 + 2 < p.length) put(x, row, p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    else put(x, row, 0, 0, 0);
  };

  if (compression === 1 || compression === 2) {
    decodeRle(b, pixelOffset, width, height, compression === 2 ? 4 : 8, putIndex);
  } else {
    const stride = Math.ceil((width * bits) / 32) * 4;
    let alphaSeen = false;
    for (let row = 0; row < height; row++) {
      const line = pixelOffset + row * stride;
      if (line + Math.ceil((width * bits) / 8) > b.length) fail("the pixel data is cut short");
      for (let x = 0; x < width; x++) {
        if (bits <= 8) {
          const bit = x * bits;
          putIndex(x, row, (b[line + (bit >> 3)] >> (8 - bits - (bit & 7))) & ((1 << bits) - 1));
        } else if (bits === 24) {
          const p = line + x * 3;
          put(x, row, b[p + 2], b[p + 1], b[p]);
        } else {
          const word = bits === 16 ? v.getUint16(line + x * 2, true) : v.getUint32(line + x * 4, true);
          const [r, g, bl, a] = masks!.map((m) => field(word, m));
          if (masks![3]) alphaSeen ||= a > 0;
          put(x, row, r, g, bl, masks![3] ? a : 255);
        }
      }
    }
    // An alpha mask that is all zero means the writer did not use it: the image is opaque.
    if (masks && masks[3] && !alphaSeen) for (let i = 3; i < d.length; i += 4) d[i] = 255;
  }

  const greyscale = Boolean(palette && palette.length === 768 && palette.every((c, i) => c === palette![i - (i % 3)] && c === Math.floor(i / 3)));
  const depth: ColorDepth = bits <= 8 ? (bits === 1 ? 1 : bits === 4 ? 4 : 8) : bits === 16 ? (masks?.[1] === 0x07e0 ? 16 : 15) : 24;
  return { raster, depth, greyscale, palette, dpi: ppm > 0 ? Math.round(ppm * 0.0254) : 0 };
}

/* A masked field scaled to 0..255. */
function field(word: number, mask: number): number {
  if (!mask) return 0;
  let shift = 0;
  while (!((mask >>> shift) & 1)) shift++;
  const max = mask >>> shift;
  return Math.round((((word & mask) >>> shift) * 255) / max);
}

/* BI_RLE8 and BI_RLE4: runs and escapes (end of line, end of bitmap, delta, absolute runs). */
function decodeRle(b: Uint8Array, at: number, width: number, height: number, bits: 4 | 8, put: (x: number, row: number, i: number) => void): void {
  let x = 0, row = 0;
  while (at + 1 < b.length && row < height) {
    const n = b[at], c = b[at + 1];
    at += 2;
    if (n > 0) {
      for (let k = 0; k < n; k++, x++) if (x < width) put(x, row, bits === 8 ? c : k & 1 ? c & 15 : c >> 4);
    } else if (c === 0) { x = 0; row++; }
    else if (c === 1) return;
    else if (c === 2) { x += b[at]; row += b[at + 1]; at += 2; }
    else {
      for (let k = 0; k < c; k++, x++) {
        const byte = bits === 8 ? b[at + k] : b[at + (k >> 1)];
        if (x < width) put(x, row, bits === 8 ? byte : k & 1 ? byte & 15 : byte >> 4);
      }
      const used = bits === 8 ? c : Math.ceil(c / 2);
      at += used + (used & 1);
    }
  }
}

export interface IndexedPixels { indices: Uint8Array; palette: Uint8Array; bits: 1 | 4 | 8 }

/** A Windows 3 bitmap: 24 bits from `raster`, or paletted from `indexed`. */
export function encodeBmp(raster: Raster, dpi: number, indexed?: IndexedPixels): Uint8Array {
  const { width, height } = raster;
  const bits = indexed?.bits ?? 24;
  const colors = indexed ? 1 << bits : 0;
  const stride = Math.ceil((width * bits) / 32) * 4;
  const offset = 14 + 40 + colors * 4;
  const out = new Uint8Array(offset + stride * height);
  const v = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d;
  v.setUint32(2, out.length, true);
  v.setUint32(10, offset, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, width, true);
  v.setInt32(22, height, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, bits, true);
  v.setUint32(34, stride * height, true);
  const ppm = Math.round(dpi / 0.0254);
  v.setInt32(38, ppm, true);
  v.setInt32(42, ppm, true);
  v.setUint32(46, colors, true);
  if (indexed) {
    const p = indexed.palette;
    for (let i = 0; i < p.length / 3 && i < colors; i++) { out[54 + i * 4] = p[i * 3 + 2]; out[55 + i * 4] = p[i * 3 + 1]; out[56 + i * 4] = p[i * 3]; }
  }
  const d = raster.data;
  for (let y = 0; y < height; y++) {
    const line = offset + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      if (indexed) {
        const i = indexed.indices[y * width + x];
        const bit = x * bits;
        out[line + (bit >> 3)] |= i << (8 - bits - (bit & 7));
      } else {
        const s = (y * width + x) * 4, p = line + x * 3;
        out[p] = d[s + 2]; out[p + 1] = d[s + 1]; out[p + 2] = d[s];
      }
    }
  }
  return out;
}
