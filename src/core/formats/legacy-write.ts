/*
  Saving the older formats PSP 6 also writes, after jff.dll's encoders (docs/PSP_EXE_ANALYSIS.md
  section 21). Rows go top to bottom unless a format says otherwise.

    MAC   EncodeMAC   576 x 720, 2 colors: a 512-byte zero header, then PackBits rows of 72
                      bytes (1 = black); runs of 3 or more, pairs kept as literals
    MSP   EncodeMSP   2 colors: "LinS" version 2 header (32 bytes), a row-length table, then
                      each row run-length coded (0, n, byte for runs of 2 or more; n, bytes)
                      with 1 = white
    IMG   EncodeIMG   2, 16 or 256 colors as 1, 4 or 8 planes: version 1, 8-word header,
                      pattern length 1, 85 x 85 micron pixels; per plane row: solid runs of
                      0x00 (n) and 0xFF (0x80 | n), pattern runs (0, n, byte), literals (0x80,
                      n, bytes); bits inverted (1 = black)
    CUT   EncodeCUT   256 colors: width, height, 0; each row a length word, runs (0x80 | n,
                      byte) of 3 or more, literals (n, bytes), and a 0
    RAS   EncodeRAS   2, 256 or 16 million colors: Sun raster type 1, an RGB map for 256
                      colors, 1-bit rows inverted, 24-bit rows BGR, rows padded to 16 bits
    CLP   EncodeCLP   a 14-byte clipboard header (0xC350, one CF_DIB entry at offset 14), then
                      the packed device-independent bitmap
    IFF   EncodeIFF   FORM ILBM: BMHD (ByteRun1), CMAP for 256 colors or fewer, BODY of
                      interleaved plane rows (24 planes red, green, blue for full color)
    PICT  EncodePICT  a 512-byte zero header, then version 1 (2 colors) or 2 with a clip
                      region and PackBitsRect (with its color table) or DirectBitsRect (packed
                      per component), then the end opcode
    WPG   EncodeWPG   WPG 1: start (sizes in 1200ths of an inch), color map, bitmap type 1, end

  Paletted formats take each pixel's palette index; MAC and MSP need 2-color images.
*/
import type { Raster } from "../image/raster.ts";
import type { IndexedPixels } from "./bmp.ts";
import { encodeBmp } from "./bmp.ts";

export class SaveError extends Error {}

class Out {
  private buf = new Uint8Array(4096);
  length = 0;
  private room(n: number) {
    if (this.length + n <= this.buf.length) return;
    const b = new Uint8Array(Math.max(this.buf.length * 2, this.length + n));
    b.set(this.buf.subarray(0, this.length));
    this.buf = b;
  }
  u8(...v: number[]) { this.room(v.length); for (const x of v) this.buf[this.length++] = x & 0xff; return this; }
  bytes(b: ArrayLike<number>) { this.room(b.length); this.buf.set(b, this.length); this.length += b.length; return this; }
  be16(v: number) { return this.u8(v >> 8, v); }
  le16(v: number) { return this.u8(v, v >> 8); }
  be32(v: number) { return this.u8(v >>> 24, v >>> 16, v >>> 8, v); }
  le32(v: number) { return this.u8(v, v >>> 8, v >>> 16, v >>> 24); }
  ascii(s: string) { return this.u8(...[...s].map((c) => c.charCodeAt(0))); }
  set16be(at: number, v: number) { this.buf[at] = v >> 8; this.buf[at + 1] = v; }
  set16le(at: number, v: number) { this.buf[at] = v; this.buf[at + 1] = v >> 8; }
  set32be(at: number, v: number) { this.buf[at] = v >>> 24; this.buf[at + 1] = v >>> 16; this.buf[at + 2] = v >>> 8; this.buf[at + 3] = v; }
  done() { return this.buf.slice(0, this.length); }
}

/* Packed rows of `bits` per pixel from palette indexes. */
function packRow(idx: Uint8Array, w: number, y: number, bits: number, bytes: number, map = (v: number) => v): Uint8Array {
  const row = new Uint8Array(bytes);
  for (let x = 0; x < w; x++) {
    const v = map(idx[y * w + x]), bit = x * bits;
    row[bit >> 3] |= v << (8 - bits - (bit & 7));
  }
  return row;
}

