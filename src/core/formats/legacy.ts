/*
  The older raster formats PSP 6 opens (read only):
    IFF / LBM   Amiga Interleaved Bitmap (ILBM) and Deluxe Paint's chunky PBM: 1-8 planes with
                a palette, 24-bit ILBM, ByteRun1; HAM6 and Extra Half-Brite as PSP reads them
    MAC         MacPaint: 576 x 720, 1 bit, PackBits (with or without a MacBinary header)
    MSP         Microsoft Paint 1 ("DanM") and 2 ("LinS")
    IMG         GEM Paint, 1 to 8 planes
    CUT         Dr. Halo, 8 bits (the palette lives in a separate .PAL file; read as greys)
    CLP         Windows Clipboard file: its device-independent bitmap
    ICO / CUR   Windows icons and cursors: the largest image (DIB icons; PNG icons are not read)
    WPG         WordPerfect Graphics 1 and 2: the first bitmap, with its color map
*/
import type { Raster } from "../image/raster.ts";
import { createRaster } from "../image/raster.ts";
import { decodeBmp, type DecodedImage } from "./bmp.ts";

export class LegacyError extends Error {}
const fail = (m: string): never => { throw new LegacyError(m); };
const be16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const be32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const le16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const le32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const tag = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const greys = () => Uint8Array.from({ length: 768 }, (_, i) => Math.floor(i / 3));
const mono = () => Uint8Array.from([0, 0, 0, 255, 255, 255]);

/* 1-bit rows (1 = black, as MacPaint, MSP and GEM draw) into a raster. */
function bilevel(width: number, height: number, bit: (x: number, y: number) => number): DecodedImage {
  const r = createRaster(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const v = bit(x, y) ? 0 : 255; r.data.set([v, v, v, 255], (y * width + x) * 4); }
  return { raster: r, depth: 1, greyscale: false, palette: mono(), dpi: 0 };
}

/* PackBits / ByteRun1 into exactly `n` bytes from `at`; returns the bytes and where it stopped. */
function unpack(b: Uint8Array, at: number, n: number): [Uint8Array, number] {
  const out = new Uint8Array(n);
  let o = 0;
  while (o < n && at < b.length) {
    const c = (b[at++] << 24) >> 24;
    if (c >= 0) { for (let k = 0; k <= c && o < n; k++) out[o++] = b[at++]; }
    else if (c !== -128) { const v = b[at++]; for (let k = 0; k < 1 - c && o < n; k++) out[o++] = v; }
  }
  return [out, at];
}

// ---- IFF ----
export const isIff = (b: Uint8Array) => b.length > 12 && tag(b, 0) === "FORM" && (tag(b, 8) === "ILBM" || tag(b, 8) === "PBM ");

