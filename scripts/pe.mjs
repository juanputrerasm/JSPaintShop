/*
  A small reader for the resources of a Win32 PE file (Psp.exe), with Node built-ins only.

  It walks the .rsrc tree (type / name / language) and decodes the resource types the shell
  needs: MENU, STRING, ACCELERATOR, the MFC TOOLBAR (241), DLGINIT (240), DIALOG, BITMAP,
  CURSOR and ICON groups. Layouts follow the Win32 SDK headers (winnt.h, winuser.h) and MFC's
  CToolBarData and DLGINIT records.
*/

export const RT = {
  CURSOR: 1, BITMAP: 2, ICON: 3, MENU: 4, DIALOG: 5, STRING: 6, ACCELERATOR: 9,
  GROUP_CURSOR: 12, GROUP_ICON: 14, VERSION: 16, DLGINIT: 240, TOOLBAR: 241,
};

export class PeResources {
  /** @param {Uint8Array} bytes */
  constructor(bytes) {
    this.b = bytes;
    this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const v = this.v;
    const pe = v.getUint32(0x3c, true);
    if (v.getUint32(pe, true) !== 0x4550) throw new Error("Not a PE file");
    const sections = v.getUint16(pe + 6, true);
    const optSize = v.getUint16(pe + 20, true);
    const opt = pe + 24;
    const magic = v.getUint16(opt, true);
    const dirs = opt + (magic === 0x20b ? 112 : 96);
    this.rsrcRva = v.getUint32(dirs + 2 * 8, true);
    this.sections = [];
    for (let i = 0; i < sections; i++) {
      const s = opt + optSize + i * 40;
      this.sections.push({ va: v.getUint32(s + 12, true), vsize: v.getUint32(s + 8, true), raw: v.getUint32(s + 20, true), rawSize: v.getUint32(s + 16, true) });
    }
    this.rsrcOff = this.offset(this.rsrcRva);
    /** @type {Map<number, Map<number|string, Uint8Array>>} type -> name -> data (first language) */
    this.types = new Map();
    this.walk();
  }

  offset(rva) {
    for (const s of this.sections) if (rva >= s.va && rva < s.va + Math.max(s.vsize, s.rawSize)) return rva - s.va + s.raw;
    throw new Error(`RVA ${rva.toString(16)} outside every section`);
  }

  entries(dirOff) {
    const v = this.v;
    const named = v.getUint16(dirOff + 12, true), ids = v.getUint16(dirOff + 14, true);
    const out = [];
    for (let i = 0; i < named + ids; i++) {
      const e = dirOff + 16 + i * 8;
      const name = v.getUint32(e, true), data = v.getUint32(e + 4, true);
      let key;
      if (name & 0x80000000) {
        const s = this.rsrcOff + (name & 0x7fffffff);
        const len = v.getUint16(s, true);
        key = this.utf16(s + 2, len);
      } else key = name;
      out.push({ key, dir: Boolean(data & 0x80000000), off: this.rsrcOff + (data & 0x7fffffff) });
    }
    return out;
  }

  walk() {
    for (const t of this.entries(this.rsrcOff)) {
      const names = new Map();
      for (const n of this.entries(t.off)) {
        const lang = this.entries(n.off)[0];
        const rva = this.v.getUint32(lang.off, true), size = this.v.getUint32(lang.off + 4, true);
        const at = this.offset(rva);
        names.set(n.key, this.b.subarray(at, at + size));
      }
      this.types.set(t.key, names);
    }
  }

  utf16(at, chars) {
    let s = "";
    for (let i = 0; i < chars; i++) s += String.fromCharCode(this.v.getUint16(at + i * 2, true));
    return s;
  }

  get(type, name) { return this.types.get(type)?.get(name) ?? null; }
  names(type) { return [...(this.types.get(type)?.keys() ?? [])]; }
}

function view(b) { return new DataView(b.buffer, b.byteOffset, b.byteLength); }

/** A zero-terminated UTF-16 string at `at`: [text, next offset]. */
function sz(b, at) {
  const v = view(b);
  let s = "";
  for (;;) {
    const c = v.getUint16(at, true);
    at += 2;
    if (!c) return [s, at];
    s += String.fromCharCode(c);
  }
}

/*
  MENU: a MENUITEMTEMPLATEHEADER (version 0) then items, or MENUEX (version 1).
  Returns [{ label, id?, items?, flags }], separators as { separator: true }.
*/
export function parseMenu(b) {
  const v = view(b);
  const version = v.getUint16(0, true);
  if (version === 1) return parseMenuEx(b);
  let at = 4 + v.getUint16(2, true);
  const level = () => {
    const items = [];
    for (;;) {
      const flags = v.getUint16(at, true); at += 2;
      let id;
      if (!(flags & 0x10)) { id = v.getUint16(at, true); at += 2; }
      const [label, next] = sz(b, at); at = next;
      if (flags & 0x10) items.push({ label, flags, items: level() });
      else if ((flags & 0x800) || (!id && !label)) items.push({ separator: true });
      else items.push({ label, id, flags });
      if (flags & 0x80) return items;
    }
  };
  return level();
}

