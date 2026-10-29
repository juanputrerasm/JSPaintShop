/*
  More of the formats PSP 6 reads and writes (jff.dll), each from its published layout:

    TGA  Truevision Targa: 8-bit color-mapped or grey, 15/16/24/32-bit true color, plain or
         run-length, either row order; written 24 or 32 bits, uncompressed
    PCX  ZSoft Paintbrush: 1, 4 (planar), 8 (with the palette at the end) and 24 bits (three
         planes), run-length; written 8 bits paletted or 24 bits
    PNM  Portable bitmap, greymap and pixmap (P1-P6), plain text or binary; written P6 or P5
    RAS  Sun Raster: 1, 8, 24 and 32 bits, plain or RLE
*/
import { createRaster, type Raster } from "../image/raster.ts";
import type { DecodedImage, IndexedPixels } from "./bmp.ts";
import type { ColorDepth } from "../doc/image-doc.ts";

const depthOf = (bits: number): ColorDepth => (bits <= 1 ? 1 : bits <= 4 ? 4 : bits <= 8 ? 8 : 24);

// ---- TGA ----

export function looksLikeTga(b: Uint8Array, name: string): boolean {
  return /\.(tga|vda|icb|vst)$/i.test(name) && b.length > 18 && [1, 2, 3, 9, 10, 11].includes(b[2]);
}

export function decodeTga(b: Uint8Array): DecodedImage {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const idLen = b[0], mapType = b[1], type = b[2];
  const mapFirst = v.getUint16(3, true), mapLen = v.getUint16(5, true), mapBits = b[7];
  const w = v.getUint16(12, true), h = v.getUint16(14, true), bits = b[16], desc = b[17];
  if (!w || !h) throw new Error("Not a readable TGA: no size.");
  let at = 18 + idLen;
  let palette: Uint8Array | null = null;
  const color = (b: Uint8Array, p: number, nbits: number, out: number[]) => {
    if (nbits === 8) { out[0] = out[1] = out[2] = b[p]; out[3] = 255; }
    else if (nbits === 15 || nbits === 16) { const x = b[p] | (b[p + 1] << 8); out[0] = ((x >> 10) & 31) * 255 / 31; out[1] = ((x >> 5) & 31) * 255 / 31; out[2] = (x & 31) * 255 / 31; out[3] = nbits === 16 && !(x & 0x8000) && (desc & 15) ? 0 : 255; }
    else { out[0] = b[p + 2]; out[1] = b[p + 1]; out[2] = b[p]; out[3] = nbits === 32 ? b[p + 3] : 255; }
  };
  if (mapType) {
    const eb = Math.ceil(mapBits / 8);
    palette = new Uint8Array((mapFirst + mapLen) * 3);
    const c = [0, 0, 0, 0];
    for (let i = 0; i < mapLen; i++) { color(b, at + i * eb, mapBits, c); palette.set([c[0], c[1], c[2]], (mapFirst + i) * 3); }
    at += mapLen * eb;
  }
  const px = Math.ceil(bits / 8), n = w * h;
  const raw = new Uint8Array(n * px);
  if (type >= 9) {
    let o = 0;
    while (o < raw.length && at < b.length) {
      const hdr = b[at++], count = (hdr & 127) + 1;
      if (hdr & 128) { for (let k = 0; k < count; k++) raw.set(b.subarray(at, at + px), o + k * px); at += px; }
      else { raw.set(b.subarray(at, at + count * px), o); at += count * px; }
      o += count * px;
    }
  } else raw.set(b.subarray(at, at + raw.length));
  const r = createRaster(w, h);
  const c = [0, 0, 0, 0];
  const bottomUp = !(desc & 0x20), rightToLeft = Boolean(desc & 0x10);
  const mapped = type === 1 || type === 9;
  for (let i = 0; i < n; i++) {
    const sx = i % w, sy = Math.floor(i / w);
    const x = rightToLeft ? w - 1 - sx : sx, y = bottomUp ? h - 1 - sy : sy;
    if (mapped && palette) { const k = px === 2 ? raw[i * 2] | (raw[i * 2 + 1] << 8) : raw[i]; c[0] = palette[k * 3]; c[1] = palette[k * 3 + 1]; c[2] = palette[k * 3 + 2]; c[3] = 255; }
    else color(raw, i * px, (type === 3 || type === 11) ? 8 : bits, c);
    r.data.set(c, (y * w + x) * 4);
  }
  const grey = type === 3 || type === 11;
  return { raster: r, depth: mapped ? 8 : grey ? 8 : bits === 15 ? 15 : bits === 16 ? 16 : 24, greyscale: grey, palette: mapped ? palette : null, dpi: 0 };
}

export function encodeTga(r: Raster, alpha: boolean): Uint8Array {
  const px = alpha ? 4 : 3;
  const out = new Uint8Array(18 + r.width * r.height * px);
  out[2] = 2;
  out[12] = r.width & 255; out[13] = r.width >> 8; out[14] = r.height & 255; out[15] = r.height >> 8;
  out[16] = alpha ? 32 : 24;
  out[17] = (alpha ? 8 : 0) | 0x20;
  for (let i = 0; i < r.width * r.height; i++) {
    out[18 + i * px] = r.data[i * 4 + 2]; out[19 + i * px] = r.data[i * 4 + 1]; out[20 + i * px] = r.data[i * 4];
    if (alpha) out[21 + i * px] = r.data[i * 4 + 3];
  }
  return out;
}