export function decodeIff(b: Uint8Array): DecodedImage {
  if (!isIff(b)) fail("IFF: not an ILBM or PBM picture");
  const chunky = tag(b, 8) === "PBM ";
  let at = 12, w = 0, h = 0, planes = 0, masking = 0, comp = 0, transparent = -1;
  let cmap: Uint8Array | null = null, body: [number, number] | null = null, camg = 0;
  while (at + 8 <= b.length) {
    const id = tag(b, at), len = be32(b, at + 4), d = at + 8;
    if (id === "BMHD") { w = be16(b, d); h = be16(b, d + 2); planes = b[d + 8]; masking = b[d + 9]; comp = b[d + 10]; transparent = masking === 2 ? be16(b, d + 12) : -1; }
    else if (id === "CMAP") cmap = b.slice(d, d + len);
    else if (id === "CAMG") camg = be32(b, d);
    else if (id === "BODY") body = [d, len];
    at = d + len + (len & 1);
  }
  if (!w || !h || !body) fail("IFF: no picture");
  // HAM (CAMG 0x800): PSP 6 reads 6-plane pictures only (jff.dll DecodeIFF).
  const ham = (camg & 0x800) !== 0 && !chunky;
  if (ham && planes !== 6) fail("IFF: only 6-plane HAM pictures can be read");
  const r = createRaster(w, h), rowBytes = ((w + 15) >> 4) << 1;
  const planesInFile = planes + (masking === 1 ? 1 : 0);
  let p = body![0];
  const rowLen = chunky ? w + (w & 1) : rowBytes * planesInFile;
  let palette = cmap ?? greys();
  // Extra Half-Brite (CAMG 0x80): the second half of the palette is the first half at half brightness.
  if (camg & 0x80 && !ham) {
    const n = palette.length / 3, full = 1 << Math.min(8, planes), ext = new Uint8Array(full * 3);
    ext.set(palette.subarray(0, Math.min(palette.length, full * 3)));
    for (let i = n; i < full && i - n < n; i++) for (let c = 0; c < 3; c++) ext[i * 3 + c] = palette[(i - n) * 3 + c] >> 1;
    palette = ext;
  }
  if (ham) {
    // Each row starts from entry 0; a pixel is a palette entry (00), or the last color with its
    // blue (01), red (10) or green (11) set to the low 4 bits. Components keep 4 bits (v << 4).
    const pal = (i: number, c: number) => (palette[i * 3 + c] ?? 0) & 0xf0;
    for (let y = 0; y < h; y++) {
      let row: Uint8Array;
      if (comp === 1) [row, p] = unpack(b, p, rowLen);
      else { row = b.subarray(p, p + rowLen); p += rowLen; }
      let R = pal(0, 0), G = pal(0, 1), B = pal(0, 2);
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let k = 0; k < 6; k++) v |= ((row[k * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1) << k;
        const low = v & 15;
        switch (v >> 4) {
          case 0: R = pal(low, 0); G = pal(low, 1); B = pal(low, 2); break;
          case 1: B = low << 4; break;
          case 2: R = low << 4; break;
          default: G = low << 4;
        }
        r.data.set([R, G, B, 255], (y * w + x) * 4);
      }
    }
    return { raster: r, depth: 24, greyscale: false, palette: null, dpi: 0 };
  }
  for (let y = 0; y < h; y++) {
    let row: Uint8Array;
    if (comp === 1) [row, p] = unpack(b, p, rowLen);
    else { row = b.subarray(p, p + rowLen); p += rowLen; }
    for (let x = 0; x < w; x++) {
      let v = 0;
      if (chunky) v = row[x];
      else for (let k = 0; k < planes; k++) v |= ((row[k * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1) << k;
      const o = (y * w + x) * 4;
      if (planes === 24) r.data.set([v & 255, (v >> 8) & 255, (v >> 16) & 255, 255], o);
      else {
        const i = Math.min(v, palette.length / 3 - 1);
        r.data.set([palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2], v === transparent ? 0 : 255], o);
      }
    }
  }
  const depth = planes === 24 ? 24 : planes <= 1 ? 1 : planes <= 4 ? 4 : 8;
  return { raster: r, depth, greyscale: false, palette: planes === 24 ? null : palette.slice(0, (1 << Math.min(8, planes)) * 3), dpi: 0, transparent: transparent >= 0 ? transparent : undefined };
}

// ---- MacPaint ----
export function decodeMacPaint(b: Uint8Array): DecodedImage {
  // A MacBinary header (128 bytes) puts the file type "PNTG" at 65.
  const start = b.length > 128 && tag(b, 65) === "PNTG" ? 128 + 512 : 512;
  if (b.length < start) fail("MacPaint: file too short");
  const [bits] = unpack(b, start, 72 * 720);
  return bilevel(576, 720, (x, y) => (bits[y * 72 + (x >> 3)] >> (7 - (x & 7))) & 1);
}

// ---- Microsoft Paint ----
export const isMsp = (b: Uint8Array) => b.length > 32 && (tag(b, 0) === "DanM" || tag(b, 0) === "LinS");

export function decodeMsp(b: Uint8Array): DecodedImage {
  if (!isMsp(b)) fail("MSP: not a Microsoft Paint file");
  const w = le16(b, 4), h = le16(b, 6), bpr = (w + 7) >> 3;
  const bits = new Uint8Array(bpr * h);
  if (tag(b, 0) === "DanM") bits.set(b.subarray(32, 32 + bits.length));
  else {
    // Version 2: a table of row lengths, then each row run-length coded.
    let at = 32 + h * 2;
    for (let y = 0; y < h; y++) {
      const len = le16(b, 32 + y * 2), end = at + len;
      let o = y * bpr;
      if (!len) { bits.fill(0xff, o, o + bpr); continue; }
      while (at < end && o < (y + 1) * bpr) {
        const n = b[at++];
        if (n === 0) { const c = b[at++], v = b[at++]; for (let k = 0; k < c; k++) bits[o++] = v; }
        else for (let k = 0; k < n; k++) bits[o++] = b[at++];
      }
      at = end;
    }
  }
  // MSP: 1 is white.
  return bilevel(w, h, (x, y) => ((bits[y * bpr + (x >> 3)] >> (7 - (x & 7))) & 1) ^ 1);
}

// ---- GEM IMG ----
/*
  1 to 8 planes, each scanline's planes in turn, the first plane the lowest bit (jff.dll's
  DecodeIMG); several planes open in greys, entry i of n being i * 256 / n (black and white at
  the ends), as PSP does: the format carries no palette.
*/
export function decodeGemImg(b: Uint8Array): DecodedImage {
  const hlen = be16(b, 2) * 2, planes = be16(b, 4), patLen = be16(b, 6), w = be16(b, 12), h = be16(b, 14);
  if (!w || !h || planes < 1 || hlen < 16) fail("IMG: not a GEM image");
  if (planes > 8) fail("IMG: GEM images of more than 8 planes are not supported");
  const bpr = (w + 7) >> 3, idx = new Uint8Array(w * h);
  let at = hlen, y = 0;
  const readLine = (line: Uint8Array) => {
    let o = 0;
    while (o < bpr && at < b.length) {
      const c = b[at++];
      if (c === 0) { const n = b[at++]; for (let k = 0; k < n; k++) for (let p = 0; p < patLen; p++) line[o++] = b[at + p]; at += patLen; }
      else if (c === 0x80) { const n = b[at++]; for (let k = 0; k < n; k++) line[o++] = b[at++]; }
      else { const v = c & 0x80 ? 0xff : 0, n = c & 0x7f; for (let k = 0; k < n; k++) line[o++] = v; }
    }
  };
  while (y < h && at < b.length) {
    let repeat = 1;
    if (b[at] === 0 && b[at + 1] === 0 && b[at + 2] === 0xff) { repeat = b[at + 3]; at += 4; }
    const row = new Uint8Array(w);
    for (let plane = 0; plane < planes; plane++) {
      const line = new Uint8Array(bpr + patLen);
      readLine(line);
      for (let x = 0; x < w; x++) if ((line[x >> 3] >> (7 - (x & 7))) & 1) row[x] |= 1 << plane;
    }
    for (let k = 0; k < repeat && y < h; k++, y++) idx.set(row, y * w);
  }
  if (planes === 1) return bilevel(w, h, (x, yy) => idx[yy * w + x]);
  const n = 1 << planes, palette = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) palette.fill(i === 0 ? 0 : i === n - 1 ? 255 : Math.trunc(256 / n) * i, i * 3, i * 3 + 3);
  const r = createRaster(w, h);
  // A set bit is ink (black), so the index counts down from white.
  for (let i = 0; i < w * h; i++) { const k = (n - 1 - idx[i]) * 3; r.data.set([palette[k], palette[k + 1], palette[k + 2], 255], i * 4); }
  return { raster: r, depth: planes <= 4 ? 4 : 8, greyscale: true, palette, dpi: 0, indices: idx.map((v) => n - 1 - v) };
}