function parseMenuEx(b) {
  const v = view(b);
  let at = 4 + v.getUint16(2, true);
  const level = () => {
    const items = [];
    for (;;) {
      const type = v.getUint32(at, true), state = v.getUint32(at + 4, true), id = v.getUint32(at + 8, true), res = v.getUint16(at + 12, true);
      at += 14;
      const [label, next] = sz(b, at); at = (next + 3) & ~3;
      if (res & 1) { at += 4; items.push({ label, flags: state, items: level() }); }
      else if (type & 0x800) items.push({ separator: true });
      else items.push({ label, id, flags: state });
      if (res & 0x80) return items;
    }
  };
  return level();
}

/* STRING block n holds ids (n-1)*16 .. (n-1)*16+15, each a length-prefixed UTF-16 string. */
export function parseStringBlock(block, b) {
  const v = view(b);
  const out = new Map();
  let at = 0;
  for (let i = 0; i < 16 && at < b.length; i++) {
    const len = v.getUint16(at, true); at += 2;
    if (len) {
      let s = "";
      for (let k = 0; k < len; k++) s += String.fromCharCode(v.getUint16(at + k * 2, true));
      out.set((block - 1) * 16 + i, s);
    }
    at += len * 2;
  }
  return out;
}

/* ACCELTABLEENTRY: fVirt, key, cmd, pad; the last has 0x80 in fVirt. */
export function parseAccelerators(b) {
  const v = view(b);
  const out = [];
  for (let at = 0; at + 8 <= b.length; at += 8) {
    const flags = v.getUint16(at, true), key = v.getUint16(at + 2, true), cmd = v.getUint16(at + 4, true);
    out.push({ virt: Boolean(flags & 1), shift: Boolean(flags & 4), ctrl: Boolean(flags & 8), alt: Boolean(flags & 0x10), key, cmd });
    if (flags & 0x80) break;
  }
  return out;
}

/* MFC CToolBarData: version, width, height, count, then the button ids (0 = separator). */
export function parseToolbar(b) {
  const v = view(b);
  const count = v.getUint16(6, true);
  const ids = [];
  for (let i = 0; i < count; i++) ids.push(v.getUint16(8 + i * 2, true));
  return { width: v.getUint16(2, true), height: v.getUint16(4, true), ids };
}

/*
  DLGINIT: records of control id, message, data length, data; CB_ADDSTRING (0x403) and
  LB_ADDSTRING (0x180) carry an ANSI string. Returns control id -> strings.
*/
export function parseDlgInit(b) {
  const v = view(b);
  const out = new Map();
  let at = 0;
  while (at + 2 <= b.length) {
    const ctl = v.getUint16(at, true);
    if (!ctl) break;
    const msg = v.getUint16(at + 2, true), len = v.getUint32(at + 4, true);
    const data = b.subarray(at + 8, at + 8 + len);
    at += 8 + len;
    if (msg !== 0x403 && msg !== 0x180 && msg !== 0x1234) continue;
    let s = Buffer.from(data).toString("latin1");
    s = s.replace(/\0+$/, "");
    if (!out.has(ctl)) out.set(ctl, []);
    out.get(ctl).push(s);
  }
  return out;
}

/* sz_Or_Ord: 0x0000 none, 0xFFFF then an ordinal, else a string. */
function szOrOrd(b, at) {
  const v = view(b);
  const first = v.getUint16(at, true);
  if (first === 0) return [null, at + 2];
  if (first === 0xffff) return [v.getUint16(at + 2, true), at + 4];
  return sz(b, at);
}

const CLASS_ATOMS = { 0x80: "Button", 0x81: "Edit", 0x82: "Static", 0x83: "ListBox", 0x84: "ScrollBar", 0x85: "ComboBox" };

/* DLGTEMPLATE or DLGTEMPLATEEX, with their controls, in dialog units. */
export function parseDialog(b) {
  const v = view(b);
  const ex = v.getUint16(0, true) === 1 && v.getUint16(2, true) === 0xffff;
  let at, style, count, x, y, cx, cy;
  if (ex) {
    style = v.getUint32(12, true); count = v.getUint16(16, true);
    x = v.getInt16(18, true); y = v.getInt16(20, true); cx = v.getInt16(22, true); cy = v.getInt16(24, true);
    at = 26;
  } else {
    style = v.getUint32(0, true); count = v.getUint16(8, true);
    x = v.getInt16(10, true); y = v.getInt16(12, true); cx = v.getInt16(14, true); cy = v.getInt16(16, true);
    at = 18;
  }
  let menu, cls, title, font = null;
  [menu, at] = szOrOrd(b, at);
  [cls, at] = szOrOrd(b, at);
  [title, at] = sz(b, at);
  if (style & 0x40 /* DS_SETFONT */) {
    const size = v.getUint16(at, true); at += 2;
    if (ex) at += 4;
    let face; [face, at] = sz(b, at);
    font = { size, face };
  }
  const controls = [];
  for (let i = 0; i < count; i++) {
    at = (at + 3) & ~3;
    let cstyle, cxp, cyp, ccx, ccy, id;
    if (ex) {
      cstyle = v.getUint32(at + 8, true);
      cxp = v.getInt16(at + 12, true); cyp = v.getInt16(at + 14, true); ccx = v.getInt16(at + 16, true); ccy = v.getInt16(at + 18, true);
      id = v.getUint32(at + 20, true); at += 24;
    } else {
      cstyle = v.getUint32(at, true);
      cxp = v.getInt16(at + 8, true); cyp = v.getInt16(at + 10, true); ccx = v.getInt16(at + 12, true); ccy = v.getInt16(at + 14, true);
      id = v.getUint16(at + 16, true); at += 18;
    }
    let klass, text;
    [klass, at] = szOrOrd(b, at);
    [text, at] = szOrOrd(b, at);
    const extra = v.getUint16(at, true); at += 2 + extra;
    if (typeof klass === "number") klass = CLASS_ATOMS[klass] ?? `#${klass}`;
    controls.push({ id: id === 0xffff ? -1 : id, class: klass, text: typeof text === "string" ? text : text === null ? "" : `#${text}`, style: cstyle >>> 0, rect: [cxp, cyp, ccx, ccy] });
  }
  return { title, style: style >>> 0, rect: [x, y, cx, cy], font, controls };
}

