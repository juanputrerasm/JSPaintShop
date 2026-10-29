/*
  PSP 6's own vector and adjustment layer data, read the way jff.dll's PSP reader does
  (DecodePSP 0x10070ab0; layers 0x100728f0, shapes 0x10073c30, paths 0x10074120, paint styles
  0x10074450, text styles 0x10074660). What each field means comes from Psp.exe's writers:
  shapes 0x6cbe50 and 0x6cbc70, text 0x783cf0, 0x791e40 and 0x49ddd0, adjustment layers
  0x428bc0. docs/PSP_EXE_ANALYSIS.md section 19.

  File version 4 only (PSP 6): every chunk opens with its own length (u32, counting itself).

  Layer block of a vector or adjustment layer: the layer chunk, then this block, then the bitmap
  chunk and the channels.

    12 ADJUSTMENT_EXTENSION   chunk {u16 type}, then chunk {the settings} (below)
    13 VECTOR_EXTENSION       chunk {u32 shape count}, then a SHAPE block per shape
    14 SHAPE                  chunk {u16 type, u32 flags (bit 0 antialias, bit 1 selected,
                              bit 2 visible), u32, u32}; type 1 text, 2 polyline, 3 and 4 the
                              other path shapes (same layout as a polyline)
    15 PAINTSTYLE             chunk {u16 style}, then chunk {COLORREF, u32} for style 1 (a color)

  Path shapes: chunk {name (u16 length + bytes), u8 stroked, u16 line width, u8 filled, u8 cap
  (0 round, 1 square, 2 flat), u8 join (0 round, 1 bevel, 2 miter), f64 miter limit}, the stroke
  PAINTSTYLE, the fill PAINTSTYLE, chunk {u32 node count}, then a chunk per node {f64 x, y,
  before-handle x, y, after-handle x, y; u8 starts a contour; u16 flags (1 smooth, 2 symmetric,
  0x20 selected, 0x80 closes its contour)}.

  Text shapes: chunk {u8, i32 x, i32 y, 3 x 3 f64 transform}, chunk {u32 element count}, then
  per element chunk {u16 kind} and chunk {data}: 1 a character (u32), 2 a character style
  (face name, u32 flags: 1 italic, 2 strikeout, 4 underline; u32 weight, u32, u32 height,
  u8, u32, u32; then the fill PAINTSTYLE), 3 a new line (u32, taken as its alignment).
*/
import type { Adjustment, LevelsChannel } from "../color/adjustments.ts";
import type { Contour, NodeType, PathNode, TextData, VectorObject, VectorStyle } from "../vector/objects.ts";
import type { Rgba } from "../image/raster.ts";

/** The byte access the PSP reader gives. */
export interface PspBytes {
  readonly b: Uint8Array;
  u8(at: number): number;
  u16(at: number): number;
  u32(at: number): number;
  i32(at: number): number;
  f64(at: number): number;
  latin1(at: number, n: number): string;
}

export const NATIVE_BLOCK = { ADJUSTMENT_EXTENSION: 12, VECTOR_EXTENSION: 13, SHAPE: 14, PAINTSTYLE: 15 } as const;
const MARKER = 0x004b427e;

/** A stream over a byte range: chunks (length first) and block headers in turn. */
class Cursor {
  readonly r: PspBytes;
  at: number;
  readonly end: number;
  constructor(r: PspBytes, at: number, end: number) { this.r = r; this.at = at; this.end = end; }
  /** The next chunk's data range [data, end), or null when it is shorter than `min` bytes. */
  chunk(min = 4): { data: number; end: number } | null {
    if (this.at + 4 > this.end) return null;
    const len = this.r.u32(this.at);
    if (len < Math.max(4, min) || this.at + len > this.end) return null;
    const c = { data: this.at + 4, end: this.at + len };
    this.at += len;
    return c;
  }
  /** The next block's id and range, the cursor moved past its header only. */
  block(): { id: number; end: number } | null {
    if (this.at + 10 > this.end || this.r.u32(this.at) !== MARKER) return null;
    const id = this.r.u16(this.at + 4), end = this.at + 10 + this.r.u32(this.at + 6);
    this.at += 10;
    return end <= this.end ? { id, end } : null;
  }
}

const name = (r: PspBytes, at: number): [string, number] => {
  const n = r.u16(at);
  return [r.latin1(at + 2, n), at + 2 + n];
};
const colorref = (v: number): Rgba => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, 255];

/** A PAINTSTYLE block: a color, or null for any other style. */
function paintStyle(c: Cursor): Rgba | null | undefined {
  const blk = c.block();
  if (!blk || blk.id !== NATIVE_BLOCK.PAINTSTYLE) return undefined;
  const inner = new Cursor(c.r, c.at, blk.end);
  const head = inner.chunk(6);
  const style = head ? c.r.u16(head.data) : 0;
  const data = inner.chunk(4);
  c.at = blk.end;
  return style === 1 && data && data.end - data.data >= 8 ? colorref(c.r.u32(data.data)) : null;
}