/* Which index of a 2-color palette is the darker one. */
const darkIndex = (pal: Uint8Array) => (pal[0] + pal[1] + pal[2] <= pal[3] + pal[4] + pal[5] ? 0 : 1);

function needTwo(p: IndexedPixels, name: string): void {
  if (p.bits !== 1) throw new SaveError(`${name} saves 2-color images. Use Colors > Decrease Color Depth > 2 Colors first.`);
}

/* ---- MacPaint ---- */

/** EncodeMAC's PackBits: runs of 3 or more as -(n - 1), the rest as literals. */
function macPack(row: Uint8Array, out: Out): void {
  const lit: number[] = [];
  const flush = () => { if (lit.length) { out.u8(lit.length - 1).bytes(lit); lit.length = 0; } };
  let i = 0;
  while (i < row.length) {
    const v = row[i];
    let n = 1;
    while (i + n < row.length && row[i + n] === v) n++;
    if (n <= 2) { for (let k = 0; k < n; k++) lit.push(v); }
    else { flush(); out.u8(1 - n, v); }
    i += n;
  }
  flush();
}

export function encodeMacPaint(p: IndexedPixels, w: number, h: number): Uint8Array {
  needTwo(p, "MacPaint");
  if (w !== 576 || h !== 720) throw new SaveError("MacPaint images are 576 x 720 pixels. Use Image > Canvas Size first.");
  const out = new Out().bytes(new Uint8Array(512));
  const black = darkIndex(p.palette);
  for (let y = 0; y < h; y++) macPack(packRow(p.indices, w, y, 1, 72, (v) => (v === black ? 1 : 0)), out);
  return out.done();
}

/* ---- Microsoft Paint 2 ---- */

export function encodeMsp(p: IndexedPixels, w: number, h: number): Uint8Array {
  needTwo(p, "Microsoft Paint");
  if (w > 0x7fff || h > 0x7fff) throw new SaveError("Microsoft Paint images are at most 32767 pixels each way.");
  const bpr = (w + 7) >> 3, white = 1 - darkIndex(p.palette);
  const out = new Out().ascii("LinS").le16(w).le16(h);
  for (let k = 0; k < 3; k++) out.le16(w).le16(h);
  out.bytes([0, 0, 0, 0, 0x22, 0x3a, 0, 0, 0, 0, 0, 0]);
  const table = out.length;
  out.bytes(new Uint8Array(h * 2));
  for (let y = 0; y < h; y++) {
    const row = packRow(p.indices, w, y, 1, bpr, (v) => (v === white ? 1 : 0)), start = out.length;
    const lit: number[] = [];
    const flush = () => { if (lit.length) { out.u8(lit.length).bytes(lit); lit.length = 0; } };
    let i = 0;
    while (i < bpr) {
      const v = row[i];
      let n = 1;
      while (i + n < bpr && row[i + n] === v && n < 255) n++;
      if (n === 1) { lit.push(v); if (lit.length === 255) flush(); }
      else { flush(); out.u8(0, n, v); }
      i += n;
    }
    flush();
    out.set16le(table + y * 2, out.length - start);
  }
  return out.done();
}

/* ---- GEM IMG ---- */

export function encodeGemImg(p: IndexedPixels, w: number, h: number): Uint8Array {
  if (w > 0x7fff || h > 0x7fff) throw new SaveError("GEM images are at most 32767 pixels each way.");
  const planes = p.bits, bpr = (w + 7) >> 3;
  const out = new Out().be16(1).be16(8).be16(planes).be16(1).be16(85).be16(85).be16(w).be16(h);
  for (let y = 0; y < h; y++) {
    for (let plane = 0; plane < planes; plane++) {
      // Plane 0 is the lowest bit (PSP 6's encoder writes the highest first; see the docs).
      const row = packRow(p.indices, w, y, 1, bpr, (v) => (v >> plane) & 1).map((b) => ~b & 0xff);
      const lit: number[] = [];
      const flush = () => { if (lit.length) { out.u8(0x80, lit.length).bytes(lit); lit.length = 0; } };
      let i = 0;
      while (i < bpr) {
        const v = row[i];
        let n = 1;
        while (i + n < bpr && row[i + n] === v && n < 0x7f) n++;
        if (n === 1) { lit.push(v); if (lit.length === 0x7f) flush(); }
        else {
          flush();
          if (v === 0xff) out.u8(0x80 | n);
          else if (v === 0) out.u8(n);
          else out.u8(0, n, v);
        }
        i += n;
      }
      flush();
    }
  }
  return out.done();
}

