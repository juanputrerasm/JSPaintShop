/*
  Adobe Photoshop (.psd), PSP 6's "PSD - Photoshop": layers as PSP keeps them.

  Reading: version 1 files in Bitmap, Greyscale, Indexed, RGB or CMYK at 8 bits (16 bits
  reduced to 8); the resolution; the layers (position, opacity, blend mode, visibility,
  transparency, layer mask) when there are any, else the merged image; raw or RLE channels,
  and (an addition: later Photoshops write them, PSP 6 does not read them) ZIP layer channels
  with or without prediction.
  Writing: RGB at 8 bits with every raster layer (vector and adjustment layers as their
  pixels), masks, and the merged image, all RLE.
*/
import type { Raster } from "../image/raster.ts";
import { createRaster } from "../image/raster.ts";
import { emptyCreator, rasterLayer, type ImageDoc, type Layer } from "../doc/image-doc.ts";

export class PsdError extends Error {}
const fail = (m: string): never => { throw new PsdError(`PSD: ${m}`); };

export function isPsd(b: Uint8Array): boolean {
  return b.length >= 26 && b[0] === 0x38 && b[1] === 0x42 && b[2] === 0x50 && b[3] === 0x53 && b[4] === 0 && b[5] === 1;
}

/* Photoshop's blend keys in PSP's BLEND_MODES order. */
export const PSD_BLEND = ["norm", "dark", "lite", "hue ", "sat ", "colr", "lum ", "mul ", "scrn", "diss", "over", "hLit", "sLit", "diff", "div ", "idiv", "smud"];

class R {
  b: Uint8Array; at: number;
  constructor(b: Uint8Array, at = 0) { this.b = b; this.at = at; }
  u8() { return this.b[this.at++]; }
  u16() { const v = (this.b[this.at] << 8) | this.b[this.at + 1]; this.at += 2; return v; }
  i16() { return (this.u16() << 16) >> 16; }
  u32() { const v = ((this.b[this.at] << 24) | (this.b[this.at + 1] << 16) | (this.b[this.at + 2] << 8) | this.b[this.at + 3]) >>> 0; this.at += 4; return v; }
  i32() { return this.u32() | 0; }
  str(n: number) { const s = String.fromCharCode(...this.b.subarray(this.at, this.at + n)); this.at += n; return s; }
}

/* Undo ZIP prediction: running sums along each row, of bytes (8 bits) or big-endian words (16). */
function unpredict(raw: Uint8Array, width: number, height: number, depth: number): void {
  if (depth === 16) {
    for (let y = 0; y < height; y++) for (let x = 1; x < width; x++) {
      const i = (y * width + x) * 2, v = (((raw[i - 2] << 8) | raw[i - 1]) + ((raw[i] << 8) | raw[i + 1])) & 0xffff;
      raw[i] = v >> 8; raw[i + 1] = v & 0xff;
    }
  } else if (depth === 8) {
    for (let y = 0; y < height; y++) for (let x = 1; x < width; x++) raw[y * width + x] = (raw[y * width + x] + raw[y * width + x - 1]) & 0xff;
  }
}

/* One channel's rows: raw or PackBits with a row length table (`rows` rows of `width` samples). */
function readChannel(r: R, width: number, height: number, depth: number, compression: number, counts?: number[]): Uint8Array {
  const bpr = depth === 16 ? width * 2 : depth === 1 ? Math.ceil(width / 8) : width;
  const out = new Uint8Array(bpr * height);
  if (compression === 0) { out.set(r.b.subarray(r.at, r.at + out.length)); r.at += out.length; }
  else if (compression === 1) {
    const lens = counts ?? Array.from({ length: height }, () => r.u16());
    let o = 0;
    for (let y = 0; y < height; y++) {
      const end = r.at + lens[y], rowEnd = (y + 1) * bpr;
      let row = y * bpr;
      // A malformed row stops at its own end instead of spilling into the next.
      while (r.at < end) {
        const n = (r.u8() << 24) >> 24;
        if (n >= 0) { for (let k = 0; k <= n; k++) { const v = r.u8(); if (row < rowEnd) out[row++] = v; } }
        else if (n !== -128) { const v = r.u8(); for (let k = 0; k < 1 - n && row < rowEnd; k++) out[row++] = v; }
      }
      r.at = end;
      o = row;
    }
    void o;
  } else fail("ZIP-compressed channels are not supported");
  // 16 bits: keep the high byte; bitmap: expand to 0/255 (1 is black).
  if (depth === 16) { const e = new Uint8Array(width * height); for (let i = 0; i < e.length; i++) e[i] = out[i * 2]; return e; }
  if (depth === 1) {
    const e = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) e[y * width + x] = (out[y * bpr + (x >> 3)] >> (7 - (x & 7))) & 1 ? 0 : 255;
    return e;
  }
  return out;
}