const NODE_TYPE = (flags: number): NodeType => (flags & 2 ? "symmetric" : flags & 1 ? "smooth" : "cusp");

function pathShape(c: Cursor, flags: number): VectorObject | null {
  const r = c.r;
  const attrs = c.chunk(0xe);
  if (!attrs) return null;
  const [label, p] = name(r, attrs.data);
  const stroked = r.u8(p) !== 0, width = r.u16(p + 1), filled = r.u8(p + 3) !== 0;
  const cap = (["round", "square", "butt"] as const)[r.u8(p + 4)] ?? "round";
  const join = (["round", "bevel", "miter"] as const)[r.u8(p + 5)] ?? "miter";
  const miter = p + 14 <= attrs.end ? r.f64(p + 6) : 10;
  const stroke = paintStyle(c), fill = paintStyle(c);
  const count = c.chunk(8);
  const n = count ? r.u32(count.data) : 0;
  const contours: Contour[] = [];
  let cur: Contour | null = null;
  for (let i = 0; i < n; i++) {
    const nd = c.chunk(0x37);
    if (!nd) break;
    const d = nd.data, f = r.u16(d + 0x31);
    const node: PathNode = { x: r.f64(d), y: r.f64(d + 8), inX: r.f64(d + 16), inY: r.f64(d + 24), outX: r.f64(d + 32), outY: r.f64(d + 40), type: NODE_TYPE(f) };
    if (!cur || r.u8(d + 0x30) !== 0) { cur = { nodes: [], closed: false }; contours.push(cur); }
    cur.nodes.push(node);
    if (f & 0x80) { cur.closed = true; cur = null; }
  }
  const style: VectorStyle = {
    stroke: stroked ? stroke ?? [0, 0, 0, 255] : null, fill: filled ? fill ?? [0, 0, 0, 255] : null,
    width: Math.max(1, width), antialias: (flags & 1) !== 0, cap, join, miter: Number.isFinite(miter) && miter > 0 ? miter : 10,
  };
  return { name: label, visible: (flags & 4) !== 0, style, contours };
}

function textShape(c: Cursor, flags: number): VectorObject | null {
  const r = c.r;
  const attrs = c.chunk(0x55);
  if (!attrs) return null;
  const d = attrs.data, ax = r.i32(d + 1), ay = r.i32(d + 5);
  const m = Array.from({ length: 9 }, (_, i) => r.f64(d + 9 + i * 8));
  const count = c.chunk(8);
  const n = count ? r.u32(count.data) : 0;
  let text = "", lines = 0, align: TextData["align"] = "left";
  let font = "Arial", size = 24, bold = false, italic = false, underline = false, strikeout = false, styled = false;
  let fill: Rgba | null = [0, 0, 0, 255];
  for (let i = 0; i < n; i++) {
    const kind = c.chunk(6), data = c.chunk(4);
    if (!kind || !data) break;
    const k = r.u16(kind.data);
    if (k === 1 && data.end - data.data >= 4) text += String.fromCharCode(r.u32(data.data));
    else if (k === 3) {
      if (lines++) text += "\n";
      else if (data.end - data.data >= 4) { const a = r.u32(data.data); align = a === 1 || a === 6 ? "center" : a === 2 ? "right" : "left"; }
    } else if (k === 2) {
      const [face, p] = name(r, data.data);
      const f = r.u32(p), weight = r.u32(p + 4), height = r.i32(p + 12);
      const color = paintStyle(c);
      if (!styled) {
        styled = true;
        if (color !== undefined) fill = color;
        if (face) font = face;
        italic = (f & 1) !== 0; strikeout = (f & 2) !== 0; underline = (f & 4) !== 0;
        bold = weight >= 600;
        if (height) size = Math.abs(height);
      }
    }
  }
  // The anchor through the transform (rows: x' = x m00 + y m10 + m20).
  const x = ax * m[0] + ay * m[3] + m[6], y = ax * m[1] + ay * m[4] + m[7];
  const t: TextData = { text, font, size, bold, italic, underline, strikeout, align, kerning: 0, leading: 0, x: Number.isFinite(x) ? x : ax, y: Number.isFinite(y) ? y : ay };
  return { name: text.split("\n")[0].slice(0, 32) || "Text", visible: (flags & 4) !== 0, style: { stroke: null, fill, width: 1, antialias: (flags & 1) !== 0, cap: "round", join: "round", miter: 10 }, contours: [], text: t };
}

