/*
  GIF (87a and 89a), read and written.

  Reading takes the first image of the file onto the logical screen, with its local or global
  color table, interlacing and the transparent color of its Graphic Control Extension; what
  the image does not cover is transparent. Writing makes one image with a global color
  table, GIF89a when a color is transparent and GIF87a otherwise.
*/
import { createRaster } from "../image/raster.ts";
import type { DecodedImage, IndexedPixels } from "./bmp.ts";
import type { Raster } from "../image/raster.ts";
import type { ColorDepth } from "../doc/image-doc.ts";

export function isGif(b: Uint8Array): boolean {
  return b.length > 13 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38;
}

const fail = (why: string): never => { throw new Error(`Not a readable GIF: ${why}.`); };

export function decodeGif(b: Uint8Array): DecodedImage {
  if (!isGif(b)) fail("no GIF8 signature");
  const u16 = (at: number) => b[at] | (b[at + 1] << 8);
  const width = u16(6), height = u16(8), flags = b[10];
  let at = 13;
  let globalTable: Uint8Array | null = null;
  if (flags & 0x80) {
    const n = 3 << ((flags & 7) + 1);
    globalTable = b.slice(at, at + n);
    at += n;
  }
  let transparent = -1;
  while (at < b.length) {
    const kind = b[at++];
    if (kind === 0x3b) break;
    if (kind === 0x21) {
      const label = b[at++];
      if (label === 0xf9 && b[at] >= 4 && b[at + 1] & 1) transparent = b[at + 4];
      while (at < b.length && b[at]) at += b[at] + 1;
      at++;
      continue;
    }
    if (kind !== 0x2c) fail(`unknown block 0x${kind.toString(16)}`);
    const left = u16(at), top = u16(at + 2), w = u16(at + 4), h = u16(at + 6), f = b[at + 8];
    at += 9;
    let table = globalTable;
    if (f & 0x80) {
      const n = 3 << ((f & 7) + 1);
      table = b.slice(at, at + n);
      at += n;
    }
    if (!table) fail("no color table");
    const minCode = b[at++];
    const chunks: Uint8Array[] = [];
    while (at < b.length && b[at]) { chunks.push(b.subarray(at + 1, at + 1 + b[at])); at += b[at] + 1; }
    const indices = lzwDecode(concat(chunks), minCode, w * h);
    const raster = createRaster(width, height);
    const d = raster.data;
    const rows = f & 0x40 ? interlacedRows(h) : Array.from({ length: h }, (_, i) => i);
    for (let i = 0; i < h; i++) {
      const y = top + rows[i];
      if (y >= height) continue;
      for (let x = 0; x < w; x++) {
        if (left + x >= width) continue;
        const c = indices[i * w + x];
        if (c === transparent) continue;
        const o = (y * width + left + x) * 4;
        d[o] = table![c * 3]; d[o + 1] = table![c * 3 + 1]; d[o + 2] = table![c * 3 + 2]; d[o + 3] = 255;
      }
    }
    const colors = table!.length / 3;
    const depth: ColorDepth = colors <= 2 ? 1 : colors <= 16 ? 4 : 8;
    return { raster, depth, greyscale: false, palette: table!, dpi: 0, transparent: transparent >= 0 ? transparent : undefined };
  }
  return fail("no image in the file");
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/* Interlaced GIFs store rows in four passes: every 8th from 0, every 8th from 4, every 4th from 2, every 2nd from 1. */
function interlacedRows(h: number): number[] {
  const rows: number[] = [];
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < h; y += step) rows.push(y);
  return rows;
}

