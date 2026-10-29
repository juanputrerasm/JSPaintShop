/*
  PSP image files (.psp), and the stock files PSP 6 stores in the same format:
  Picture Tubes (.tub) and Picture Frames (.pfr). Read only here; writing comes with layers.

  The layout follows the published PSP file format description and was checked against
  PSP 6's own stock files: file version 3 (PSP 5, the tubes) and 4 (PSP 6, the frames).

    header      "Paint Shop Pro Image File\n\x1a" padded to 32 bytes, then major and minor version
    blocks      "~BK\0", block id (u16), then
                  version 3:  initial data length (u32), total length (u32)
                  version 4+: total length (u32); the data then opens with its own chunk length
    0 IMAGE     width, height, resolution (f64), resolution unit, compression (0 none, 1 RLE,
                2 LZ77 = zlib), bit depth, planes, color count, greyscale, image size, active
                layer, layer count
    1 CREATOR   "~FL\0" fields: 0 title, 1 created, 2 modified, 3 artist, 4 copyright, 5 description
    2 COLOR     the palette, as BGRA entries
    3 LAYER_START, holding a LAYER block per layer (bottom first), each holding CHANNEL blocks
    5 CHANNEL   compressed length, uncompressed length, bitmap type (0 image, 1 transparency
                mask, 2 user mask...), channel type (0 index or grey, 1 red, 2 green, 3 blue),
                then the channel: one byte per pixel of the layer's saved rectangle, no row padding

    6 SELECTION the saved selection: selection rectangle, saved rectangle, then a CHANNEL
    7 ALPHA_BANK the alpha channel count, then an ALPHA_CHANNEL (8) block per channel: name,
                image rectangle, saved rectangle, a bitmap chunk (1 bitmap, 1 channel), then a
                CHANNEL (PSP 6's stock frames have one, "Selection #0")

  Layer masks are CHANNEL blocks of bitmap type 2 in the layer. PSP 6's vector and adjustment
  layers carry a VECTOR_EXTENSION or ADJUSTMENT_EXTENSION block between the layer chunk and the
  bitmap chunk (psp-native.ts, docs/PSP_EXE_ANALYSIS.md section 19).
*/
import { createRaster, type Raster } from "../image/raster.ts";
import { emptyCreator, normalizeLayers, rasterLayer, type ColorDepth, type Creator, type ImageDoc, type Layer } from "../doc/image-doc.ts";
import { createMask } from "../image/raster.ts";
import { EXTENSION_BLOCK } from "./psp-write.ts";
import { NATIVE_BLOCK, readAdjustmentExtension, readVectorExtension } from "./psp-native.ts";
import type { Mask } from "../image/raster.ts";

export const PSP_SIGNATURE = "Paint Shop Pro Image File\n\x1a";

export function isPsp(b: Uint8Array): boolean {
  if (b.length < 36) return false;
  for (let i = 0; i < PSP_SIGNATURE.length; i++) if (b[i] !== PSP_SIGNATURE.charCodeAt(i)) return false;
  return true;
}

/** The Picture Tube block (id 11): fields as Psp.exe 0x7ba250 reads them, modes 0-based. */
export interface TubeInfo { name: string; step: number; across: number; down: number; count: number; placement: number; selection: number }

export interface PspRead { doc: ImageDoc; version: [number, number]; warnings: string[]; tube?: TubeInfo }

type Inflate = (bytes: Uint8Array) => Promise<Uint8Array>;

const BLOCK = { IMAGE: 0, CREATOR: 1, COLOR: 2, LAYER_START: 3, LAYER: 4, CHANNEL: 5, SELECTION: 6, ALPHA_BANK: 7, ALPHA_CHANNEL: 8, TUBE: 11 } as const;

interface Block { id: number; data: number; init: number; end: number }