const toRgb = (mode: number, ch: (k: number) => number, palette: Uint8Array | null): [number, number, number] => {
  if (mode === 3) return [ch(0), ch(1), ch(2)];
  if (mode === 4) { const k = 255 - ch(3); return [((255 - (255 - ch(0))) * (255 - k)) / 255, ((255 - (255 - ch(1))) * (255 - k)) / 255, ((255 - (255 - ch(2))) * (255 - k)) / 255]; }
  if (mode === 2 && palette) { const i = ch(0); return [palette[i], palette[256 + i], palette[512 + i]]; }
  const v = ch(0);
  return [v, v, v];
};

export async function readPsd(b: Uint8Array, inflate?: (bytes: Uint8Array) => Promise<Uint8Array>): Promise<{ doc: ImageDoc; warnings: string[] }> {
  if (!isPsd(b)) fail("not a Photoshop file");
  const r = new R(b, 12);
  const channels = r.u16(), height = r.u32(), width = r.u32(), depth = r.u16(), mode = r.u16();
  if (![1, 8, 16].includes(depth)) fail(`${depth}-bit images are not supported`);
  if (![0, 1, 2, 3, 4, 8].includes(mode)) fail("this color mode is not supported");
  const warnings: string[] = [];
  const cmLen = r.u32();
  const palette = mode === 2 && cmLen >= 768 ? b.slice(r.at, r.at + 768) : null;
  r.at += cmLen;
  // Image resources: the resolution (0x03ED).
  const resLen = r.u32(), resEnd = r.at + resLen;
  let dpi = 72;
  while (r.at + 12 <= resEnd) {
    if (r.str(4) !== "8BIM") break;
    const id = r.u16(), nameLen = r.u8();
    r.at += nameLen + ((nameLen + 1) & 1);
    const size = r.u32(), next = r.at + size + (size & 1);
    if (id === 0x03ed) dpi = Math.round(r.u32() / 65536);
    r.at = next;
  }
  r.at = resEnd;
  // Layers.
  const lmLen = r.u32(), lmEnd = r.at + lmLen;
  const layers: Layer[] = [];
  const colorCh = mode === 3 ? 3 : mode === 4 ? 4 : 1;
  if (lmLen > 0) {
    const liLen = r.u32(), liEnd = r.at + liLen;
    if (liLen > 0) {
      const count = Math.abs(r.i16());
      const recs: { top: number; left: number; w: number; h: number; ch: [number, number][]; blend: string; opacity: number; flags: number; name: string; mask: { top: number; left: number; w: number; h: number; def: number; flags: number } | null }[] = [];
      for (let k = 0; k < count; k++) {
        const top = r.i32(), left = r.i32(), bottom = r.i32(), right = r.i32();
        const nch = r.u16(), ch: [number, number][] = [];
        for (let c = 0; c < nch; c++) ch.push([r.i16(), r.u32()]);
        r.str(4);
        const blend = r.str(4), opacity = r.u8();
        r.u8();
        const flags = r.u8();
        r.u8();
        const extraLen = r.u32(), extraEnd = r.at + extraLen;
        const mLen = r.u32();
        let mask = null;
        if (mLen >= 20) {
          const mt = r.i32(), ml = r.i32(), mb = r.i32(), mr = r.i32(), def = r.u8(), mf = r.u8();
          mask = { top: mt, left: ml, w: mr - ml, h: mb - mt, def, flags: mf };
          r.at += mLen - 18;
        } else r.at += mLen;
        const ranges = r.u32();
        r.at += ranges;
        const nl = r.u8();
        const name = new TextDecoder("latin1").decode(b.subarray(r.at, r.at + nl));
        r.at = extraEnd;
        recs.push({ top, left, w: right - left, h: bottom - top, ch, blend, opacity, flags, name, mask });
      }
      for (const rec of recs) {
        const ras = createRaster(Math.max(1, rec.w), Math.max(1, rec.h));
        const planes = new Map<number, Uint8Array>();
        for (const [id, len] of rec.ch) {
          const end = r.at + len, comp = r.u16();
          const isMask = id === -2, w = isMask ? rec.mask?.w ?? 0 : rec.w, h = isMask ? rec.mask?.h ?? 0 : rec.h;
          if (w > 0 && h > 0) {
            if ((comp === 2 || comp === 3) && inflate) {
              // ZIP: one zlib stream; with prediction (3) each row holds differences from the left.
              const raw = await inflate(b.subarray(r.at, end));
              if (comp === 3) unpredict(raw, w, h, depth);
              planes.set(id, readChannel(new R(raw), w, h, depth, 0));
            } else planes.set(id, readChannel(r, w, h, depth, comp));
          }
          r.at = end;
        }
        const d = ras.data;
        for (let i = 0; i < rec.w * rec.h; i++) {
          const [cr, cg, cb] = toRgb(mode, (k) => planes.get(k)?.[i] ?? 0, palette);
          d[i * 4] = cr; d[i * 4 + 1] = cg; d[i * 4 + 2] = cb;
          d[i * 4 + 3] = planes.get(-1)?.[i] ?? 255;
        }
        const layer = rasterLayer(rec.name || `Layer${layers.length + 1}`, ras, rec.left, rec.top);
        layer.opacity = rec.opacity;
        layer.visible = !(rec.flags & 2);
        layer.lockTransparency = Boolean(rec.flags & 1);
        const bi = PSD_BLEND.indexOf(rec.blend);
        if (bi < 0) warnings.push(`Layer "${layer.name}": the blend mode "${rec.blend.trim()}" has no PSP counterpart; Normal is used.`);
        layer.blend = Math.max(0, bi);
        const m = planes.get(-2);
        if (m && rec.mask) {
          // The layer mask, canvas-sized: the default color outside its rectangle.
          const full = { width, height, data: new Uint8Array(width * height).fill(rec.mask.def) };
          for (let y = 0; y < rec.mask.h; y++) for (let x = 0; x < rec.mask.w; x++) {
            const cx = rec.mask.left + x, cy = rec.mask.top + y;
            if (cx >= 0 && cy >= 0 && cx < width && cy < height) full.data[cy * width + cx] = m[y * rec.mask.w + x];
          }
          layer.mask = full;
          layer.maskEnabled = !(rec.mask.flags & 2);
        }
        layers.push(layer);
      }
    }
    r.at = liEnd;
  }
  r.at = lmEnd;
  if (!layers.length) {
    // The merged image: planar, one compression for all channels, RLE counts first.
    const comp = r.u16();
    const counts = comp === 1 ? Array.from({ length: channels * height }, () => r.u16()) : undefined;
    const planes: Uint8Array[] = [];
    for (let c = 0; c < channels; c++) planes.push(readChannel(r, width, height, depth, comp, counts?.slice(c * height, c * height + height)));
    const ras = createRaster(width, height);
    for (let i = 0; i < width * height; i++) {
      const [cr, cg, cb] = toRgb(mode, (k) => planes[k]?.[i] ?? 0, palette);
      ras.data[i * 4] = cr; ras.data[i * 4 + 1] = cg; ras.data[i * 4 + 2] = cb;
      ras.data[i * 4 + 3] = channels > colorCh && mode !== 2 ? planes[colorCh][i] : 255;
    }
    layers.push(rasterLayer("Background", ras));
  }
  const paletteRgb = palette ? Uint8Array.from({ length: 768 }, (_, i) => palette[(i % 3) * 256 + Math.floor(i / 3)]) : null;
  const doc: ImageDoc = {
    width, height, dpi, depth: mode === 0 ? 1 : mode === 1 || mode === 8 || mode === 2 ? 8 : 24, greyscale: mode === 1 || mode === 8,
    palette: mode === 2 ? paletteRgb : mode === 1 || mode === 8 ? Uint8Array.from({ length: 768 }, (_, i) => Math.floor(i / 3)) : mode === 0 ? Uint8Array.from([0, 0, 0, 255, 255, 255]) : null,
    layers, active: layers.length - 1, creator: emptyCreator(), selection: null, alphas: [],
  };
  if (mode === 0 || mode === 1 || mode === 2 || mode === 8) {
    // PSP keeps paletted and greyscale images single-layered.
    if (layers.length > 1) { doc.depth = 24; doc.greyscale = false; doc.palette = null; }
  }
  return { doc, warnings };
}