function lzwDecode(data: Uint8Array, minCode: number, count: number): Uint8Array {
  const out = new Uint8Array(count);
  const clear = 1 << minCode, end = clear + 1;
  const prefix = new Int16Array(4096), suffix = new Uint8Array(4096), lengths = new Uint16Array(4096);
  for (let i = 0; i < clear; i++) { prefix[i] = -1; suffix[i] = i; lengths[i] = 1; }
  let size = minCode + 1, next = end + 1, prev = -1, o = 0, bitPos = 0;
  const stack = new Uint8Array(4097);
  while (o < count) {
    if ((bitPos + size) > data.length * 8) break;
    let code = 0;
    for (let k = 0; k < size; k++, bitPos++) code |= ((data[bitPos >> 3] >> (bitPos & 7)) & 1) << k;
    if (code === clear) { size = minCode + 1; next = end + 1; prev = -1; continue; }
    if (code === end) break;
    let c = code, sp = 0;
    if (code >= next) {
      // The code being defined right now: the previous string plus its own first byte.
      if (prev < 0) break;
      c = prev;
    }
    while (c >= 0 && sp < 4097) { stack[sp++] = suffix[c]; c = prefix[c]; }
    const first = stack[sp - 1];
    if (code >= next) { stack.copyWithin(1, 0, sp); stack[0] = first; sp++; }
    for (let k = sp - 1; k >= 0 && o < count; k--) out[o++] = stack[k];
    if (prev >= 0 && next < 4096) {
      prefix[next] = prev; suffix[next] = first; lengths[next] = lengths[prev] + 1;
      next++;
      if (next === 1 << size && size < 12) size++;
    }
    prev = code;
  }
  return out;
}

/** One image, its palette padded to a power of two, `transparent` the index to leave clear (or -1). */
export function encodeGif(raster: Raster, indexed: IndexedPixels, transparent = -1): Uint8Array {
  const { width, height } = raster;
  const bits = Math.max(1, Math.ceil(Math.log2(Math.max(2, indexed.palette.length / 3))));
  const out: number[] = [];
  const u16 = (n: number) => out.push(n & 255, n >> 8);
  out.push(...[...(transparent >= 0 ? "GIF89a" : "GIF87a")].map((c) => c.charCodeAt(0)));
  u16(width); u16(height);
  out.push(0x80 | ((bits - 1) << 4) | (bits - 1), 0, 0);
  for (let i = 0; i < 1 << bits; i++) out.push(indexed.palette[i * 3] ?? 0, indexed.palette[i * 3 + 1] ?? 0, indexed.palette[i * 3 + 2] ?? 0);
  if (transparent >= 0) out.push(0x21, 0xf9, 4, 1, 0, 0, transparent, 0);
  out.push(0x2c);
  u16(0); u16(0); u16(width); u16(height);
  out.push(0);
  const minCode = Math.max(2, bits);
  out.push(minCode);
  const data = lzwEncode(indexed.indices, minCode);
  for (let i = 0; i < data.length; i += 255) {
    const n = Math.min(255, data.length - i);
    out.push(n);
    for (let k = 0; k < n; k++) out.push(data[i + k]);
  }
  out.push(0, 0x3b);
  return Uint8Array.from(out);
}

function lzwEncode(pixels: Uint8Array, minCode: number): Uint8Array {
  const clear = 1 << minCode, end = clear + 1;
  const out: number[] = [];
  let acc = 0, accBits = 0;
  let size = minCode + 1;
  const emit = (code: number) => {
    acc |= code << accBits;
    accBits += size;
    while (accBits >= 8) { out.push(acc & 255); acc >>>= 8; accBits -= 8; }
  };
  let dict = new Map<number, number>();
  let next = end + 1;
  emit(clear);
  let prefix = pixels.length ? pixels[0] : 0;
  for (let i = 1; i < pixels.length; i++) {
    const c = pixels[i];
    const key = (prefix << 8) | c;
    const found = dict.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << size && size < 12) size++;
    } else {
      emit(clear);
      dict = new Map();
      next = end + 1;
      size = minCode + 1;
    }
    prefix = c;
  }
  if (pixels.length) emit(prefix);
  emit(end);
  if (accBits > 0) out.push(acc & 255);
  return Uint8Array.from(out);
}
