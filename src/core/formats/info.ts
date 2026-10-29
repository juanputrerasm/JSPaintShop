/*
  What PNG and JPEG files say about themselves. Their pixels are decoded by the browser; these
  read the headers for what the browser does not report: the color depth PSP shows for the
  image, greyscale, and the resolution.
*/
import type { ColorDepth } from "../doc/image-doc.ts";

export interface HeaderInfo { depth: ColorDepth; greyscale: boolean; dpi: number }

export function isPng(b: Uint8Array): boolean {
  return b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

export function isJpeg(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

/* IHDR's bit depth and color type, and pHYs when its unit is the meter. */
export function pngInfo(b: Uint8Array): HeaderInfo {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const bits = b[24], type = b[25];
  let dpi = 0;
  for (let at = 8; at + 12 <= b.length;) {
    const len = v.getUint32(at), kind = String.fromCharCode(b[at + 4], b[at + 5], b[at + 6], b[at + 7]);
    if (kind === "pHYs" && b[at + 16] === 1) dpi = Math.round(v.getUint32(at + 8) * 0.0254);
    if (kind === "IDAT" || kind === "IEND") break;
    at += 12 + len;
  }
  if (type === 3) return { depth: bits <= 1 ? 1 : bits <= 4 ? 4 : 8, greyscale: false, dpi };
  if (type === 0 && bits <= 8) return { depth: 8, greyscale: true, dpi };
  return { depth: 24, greyscale: false, dpi };
}

/* The JFIF density (APP0) and the number of components in the frame header (1 is greyscale). */
export function jpegInfo(b: Uint8Array): HeaderInfo {
  let dpi = 0, greyscale = false;
  for (let at = 2; at + 4 <= b.length;) {
    if (b[at] !== 0xff) break;
    const marker = b[at + 1], len = (b[at + 2] << 8) | b[at + 3];
    if (marker === 0xe0 && b[at + 4] === 0x4a && b[at + 5] === 0x46) {
      const unit = b[at + 11], x = (b[at + 12] << 8) | b[at + 13];
      dpi = unit === 1 ? x : unit === 2 ? Math.round(x * 2.54) : 0;
    }
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xcb && marker !== 0xc8)) { greyscale = b[at + 9] === 1; break; }
    if (marker === 0xda) break;
    at += 2 + len;
  }
  return { depth: greyscale ? 8 : 24, greyscale, dpi };
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A PNG with its resolution recorded: a pHYs chunk (pixels per meter) right after IHDR, replacing any. */
export function setPngDpi(b: Uint8Array, dpi: number): Uint8Array {
  if (!isPng(b) || dpi <= 0) return b;
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const v = new DataView(chunk.buffer);
  v.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);
  v.setUint32(8, ppm);
  v.setUint32(12, ppm);
  chunk[16] = 1;
  v.setUint32(17, crc32(chunk.subarray(4, 17)));
  const parts: Uint8Array[] = [b.subarray(0, 33), chunk];
  const bv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let at = 33; at + 12 <= b.length;) {
    const len = bv.getUint32(at);
    const kind = String.fromCharCode(b[at + 4], b[at + 5], b[at + 6], b[at + 7]);
    if (kind !== "pHYs") parts.push(b.subarray(at, at + 12 + len));
    at += 12 + len;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** A JPEG with its resolution recorded in the JFIF header, when it has one. */
export function setJpegDpi(b: Uint8Array, dpi: number): Uint8Array {
  if (!isJpeg(b) || dpi <= 0 || b[3] !== 0xe0 || b[6] !== 0x4a || b[7] !== 0x46) return b;
  const out = b.slice();
  out[13] = 1;
  out[14] = dpi >> 8; out[15] = dpi & 255;
  out[16] = dpi >> 8; out[17] = dpi & 255;
  return out;
}
