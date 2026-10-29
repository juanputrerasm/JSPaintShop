/*
  Reading a WinHelp file (.hlp, as Psp.hlp) so Help > Help Topics can show the user's own
  PSP 6 help. The format follows helpdeco's description (Manfred Winterhoff's
  "HELPDECO"/"helpfile.txt"): an internal file system of B+ trees, |SYSTEM, the phrase tables,
  |TOPIC in LZ77-compressed blocks, |CONTEXT (hash -> topic) and |TTLBTREE (titles).

  JSPaintShop ships no help text and no longer shows PSP's help (the browser port drops Help
  Topics); the decoder is kept as a format reference, checked by tests/help.test.ts.
*/

export class HelpError extends Error {}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const i16 = (b: Uint8Array, o: number) => (u16(b, o) << 16) >> 16;
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const i32 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
// "latin1" is Windows-1252 in the Encoding standard, which is what help files hold.
const latin1 = new TextDecoder("latin1");
const cstr = (b: Uint8Array, o: number, end = b.length): [string, number] => {
  let e = o;
  while (e < end && b[e]) e++;
  return [latin1.decode(b.subarray(o, e)), e + 1];
};

/* A B+ tree's leaf entries, in key order; `entry` reads one at `at` and returns the next offset. */
function btreeLeaves<T>(b: Uint8Array, start: number, entry: (at: number) => [T, number]): T[] {
  if (u16(b, start) !== 0x293b) throw new HelpError("Not a WinHelp B+ tree");
  const pageSize = u16(b, start + 4), root = i16(b, start + 26), levels = i16(b, start + 32);
  const pages = start + 38;
  // Down the first child of every index page to the first leaf.
  let page = root;
  for (let l = 1; l < levels; l++) page = i16(b, pages + page * pageSize + 6);
  const out: T[] = [];
  while (page !== -1) {
    const p = pages + page * pageSize, n = i16(b, p + 2);
    let at = p + 8;
    for (let k = 0; k < n; k++) { const [v, next] = entry(at); out.push(v); at = next; }
    page = i16(b, p + 6);
  }
  return out;
}

/** The internal files: name -> [data start, data length]. */
export function helpDirectory(b: Uint8Array): Map<string, [number, number]> {
  if (u32(b, 0) !== 0x00035f3f) throw new HelpError("Not a WinHelp file");
  const dir = i32(b, 4);
  const files = new Map<string, [number, number]>();
  // The directory is itself an internal file: a 9-byte header, then its B+ tree.
  for (const [name, off] of btreeLeaves(b, dir + 9, (at) => { const [s, e] = cstr(b, at); return [[s, i32(b, e)] as [string, number], e + 4]; })) {
    files.set(name, [off + 9, u32(b, off + 4)]);
  }
  return files;
}

/* WinHelp's LZ77: a flag byte, then eight literals or (length 3..18, distance 1..4096) pairs. */
export function lz77(src: Uint8Array, start: number, end: number, max = Infinity): Uint8Array {
  const out: number[] = [];
  let i = start;
  while (i < end && out.length < max) {
    const flags = src[i++];
    for (let bit = 0; bit < 8 && i < end && out.length < max; bit++) {
      if (flags & (1 << bit)) {
        const w = u16(src, i); i += 2;
        const len = (w >> 12) + 3, dist = (w & 0xfff) + 1;
        for (let k = 0; k < len; k++) out.push(out[out.length - dist] ?? 0);
      } else out.push(src[i++]);
    }
  }
  return Uint8Array.from(out);
}

/** WinHelp's context-string hash (as winhlp32 computes it). */
export function contextHash(name: string): number {
  let h = 0;
  for (const c of name) {
    let x = 0;
    if (c >= "A" && c <= "Z") x = c.charCodeAt(0) - 65 + 17;
    else if (c >= "a" && c <= "z") x = c.charCodeAt(0) - 97 + 17;
    else if (c >= "1" && c <= "9") x = c.charCodeAt(0) - 48;
    else if (c === "0") x = 10;
    else if (c === ".") x = 12;
    else if (c === "_") x = 13;
    if (x) h = (Math.imul(h, 43) + x) | 0;
  }
  return h;
}