// ---- Dr. Halo CUT ----
/** A Dr. Halo .PAL ("AH"), laid out as PSP writes it (legacy-write.ts encodeHaloPalette); null otherwise. */
export function decodeHaloPalette(b: Uint8Array): Uint8Array | null {
  if (b.length < 2048 || b[0] !== 0x41 || b[1] !== 0x48) return null;
  const pal = new Uint8Array(768);
  let entry = 0;
  [[40, 78], [0, 85], [0, 85], [0, 8]].forEach(([at, count], block) => {
    for (let k = 0; k < count; k++, entry++, at += 6) pal.set([b[block * 512 + at], b[block * 512 + at + 2], b[block * 512 + at + 4]], entry * 3);
  });
  return pal;
}

/** A Dr. Halo image; with its .PAL's colors when given, else in greys. */
export function decodeCut(b: Uint8Array, palette?: Uint8Array | null): DecodedImage {
  const w = le16(b, 0), h = le16(b, 2);
  if (!w || !h) fail("CUT: not a Dr. Halo image");
  const r = createRaster(w, h);
  let at = 6;
  for (let y = 0; y < h && at < b.length; y++) {
    const len = le16(b, at), end = at + 2 + len;
    at += 2;
    let x = 0;
    while (at < end) {
      const c = b[at++];
      if (c === 0) break;
      if (c & 0x80) { const v = b[at++]; for (let k = 0; k < (c & 0x7f); k++, x++) if (x < w) r.data.set([v, v, v, 255], (y * w + x) * 4); }
      else for (let k = 0; k < c; k++, x++) { const v = b[at++]; if (x < w) r.data.set([v, v, v, 255], (y * w + x) * 4); }
    }
    at = end;
  }
  if (!palette) return { raster: r, depth: 8, greyscale: true, palette: greys(), dpi: 0 };
  const d = r.data;
  for (let i = 0; i < d.length; i += 4) { const k = d[i] * 3; d[i] = palette[k] ?? 0; d[i + 1] = palette[k + 1] ?? 0; d[i + 2] = palette[k + 2] ?? 0; }
  return { raster: r, depth: 8, greyscale: false, palette: palette.slice(0, 768), dpi: 0 };
}