// ---- PCX ----

export function isPcx(b: Uint8Array): boolean {
  return b.length > 128 && b[0] === 0x0a && b[1] <= 5 && b[2] === 1;
}

export function decodePcx(b: Uint8Array, at = 0): DecodedImage {
  const v = new DataView(b.buffer, b.byteOffset + at, b.byteLength - at);
  const bpp = v.getUint8(3), x0 = v.getUint16(4, true), y0 = v.getUint16(6, true), x1 = v.getUint16(8, true), y1 = v.getUint16(10, true);
  const dpi = v.getUint16(12, true), planes = v.getUint8(65), bpl = v.getUint16(66, true);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const line = planes * bpl;
  const raw = new Uint8Array(line * h);
  let p = at + 128, o = 0;
  while (o < raw.length && p < b.length) {
    const c = b[p++];
    if ((c & 0xc0) === 0xc0) { const n = c & 0x3f, val = b[p++]; raw.fill(val, o, Math.min(raw.length, o + n)); o += n; }
    else raw[o++] = c;
  }
  const r = createRaster(w, h);
  let palette: Uint8Array | null = null;
  const bits = bpp * planes;
  if (bits === 8) {
    const end = b.length - 769;
    palette = b[end] === 12 ? b.slice(end + 1, end + 769) : Uint8Array.from({ length: 768 }, (_, i) => Math.floor(i / 3));
  } else if (bits <= 4) {
    palette = b.slice(at + 16, at + 64);
    if (bits === 1) palette = Uint8Array.from([0, 0, 0, 255, 255, 255]);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const row = y * line, o4 = (y * w + x) * 4;
    if (bits === 24 || bits === 32) { r.data.set([raw[row + x], raw[row + bpl + x], raw[row + 2 * bpl + x], bits === 32 ? raw[row + 3 * bpl + x] : 255], o4); continue; }
    let k: number;
    if (bpp === 8) k = raw[row + x];
    else if (planes === 1) k = (raw[row + ((x * bpp) >> 3)] >> (8 - bpp - ((x * bpp) & 7))) & ((1 << bpp) - 1);
    else { k = 0; for (let pl = 0; pl < planes; pl++) k |= ((raw[row + pl * bpl + (x >> 3)] >> (7 - (x & 7))) & 1) << pl; }
    r.data.set([palette![k * 3], palette![k * 3 + 1], palette![k * 3 + 2], 255], o4);
  }
  return { raster: r, depth: depthOf(bits), greyscale: false, palette: bits <= 8 ? palette : null, dpi };
}

export function encodePcx(r: Raster, dpi: number, indexed?: IndexedPixels): Uint8Array {
  const w = r.width, h = r.height, planes = indexed ? 1 : 3, bpl = w + (w & 1);
  const out: number[] = [];
  const header = new Uint8Array(128);
  const v = new DataView(header.buffer);
  header.set([0x0a, 5, 1, 8]);
  v.setUint16(8, w - 1, true); v.setUint16(10, h - 1, true); v.setUint16(12, dpi, true); v.setUint16(14, dpi, true);
  header[65] = planes;
  v.setUint16(66, bpl, true);
  v.setUint16(68, 1, true);
  out.push(...header);
  const line = new Uint8Array(bpl * planes);
  for (let y = 0; y < h; y++) {
    line.fill(0);
    for (let x = 0; x < w; x++) {
      if (indexed) line[x] = indexed.indices[y * w + x];
      else for (let c = 0; c < 3; c++) line[c * bpl + x] = r.data[(y * w + x) * 4 + c];
    }
    for (let i = 0; i < line.length;) {
      let n = 1;
      while (n < 63 && i + n < line.length && line[i + n] === line[i] && (i + n) % bpl !== 0) n++;
      if (n > 1 || (line[i] & 0xc0) === 0xc0) out.push(0xc0 | n, line[i]);
      else out.push(line[i]);
      i += n;
    }
  }
  if (indexed) { out.push(12); for (let i = 0; i < 768; i++) out.push(indexed.palette[i] ?? 0); }
  return Uint8Array.from(out);
}

/* DCX: a list of PCX pages; the first is read. */
export function isDcx(b: Uint8Array): boolean {
  return b.length > 8 && b[0] === 0xb1 && b[1] === 0x68 && b[2] === 0xde && b[3] === 0x3a;
}

export function decodeDcx(b: Uint8Array): DecodedImage {
  const first = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(4, true);
  return decodePcx(b, first);
}

// ---- PNM ----

export function isPnm(b: Uint8Array): boolean {
  return b.length > 3 && b[0] === 0x50 && b[1] >= 0x31 && b[1] <= 0x36 && (b[2] === 0x0a || b[2] === 0x20 || b[2] === 0x0d || b[2] === 0x09);
}