class Reader {
  readonly b: Uint8Array;
  readonly v: DataView;
  readonly major: number;
  constructor(b: Uint8Array) {
    this.b = b;
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    this.major = this.v.getUint16(32, true);
  }
  u8(at: number) { return this.b[at]; }
  u16(at: number) { return this.v.getUint16(at, true); }
  u32(at: number) { return this.v.getUint32(at, true); }
  i32(at: number) { return this.v.getInt32(at, true); }
  f64(at: number) { return this.v.getFloat64(at, true); }
  latin1(at: number, n: number) {
    let s = "";
    for (let i = 0; i < n && this.b[at + i]; i++) s += String.fromCharCode(this.b[at + i]);
    return s;
  }
  /** The blocks between `at` and `end`. */
  *blocks(at: number, end: number): Generator<Block> {
    const v3 = this.major <= 3;
    while (at + 10 <= end) {
      if (this.u32(at) !== 0x004b427e) throw new Error(`Not a readable PSP file: no block marker at byte ${at}.`);
      const id = this.u16(at + 4);
      const init = v3 ? this.u32(at + 6) : 0;
      const total = this.u32(at + (v3 ? 10 : 6));
      const data = at + (v3 ? 14 : 10);
      if (data + total > end) throw new Error("Not a readable PSP file: a block runs past the end.");
      yield { id, data, init, end: data + total };
      at = data + total;
    }
  }
  /** Where a block's own fields start, past the chunk length versions 4+ put first. */
  fields(blk: Block): number {
    return this.major <= 3 ? blk.data : blk.data + 4;
  }
  rect(at: number) {
    return { left: this.i32(at), top: this.i32(at + 4), right: this.i32(at + 8), bottom: this.i32(at + 12) };
  }
}

export async function readPsp(bytes: Uint8Array, inflate: Inflate): Promise<PspRead> {
  if (!isPsp(bytes)) throw new Error("Not a PSP file: the signature is missing.");
  const r = new Reader(bytes);
  if (r.major < 3) throw new Error(`PSP file version ${r.major} is older than PSP 5; it cannot be read yet.`);
  const warnings: string[] = [];
  let info: { width: number; height: number; dpi: number; compression: number; depth: number; greyscale: boolean; active: number } | null = null;
  let palette: Uint8Array | null = null;
  let creator: Creator = emptyCreator();
  const layers: Layer[] = [];
  let extension: string | null = null;
  let tube: TubeInfo | undefined;
  let selection: Mask | null = null;
  const alphas: { name: string; mask: Mask }[] = [];

  for (const blk of r.blocks(36, bytes.length)) {
    if (blk.id === BLOCK.IMAGE) {
      const p = r.fields(blk);
      const res = r.f64(p + 8), unit = r.u8(p + 16);
      info = {
        width: r.i32(p), height: r.i32(p + 4),
        dpi: Math.round(unit === 2 ? res * 2.54 : res) || 72,
        compression: r.u16(p + 17), depth: r.u16(p + 19), greyscale: r.u8(p + 27) !== 0, active: r.i32(p + 32),
      };
      if (info.compression > 2) throw new Error(`This PSP file uses compression ${info.compression}, which cannot be read yet.`);
    } else if (blk.id === BLOCK.CREATOR) {
      creator = readCreator(r, blk);
    } else if (blk.id === BLOCK.COLOR) {
      const count = r.u32(r.fields(blk));
      const at = r.major <= 3 ? blk.data + blk.init : blk.data + r.u32(blk.data);
      palette = new Uint8Array(count * 3);
      for (let i = 0; i < count; i++) { palette[i * 3] = r.u8(at + i * 4 + 2); palette[i * 3 + 1] = r.u8(at + i * 4 + 1); palette[i * 3 + 2] = r.u8(at + i * 4); }
    } else if (blk.id === BLOCK.LAYER_START) {
      if (!info) throw new Error("Not a readable PSP file: the layers come before the image block.");
      for (const lb of r.blocks(blk.data, blk.end)) {
        if (lb.id !== BLOCK.LAYER) continue;
        layers.push(await readLayer(r, lb, info, palette, inflate, warnings));
      }
    } else if (blk.id === EXTENSION_BLOCK) {
      extension = new TextDecoder().decode(bytes.subarray(blk.data, blk.end));
    } else if (blk.id === BLOCK.TUBE) {
      // A 16-bit version, the name (513 bytes), then step, cells across, cells down, cell count,
      // placement mode and selection mode (32-bit; the modes 1-based in the file).
      const p = r.fields(blk) + 2;
      tube = {
        name: r.latin1(p, 513), step: r.i32(p + 513), across: r.i32(p + 517), down: r.i32(p + 521),
        count: r.i32(p + 525), placement: r.i32(p + 529) - 1, selection: r.i32(p + 533) - 1,
      };
    } else if (blk.id === BLOCK.SELECTION && info) {
      const f = r.fields(blk);
      selection = await readMaskChannel(r, r.rect(f + 16), blk, r.major <= 3 ? blk.data + blk.init : blk.data + r.u32(blk.data), info, inflate);
    } else if (blk.id === BLOCK.ALPHA_BANK && info) {
      // The channels are inside the bank (or, failing that, follow it).
      const inner = r.major <= 3 ? blk.data + blk.init : blk.data + r.u32(blk.data);
      for (const ab of r.blocks(inner, blk.end)) if (ab.id === BLOCK.ALPHA_CHANNEL) alphas.push(await readAlpha(r, ab, info, inflate));
    } else if (blk.id === BLOCK.ALPHA_CHANNEL && info) {
      alphas.push(await readAlpha(r, blk, info, inflate));
    }
  }
  if (!info) throw new Error("Not a readable PSP file: there is no image block.");
  if (!layers.length) layers.push(rasterLayer("Background", createRaster(info.width, info.height, [255, 255, 255, 255])));
  const depth = ([1, 4, 8, 15, 16, 24] as number[]).includes(info.depth) ? (info.depth as ColorDepth) : 24;
  if (depth <= 8 && !palette) palette = info.greyscale ? Uint8Array.from({ length: 768 }, (_, i) => Math.floor(i / 3)) : null;
  const doc: ImageDoc = {
    width: info.width, height: info.height, dpi: info.dpi, depth, greyscale: info.greyscale,
    palette: depth <= 8 ? palette : null, layers, active: Math.max(0, Math.min(layers.length - 1, info.active)), creator, selection, alphas: alphas.filter((a) => a.mask),
  };
  return { doc, version: [r.major, r.u16(34)], warnings: [...new Set(warnings)], tube };
}