/* ---- Dr. Halo CUT ---- */

export function encodeCut(p: IndexedPixels, w: number, h: number): Uint8Array {
  if (p.bits !== 8) throw new SaveError("Dr. Halo saves 256-color images. Use Colors > Decrease Color Depth > 256 Colors first.");
  const out = new Out().le16(w).le16(h).le16(0);
  for (let y = 0; y < h; y++) {
    const start = out.length;
    out.le16(0);
    const lit: number[] = [];
    const flush = () => { if (lit.length) { out.u8(lit.length).bytes(lit); lit.length = 0; } };
    let x = 0;
    while (x < w) {
      const v = p.indices[y * w + x];
      let n = 1;
      while (x + n < w && p.indices[y * w + x + n] === v && n < 0x7f) n++;
      if (n <= 2) { for (let k = 0; k < n; k++) lit.push(v); if (lit.length > 0x7c) flush(); }
      else { flush(); out.u8(0x80 | n, v); }
      x += n;
    }
    flush();
    out.u8(0);
    out.set16le(start, out.length - start - 2);
  }
  return out.done();
}

/*
  The Dr. Halo palette that goes beside a .CUT (EncodeCUT 0x10027b40): 2048 bytes in four
  512-byte blocks built in one buffer: "AH", 0xE3 (a word), 10 at byte 6, 0xFF words at 12,
  14, 16 and 18; then 6-byte entries R, 0, G, 0, B, 0: 78 from byte 40, then 85, 85 and 8 from
  the start of each block. The buffer is not cleared between blocks, so the last block's tail
  repeats the third block's bytes, as PSP writes it.
*/
export function encodeHaloPalette(palette: Uint8Array): Uint8Array {
  const out = new Uint8Array(2048), buf = new Uint8Array(512);
  buf[0] = 0x41; buf[1] = 0x48; buf[2] = 0xe3; buf[6] = 10;
  buf[12] = buf[14] = buf[16] = buf[18] = 0xff;
  let entry = 0;
  [[40, 78], [0, 85], [0, 85], [0, 8]].forEach(([at, count], block) => {
    for (let k = 0; k < count; k++, entry++, at += 6) {
      buf[at] = palette[entry * 3] ?? 0; buf[at + 1] = 0;
      buf[at + 2] = palette[entry * 3 + 1] ?? 0; buf[at + 3] = 0;
      buf[at + 4] = palette[entry * 3 + 2] ?? 0; buf[at + 5] = 0;
    }
    out.set(buf, block * 512);
  });
  return out;
}

/* ---- Sun raster ---- */

export function encodeRas(r: Raster, p: IndexedPixels | null): Uint8Array {
  const { width: w, height: h, data } = r;
  if (w > 0x7fff || h > 0x7fff) throw new SaveError("Sun raster images are at most 32767 pixels each way.");
  // PSP saves 2, 256 or 16 million colors; 16-color images go out as 256.
  const depth = p ? (p.bits === 1 ? 1 : 8) : 24;
  let bpr = depth === 1 ? (w + 7) >> 3 : depth === 8 ? w : w * 3;
  if (bpr & 1) bpr++;
  const out = new Out().be32(0x59a66a95).be32(w).be32(h).be32(depth).be32(bpr * h).be32(1).be32(depth === 8 ? 1 : 0).be32(depth === 8 ? 768 : 0);
  if (depth === 8) {
    for (let c = 0; c < 3; c++) for (let i = 0; i < 256; i++) out.u8(p!.palette[i * 3 + c] ?? 0);
  }
  const black = p && depth === 1 ? darkIndex(p.palette) : 0;
  for (let y = 0; y < h; y++) {
    const row = new Uint8Array(bpr);
    if (depth === 1) row.set(packRow(p!.indices, w, y, 1, (w + 7) >> 3, (v) => (v === black ? 1 : 0)));
    else if (depth === 8) row.set(p!.indices.subarray(y * w, y * w + w));
    else for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; row[x * 3] = data[i + 2]; row[x * 3 + 1] = data[i + 1]; row[x * 3 + 2] = data[i]; }
    out.bytes(row);
  }
  return out.done();
}

/* ---- Windows Clipboard ---- */