export function decodePnm(b: Uint8Array): DecodedImage {
  const kind = b[1] - 0x30;
  let at = 2;
  const token = (): number => {
    for (;;) {
      while (at < b.length && /\s/.test(String.fromCharCode(b[at]))) at++;
      if (b[at] === 0x23) { while (at < b.length && b[at] !== 0x0a) at++; continue; }
      break;
    }
    let s = "";
    while (at < b.length && !/\s/.test(String.fromCharCode(b[at]))) s += String.fromCharCode(b[at++]);
    return Number(s);
  };
  const w = token(), h = token(), max = kind === 1 || kind === 4 ? 1 : token();
  at++;
  const r = createRaster(w, h);
  const scale = 255 / (max || 1);
  const n = w * h, wide = max > 255;
  const sample = (): number => {
    if (kind <= 3) return token();
    const v = wide ? (b[at] << 8) | b[at + 1] : b[at];
    at += wide ? 2 : 1;
    return v;
  };
  for (let i = 0; i < n; i++) {
    let c: number[];
    if (kind === 1) c = Array(3).fill(token() ? 0 : 255);
    else if (kind === 4) { const x = i % w, byte = b[at + Math.floor(x / 8)]; const bit = (byte >> (7 - (x & 7))) & 1; c = Array(3).fill(bit ? 0 : 255); if (x === w - 1) at += Math.ceil(w / 8); }
    else if (kind === 2 || kind === 5) c = Array(3).fill(sample() * scale);
    else c = [sample() * scale, sample() * scale, sample() * scale];
    r.data.set([c[0], c[1], c[2], 255], i * 4);
  }
  const grey = kind === 2 || kind === 5;
  return { raster: r, depth: kind === 1 || kind === 4 ? 1 : grey ? 8 : 24, greyscale: grey, palette: grey ? Uint8Array.from({ length: 768 }, (_, i) => Math.floor(i / 3)) : kind === 1 || kind === 4 ? Uint8Array.from([0, 0, 0, 255, 255, 255]) : null, dpi: 0 };
}

export function encodePnm(r: Raster, grey: boolean): Uint8Array {
  const head = new TextEncoder().encode(`${grey ? "P5" : "P6"}\n${r.width} ${r.height}\n255\n`);
  const n = r.width * r.height, out = new Uint8Array(head.length + n * (grey ? 1 : 3));
  out.set(head);
  for (let i = 0; i < n; i++) {
    if (grey) out[head.length + i] = Math.round(0.299 * r.data[i * 4] + 0.587 * r.data[i * 4 + 1] + 0.114 * r.data[i * 4 + 2]);
    else out.set(r.data.subarray(i * 4, i * 4 + 3), head.length + i * 3);
  }
  return out;
}

// ---- Sun Raster ----

export function isRas(b: Uint8Array): boolean {
  return b.length > 32 && b[0] === 0x59 && b[1] === 0xa6 && b[2] === 0x6a && b[3] === 0x95;
}

export function decodeRas(b: Uint8Array): DecodedImage {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const w = v.getUint32(4), h = v.getUint32(8), bits = v.getUint32(12), type = v.getUint32(20), mapLen = v.getUint32(28);
  let at = 32;
  let palette: Uint8Array | null = null;
  if (mapLen) {
    const n = mapLen / 3;
    palette = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) palette.set([b[at + i], b[at + n + i], b[at + 2 * n + i]], i * 3);
    at += mapLen;
  }
  const stride = Math.ceil((w * bits) / 16) * 2;
  let raw = b.subarray(at);
  if (type === 2) {
    const out = new Uint8Array(stride * h);
    let o = 0, i = 0;
    while (o < out.length && i < raw.length) {
      const c = raw[i++];
      if (c !== 0x80) out[o++] = c;
      else { const n = raw[i++]; if (n === 0) out[o++] = 0x80; else { out.fill(raw[i++], o, o + n + 1); o += n + 1; } }
    }
    raw = out;
  }
  const r = createRaster(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const row = y * stride, o4 = (y * w + x) * 4;
    if (bits === 1) { const k = (raw[row + (x >> 3)] >> (7 - (x & 7))) & 1; const c = palette ? [palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2]] : k ? [0, 0, 0] : [255, 255, 255]; r.data.set([...c, 255], o4); }
    else if (bits === 8) { const k = raw[row + x]; r.data.set(palette ? [palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2], 255] : [k, k, k, 255], o4); }
    else {
      const p = row + x * (bits / 8), off = bits === 32 ? 1 : 0;
      // RT_FORMAT_RGB (3) stores red first; the standard type stores blue first.
      r.data.set(type === 3 ? [raw[p + off], raw[p + off + 1], raw[p + off + 2], 255] : [raw[p + off + 2], raw[p + off + 1], raw[p + off], 255], o4);
    }
  }
  return { raster: r, depth: depthOf(bits), greyscale: bits === 8 && !palette, palette: bits <= 8 ? palette ?? Uint8Array.from({ length: 768 }, (_, i) => Math.floor(i / 3)) : null, dpi: 0 };
}