/* PackBits one row. */
function packRow(row: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < row.length;) {
    let run = 1;
    while (i + run < row.length && run < 128 && row[i + run] === row[i]) run++;
    if (run >= 3) { out.push(257 - run, row[i]); i += run; continue; }
    let lit = 1;
    while (i + lit < row.length && lit < 128 && !(i + lit + 2 < row.length && row[i + lit] === row[i + lit + 1] && row[i + lit] === row[i + lit + 2])) lit++;
    out.push(lit - 1, ...row.subarray(i, i + lit));
    i += lit;
  }
  return out;
}

/* A channel as RLE: [compression 1][row lengths][rows], or rows and lengths for the merged image. */
function rle(plane: Uint8Array, w: number, h: number): { lens: number[]; data: number[] } {
  const lens: number[] = [], data: number[] = [];
  for (let y = 0; y < h; y++) { const p = packRow(plane.subarray(y * w, y * w + w)); lens.push(p.length); for (const v of p) data.push(v); }
  return { lens, data };
}

/** RGB, 8 bits, every layer with its mask, and the merged image. */
export function writePsd(doc: ImageDoc, merged: Raster): Uint8Array {
  const out: number[] = [];
  const u8 = (v: number) => out.push(v & 255);
  const u16 = (v: number) => out.push((v >> 8) & 255, v & 255);
  const u32 = (v: number) => out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  const str = (s: string) => { for (const c of s) out.push(c.charCodeAt(0) & 255); };
  const patch32 = (at: number, v: number) => { out[at] = (v >>> 24) & 255; out[at + 1] = (v >>> 16) & 255; out[at + 2] = (v >>> 8) & 255; out[at + 3] = v & 255; };
  const { width: W, height: H } = doc;
  str("8BPS"); u16(1); for (let i = 0; i < 6; i++) u8(0);
  u16(4); u32(H); u32(W); u16(8); u16(3);
  u32(0);
  // Resolution info.
  u32(28); str("8BIM"); u16(0x03ed); u16(0); u32(16);
  u32(doc.dpi * 65536); u16(1); u16(2); u32(doc.dpi * 65536); u16(1); u16(2);
  // Layer and mask information.
  const lmAt = out.length; u32(0);
  const liAt = out.length; u32(0);
  const layers = doc.layers.filter((l) => l.kind !== "adjustment" && l.kind !== "floating");
  u16(layers.length);
  const channelData: number[][] = [];
  for (const l of layers) {
    const { width: w, height: h, data } = l.raster;
    u32(l.y); u32(l.x); u32(l.y + h); u32(l.x + w);
    const planes = [-1, 0, 1, 2].map((id) => { const p = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) p[i] = data[i * 4 + (id < 0 ? 3 : id)]; return { id, p, w, h }; });
    if (l.mask) planes.push({ id: -2, p: l.mask.data, w: W, h: H });
    u16(planes.length);
    const encoded = planes.map(({ id, p, w: pw, h: ph }) => {
      const e = rle(p, pw, ph), bytes = [0, 1];
      for (const len of e.lens) bytes.push((len >> 8) & 255, len & 255);
      for (const v of e.data) bytes.push(v);
      channelData.push(bytes);
      return { id, len: bytes.length };
    });
    for (const { id, len } of encoded) { u16(id & 0xffff); u32(len); }
    str("8BIM"); str(PSD_BLEND[l.blend] ?? "norm"); u8(l.opacity); u8(0); u8((l.visible ? 0 : 2) | (l.lockTransparency ? 1 : 0)); u8(0);
    const extraAt = out.length; u32(0);
    if (l.mask) { u32(20); u32(0); u32(0); u32(H); u32(W); u8(0); u8(l.maskEnabled ? 0 : 2); u16(0); }
    else u32(0);
    u32(0);
    const name = l.name.slice(0, 255), padded = (name.length + 1 + 3) & ~3;
    u8(name.length); str(name); for (let i = name.length + 1; i < padded; i++) u8(0);
    patch32(extraAt, out.length - extraAt - 4);
  }
  for (const c of channelData) for (const v of c) out.push(v);
  if ((out.length - liAt - 4) & 1) u8(0);
  patch32(liAt, out.length - liAt - 4);
  u32(0);
  patch32(lmAt, out.length - lmAt - 4);
  // The merged image: RLE, R G B A planes.
  u16(1);
  const merges = [0, 1, 2, 3].map((c) => { const p = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) p[i] = merged.data[i * 4 + c]; return rle(p, W, H); });
  for (const m of merges) for (const len of m.lens) u16(len);
  for (const m of merges) for (const v of m.data) out.push(v);
  return Uint8Array.from(out);
}
