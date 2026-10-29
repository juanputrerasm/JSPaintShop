/*
  Macintosh PICT (.pct, .pict), the raster part PSP 6 reads: version 1 and 2 pictures whose
  image is a BitsRect / PackBitsRect (1-8 bit, with a color table) or a DirectBitsRect
  (16 or 32 bit), packed or not. The first bitmap is the picture; drawing operations are
  skipped. QuickTime-compressed pictures are not decoded.
*/
import { createRaster } from "../image/raster.ts";
import type { DecodedImage } from "./bmp.ts";

export class PictError extends Error {}
const fail = (m: string): never => { throw new PictError(`PICT: ${m}`); };

/* Fixed-size opcode data (version 2), for skipping. */
const SIZES: Record<number, number> = {
  0x00: 0, 0x02: 8, 0x03: 2, 0x04: 1, 0x05: 2, 0x06: 4, 0x07: 4, 0x08: 2, 0x09: 8, 0x0a: 8, 0x0b: 4, 0x0c: 4, 0x0d: 2, 0x0e: 4, 0x0f: 4,
  0x10: 8, 0x11: 1, 0x15: 2, 0x16: 2, 0x1a: 6, 0x1b: 6, 0x1c: 0, 0x1d: 6, 0x1e: 0, 0x1f: 6, 0x20: 8, 0x21: 4, 0x22: 6, 0x23: 2,
  0x30: 8, 0x31: 8, 0x32: 8, 0x33: 8, 0x34: 8, 0x38: 0, 0x39: 0, 0x3a: 0, 0x3b: 0, 0x3c: 0,
  0x40: 8, 0x41: 8, 0x42: 8, 0x43: 8, 0x44: 8, 0x48: 0, 0x49: 0, 0x4a: 0, 0x4b: 0, 0x4c: 0,
  0x50: 8, 0x51: 8, 0x52: 8, 0x53: 8, 0x54: 8, 0x58: 0, 0x59: 0, 0x5a: 0, 0x5b: 0, 0x5c: 0,
  0x60: 12, 0x61: 12, 0x62: 12, 0x63: 12, 0x64: 12, 0x68: 4, 0x69: 4, 0x6a: 4, 0x6b: 4, 0x6c: 4,
  0xa0: 2, 0x0c00: 24, 0x02ff: 2,
};

export function isPict(b: Uint8Array): boolean {
  for (const at of [512, 0]) {
    if (b.length < at + 14) continue;
    if ((b[at + 10] === 0x00 && b[at + 11] === 0x11 && b[at + 12] === 0x02 && b[at + 13] === 0xff) || (b[at + 10] === 0x11 && b[at + 11] === 0x01)) return true;
  }
  return false;
}

/*
  A QuickTime-compressed picture (opcode 0x8200) carries an image description and the
  compressed image; for JPEG, PNG and TIFF the image itself is returned, to open as such.
*/
export function pictEmbedded(b: Uint8Array): { type: string; bytes: Uint8Array; width: number; height: number; depth: number } | null {
  const find = (from: number) => { for (let i = from; i + 1 < b.length; i += 2) if (b[i] === 0x82 && b[i + 1] === 0x00) return i; return -1; };
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  for (let at = find(0); at >= 0; at = find(at + 2)) {
    const p = at + 2 + 4;
    // version 2, matrix 36, matte size 4, matte rect 8, mode 2, source rect 8, accuracy 4, mask size 4
    const matte = u32(p + 2 + 36), mask = u32(p + 2 + 36 + 4 + 8 + 2 + 8 + 4);
    const desc = p + 2 + 36 + 4 + 8 + 2 + 8 + 4 + 4 + matte + mask;
    if (desc + 48 > b.length) continue;
    const idSize = u32(desc), type = String.fromCharCode(b[desc + 4], b[desc + 5], b[desc + 6], b[desc + 7]), size = u32(desc + 44);
    if (!["jpeg", "png ", "tiff", "raw "].includes(type)) continue;
    const data = desc + idSize;
    const u16 = (o: number) => (b[o] << 8) | b[o + 1];
    if (data + size <= b.length) return { type: type.trim(), bytes: b.subarray(data, data + size), width: u16(desc + 32), height: u16(desc + 34), depth: u16(desc + 82) };
  }
  return null;
}