/* The compressed numbers of the topic records. */
class Reader {
  b: Uint8Array; at: number;
  constructor(b: Uint8Array, at = 0) { this.b = b; this.at = at; }
  byte() { return this.b[this.at++]; }
  i16() { const v = i16(this.b, this.at); this.at += 2; return v; }
  u16() { const v = u16(this.b, this.at); this.at += 2; return v; }
  u32() { const v = u32(this.b, this.at); this.at += 4; return v; }
  /** Unsigned compressed word: a byte or a word, halved. */
  cword() { return this.b[this.at] & 1 ? this.u16() >> 1 : this.byte() >> 1; }
  /** Signed compressed short. */
  cshort() { return this.b[this.at] & 1 ? (this.u16() >> 1) - 0x4000 : (this.byte() >> 1) - 0x40; }
  /** Unsigned compressed long. */
  culong() { return this.b[this.at] & 1 ? this.u32() >>> 1 : this.u16() >> 1; }
  /** Signed compressed long. */
  clong() { return this.b[this.at] & 1 ? (this.u32() >>> 1) - 0x40000000 : (this.u16() >> 1) - 0x4000; }
}

/** A topic as plain HTML: paragraphs, line breaks, bold and italic runs, links and pictures. */
export interface HelpTopic { title: string; offset: number; html: string }

export interface HelpFile {
  title: string;
  topics: HelpTopic[];
  /** Topic index for a context name (the .cnt file's targets), or -1. */
  find(context: string): number;
  /** Topic index for a link: a context hash, or a topic offset (WinHelp 3.0 links), or -1. */
  link(hash: number | null, offset: number | null): number;
  /** A picture by its internal name ("|bm12" or a baggage file), as RGBA. */
  picture(name: string): { width: number; height: number; data: Uint8ClampedArray } | null;
}

interface Font { bold: boolean; italic: boolean; underline: boolean; size: number }