/** The objects of a VECTOR_EXTENSION block [at, end) (after its header). */
export function readVectorExtension(r: PspBytes, at: number, end: number, warnings: string[]): VectorObject[] {
  const c = new Cursor(r, at, end);
  const head = c.chunk(8);
  const n = head ? r.u32(head.data) : 0;
  const out: VectorObject[] = [];
  for (let i = 0; i < n; i++) {
    const blk = c.block();
    if (!blk) break;
    if (blk.id !== NATIVE_BLOCK.SHAPE) { c.at = blk.end; continue; }
    const s = new Cursor(r, c.at, blk.end);
    const sh = s.chunk(0x12);
    c.at = blk.end;
    if (!sh) continue;
    const type = r.u16(sh.data), flags = r.u32(sh.data + 2);
    const o = type === 1 ? textShape(s, flags) : type >= 2 && type <= 4 ? pathShape(s, flags) : null;
    if (o) out.push(o);
    else warnings.push(`A vector object of type ${type} could not be read.`);
  }
  return out;
}

/*
  ADJUSTMENT_EXTENSION: the type is JLayer's adjustment type + 1. Channel order in Levels and
  Curves is master, blue, green, red (the Levels page fills them in that order from its RGB,
  Red, Green, Blue tabs).
    1 Levels          4 f64 gammas, then 4 x i32 input black, input white... see below
    2 Curves          4 chunks {u8, u16 point count, 18 (x, y) byte pairs, 256-entry table}
    3 Brightness/Contrast  i32 brightness, i32 contrast
    4 Color Balance   u8 preserve luminosity, 3 groups (shadows, midtones, highlights) of
                      cyan/red, magenta/green, yellow/blue
    5 Hue/Saturation  u8 colorize, 6 i32 (master, then colorize), 6 ranges of 7 i32
    6 Channel Mixer   u8 monochrome, rows blue, green, red of red, green, blue, constant
    7 Invert, 8 Threshold (u32), 9 Posterize (u32 levels)
*/
export function readAdjustmentExtension(r: PspBytes, at: number, end: number, warnings: string[]): Adjustment | null {
  const c = new Cursor(r, at, end);
  const head = c.chunk(6);
  if (!head) return null;
  const type = r.u16(head.data);
  if (type === 7) return { type: "invert" };
  if (type === 2) {
    const ch: number[][][] = [];
    for (let i = 0; i < 4; i++) {
      const k = c.chunk(299);
      if (!k) return null;
      const count = Math.min(18, r.u16(k.data + 1)), pts: number[][] = [];
      for (let j = 0; j < count; j++) pts.push([r.u8(k.data + 3 + j * 2), r.u8(k.data + 4 + j * 2)]);
      ch.push(pts.length >= 2 ? pts.sort((a, b) => a[0] - b[0]) : [[0, 0], [255, 255]]);
    }
    return { type: "curves", rgb: ch[0], blue: ch[1], green: ch[2], red: ch[3] };
  }
  const d = c.chunk(4);
  if (!d) return null;
  const p = d.data, i32 = (k: number) => r.i32(p + k * 4);
  switch (type) {
    case 1: {
      if (d.end - p < 96) return null;
      const lv = (k: number): LevelsChannel => [r.i32(p + 32 + 16 + k * 4), r.i32(p + 32 + k * 4), Math.round(r.f64(p + k * 8) * 100) / 100, r.i32(p + 32 + 48 + k * 4), r.i32(p + 32 + 32 + k * 4)];
      return { type: "levels", rgb: lv(0), blue: lv(1), green: lv(2), red: lv(3) };
    }
    case 3: return { type: "brightnessContrast", brightness: i32(0), contrast: i32(1) };
    case 4: {
      const v = (k: number) => r.i32(p + 1 + k * 4);
      // Highlights, midtones, shadows: the first group lowers the white input, the last raises
      // the black input (the table builder, Psp.exe 0x4243e0).
      return { type: "colorBalance", preserveLuminosity: r.u8(p) !== 0, highlights: [v(0), v(1), v(2)], midtones: [v(3), v(4), v(5)], shadows: [v(6), v(7), v(8)] };
    }
    case 5: {
      const v = (k: number) => r.i32(p + 1 + k * 4);
      const ranges = Array.from({ length: 6 }, (_, k) => Array.from({ length: 7 }, (_, j) => v(6 + k * 7 + j)));
      return { type: "hueSaturation", colorize: r.u8(p) !== 0, master: [v(0), v(1), v(2)], colorizeValues: [v(3), v(4), v(5)], ranges };
    }
    case 6: {
      const row = (k: number) => [0, 1, 2, 3].map((j) => r.i32(p + 1 + (k * 4 + j) * 4));
      return { type: "channelMixer", monochrome: r.u8(p) !== 0, blue: row(0), green: row(1), red: row(2) };
    }
    case 8: return { type: "threshold", threshold: r.u32(p) };
    case 9: return { type: "posterize", levels: Math.max(2, r.u32(p)) };
    default:
      warnings.push(`An adjustment layer of type ${type} could not be read.`);
      return null;
  }
}