function readCreator(r: Reader, blk: Block): Creator {
  const c = emptyCreator();
  // The fields start at once (PSP 6's own frames have no chunk length here); allow for one.
  let at = blk.data;
  if (r.u32(at) !== 0x004c467e && at + 4 <= blk.end) at = blk.data + r.u32(blk.data);
  while (at + 10 <= blk.end && r.u32(at) === 0x004c467e) {
    const id = r.u16(at + 4), len = r.u32(at + 6), p = at + 10;
    const text = () => r.latin1(p, len);
    if (id === 0) c.title = text();
    else if (id === 1) c.created = r.u32(p);
    else if (id === 2) c.modified = r.u32(p);
    else if (id === 3) c.artist = text();
    else if (id === 4) c.copyright = text();
    else if (id === 5) c.description = text();
    at = p + len;
  }
  return c;
}

async function readLayer(r: Reader, blk: Block, info: { width: number; height: number; compression: number; greyscale: boolean }, palette: Uint8Array | null, inflate: Inflate, warnings: string[]): Promise<Layer> {
  let p: number, name: string, channelsAt: number;
  let native: { id: number; at: number; end: number } | null = null;
  if (r.major <= 3) {
    name = r.latin1(blk.data, 256);
    p = blk.data + 256;
    channelsAt = blk.data + blk.init;
  } else {
    const n = r.u16(blk.data + 4);
    name = r.latin1(blk.data + 6, n);
    p = blk.data + 6 + n;
    let bitmapInfo = blk.data + r.u32(blk.data);
    // A vector or adjustment layer's extension block comes before the bitmap chunk.
    if (bitmapInfo + 10 <= blk.end && r.u32(bitmapInfo) === 0x004b427e) {
      const id = r.u16(bitmapInfo + 4), end = bitmapInfo + 10 + r.u32(bitmapInfo + 6);
      native = { id, at: bitmapInfo + 10, end: Math.min(end, blk.end) };
      bitmapInfo = native.end;
    }
    channelsAt = bitmapInfo + r.u32(bitmapInfo);
  }
  const type = r.u8(p);
  const saved = r.rect(p + 17);
  const opacity = r.u8(p + 33), blend = r.u8(p + 34), visible = r.u8(p + 35) !== 0, protect = r.u8(p + 36) !== 0, group = r.u8(p + 37);
  const savedMask = r.rect(p + 54);
  const maskDisabled = r.u8(p + 71) !== 0;
  const kind = r.major > 3 && type === 3 ? "vector" : r.major > 3 && type === 4 ? "adjustment" : "raster";
  let objects: Layer["objects"], adjustment: Layer["adjustment"] | null = null;
  if (kind === "vector" && native?.id === NATIVE_BLOCK.VECTOR_EXTENSION) objects = readVectorExtension(r, native.at, native.end, warnings);
  else if (kind === "adjustment" && native?.id === NATIVE_BLOCK.ADJUSTMENT_EXTENSION) adjustment = readAdjustmentExtension(r, native.at, native.end, warnings);
  if ((kind === "vector" && !objects) || (kind === "adjustment" && !adjustment)) warnings.push(`The ${kind} layer "${name}" was read as an empty raster layer: its data could not be read.`);

  const w = Math.max(0, saved.right - saved.left), h = Math.max(0, saved.bottom - saved.top);
  const raster = createRaster(Math.max(1, w), Math.max(1, h));
  const channels = new Map<string, Uint8Array>();
  for (const cb of r.blocks(channelsAt, blk.end)) {
    if (cb.id !== BLOCK.CHANNEL) continue;
    const f = r.fields(cb);
    const compressed = r.u32(f), bitmapType = r.u16(f + 8), channelType = r.u16(f + 10);
    const at = r.major <= 3 ? cb.data + cb.init : cb.data + r.u32(cb.data);
    if (bitmapType > 2) continue;
    const size = bitmapType === 2 ? Math.max(0, savedMask.right - savedMask.left) * Math.max(0, savedMask.bottom - savedMask.top) : w * h;
    const packed = r.b.subarray(at, at + compressed);
    const raw = info.compression === 2 ? await inflate(packed) : info.compression === 1 ? unRle(packed, size) : packed;
    channels.set(`${bitmapType}:${channelType}`, raw);
  }
  if (w > 0 && h > 0) fill(raster, w, h, channels, palette, info.greyscale);
  const layer = rasterLayer(name, raster, saved.left, saved.top);
  Object.assign(layer, { opacity, blend: blend <= 16 ? blend : 0, visible, lockTransparency: protect, group });
  if (objects) Object.assign(layer, { kind: "vector", objects, x: 0, y: 0 });
  else if (adjustment) Object.assign(layer, { kind: "adjustment", adjustment });
  // The layer mask, placed on the canvas; outside its rectangle the mask shows the layer.
  const m = channels.get("2:0");
  if (m) {
    const mask = createMask(info.width, info.height, 255);
    const mw = savedMask.right - savedMask.left;
    for (let y = savedMask.top; y < savedMask.bottom; y++) {
      if (y < 0 || y >= info.height) continue;
      for (let x = savedMask.left; x < savedMask.right; x++) if (x >= 0 && x < info.width) mask.data[y * info.width + x] = m[(y - savedMask.top) * mw + (x - savedMask.left)];
    }
    layer.mask = mask;
    layer.maskEnabled = !maskDisabled;
  }
  return layer;
}