export function encodeClp(r: Raster, p: IndexedPixels | null, dpi: number): Uint8Array {
  const dib = encodeBmp(r, dpi, p ?? undefined).subarray(14);
  // CF_DIB wants biSizeImage set.
  const dv = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);
  const bits = dv.getUint16(14, true), stride = Math.ceil((r.width * bits) / 32) * 4;
  dv.setUint32(20, stride * r.height, true);
  return new Out().le16(0xc350).le16(1).le16(8).le32(dib.length).le32(14).bytes(dib).done();
}

/* ---- Amiga IFF ILBM ---- */

function byteRun1(row: Uint8Array, out: Out): void {
  const lit: number[] = [];
  const flush = () => { if (lit.length) { out.u8(lit.length - 1).bytes(lit); lit.length = 0; } };
  let i = 0;
  while (i < row.length) {
    const v = row[i];
    let n = 1;
    while (i + n < row.length && row[i + n] === v && n < 127) n++;
    if (n === 1) { lit.push(v); if (lit.length === 127) flush(); }
    else { flush(); out.u8(1 - n, v); }
    i += n;
  }
  flush();
}

export function encodeIff(r: Raster, p: IndexedPixels | null, compress = true): Uint8Array {
  const { width: w, height: h, data } = r;
  if (w > 0x7fff || h > 0x7fff) throw new SaveError("IFF images are at most 32767 pixels each way.");
  const planes = p ? p.bits : 24, bpr = ((w + 15) >> 4) * 2;
  const out = new Out().ascii("FORM").be32(0).ascii("ILBM");
  out.ascii("BMHD").be32(20).be16(w).be16(h).be16(0).be16(0).u8(planes, 0, compress ? 1 : 0, 0).be16(0).u8(1, 1).be16(w).be16(h);
  if (p) {
    const n = 1 << p.bits;
    out.ascii("CMAP").be32(n * 3);
    for (let i = 0; i < n * 3; i++) out.u8(p.palette[i] ?? 0);
  }
  out.ascii("BODY").be32(0);
  const body = out.length;
  for (let y = 0; y < h; y++) {
    for (let plane = 0; plane < planes; plane++) {
      const row = new Uint8Array(bpr);
      for (let x = 0; x < w; x++) {
        const v = p ? (p.indices[y * w + x] >> plane) & 1 : (data[(y * w + x) * 4 + (plane >> 3)] >> (plane & 7)) & 1;
        if (v) row[x >> 3] |= 0x80 >> (x & 7);
      }
      if (compress) byteRun1(row, out); else out.bytes(row);
    }
  }
  const bodyLen = out.length - body;
  if (bodyLen & 1) out.u8(0);
  out.set32be(body - 4, bodyLen);
  out.set32be(4, out.length - 8);
  return out.done();
}

/* ---- Macintosh PICT ---- */

/* PackBits for one row, with its byte count (a word when the row is over 250 bytes). */
function pictRow(row: Uint8Array, rowBytes: number, out: Out): void {
  if (rowBytes < 8) { out.bytes(row.subarray(0, rowBytes)); return; }
  const packed = new Out();
  byteRun1(row.subarray(0, rowBytes), packed);
  const b = packed.done();
  if (rowBytes > 250) out.be16(b.length); else out.u8(b.length);
  out.bytes(b);
}

