/*
  Tagged Image File Format (.tif, .tiff), PSP 6's "TIF - Tagged Image File Format".

  Reading: the first image of either byte order; strips or tiles; no compression, LZW (with
  the horizontal predictor), PackBits or Deflate; bilevel and greyscale (1, 4, 8, 16 bits),
  paletted (1, 4, 8), RGB and CMYK (8 or 16 bits per sample) with or without an extra alpha
  sample; chunky or planar samples; the resolution.
  Writing: little-endian RGB, 8 bits per sample (with alpha when the image has transparency),
  uncompressed or LZW, one strip per 8 KB, the resolution.
*/
import type { Raster } from "../image/raster.ts";
import type { DecodedImage } from "./bmp.ts";

export class TiffError extends Error {}
const fail = (m: string): never => { throw new TiffError(`TIFF: ${m}`); };

export function isTiff(b: Uint8Array): boolean {
  return b.length >= 8 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 42 && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 42));
}

/* TIFF LZW (MSB-first codes, early change). */
export function lzwDecode(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let o = 0, bitPos = 0, width = 9;
  const table: Uint8Array[] = [];
  const reset = () => { table.length = 0; for (let i = 0; i < 256; i++) table.push(Uint8Array.of(i)); table.push(new Uint8Array(0), new Uint8Array(0)); width = 9; };
  const read = () => {
    let v = 0;
    for (let i = 0; i < width; i++) {
      const byte = src[(bitPos >> 3)] ?? 0;
      v = (v << 1) | ((byte >> (7 - (bitPos & 7))) & 1);
      bitPos++;
    }
    return v;
  };
  reset();
  let prev: Uint8Array | null = null;
  const put = (s: Uint8Array) => { for (let i = 0; i < s.length && o < expected; i++) out[o++] = s[i]; };
  while (bitPos + width <= src.length * 8 && o < expected) {
    const code = read();
    if (code === 257) break;
    if (code === 256) { reset(); prev = null; continue; }
    let entry: Uint8Array;
    if (code < table.length) entry = table[code];
    else if (prev) { entry = new Uint8Array(prev.length + 1); entry.set(prev); entry[prev.length] = prev[0]; }
    else break;
    put(entry);
    if (prev) { const n = new Uint8Array(prev.length + 1); n.set(prev); n[prev.length] = entry[0]; table.push(n); }
    prev = entry;
    if (table.length + 1 >= 1 << width && width < 12) width++;
  }
  return out;
}

export function lzwEncode(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  let acc = 0, bits = 0, width = 9;
  const emit = (code: number) => {
    acc = (acc << width) | code; bits += width;
    while (bits >= 8) { out.push((acc >> (bits - 8)) & 0xff); bits -= 8; }
    acc &= (1 << bits) - 1;
  };
  let dict = new Map<string, number>(), next = 258;
  emit(256);
  let w = "";
  for (let i = 0; i < src.length; i++) {
    const c = String.fromCharCode(src[i]), wc = w + c;
    if (w === "" || dict.has(wc) || wc.length === 1) { w = wc; continue; }
    emit(w.length === 1 ? w.charCodeAt(0) : dict.get(w)!);
    dict.set(wc, next++);
    // The decoder adds each entry one code later, so it widens one entry earlier ("early change").
    if (next >= 1 << width && width < 12) width++;
    if (next >= 4093) { emit(256); dict = new Map(); next = 258; width = 9; }
    w = c;
  }
  if (w) emit(w.length === 1 ? w.charCodeAt(0) : dict.get(w)!);
  emit(257);
  if (bits) out.push((acc << (8 - bits)) & 0xff);
  return Uint8Array.from(out);
}

function packBits(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let o = 0;
  for (let i = 0; i < src.length && o < expected;) {
    const n = (src[i++] << 24) >> 24;
    if (n >= 0) for (let k = 0; k <= n && o < expected; k++) out[o++] = src[i++];
    else if (n !== -128) { const v = src[i++]; for (let k = 0; k < 1 - n && o < expected; k++) out[o++] = v; }
  }
  return out;
}

