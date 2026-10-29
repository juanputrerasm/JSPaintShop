/*
  Writing PSP image files as PSP 6 does: file version 4.0, LZ77 (zlib) compression.

    IMAGE        size, resolution, compression, bit depth, layer count
    CREATOR      title, dates, artist, copyright, description
    COLOR        the palette, for paletted and greyscale images
    LAYER_START  one LAYER block per layer, bottom first, each with its CHANNEL blocks:
                 red, green and blue (or one index channel for paletted images), the
                 transparency mask, and the layer mask when there is one
    SELECTION    the selection, when there is one
    ALPHA_BANK   the alpha channels, each an ALPHA_CHANNEL block with its name

  The layer header copies the bytes PSP 6 writes in its own stock frames for the fields
  JSPaintShop does not use (blend ranges). The channel's "uncompressed length" field holds
  what PSP 6 puts there: the size of the same channel as a Windows DIB.

  Vector and adjustment layers have no pixels of their own to save here; their objects and
  settings go in a block of JSPaintShop's own (EXTENSION_BLOCK), which other readers skip, and
  the layer itself is saved with what it shows.
*/
import type { ImageDoc, Layer } from "../doc/image-doc.ts";
import { PSP_SIGNATURE } from "./psp.ts";
import { toPalette } from "../color/quantize.ts";

type Deflate = (bytes: Uint8Array) => Promise<Uint8Array>;

/** JSPaintShop's own block: JSON with what PSP 6's blocks cannot hold. */
export const EXTENSION_BLOCK = 0x4a53;

class Out {
  parts: Uint8Array[] = [];
  length = 0;
  push(b: Uint8Array): void { this.parts.push(b); this.length += b.length; }
  u8(v: number): void { this.push(Uint8Array.of(v & 255)); }
  u16(v: number): void { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); this.push(b); }
  u32(v: number): void { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); this.push(b); }
  i32(v: number): void { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v, true); this.push(b); }
  f64(v: number): void { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); this.push(b); }
  latin1(s: string): void { this.push(Uint8Array.from([...s].map((c) => Math.min(255, c.charCodeAt(0))))); }
  rect(l: number, t: number, r: number, b: number): void { this.i32(l); this.i32(t); this.i32(r); this.i32(b); }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.length; }
    return out;
  }
}

/* A block: "~BK\0", id, total length (version 4), then the data. */
function block(id: number, data: Uint8Array): Uint8Array {
  const o = new Out();
  o.latin1("~BK\0");
  o.u16(id);
  o.u32(data.length);
  o.push(data);
  return o.bytes();
}

function dibSize(w: number, h: number, bits: number): number {
  return 40 + (bits <= 8 ? 1024 : 0) + Math.ceil((w * bits) / 32) * 4 * h;
}

async function channel(deflate: Deflate, data: Uint8Array, w: number, h: number, bitmapType: number, channelType: number, bits: number): Promise<Uint8Array> {
  const packed = await deflate(data);
  const o = new Out();
  o.u32(16);
  o.u32(packed.length);
  o.u32(dibSize(w, h, bits));
  o.u16(bitmapType);
  o.u16(channelType);
  o.push(packed);
  return block(5, o.bytes());
}

async function layerBlock(doc: ImageDoc, layer: Layer, deflate: Deflate, palette: Uint8Array | null): Promise<Uint8Array> {
  const { width: w, height: h } = doc;
  const n = w * h, d = layer.raster.data;
  const o = new Out();
  const name = layer.name.slice(0, 255);
  o.u32(4 + 2 + name.length + 115);
  o.u16(name.length);
  o.latin1(name);
  o.u8(1); // raster
  o.rect(0, 0, w, h);
  o.rect(0, 0, w, h);
  o.u8(layer.opacity);
  o.u8(layer.blend);
  o.u8(layer.visible ? 1 : 0);
  o.u8(layer.lockTransparency ? 1 : 0);
  o.u8(layer.group);
  if (layer.mask) { o.rect(0, 0, w, h); o.rect(0, 0, w, h); } else { o.rect(0, 0, 0, 0); o.rect(0, 0, 0, 0); }
  o.u8(1); // mask linked
  o.u8(layer.mask && !layer.maskEnabled ? 1 : 0);
  o.u8(0);
  o.u16(0);
  for (let i = 0; i < 10; i++) o.push(Uint8Array.of(0, 0, 255, 255));
  const channels: Uint8Array[] = [];
  const plane = (k: number) => { const p = new Uint8Array(n); for (let i = 0; i < n; i++) p[i] = d[i * 4 + k]; return p; };
  if (palette) {
    const idx = toPalette(layer.raster, palette, doc.indices).indices;
    channels.push(await channel(deflate, idx, w, h, 0, 0, 8));
  } else {
    for (let k = 0; k < 3; k++) channels.push(await channel(deflate, plane(k), w, h, 0, k + 1, 24));
  }
  channels.push(await channel(deflate, plane(3), w, h, 1, 0, 8));
  if (layer.mask) channels.push(await channel(deflate, layer.mask.data, w, h, 2, 0, 8));
  o.u32(8);
  o.u16(layer.mask ? 3 : 2);
  o.u16(channels.length);
  for (const c of channels) o.push(c);
  return block(4, o.bytes());
}