export function encodePict(r: Raster, p: IndexedPixels | null): Uint8Array {
  const { width: w, height: h, data } = r;
  if (w > 0x7fff || h > 0x7fff) throw new SaveError("PICT images are at most 32767 pixels each way.");
  const out = new Out().bytes(new Uint8Array(512)).be16(0);
  const rect = () => out.be16(0).be16(0).be16(h).be16(w);
  rect();
  const v1 = p?.bits === 1;
  if (v1) out.u8(0x11, 0x01);
  else {
    out.be16(0x0011).be16(0x02ff).be16(0x0c00).be16(0xffff).be16(0xffff);
    // The bounds as fixed-point numbers, PSP's order: 0, 0, width, height.
    out.be16(0).be16(0).be16(0).be16(0).be16(w).be16(0).be16(h).be16(0).be32(0);
  }
  out.be16(0x0001).be16(10);
  rect();
  if (v1) {
    const rowBytes = ((w + 15) >> 4) * 2, black = darkIndex(p!.palette);
    out.be16(0x0098).be16(rowBytes);
    rect(); rect(); rect(); out.be16(0);
    for (let y = 0; y < h; y++) pictRow(packRow(p!.indices, w, y, 1, rowBytes, (v) => (v === black ? 1 : 0)), rowBytes, out);
  } else if (p) {
    const bits = p.bits, rowBytes = (((w * bits + 7) >> 3) + 1) & ~1, n = 1 << bits;
    out.be16(0x0098).be16(rowBytes | 0x8000);
    rect();
    out.be16(0).be16(0).be32(0).be32(0x480000).be32(0x480000).be16(0).be16(bits).be16(1).be16(bits).be32(0).be32(0).be32(0);
    // The color table: seed 8, flags 0, entries with each component in the high byte.
    out.be32(8).be16(0).be16(n - 1);
    for (let i = 0; i < n; i++) out.be16(i).u8(p.palette[i * 3] ?? 0, 0, p.palette[i * 3 + 1] ?? 0, 0, p.palette[i * 3 + 2] ?? 0, 0);
    rect(); rect(); out.be16(0);
    for (let y = 0; y < h; y++) pictRow(packRow(p.indices, w, y, bits, rowBytes), rowBytes, out);
  } else {
    const rowBytes = w * 4;
    out.be16(0x009a).be32(0xff).be16(rowBytes | 0x8000);
    rect();
    out.be16(0).be16(4).be32(0).be32(0x480000).be32(0x480000).be16(16).be16(32).be16(3).be16(8).be32(0).be32(0).be32(0);
    rect(); rect(); out.be16(0);
    for (let y = 0; y < h; y++) {
      // Packing type 4: each component's row in turn (red, green, blue).
      const row = new Uint8Array(w * 3);
      for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; row[x] = data[i]; row[w + x] = data[i + 1]; row[2 * w + x] = data[i + 2]; }
      const packed = new Out();
      byteRun1(row, packed);
      const b = packed.done();
      if (rowBytes > 250) out.be16(b.length); else out.u8(b.length);
      out.bytes(b);
    }
  }
  if ((out.length - 512) & 1) out.u8(0);
  out.be16(0x00ff);
  out.set16be(512, (out.length - 512) & 0xffff);
  return out.done();
}

/* ---- WordPerfect Graphics 1 ---- */

export function encodeWpg(p: IndexedPixels, w: number, h: number, dpi: number): Uint8Array {
  if (w > 0x7fff || h > 0x7fff) throw new SaveError("WPG images are at most 32767 pixels each way.");
  const res = dpi > 0 ? Math.round(dpi) : 72;
  const units = (n: number) => Math.ceil((n * 100) / res) * 12;
  const out = new Out().u8(0xff).ascii("WPC").le32(16).u8(1, 0x16, 1, 0).le16(0).le16(0);
  out.u8(0x0f, 6, 1, 0).le16(units(w)).le16(units(h));
  const n = 1 << p.bits;
  // PSP writes the map's length word as 0x0104 for 256 colors; the true length is written here.
  out.u8(0x0e, 0xff).le16(4 + n * 3).le16(0).le16(n);
  for (let i = 0; i < n * 3; i++) out.u8(p.palette[i] ?? 0);
  out.u8(0x0b, 0xff);
  const lenAt = out.length;
  out.le16(0).le16(0);
  const start = out.length;
  out.le16(w).le16(h).le16(p.bits).le16(res).le16(res);
  const bpr = (w * p.bits + 7) >> 3;
  for (let y = 0; y < h; y++) {
    const row = packRow(p.indices, w, y, p.bits, bpr);
    const lit: number[] = [];
    const flush = () => { if (lit.length) { out.u8(lit.length).bytes(lit); lit.length = 0; } };
    let i = 0;
    while (i < bpr) {
      const v = row[i];
      let k = 1;
      while (i + k < bpr && row[i + k] === v && k < 0x7f) k++;
      if (k === 1) { lit.push(v); if (lit.length === 0x7e) flush(); }
      else { flush(); out.u8(0x80 | k, v); }
      i += k;
    }
    flush();
  }
  const len = out.length - start;
  // A long length: two words, the high one first with bit 15 set.
  out.set16le(lenAt, 0x8000 | (len >>> 16));
  out.set16le(lenAt + 2, len & 0xffff);
  out.u8(0x10, 0);
  return out.done();
}