interface Ifd { tags: Map<number, number[]>; }

export async function decodeTiff(b: Uint8Array, inflate: (d: Uint8Array) => Promise<Uint8Array>): Promise<DecodedImage> {
  if (!isTiff(b)) fail("not a TIFF file");
  const le = b[0] === 0x49;
  const u16 = (o: number) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o: number) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
  const ifdAt = u32(4);
  if (ifdAt + 2 > b.length) fail("no image directory");
  const ifd: Ifd = { tags: new Map() };
  const n = u16(ifdAt);
  const sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 16: 8 };
  for (let k = 0; k < n; k++) {
    const e = ifdAt + 2 + k * 12, tag = u16(e), type = u16(e + 2), count = u32(e + 4), sz = (sizes[type] ?? 1) * count;
    const at = sz <= 4 ? e + 8 : u32(e + 8);
    const vals: number[] = [];
    for (let i = 0; i < Math.min(count, 1 << 20); i++) {
      if (type === 3 || type === 8) vals.push(u16(at + i * 2));
      else if (type === 4 || type === 9 || type === 16) vals.push(u32(at + i * (type === 16 ? 8 : 4)));
      else if (type === 5 || type === 10) vals.push(u32(at + i * 8) / (u32(at + i * 8 + 4) || 1));
      else vals.push(b[at + i]);
    }
    ifd.tags.set(tag, vals);
  }
  const tag = (t: number, d?: number) => ifd.tags.get(t)?.[0] ?? d;
  const width = tag(256) ?? fail("no width"), height = tag(257) ?? fail("no height");
  const bps = ifd.tags.get(258) ?? [1], spp = tag(277, 1)!, bits = bps[0];
  const comp = tag(259, 1)!, photo = tag(262, spp >= 3 ? 2 : 1)!, planar = tag(284, 1)!, predictor = tag(317, 1)!;
  const extra = ifd.tags.get(338) ?? [], fill = tag(266, 1)!;
  const resUnit = tag(296, 2)!, xres = tag(282, 0)!;
  const dpi = resUnit === 3 ? Math.round(xres * 2.54) : resUnit === 2 ? Math.round(xres) : 0;
  if (![1, 5, 32773, 8, 32946].includes(comp)) fail(`compression ${comp} is not supported`);
  if (![1, 2, 4, 8, 16].includes(bits)) fail(`${bits} bits per sample are not supported`);
  // Chunks: strips or tiles, each decoded to its raw bytes.
  const tiled = ifd.tags.has(322);
  const tw = tiled ? tag(322)! : width, th = tiled ? tag(323)! : tag(278, height)!;
  const offsets = ifd.tags.get(tiled ? 324 : 273) ?? fail("no image data");
  const counts = ifd.tags.get(tiled ? 325 : 279) ?? offsets.map((o, i) => (offsets[i + 1] ?? b.length) - o);
  const across = tiled ? Math.ceil(width / tw) : 1, down = Math.ceil(height / th);
  const planes = planar === 2 ? spp : 1, chunkSpp = planar === 2 ? 1 : spp;
  const rowBytes = Math.ceil((tw * chunkSpp * bits) / 8);
  const sampleAt = new Float64Array(0);
  void sampleAt;
  // samples[plane][y][x * chunkSpp + s], as numbers 0..(2^bits - 1)
  const full = (2 ** bits) - 1;
  const samples = new Uint16Array(width * height * spp);
  for (let p = 0; p < planes; p++) for (let cy = 0; cy < down; cy++) for (let cx = 0; cx < across; cx++) {
    const idx = p * across * down + cy * across + cx;
    const raw = b.subarray(offsets[idx], offsets[idx] + counts[idx]);
    const size = rowBytes * th;
    let data: Uint8Array;
    if (comp === 1) data = raw;
    else if (comp === 5) data = lzwDecode(raw, size);
    else if (comp === 32773) data = packBits(raw, size);
    else data = await inflate(raw);
    if (predictor === 2 && bits === 8) {
      for (let y = 0; y < th; y++) for (let x = chunkSpp; x < tw * chunkSpp; x++) data[y * rowBytes + x] = (data[y * rowBytes + x] + data[y * rowBytes + x - chunkSpp]) & 255;
    }
    for (let y = 0; y < th; y++) {
      const iy = cy * th + y;
      if (iy >= height) break;
      for (let x = 0; x < tw; x++) {
        const ix = cx * tw + x;
        if (ix >= width) break;
        for (let s = 0; s < chunkSpp; s++) {
          const i = x * chunkSpp + s;
          let v: number;
          if (bits === 8) v = data[y * rowBytes + i] ?? 0;
          else if (bits === 16) { const o = y * rowBytes + i * 2; v = le ? data[o] | (data[o + 1] << 8) : (data[o] << 8) | data[o + 1]; }
          else {
            const bit = i * bits, byte = data[y * rowBytes + (bit >> 3)] ?? 0;
            v = fill === 2 ? (byte >> (bit & 7)) & full : (byte >> (8 - bits - (bit & 7))) & full;
          }
          samples[(iy * width + ix) * spp + (planar === 2 ? p : s)] = v;
        }
      }
    }
  }
  const to8 = (v: number) => (bits === 8 ? v : bits === 16 ? v >> 8 : Math.round((v * 255) / full));
  const raster: Raster = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  const d = raster.data;
  let palette: Uint8Array | null = null;
  const map = ifd.tags.get(320);
  if (photo === 3 && map) {
    const count = map.length / 3;
    palette = new Uint8Array(count * 3);
    for (let i = 0; i < count; i++) { palette[i * 3] = map[i] >> 8; palette[i * 3 + 1] = map[count + i] >> 8; palette[i * 3 + 2] = map[2 * count + i] >> 8; }
  }
  const color = photo === 2 || photo === 5 ? (photo === 5 ? 4 : 3) : 1;
  const alphaSample = extra.length && spp > color ? color : -1;
  for (let i = 0; i < width * height; i++) {
    const s = samples.subarray(i * spp, i * spp + spp);
    let r: number, g: number, bl: number;
    if (photo === 3 && palette) { const k = Math.min(s[0], palette.length / 3 - 1); r = palette[k * 3]; g = palette[k * 3 + 1]; bl = palette[k * 3 + 2]; }
    else if (photo === 2) { r = to8(s[0]); g = to8(s[1]); bl = to8(s[2]); }
    else if (photo === 5) { const c = to8(s[0]), m = to8(s[1]), y = to8(s[2]), k = to8(s[3]); r = ((255 - c) * (255 - k)) / 255; g = ((255 - m) * (255 - k)) / 255; bl = ((255 - y) * (255 - k)) / 255; }
    else { const v = photo === 0 ? 255 - to8(s[0]) : to8(s[0]); r = g = bl = v; }
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = bl;
    d[i * 4 + 3] = alphaSample >= 0 ? to8(s[alphaSample]) : 255;
  }
  // Associated alpha (extra sample 1) is premultiplied: undo it.
  if (alphaSample >= 0 && extra[0] === 1) for (let i = 0; i < d.length; i += 4) if (d[i + 3] && d[i + 3] < 255) for (let c = 0; c < 3; c++) d[i + c] = Math.min(255, (d[i + c] * 255) / d[i + 3]);
  const greyscale = photo === 0 || photo === 1;
  const depth = photo === 3 ? (bits <= 1 ? 1 : bits <= 4 ? 4 : 8) : greyscale ? (bits === 1 ? 1 : 8) : 24;
  return { raster, depth: depth as DecodedImage["depth"], greyscale: greyscale && bits > 1, palette: palette ?? (greyscale && bits <= 8 ? Uint8Array.from({ length: 768 }, (_, i) => Math.floor(i / 3)) : null), dpi };
}