/** QuickTime "raw " pixels: 16 (5-5-5), 24 (RGB) or 32 (ARGB) bits, rows of size/height bytes. */
export function decodeQuickTimeRaw(e: { bytes: Uint8Array; width: number; height: number; depth: number }): DecodedImage {
  const { bytes: d, width: w, height: h, depth } = e;
  if (!w || !h || ![16, 24, 32].includes(depth)) fail("unsupported QuickTime raw picture");
  const r = createRaster(w, h), rowBytes = Math.floor(d.length / h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * rowBytes;
    let c: number[];
    if (depth === 32) c = [d[o + x * 4 + 1], d[o + x * 4 + 2], d[o + x * 4 + 3]];
    else if (depth === 24) c = [d[o + x * 3], d[o + x * 3 + 1], d[o + x * 3 + 2]];
    else { const v = (d[o + x * 2] << 8) | d[o + x * 2 + 1], c5 = (s: number) => ((v >> s) & 31) * 255 / 31; c = [c5(10), c5(5), c5(0)]; }
    r.data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
  }
  return { raster: r, depth: 24, greyscale: false, palette: null, dpi: 0 };
}

export function decodePict(b: Uint8Array): DecodedImage {
  let at = b.length > 524 && b[522] === 0x00 && b[523] === 0x11 ? 512 : b.length > 522 && b[522] === 0x11 && b[523] === 0x01 ? 512 : 0;
  const u16 = (o: number) => (b[o] << 8) | b[o + 1];
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  at += 10; // size and frame
  const v2 = b[at] === 0x00 && b[at + 1] === 0x11;
  const op = () => { if (v2) { at = (at + 1) & ~1; const v = u16(at); at += 2; return v; } return b[at++]; };
  for (let guard = 0; guard < 100000 && at < b.length; guard++) {
    const code = op();
    if (code === 0xff || code === 0x00ff) break;
    if (code === 0x90 || code === 0x91 || code === 0x98 || code === 0x99) return bitsRect(code);
    if (code === 0x9a || code === 0x9b) return directBits(code);
    if (code === 0x01) { at += u16(at); continue; }
    if (code === 0xa1) { at += 4 + u16(at + 2); continue; }
    if (code === 0x28) { at += 5 + b[at + 4]; continue; }
    if (code === 0x29 || code === 0x2a) { at += 2 + b[at + 1]; continue; }
    if (code === 0x2b) { at += 3 + b[at + 2]; continue; }
    if (code === 0x2c || code === 0x2e) { at += 2 + u16(at); continue; }
    if (code >= 0x70 && code <= 0x7f && code !== 0x78 && code !== 0x79 && code !== 0x7a && code !== 0x7b && code !== 0x7c) { at += u16(at); continue; }
    if (code >= 0x80 && code <= 0x8f && (code & 7) < 5) { at += u16(at); continue; }
    if (code === 0x8200 || code === 0x8201) fail("QuickTime-compressed pictures are opened through pictEmbedded");
    if (code in SIZES) { at += SIZES[code]; continue; }
    if (code >= 0x100 && code <= 0x7fff) { at += (code >> 8) * 2; continue; }
    if (code >= 0x8000 && code <= 0x80ff) continue;
    if (code >= 0x8100) { at += 4 + u32(at); continue; }
    fail(`opcode 0x${code.toString(16)} cannot be read`);
  }
  return fail("no bitmap in the picture");

  function rows(rowBytes: number, h: number, packed: boolean, unit = 1): Uint8Array {
    const out = new Uint8Array(rowBytes * h);
    for (let y = 0; y < h; y++) {
      if (!packed || rowBytes < 8) { out.set(b.subarray(at, at + rowBytes), y * rowBytes); at += rowBytes; continue; }
      const len = rowBytes > 250 ? u16(at) : b[at];
      at += rowBytes > 250 ? 2 : 1;
      const end = at + len;
      let o = y * rowBytes;
      const rowEnd = o + rowBytes;
      while (at < end && o < rowEnd) {
        const n = (b[at++] << 24) >> 24;
        if (n >= 0) { const c = (n + 1) * unit; for (let k = 0; k < c && o < rowEnd; k++) out[o++] = b[at++]; }
        else if (n !== -128) { const v = b.subarray(at, at + unit); at += unit; for (let k = 0; k < 1 - n; k++) for (let u = 0; u < unit && o < rowEnd; u++) out[o++] = v[u]; }
      }
      at = end;
    }
    return out;
  }

  function bitsRect(code: number): DecodedImage {
    let rowBytes = u16(at); at += 2;
    const pixmap = (rowBytes & 0x8000) !== 0;
    rowBytes &= 0x3fff;
    const top = u16(at), left = u16(at + 2), bottom = u16(at + 4), right = u16(at + 6);
    at += 8;
    const w = right - left, h = bottom - top;
    let bits = 1;
    let pal: number[][] = [[255, 255, 255], [0, 0, 0]];
    if (pixmap) {
      at += 2 + 2 + 4 + 4 + 4 + 2; // version, packType, packSize, hRes, vRes, pixelType
      bits = u16(at); at += 2;
      at += 2 + 2 + 4 + 4 + 4; // cmpCount, cmpSize, planeBytes, pmTable, reserved
      at += 4 + 2;
      const n = u16(at) + 1; at += 2;
      pal = Array.from({ length: 256 }, () => [0, 0, 0]);
      for (let k = 0; k < n; k++) { const idx = u16(at) & 255; pal[idx] = [b[at + 2], b[at + 4], b[at + 6]]; at += 8; }
    }
    at += 8 + 8 + 2; // src, dst, mode
    if (code === 0x91 || code === 0x99) at += u16(at);
    const data = rows(rowBytes, h, code === 0x98 || code === 0x99);
    const r = createRaster(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const bit = x * bits, byte = data[y * rowBytes + (bit >> 3)];
      const i = bits === 8 ? byte : (byte >> (8 - bits - (bit & 7))) & ((1 << bits) - 1);
      const c = pal[i] ?? [0, 0, 0];
      r.data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
    }
    const palette = Uint8Array.from(pal.slice(0, 1 << bits).flat());
    return { raster: r, depth: bits === 1 ? 1 : bits <= 4 ? 4 : 8, greyscale: false, palette, dpi: 0 };
  }

  function directBits(code: number): DecodedImage {
    // pixelSize sits 26 bytes past the packing type; read it early to choose the default packing.
    const pixelSize32 = () => u16(at + 4 + 4 + 4 + 2) === 32;
    at += 4; // baseAddr
    const rowBytes = u16(at) & 0x3fff; at += 2;
    const top = u16(at), left = u16(at + 2), bottom = u16(at + 4), right = u16(at + 6);
    at += 8;
    at += 2;
    const declared = u16(at); at += 2;
    // 0 is the default packing: 4 (planes) for 32 bits, 3 (words) for 16; rows under 8 bytes are never packed.
    const packType = rowBytes < 8 ? 1 : declared === 0 ? (pixelSize32() ? 4 : 3) : declared;
    at += 4;
    const hRes = u32(at) / 65536; at += 4 + 4 + 2;
    const pixelSize = u16(at), cmpCount = u16(at + 2); at += 4;
    at += 2 + 4 + 4 + 4; // cmpSize, planeBytes, pmTable, reserved
    at += 8 + 8 + 2;
    if (code === 0x9b) at += u16(at);
    const w = right - left, h = bottom - top;
    const r = createRaster(w, h);
    if (pixelSize === 16) {
      const data = rows(rowBytes, h, packType !== 1, 2);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = (data[y * rowBytes + x * 2] << 8) | data[y * rowBytes + x * 2 + 1];
        const c5 = (s: number) => ((v >> s) & 31) * 255 / 31;
        r.data.set([c5(10), c5(5), c5(0), 255], (y * w + x) * 4);
      }
    } else {
      // 32 bits: packType 4 packs each row as planes (alpha?, red, green, blue).
      const planar = packType === 4, rb = planar ? w * cmpCount : rowBytes;
      const data = rows(rb, h, packType !== 1 && packType !== 2);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let c: number[];
        if (planar) { const o = y * rb, s = cmpCount === 4 ? 1 : 0; c = [data[o + (s) * w + x], data[o + (s + 1) * w + x], data[o + (s + 2) * w + x]]; }
        else { const o = y * rb + x * 4; c = [data[o + 1], data[o + 2], data[o + 3]]; }
        r.data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
      }
    }
    return { raster: r, depth: 24, greyscale: false, palette: null, dpi: Math.round(hRes) || 0 };
  }
}