/* Channels to RGBA: red, green and blue, or an index (paletted) or grey channel; alpha from the transparency mask. */
function fill(raster: Raster, w: number, h: number, ch: Map<string, Uint8Array>, palette: Uint8Array | null, greyscale: boolean): void {
  const d = raster.data, n = w * h;
  const red = ch.get("0:1"), green = ch.get("0:2"), blue = ch.get("0:3"), index = ch.get("0:0"), alpha = ch.get("1:0");
  const idx = index && index.length < n ? unpack(index, w, h) : index;
  for (let i = 0; i < n; i++) {
    if (red && green && blue) { d[i * 4] = red[i]; d[i * 4 + 1] = green[i]; d[i * 4 + 2] = blue[i]; }
    else if (idx) {
      const k = idx[i];
      if (palette && !greyscale && k * 3 + 2 < palette.length) { d[i * 4] = palette[k * 3]; d[i * 4 + 1] = palette[k * 3 + 1]; d[i * 4 + 2] = palette[k * 3 + 2]; }
      else d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = k;
    }
    d[i * 4 + 3] = alpha ? alpha[i] : 255;
  }
}

/* 1 and 4 bit channels: packed rows, the bits per pixel told by the length. */
function unpack(packed: Uint8Array, w: number, h: number): Uint8Array {
  const stride = Math.floor(packed.length / h);
  const bits = stride * 8 >= w * 4 ? 4 : 1;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const bit = x * bits;
    out[y * w + x] = (packed[y * stride + (bit >> 3)] >> (8 - bits - (bit & 7))) & ((1 << bits) - 1);
  }
  return out;
}