/** Little-endian RGB(A) TIFF, 8 bits per sample, uncompressed or LZW. */
export function encodeTiff(r: Raster, dpi: number, lzw = true): Uint8Array {
  const { width: W, height: H, data } = r;
  const alpha = data.some((v, i) => (i & 3) === 3 && v < 255);
  const spp = alpha ? 4 : 3, rowBytes = W * spp;
  const rowsPerStrip = Math.max(1, Math.floor(8192 / rowBytes));
  const strips: Uint8Array[] = [];
  for (let y = 0; y < H; y += rowsPerStrip) {
    const rows = Math.min(rowsPerStrip, H - y), raw = new Uint8Array(rows * rowBytes);
    for (let yy = 0; yy < rows; yy++) for (let x = 0; x < W; x++) for (let s = 0; s < spp; s++) raw[yy * rowBytes + x * spp + s] = data[((y + yy) * W + x) * 4 + s];
    strips.push(lzw ? lzwEncode(raw) : raw);
  }
  const entries: [number, number, number, number[]][] = [
    [256, 4, 1, [W]], [257, 4, 1, [H]], [258, 3, spp, Array(spp).fill(8)], [259, 3, 1, [lzw ? 5 : 1]], [262, 3, 1, [2]],
    [273, 4, strips.length, []], [277, 3, 1, [spp]], [278, 4, 1, [rowsPerStrip]], [279, 4, strips.length, strips.map((s) => s.length)],
    [282, 5, 1, [dpi || 72]], [283, 5, 1, [dpi || 72]], [284, 3, 1, [1]], [296, 3, 1, [2]],
  ];
  if (alpha) entries.push([338, 3, 1, [2]]);
  entries.sort((a, b) => a[0] - b[0]);
  const out: number[] = [];
  const w16 = (v: number) => out.push(v & 255, (v >> 8) & 255);
  const w32 = (v: number) => out.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
  out.push(0x49, 0x49); w16(42); w32(8);
  const ifdSize = 2 + entries.length * 12 + 4;
  let extraAt = 8 + ifdSize;
  const extras: number[][] = [];
  const pending: { at: number; values: number[]; type: number }[] = [];
  w16(entries.length);
  for (const [tagId, type, count, values] of entries) {
    w16(tagId); w16(type); w32(count);
    const size = (type === 3 ? 2 : type === 5 ? 8 : 4) * count;
    if (tagId === 273) { pending.push({ at: out.length, values: [], type }); w32(0); continue; }
    if (size <= 4) { if (type === 3) { w16(values[0]); w16(count > 1 ? values[1] : 0); } else w32(values[0]); continue; }
    w32(extraAt);
    const bytes: number[] = [];
    for (const v of values) {
      if (type === 3) bytes.push(v & 255, (v >> 8) & 255);
      else if (type === 5) { const num = Math.round(v), den = 1; bytes.push(num & 255, (num >> 8) & 255, (num >> 16) & 255, (num >>> 24) & 255, den, 0, 0, 0); }
      else bytes.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
    }
    extras.push(bytes);
    extraAt += bytes.length + (bytes.length & 1);
  }
  w32(0);
  for (const e of extras) { out.push(...e); if (e.length & 1) out.push(0); }
  // Strip offsets: inline for one strip, else an array after the extras.
  let dataAt = out.length;
  const offsetsArrayAt = strips.length > 1 ? dataAt : -1;
  if (strips.length > 1) dataAt += strips.length * 4;
  const offs: number[] = [];
  let at = dataAt;
  for (const s of strips) { offs.push(at); at += s.length; }
  const p = pending[0];
  const put32 = (o: number, v: number) => { out[o] = v & 255; out[o + 1] = (v >>> 8) & 255; out[o + 2] = (v >>> 16) & 255; out[o + 3] = (v >>> 24) & 255; };
  if (strips.length === 1) put32(p.at, offs[0]);
  else { put32(p.at, offsetsArrayAt); for (const o of offs) w32(o); }
  const head = Uint8Array.from(out);
  const total = new Uint8Array(at);
  total.set(head);
  let o = dataAt;
  for (const s of strips) { total.set(s, o); o += s.length; }
  return total;
}