/*
  A BITMAPINFOHEADER DIB (as stored in BITMAP, ICON and CURSOR resources) to top-down RGBA.
  `height` is the image height (an icon's header holds twice that, for the AND mask).
  With `mask`, the AND mask that follows the colour rows sets alpha.
*/
export function decodeDib(b, at = 0, opts = {}) {
  const v = view(b);
  const headerSize = v.getUint32(at, true);
  let width, height, bits, colors, compression = 0;
  if (headerSize === 12) {
    width = v.getUint16(at + 4, true); height = v.getUint16(at + 6, true); bits = v.getUint16(at + 10, true);
    colors = bits <= 8 ? 1 << bits : 0;
  } else {
    width = v.getInt32(at + 4, true); height = v.getInt32(at + 8, true); bits = v.getUint16(at + 14, true);
    compression = v.getUint32(at + 16, true);
    colors = v.getUint32(at + 32, true) || (bits <= 8 ? 1 << bits : 0);
  }
  if (compression !== 0 && compression !== 3) throw new Error(`Compressed DIB (${compression}) not supported`);
  const topDown = height < 0;
  height = Math.abs(height);
  if (opts.height) height = opts.height;
  const entry = headerSize === 12 ? 3 : 4;
  const pal = at + headerSize + (compression === 3 ? 12 : 0);
  let px = pal + colors * entry;
  const stride = Math.ceil((width * bits) / 32) * 4;
  const rgba = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const y = topDown ? row : height - 1 - row;
    const line = px + row * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (bits <= 8) {
        const bit = x * bits;
        const index = (b[line + (bit >> 3)] >> (8 - bits - (bit & 7))) & ((1 << bits) - 1);
        rgba[o] = b[pal + index * entry + 2]; rgba[o + 1] = b[pal + index * entry + 1]; rgba[o + 2] = b[pal + index * entry]; rgba[o + 3] = 255;
      } else if (bits === 16) {
        const w = v.getUint16(line + x * 2, true);
        rgba[o] = ((w >> 10) & 31) * 255 / 31; rgba[o + 1] = ((w >> 5) & 31) * 255 / 31; rgba[o + 2] = (w & 31) * 255 / 31; rgba[o + 3] = 255;
      } else {
        const p = line + x * (bits >> 3);
        rgba[o] = b[p + 2]; rgba[o + 1] = b[p + 1]; rgba[o + 2] = b[p]; rgba[o + 3] = bits === 32 && opts.alpha ? b[p + 3] : 255;
      }
    }
  }
  if (opts.mask) {
    px += stride * height;
    const ms = Math.ceil(width / 32) * 4;
    for (let row = 0; row < height; row++) {
      const y = height - 1 - row;
      for (let x = 0; x < width; x++) {
        const andBit = (b[px + row * ms + (x >> 3)] >> (7 - (x & 7))) & 1;
        if (!andBit) continue;
        const o = (y * width + x) * 4;
        // AND 1 with a black colour is transparent; AND 1 with a colour is "invert screen",
        // which a browser cannot do: draw it as black so the shape still shows.
        if (rgba[o] || rgba[o + 1] || rgba[o + 2]) { rgba[o] = rgba[o + 1] = rgba[o + 2] = 0; rgba[o + 3] = 255; }
        else rgba[o + 3] = 0;
      }
    }
  }
  return { width, height, bits, rgba };
}

/* GRPICONDIR / cursor NEWHEADER: the entries with their resource ids. */
export function parseGroup(b, cursor) {
  const v = view(b);
  const count = v.getUint16(4, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 14;
    if (cursor) out.push({ width: v.getUint16(e, true), height: v.getUint16(e + 2, true) / 2, bits: v.getUint16(e + 6, true), id: v.getUint16(e + 12, true) });
    else out.push({ width: b[e] || 256, height: b[e + 1] || 256, bits: v.getUint16(e + 6, true), id: v.getUint16(e + 12, true) });
  }
  return out;
}