/* PSP's run-length coding: a count over 128 repeats the next byte (count - 128) times, else that many bytes follow as they are. */
export function unRle(src: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let i = 0, o = 0;
  while (i < src.length && o < size) {
    const n = src[i++];
    if (n > 128) { out.fill(src[i++], o, Math.min(size, o + n - 128)); o += n - 128; }
    else { out.set(src.subarray(i, i + n).subarray(0, size - o), o); i += n; o += n; }
  }
  return out;
}

/* JSPaintShop's own block: vector objects and adjustment settings for the layers that have them. */
function applyExtension(doc: ImageDoc, json: string, warnings: string[]): void {
  try {
    const data = JSON.parse(json, (_k, v) => (v && typeof v === "object" && Array.isArray(v.u8) ? Uint8Array.from(v.u8) : v)) as { layers?: { index: number; kind: Layer["kind"]; objects?: Layer["objects"]; adjustment?: Layer["adjustment"] }[] };
    for (const e of data.layers ?? []) {
      const l = doc.layers[e.index];
      if (!l) continue;
      l.kind = e.kind;
      if (e.objects) l.objects = e.objects;
      if (e.adjustment) l.adjustment = e.adjustment;
    }
    // Those layers are JSPaintShop's own now: drop the warnings about PSP's.
    for (let i = warnings.length - 1; i >= 0; i--) if (warnings[i].includes("cannot be read yet")) warnings.splice(i, 1);
  } catch {
    warnings.push("The JSPaintShop layer data in this file could not be read.");
  }
}

/* One 8-bit channel (selection or alpha) placed on the canvas from its saved rectangle. */
async function readMaskChannel(r: Reader, saved: { left: number; top: number; right: number; bottom: number }, blk: Block, inner: number, info: { width: number; height: number; compression: number }, inflate: Inflate): Promise<Mask | null> {
  const w = Math.max(0, saved.right - saved.left), h = Math.max(0, saved.bottom - saved.top);
  // Version 4 puts a bitmap chunk (bitmap and channel counts) before the CHANNEL block.
  if (r.major > 3 && inner + 4 <= blk.end && r.u32(inner) !== 0x004b427e) inner += r.u32(inner);
  for (const cb of r.blocks(inner, blk.end)) {
    if (cb.id !== BLOCK.CHANNEL) continue;
    const f = r.fields(cb), compressed = r.u32(f);
    const at = r.major <= 3 ? cb.data + cb.init : cb.data + r.u32(cb.data);
    const packed = r.b.subarray(at, at + compressed);
    const raw = info.compression === 2 ? await inflate(packed) : info.compression === 1 ? unRle(packed, w * h) : packed;
    const mask = createMask(info.width, info.height, 0);
    for (let y = 0; y < h; y++) {
      const cy = saved.top + y;
      if (cy < 0 || cy >= info.height) continue;
      for (let x = 0; x < w; x++) { const cx = saved.left + x; if (cx >= 0 && cx < info.width) mask.data[cy * info.width + cx] = raw[y * w + x] ?? 0; }
    }
    return mask;
  }
  return null;
}

async function readAlpha(r: Reader, blk: Block, info: { width: number; height: number; compression: number }, inflate: Inflate): Promise<{ name: string; mask: Mask }> {
  const f = r.fields(blk);
  const n = r.u16(f), name = r.latin1(f + 2, n), saved = r.rect(f + 2 + n + 16);
  const inner = r.major <= 3 ? blk.data + blk.init : blk.data + r.u32(blk.data);
  const mask = await readMaskChannel(r, saved, blk, inner, info, inflate);
  return { name: name || "Alpha", mask: mask ?? createMask(info.width, info.height, 0) };
}