function readFonts(b: Uint8Array, start: number): Font[] {
  try {
    const nDesc = u16(b, start + 2), descOff = u16(b, start + 6);
    const out: Font[] = [];
    for (let k = 0; k < nDesc; k++) {
      const d = start + descOff + k * 11, attr = b[d];
      out.push({ bold: Boolean(attr & 1), italic: Boolean(attr & 2), underline: Boolean(attr & 4), size: b[d + 1] / 2 });
    }
    return out;
  } catch {
    return [];
  }
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/* One display or table record (0x20, 0x23) as HTML; returns the HTML and its character count. */
function paragraphs(type: number, d1: Uint8Array, d2: Uint8Array, fonts: Font[]): { html: string; length: number } {
  const r = new Reader(d1);
  r.clong(); // topic size
  const length = r.cword();
  const strings = latin1.decode(d2).split("\0");
  let si = 0;
  const out: string[] = [];
  let open = "";
  const closeFont = () => { if (open) { out.push(open); open = ""; } };
  let cols = 0;
  if (type === 0x23) {
    cols = r.byte();
    const tableType = r.byte();
    if (tableType === 0 || tableType === 2) r.i16();
    for (let c = 0; c < cols; c++) { r.i16(); r.i16(); }
    out.push("<table class=\"hlp-table\"><tr>");
  }
  for (;;) {
    if (type === 0x23) {
      const col = r.i16();
      if (col === -1) break;
      r.i16(); r.byte();
      out.push("<td>");
    }
    r.byte(); r.byte(); r.u16();
    const bits = r.u16();
    if (bits & 0x0001) r.clong();
    if (bits & 0x0002) r.cshort();
    if (bits & 0x0004) r.cshort();
    if (bits & 0x0008) r.cshort();
    if (bits & 0x0010) r.cshort();
    if (bits & 0x0020) r.cshort();
    if (bits & 0x0040) r.cshort();
    if (bits & 0x0100) { r.byte(); r.i16(); }
    if (bits & 0x0200) {
      const n = r.cshort();
      for (let k = 0; k < n; k++) { const t = r.cword(); if (t & 0x4000) r.cword(); }
    }
    const align = bits & 0x0800 ? " style=\"text-align:center\"" : bits & 0x0400 ? " style=\"text-align:right\"" : "";
    out.push(`<p${align}>`);
    let link = "";
    // Text and commands alternate: a string, then a command, until 0xFF.
    for (;;) {
      if (si < strings.length) out.push(esc(strings[si++]));
      if (r.at >= d1.length) break;
      const cmd = r.byte();
      if (cmd === 0xff) break;
      switch (cmd) {
        case 0x20: r.u32(); break;
        case 0x21: r.u16(); break;
        case 0x80: {
          const f = fonts[r.i16()];
          closeFont();
          if (f) {
            const tags = [f.bold ? "b" : "", f.italic ? "i" : "", f.underline ? "u" : ""].filter(Boolean);
            out.push(tags.map((t) => `<${t}>`).join(""));
            open = tags.reverse().map((t) => `</${t}>`).join("");
          }
          break;
        }
        case 0x81: out.push("<br>"); break;
        case 0x82: closeFont(); out.push(`</p><p${align}>`); break;
        case 0x83: out.push("&emsp;"); break;
        case 0x86: case 0x87: case 0x88: {
          const kind = r.byte(), size = r.clong();
          const after = r.at + size;
          let name = "";
          if (kind === 0x22) r.cword();
          if (kind === 3 || kind === 0x22) { r.u16(); name = `|bm${r.u16()}`; }
          else if (kind === 5) { r.u16(); r.u16(); r.u16(); name = cstr(d1, r.at)[0]; }
          out.push(`<img class="hlp-pic${cmd === 0x87 ? " left" : cmd === 0x88 ? " right" : ""}" data-pic="${esc(name)}" alt="">`);
          r.at = Math.max(r.at, after);
          break;
        }
        case 0x89: if (link) { out.push("</a>"); link = ""; } break;
        case 0x8b: out.push("&nbsp;"); break;
        case 0x8c: out.push("&#8209;"); break;
        case 0xc8: case 0xcc: { const n = r.i16(); r.at += n; break; }
        case 0xe0: case 0xe1: { const off = r.u32(); out.push(`<a href="#" data-offset="${off}" class="${cmd === 0xe0 ? "hlp-popup" : "hlp-jump"}">`); link = "a"; break; }
        case 0xe2: case 0xe3: case 0xe6: case 0xe7: { const h = i32(d1, r.at); r.at += 4; out.push(`<a href="#" data-hash="${h}" class="${cmd & 1 ? "hlp-jump" : "hlp-popup"}">`); link = "a"; break; }
        case 0xea: case 0xeb: case 0xee: case 0xef: {
          const n = r.i16(), next = r.at + n, t = r.byte(), h = i32(d1, r.at);
          r.at += 4;
          void t;
          out.push(`<a href="#" data-hash="${h}" class="${cmd & 1 ? "hlp-jump" : "hlp-popup"}">`);
          link = "a";
          r.at = next;
          break;
        }
        default: break;
      }
    }
    closeFont();
    out.push("</p>");
    if (type === 0x23) out.push("</td>"); else break;
  }
  if (type === 0x23) out.push("</tr></table>");
  return { html: out.join("").replace(/<p( style="[^"]*")?><\/p>/g, ""), length };
}

/* An SHG/MRB picture (|bm files): the first image, a DIB or DDB, packed with RLE and/or LZ77. */
function readPicture(b: Uint8Array, start: number): { width: number; height: number; data: Uint8ClampedArray } | null {
  const magic = u16(b, start);
  if (magic !== 0x506c && magic !== 0x706c) return null;
  if (u16(b, start + 2) < 1) return null;
  const p = start + u32(b, start + 4);
  const type = b[p], packing = b[p + 1];
  if (type !== 5 && type !== 6) return null;
  const r = new Reader(b, p + 2);
  r.culong(); r.culong(); // dpi
  r.cword();
  const bits = r.cword(), width = r.culong(), height = r.culong(), used = r.culong();
  r.culong();
  const csize = r.culong();
  r.culong();
  const coff = r.u32();
  r.u32();
  const colors = bits <= 8 ? (used || 1 << bits) : 0;
  const pal: number[][] = [];
  if (type === 6) for (let k = 0; k < colors; k++) { pal.push([b[r.at + 2], b[r.at + 1], b[r.at]]); r.at += 4; }
  else for (let k = 0; k < colors; k++) { const v = k ? 255 : 0; pal.push([v, v, v]); }
  let px: Uint8Array = b.subarray(p + coff, p + coff + csize);
  if (packing === 2 || packing === 3) px = lz77(px, 0, px.length);
  if (packing === 1 || packing === 3) {
    const o: number[] = [];
    for (let i = 0; i < px.length;) {
      const n = px[i++];
      if (n & 0x80) for (let k = 0; k < (n & 0x7f); k++) o.push(px[i++]);
      else { for (let k = 0; k < n; k++) o.push(px[i]); i++; }
    }
    px = Uint8Array.from(o);
  }
  const stride = type === 6 ? ((width * bits + 31) >> 5) << 2 : ((width * bits + 15) >> 4) << 1;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = (type === 6 ? height - 1 - y : y) * stride;
    for (let x = 0; x < width; x++) {
      let c: number[];
      if (bits === 24) c = [px[row + x * 3 + 2], px[row + x * 3 + 1], px[row + x * 3]];
      else if (bits === 8) c = pal[px[row + x]] ?? [0, 0, 0];
      else if (bits === 4) c = pal[(px[row + (x >> 1)] >> (x & 1 ? 0 : 4)) & 15] ?? [0, 0, 0];
      else if (bits === 1) c = pal[(px[row + (x >> 3)] >> (7 - (x & 7))) & 1] ?? [0, 0, 0];
      else c = [0, 0, 0];
      data.set([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/* A plain BMP file (the help's baggage pictures). */
function readBmp(b: Uint8Array, start: number): { width: number; height: number; data: Uint8ClampedArray } | null {
  if (b[start] !== 0x42 || b[start + 1] !== 0x4d) return null;
  const off = start + u32(b, start + 10), h0 = start + 14;
  const width = i32(b, h0 + 4), hRaw = i32(b, h0 + 8), bits = u16(b, h0 + 14), used = u32(b, h0 + 32);
  const height = Math.abs(hRaw), stride = ((width * bits + 31) >> 5) << 2;
  const colors = bits <= 8 ? used || 1 << bits : 0, pal = h0 + u32(b, h0);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = off + (hRaw > 0 ? height - 1 - y : y) * stride;
    for (let x = 0; x < width; x++) {
      let i = 0, c: number[];
      if (bits === 24) c = [b[row + x * 3 + 2], b[row + x * 3 + 1], b[row + x * 3]];
      else {
        i = bits === 8 ? b[row + x] : bits === 4 ? (b[row + (x >> 1)] >> (x & 1 ? 0 : 4)) & 15 : (b[row + (x >> 3)] >> (7 - (x & 7))) & 1;
        c = i < colors ? [b[pal + i * 4 + 2], b[pal + i * 4 + 1], b[pal + i * 4]] : [0, 0, 0];
      }
      data.set([c[0], c[1], c[2], 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** Read a WinHelp 3.1/4 file's topics. */
export function readHelp(b: Uint8Array): HelpFile {
  const files = helpDirectory(b);
  const sys = files.get("|SYSTEM");
  if (!sys) throw new HelpError("The help file has no |SYSTEM");
  const s0 = sys[0];
  if (u16(b, s0) !== 0x036c) throw new HelpError("Bad |SYSTEM");
  const minor = u16(b, s0 + 2), flags = u16(b, s0 + 10);
  if (files.has("|Phrases") || files.has("|PhrIndex")) throw new HelpError("Phrase-compressed help files are not supported");
  let title = "";
  if (minor > 16) {
    for (let at = s0 + 12; at < s0 + sys[1];) {
      const t = u16(b, at), n = u16(b, at + 2);
      if (t === 1) title = cstr(b, at + 4, at + 4 + n)[0];
      at += 4 + n;
    }
  } else title = cstr(b, s0 + 12, s0 + sys[1])[0];
  const compressed = minor > 16 && flags !== 0;
  const blockSize = minor <= 16 ? 0x800 : flags === 8 ? 0x800 : 0x1000;
  const dsize = compressed ? 0x4000 : blockSize - 12;
  // The topic stream: the blocks' data end to end (a record that runs past the end of its
  // block's data goes on in the next block's); a position is block * dsize + offset.
  const [t0, tlen] = files.get("|TOPIC") ?? [0, 0];
  const blocks = Math.ceil(tlen / blockSize);
  const chunks: Uint8Array[] = [], starts: number[] = [];
  let total = 0;
  for (let k = 0; k < blocks; k++) {
    const bs = t0 + k * blockSize, be = Math.min(t0 + tlen, bs + blockSize);
    const data = compressed ? lz77(b, bs + 12, be, dsize) : b.subarray(bs + 12, be);
    starts.push(total);
    chunks.push(data);
    total += data.length;
  }
  const stream = new Uint8Array(total + 64);
  chunks.forEach((c, k) => stream.set(c, starts[k]));
  const fontsAt = files.get("|FONT");
  const fonts = fontsAt ? readFonts(b, fontsAt[0]) : [];
  const pos = (ref: number) => (starts[Math.floor((ref - 12) / dsize)] ?? -1e9) + ((ref - 12) % dsize);
  const topics: HelpTopic[] = [];
  let ref = i32(b, t0 + 4), offs = 0, lastBlock = -1;
  const parts: string[][] = [];
  for (let guard = 0; ref !== -1 && guard < 200000; guard++) {
    const block = Math.floor((ref - 12) / dsize);
    if (block !== lastBlock) { offs = 0; lastBlock = block; }
    const at = pos(ref);
    if (at < 0 || at + 21 > stream.length) break;
    const size = i32(stream, at), len2 = i32(stream, at + 4), next = i32(stream, at + 12), len1 = i32(stream, at + 16), type = stream[at + 20];
    const d1 = stream.subarray(at + 21, at + len1), d2 = stream.subarray(at + len1, at + size);
    void len2;
    if (type === 2) {
      const [t] = cstr(d2, 0);
      topics.push({ title: t, offset: block * 0x8000 + offs, html: "" });
      parts.push([]);
    } else if ((type === 0x20 || type === 0x23) && parts.length) {
      try {
        const p = paragraphs(type, d1, d2, fonts);
        parts[parts.length - 1].push(p.html);
        offs += p.length;
      } catch { /* a record this reader does not follow is left out */ }
    }
    if (next === ref || size <= 0) break;
    ref = next;
  }
  topics.forEach((t, i) => { t.html = parts[i].join(""); });
  // |CONTEXT: hash -> topic offset.
  const ctx = new Map<number, number>();
  const c = files.get("|CONTEXT");
  if (c) for (const [h, off] of btreeLeaves(b, c[0], (at) => [[i32(b, at), i32(b, at + 4)] as [number, number], at + 8])) ctx.set(h, off);
  const byOffset = (off: number) => {
    let best = -1;
    for (let i = 0; i < topics.length; i++) if (topics[i].offset <= off && (best < 0 || topics[i].offset >= topics[best].offset)) best = i;
    return best;
  };
  return {
    title, topics,
    find: (context) => { const off = ctx.get(contextHash(context)); return off === undefined ? -1 : byOffset(off); },
    link: (hash, offset) => { const off = hash !== null ? ctx.get(hash) : offset; return off === undefined || off === null ? -1 : byOffset(off); },
    picture: (name) => {
      const f = files.get(name) ?? files.get(name.toUpperCase());
      if (!f) return null;
      return readPicture(b, f[0]) ?? readBmp(b, f[0]);
    },
  };
}

/** The .cnt contents file: nested headings and topics (level, title, context name or null). */
export function readContents(text: string): { level: number; title: string; context: string | null }[] {
  const out: { level: number; title: string; context: string | null }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const [title, target] = m[2].split("=");
    out.push({ level: Number(m[1]), title: title.trim(), context: target ? target.split("@")[0].split(">")[0].trim() : null });
  }
  return out;
}