function creatorBlock(doc: ImageDoc): Uint8Array {
  const o = new Out();
  const field = (id: number, data: Uint8Array) => { o.latin1("~FL\0"); o.u16(id); o.u32(data.length); o.push(data); };
  const text = (s: string) => Uint8Array.from([...s].map((c) => Math.min(255, c.charCodeAt(0))));
  const u32 = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return b; };
  const c = doc.creator;
  field(0, text(c.title));
  field(1, u32(c.created));
  field(2, u32(c.modified));
  field(3, text(c.artist));
  field(4, text(c.copyright));
  field(5, text(c.description));
  field(6, u32(0));
  field(7, u32(0));
  return block(1, o.bytes());
}

/** The Picture Tube block (id 11), PSP 6 style: chunk length, version, name (513 bytes), the six fields (modes 1-based). */
export interface TubeBlock { name: string; step: number; across: number; down: number; count: number; placement: number; selection: number }

function tubeBlock(t: TubeBlock): Uint8Array {
  const o = new Out();
  o.u32(4 + 2 + 513 + 24);
  o.u16(0);
  const name = new Uint8Array(513);
  for (let i = 0; i < Math.min(512, t.name.length); i++) name[i] = t.name.charCodeAt(i) & 0xff;
  o.push(name);
  for (const v of [t.step, t.across, t.down, t.count, t.placement + 1, t.selection + 1]) o.i32(v);
  return block(11, o.bytes());
}

export async function writePsp(doc: ImageDoc, deflate: Deflate, now = Math.floor(Date.now() / 1000), tube?: TubeBlock): Promise<Uint8Array> {
  const paletted = doc.depth <= 8 && (doc.greyscale || doc.palette);
  const palette = paletted ? (doc.greyscale ? Uint8Array.from({ length: 768 }, (_, i) => Math.floor(i / 3)) : doc.palette!) : null;
  const out = new Out();
  const header = new Uint8Array(32);
  header.set([...PSP_SIGNATURE].map((c) => c.charCodeAt(0)));
  out.push(header);
  out.u16(4);
  out.u16(0);

  const img = new Out();
  img.u32(46);
  img.i32(doc.width);
  img.i32(doc.height);
  img.f64(doc.dpi);
  img.u8(1);
  img.u16(2);
  img.u16(palette ? 8 : 24);
  img.u16(1);
  img.u32(palette ? palette.length / 3 : 1 << 24);
  img.u8(doc.greyscale ? 1 : 0);
  img.u32(doc.width * doc.height * (palette ? 1 : 3));
  img.i32(doc.active);
  img.u16(doc.layers.length);
  img.u32(1);
  out.push(block(0, img.bytes()));
  out.push(creatorBlock({ ...doc, creator: { ...doc.creator, modified: now, created: doc.creator.created || now } }));
  if (tube) out.push(tubeBlock(tube));
  if (palette) {
    const c = new Out();
    c.u32(8);
    c.u32(palette.length / 3);
    for (let i = 0; i < palette.length / 3; i++) c.push(Uint8Array.of(palette[i * 3 + 2], palette[i * 3 + 1], palette[i * 3], 0));
    out.push(block(2, c.bytes()));
  }
  const layers = new Out();
  for (const l of doc.layers) layers.push(await layerBlock(doc, l, deflate, palette));
  out.push(block(3, layers.bytes()));

  // The selection and the alpha channels, whole-canvas rectangles.
  if (doc.selection) {
    const o = new Out();
    o.u32(4 + 32);
    o.rect(0, 0, doc.width, doc.height);
    o.rect(0, 0, doc.width, doc.height);
    o.u32(8); o.u16(1); o.u16(1);
    o.push(await channel(deflate, doc.selection.data, doc.width, doc.height, 3, 0, 8));
    out.push(block(6, o.bytes()));
  }
  if (doc.alphas.length) {
    const o = new Out();
    o.u32(6);
    o.u16(doc.alphas.length);
    for (const a of doc.alphas) {
      const c = new Out(), name = a.name.slice(0, 255);
      c.u32(4 + 2 + name.length + 32);
      c.u16(name.length);
      c.latin1(name);
      c.rect(0, 0, doc.width, doc.height);
      c.rect(0, 0, doc.width, doc.height);
      c.u32(8); c.u16(1); c.u16(1);
      c.push(await channel(deflate, a.mask.data, doc.width, doc.height, 4, 0, 8));
      o.push(block(8, c.bytes()));
    }
    out.push(block(7, o.bytes()));
  }

  const extra = doc.layers.map((l, i) => (l.kind === "raster" ? null : { index: i, kind: l.kind, objects: l.objects, adjustment: l.adjustment })).filter(Boolean);
  if (extra.length) out.push(block(EXTENSION_BLOCK, new TextEncoder().encode(JSON.stringify({ layers: extra }, (_k, v) => (v instanceof Uint8Array ? { u8: [...v] } : v)))));
  return out.bytes();
}
