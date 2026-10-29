/*
  PC Paint / Pictor (.pic) (jff.dll DecodePIC 0x10048e20 and EncodePIC 0x100537e0).
  docs/PSP_EXE_ANALYSIS.md section 18.

    0   0x1234, width, height, x and y offsets (16-bit words)
    10  plane info: bits per pixel in the low nibble, planes - 1 in the high one; PSP opens
        1, 4 or 8 bits a plane making 1, 4 or 8 bits a pixel (one plane, or four 1-bit planes)
    11  0xff, then the video mode
    13  palette type (word): 3 = EGA, 16 indices into the 64 EGA colors; otherwise VGA triples
        of 6-bit values (each shifted left 2); none = black and white
    15  palette size in bytes (at most 768), then the palette
        a word: the number of run-length blocks, 0 for uncompressed rows
    Blocks: a word with the block's size (5 more than its data), a word with its unpacked size,
    the run marker, then data: a byte, or the marker, a count byte and a byte, or the marker,
    0, a 16-bit count and a byte.

  Rows are stored bottom up, each plane's rows in turn; a pixel's bit n comes from plane n.

  PSP saves 1, 4 and 8-bit images with one block per row, marker 0, runs of two or more (and
  any 0 byte) coded, a VGA palette (none for 1 bit), video mode 0x4c.
*/
import type { DecodedImage } from "./bmp.ts";

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);

export function isPcPaint(b: Uint8Array): boolean {
  return b.length >= 19 && u16(b, 0) === 0x1234 && u16(b, 2) > 0 && u16(b, 4) > 0;
}

/* The 64 EGA colors: bits 0-2 add 0xaa of blue, green, red, bits 3-5 add 0x55 (DecodePIC's table). */
export const EGA_COLORS = Uint8Array.from({ length: 192 }, (_, i) => {
  const n = Math.floor(i / 3), c = 2 - (i % 3);
  return ((n >> c) & 1) * 0xaa + ((n >> (c + 3)) & 1) * 0x55;
});

export function decodePcPaint(b: Uint8Array): DecodedImage {
  if (!isPcPaint(b)) throw new Error("Not a PC Paint file.");
  const W = u16(b, 2), H = u16(b, 4), info = b[10];
  const bits = info & 15, planes = (info >> 4) + 1, depth = bits * planes;
  if (![1, 4, 8].includes(bits) || ![1, 4, 8].includes(depth) || (planes > 1 && bits !== 1)) throw new Error(`PC Paint images with ${planes} plane(s) of ${bits} bit(s) are not supported.`);
  const type = u16(b, 13), size = u16(b, 15);
  if (size > 0x300) throw new Error("The PC Paint palette is too large.");
  let at = 17;
  const count = 1 << depth, palette = new Uint8Array(count * 3);
  if (size === 0) palette.set([0, 0, 0, 255, 255, 255]);
  else if (type === 3) for (let i = 0; i < Math.min(16, count); i++) palette.set(EGA_COLORS.subarray(b[at + i] * 3, b[at + i] * 3 + 3), i * 3);
  else for (let i = 0; i < Math.min(count, Math.floor(size / 3)); i++) for (let c = 0; c < 3; c++) palette[i * 3 + c] = (b[at + i * 3 + c] << 2) & 0xff;
  at += size;
  const blocks = u16(b, at);
  at += 2;
  const rowBytes = Math.ceil(W / (8 / bits)), total = rowBytes * H * planes;
  let packed: Uint8Array;
  if (blocks === 0) packed = b.subarray(at, at + total);
  else {
    packed = new Uint8Array(total);
    let n = 0;
    for (let k = 0; k < blocks && at + 5 <= b.length && n < total; k++) {
      const end = Math.min(b.length, at + u16(b, at)), marker = b[at + 4];
      let p = at + 5;
      while (p < end && n < total) {
        let v = b[p++], run = 1;
        if (v === marker) {
          run = b[p++];
          if (run === 0) { run = u16(b, p); p += 2; }
          v = b[p++];
        }
        for (let i = 0; i < run && n < total; i++) packed[n++] = v;
      }
      at = Math.max(end, at + 5);
    }
  }
  const indices = new Uint8Array(W * H), data = new Uint8ClampedArray(W * H * 4);
  for (let fileRow = 0; fileRow < H; fileRow++) {
    const y = H - 1 - fileRow;
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let p = 0; p < planes; p++) {
        const row = (p * H + fileRow) * rowBytes;
        if (bits === 8) v = packed[row + x] ?? 0;
        else if (bits === 4) v |= (((packed[row + (x >> 1)] ?? 0) >> (x & 1 ? 0 : 4)) & 15) << (4 * p);
        else v |= (((packed[row + (x >> 3)] ?? 0) >> (7 - (x & 7))) & 1) << p;
      }
      const i = y * W + x;
      indices[i] = v;
      data.set([palette[v * 3], palette[v * 3 + 1], palette[v * 3 + 2], 255], i * 4);
    }
  }
  return { raster: { width: W, height: H, data }, depth: depth as 1 | 4 | 8, greyscale: false, palette, dpi: 0, indices };
}

/** Save a paletted image (1, 4 or 8 bits a pixel) as PSP does. */
export function encodePcPaint(indices: Uint8Array, W: number, H: number, palette: Uint8Array, depth: 1 | 4 | 8): Uint8Array {
  if (W > 0x7fff || H > 0x7fff) throw new Error("PC Paint images are at most 32767 pixels each way.");
  const out: number[] = [];
  const w16 = (v: number) => out.push(v & 0xff, (v >> 8) & 0xff);
  const colors = depth === 1 ? 0 : Math.min(256, palette.length / 3);
  w16(0x1234); w16(W); w16(H); w16(0); w16(0);
  out.push(depth, 0xff, 0x4c);
  w16(depth === 1 ? 0 : 4); w16(colors * 3);
  for (let i = 0; i < colors * 3; i++) out.push(palette[i] >> 2);
  w16(H);
  const rowBytes = Math.ceil((W * depth) / 8), row = new Uint8Array(rowBytes);
  for (let fileRow = 0; fileRow < H; fileRow++) {
    const y = H - 1 - fileRow;
    row.fill(0);
    for (let x = 0; x < W; x++) {
      const v = indices[y * W + x];
      if (depth === 8) row[x] = v;
      else if (depth === 4) row[x >> 1] |= (v & 15) << (x & 1 ? 0 : 4);
      else row[x >> 3] |= (v & 1) << (7 - (x & 7));
    }
    const data: number[] = [];
    for (let i = 0; i < rowBytes;) {
      const v = row[i];
      let n = 1;
      while (i + n < rowBytes && row[i + n] === v) n++;
      if (n < 2 && v !== 0) data.push(v);
      else if (n < 256) data.push(0, n, v);
      else data.push(0, 0, n & 0xff, n >> 8, v);
      i += n;
    }
    if (data.length + 5 > 0x2800) throw new Error("A PC Paint row is too long to save.");
    w16(data.length + 5); w16(rowBytes); out.push(0, ...data);
  }
  return Uint8Array.from(out);
}