// ---- Windows Clipboard ----
export const isClp = (b: Uint8Array) => b.length > 4 && (le16(b, 0) === 0xc350 || le16(b, 0) === 0xc351);

export function decodeClp(b: Uint8Array): DecodedImage {
  if (!isClp(b)) fail("CLP: not a clipboard file");
  // Windows 3.1 entries are 89 bytes (16-bit format id, ANSI name); NT's are 170 (32-bit id, wide name).
  const nt = le16(b, 0) === 0xc351, count = le16(b, 2), size = nt ? 170 : 89, idSize = nt ? 4 : 2;
  for (let k = 0; k < count; k++) {
    const e = 4 + k * size, fmt = nt ? le32(b, e) : le16(b, e), len = le32(b, e + idSize), off = le32(b, e + idSize + 4);
    if (fmt !== 8 && fmt !== 2) continue;
    if (fmt === 8) {
      // CF_DIB: a BITMAPINFO and its bits; give it a BMP file header.
      const dib = b.subarray(off, off + len), hdr = le32(dib, 0), bits = le16(dib, 14), used = le32(dib, 32);
      const colors = bits <= 8 ? (used || 1 << bits) : 0, pixels = 14 + hdr + colors * 4;
      const file = new Uint8Array(14 + len);
      file.set([0x42, 0x4d]);
      new DataView(file.buffer).setUint32(2, file.length, true);
      new DataView(file.buffer).setUint32(10, pixels, true);
      file.set(dib, 14);
      return decodeBmp(file);
    }
  }
  return fail("CLP: the clipboard file holds no bitmap");
}

// ---- Icons and cursors ----
export const isIco = (b: Uint8Array) => b.length > 22 && le16(b, 0) === 0 && (le16(b, 2) === 1 || le16(b, 2) === 2) && le16(b, 4) > 0;

export function decodeIco(b: Uint8Array): DecodedImage {
  if (!isIco(b)) fail("ICO: not an icon or cursor");
  const n = le16(b, 4);
  let best = -1, bestArea = -1, bestBits = -1;
  for (let k = 0; k < n; k++) {
    const e = 6 + k * 16, w = b[e] || 256, h = b[e + 1] || 256, off = le32(b, e + 12);
    const bits = le16(b, off + 14);
    if (w * h > bestArea || (w * h === bestArea && bits > bestBits)) { best = k; bestArea = w * h; bestBits = bits; }
  }
  const e = 6 + best * 16, len = le32(b, e + 8), off = le32(b, e + 12);
  const dib = b.subarray(off, off + len);
  if (dib[0] === 0x89 && dib[1] === 0x50) fail("ICO: PNG icons are opened through the PNG reader");
  const hdr = le32(dib, 0), w = le32(dib, 4), h = (le32(dib, 8) | 0) / 2, bits = le16(dib, 14), used = le32(dib, 32);
  const colors = bits <= 8 ? (used || 1 << bits) : 0;
  const pal = hdr, px = hdr + colors * 4, stride = ((w * bits + 31) >> 5) << 2, maskAt = px + stride * h, mstride = ((w + 31) >> 5) << 2;
  const r: Raster = createRaster(w, h);
  for (let y = 0; y < h; y++) {
    const row = px + (h - 1 - y) * stride, mrow = maskAt + (h - 1 - y) * mstride;
    for (let x = 0; x < w; x++) {
      let c: number[];
      if (bits === 32) c = [dib[row + x * 4 + 2], dib[row + x * 4 + 1], dib[row + x * 4], dib[row + x * 4 + 3]];
      else if (bits === 24) c = [dib[row + x * 3 + 2], dib[row + x * 3 + 1], dib[row + x * 3], 255];
      else {
        const i = bits === 8 ? dib[row + x] : bits === 4 ? (dib[row + (x >> 1)] >> (x & 1 ? 0 : 4)) & 15 : (dib[row + (x >> 3)] >> (7 - (x & 7))) & 1;
        c = [dib[pal + i * 4 + 2], dib[pal + i * 4 + 1], dib[pal + i * 4], 255];
      }
      if (bits !== 32 && (dib[mrow + (x >> 3)] >> (7 - (x & 7))) & 1) c[3] = 0;
      r.data.set(c, (y * w + x) * 4);
    }
  }
  // Icons keep their transparency, so they open as 16 million colors.
  return { raster: r, depth: 24, greyscale: false, palette: null, dpi: 0 };
}

// ---- WordPerfect Graphics ----
export const isWpg = (b: Uint8Array) => b.length > 16 && b[0] === 0xff && b[1] === 0x57 && b[2] === 0x50 && b[3] === 0x43 && b[9] === 0x16;

/* WPG 1: the first bitmap record (type 0x0B, or 0x14 with its placement fields), with the color map. */
export function decodeWpg(b: Uint8Array): DecodedImage {
  if (!isWpg(b)) fail("WPG: not a WordPerfect graphic");
  if (b[10] === 2) return decodeWpg2(b);
  if (b[10] !== 1) fail(`WPG: version ${b[10]} files are not supported`);
  let at = le32(b, 4);
  let palette = Uint8Array.from({ length: 768 }, (_, i) => (i < 6 ? [0, 0, 0, 255, 255, 255][i] : 0));
  while (at < b.length) {
    const type = b[at++];
    let len = b[at++];
    if (len === 0xff) {
      len = le16(b, at); at += 2;
      if (len & 0x8000) { len = ((len & 0x7fff) << 16) | le16(b, at); at += 2; }
    }
    const d = at;
    at += len;
    if (type === 0x10 && len === 0) break;
    if (type === 0x0e) {
      const start = le16(b, d), count = le16(b, d + 2);
      for (let k = 0; k < count && start + k < 256; k++) palette.set(b.subarray(d + 4 + k * 3, d + 7 + k * 3), (start + k) * 3);
      continue;
    }
    if (type !== 0x0b && type !== 0x14) continue;
    const h0 = type === 0x14 ? d + 10 : d;
    const w = le16(b, h0), h = le16(b, h0 + 2), depth = le16(b, h0 + 4);
    if (![1, 2, 4, 8].includes(depth)) fail(`WPG: ${depth}-bit bitmaps are not supported`);
    const bpr = Math.ceil((w * depth) / 8), out = new Uint8Array(bpr * h);
    let p = h0 + 10, o = 0;
    while (o < out.length && p < at) {
      const c = b[p++];
      if (c & 0x80) {
        const n = c & 0x7f;
        if (n === 0) { const cnt = b[p++]; for (let k = 0; k < cnt && o < out.length; k++) out[o++] = 0xff; }
        else { const v = b[p++]; for (let k = 0; k < n && o < out.length; k++) out[o++] = v; }
      } else if (c === 0) {
        // Repeat the previous row.
        const cnt = b[p++], row = Math.floor(o / bpr) - 1;
        for (let k = 0; k < cnt && o < out.length && row >= 0; k++) { out.copyWithin(o, row * bpr, row * bpr + bpr); o += bpr; }
      } else for (let k = 0; k < c && o < out.length; k++) out[o++] = b[p++];
    }
    const r = createRaster(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const bit = x * depth, i = (out[y * bpr + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
      r.data.set([palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2], 255], (y * w + x) * 4);
    }
    const dd = depth === 1 ? 1 : depth <= 4 ? 4 : 8;
    return { raster: r, depth: dd, greyscale: false, palette: palette.slice(0, (1 << dd) * 3), dpi: le16(b, h0 + 6) || 0 };
  }
  return fail("WPG: the file holds no bitmap (vector WordPerfect graphics are not supported)");
}

/*
  WPG 2 (jff.dll 0x1009a110): records of a class byte, a type byte, an extension and a length
  (each a byte, or 0xFF and a word, a long when the word's top bit is set). Type 0x0C is a
  palette (first entry, count, then RGBA), 0x0E a bitmap (width, height, depth code 1, 3, 4 or
  12 for 1, 4 or 8 bits, 8 for 24 bits; compression 1), 2 the end. The bitmap's rows are coded
  in samples (1 byte unless 0x7D sets the size):
    0x7D n   sample size n           0x7E     (nothing)
    0x7F n   n + 1 samples of 0       0xFF n   n + 1 samples of 0xFF
    0xFD n   the last sample n + 1 more times
    0xFE n   the previous row n + 1 times
    0x80+n   one sample, n + 1 times  0..0x7C  n + 1 samples as they are
  A run stops at the end of its row. Two-color bitmaps are always black and white.
*/
function decodeWpg2(b: Uint8Array): DecodedImage {
  let at = le32(b, 4);
  const varLen = () => {
    let v = b[at++];
    if (v === 0xff) {
      v = le16(b, at); at += 2;
      if (v & 0x8000) { v = ((v & 0x7fff) << 16) | le16(b, at); at += 2; }
    }
    return v;
  };
  let palette: Uint8Array = greys();
  while (at + 2 < b.length) {
    at++;
    const type = b[at++];
    varLen();
    const len = varLen(), d = at;
    at += len;
    if (type === 2) break;
    if (type === 0x0c) {
      const start = le16(b, d), count = le16(b, d + 2);
      for (let k = 0; k < count && start + k < 256; k++) palette.set(b.subarray(d + 4 + k * 4, d + 7 + k * 4), (start + k) * 3);
      continue;
    }
    if (type !== 0x0e) continue;
    const w = le16(b, d), h = le16(b, d + 2), code = b[d + 4], comp = b[d + 5];
    const depth = code === 1 ? 1 : code === 3 ? 4 : code === 4 || code === 12 ? 8 : code === 8 ? 24 : 0;
    if (!depth) fail(`WPG: bitmap depth code ${code} is not supported`);
    if (comp !== 1) fail("WPG: only run-length coded WPG 2 bitmaps are supported");
    const bpr = depth === 24 ? w * 3 : Math.ceil((w * depth) / 8), out = new Uint8Array(bpr * h);
    let p = d + 6, size = 1, y = 0, x = 0;
    const sample = new Uint8Array(8);
    const put = (v: number) => { if (x < bpr) out[y * bpr + x++] = v; };
    while (y < h && p < at) {
      const c = b[p++];
      if (c === 0x7d) { size = Math.max(1, Math.min(8, b[p++])); }
      else if (c === 0x7e) { /* nothing */ }
      else if (c === 0x7f || c === 0xff) { const n = (b[p++] + 1) * size; for (let k = 0; k < n; k++) put(c === 0x7f ? 0 : 0xff); }
      else if (c === 0xfd) { const n = b[p++] + 1; for (let k = 0; k < n; k++) for (let s = 0; s < size; s++) put(sample[s]); }
      else if (c === 0xfe) {
        const n = b[p++] + 1;
        for (let k = 0; k < n && y < h; k++) { if (y > 0) out.copyWithin(y * bpr, (y - 1) * bpr, y * bpr); y++; }
        x = 0;
        continue;
      } else if (c & 0x80) {
        for (let s = 0; s < size; s++) sample[s] = b[p++];
        for (let k = 0; k <= (c & 0x7f); k++) for (let s = 0; s < size; s++) put(sample[s]);
      } else {
        for (let k = 0; k <= c; k++) for (let s = 0; s < size; s++) put(b[p++]);
      }
      if (x >= bpr) { x = 0; y++; }
    }
    const r = createRaster(w, h);
    if (depth === 24) {
      for (let i = 0; i < w * h; i++) { const q = Math.floor(i / w) * bpr + (i % w) * 3; r.data.set([out[q], out[q + 1], out[q + 2], 255], i * 4); }
      return { raster: r, depth: 24, greyscale: false, palette: null, dpi: 0 };
    }
    if (depth === 1) palette = Uint8Array.from([0, 0, 0, 255, 255, 255, ...new Array(762).fill(0)]);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const bit = xx * depth, i = (out[yy * bpr + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
      r.data.set([palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2], 255], (yy * w + xx) * 4);
    }
    return { raster: r, depth: depth === 1 ? 1 : depth === 4 ? 4 : 8, greyscale: false, palette: palette.slice(0, (1 << depth) * 3), dpi: 0 };
  }
  return fail("WPG: the file holds no bitmap (vector WordPerfect graphics are not supported)");
}
