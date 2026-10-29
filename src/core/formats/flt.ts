/*
  User defined filter files (pspud.flt), as Psp.exe 0x718ca0 reads them
  (docs/PSP_EXE_ANALYSIS.md section 9):
    PSP 6   "JASC_FILT\\r\\n0150\\r\\n", a 16-bit count, records of 232 bytes: the name (28 bytes,
            zero padded), the division factor and the bias (32-bit), a 7 x 7 matrix of 32-bit
            values row by row
    older   a 16-bit count, records of 78 bytes: the name (25 bytes), the division factor
            (16-bit at 25), the bias (byte at 27), a 5 x 5 matrix of 16-bit values at 28; records
            with an all-zero matrix or a zero factor are dropped. The 5 x 5 lands in the middle of
            the 7 x 7.
*/
export interface UserFilter { name: string; div: number; bias: number; matrix: number[] }

const MAGIC = "JASC_FILT\r\n", VERSION = "0150\r\n";

export function readFlt(b: Uint8Array): UserFilter[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const text = (o: number, n: number) => { let s = ""; for (let i = 0; i < n && b[o + i]; i++) s += String.fromCharCode(b[o + i]); return s; };
  const out: UserFilter[] = [];
  if (text(0, MAGIC.length) === MAGIC) {
    let o = MAGIC.length + VERSION.length;
    const n = v.getUint16(o, true); o += 2;
    for (let i = 0; i < n && o + 232 <= b.length; i++, o += 232) {
      const matrix: number[] = [];
      for (let k = 0; k < 49; k++) matrix.push(v.getInt32(o + 0x24 + k * 4, true));
      out.push({ name: text(o, 28), div: v.getInt32(o + 0x1c, true), bias: v.getInt32(o + 0x20, true), matrix });
    }
    return out;
  }
  const n = v.getUint16(0, true);
  for (let i = 0, o = 2; i < n && o + 78 <= b.length; i++, o += 78) {
    const matrix = new Array<number>(49).fill(0);
    let any = false;
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) { const x = v.getInt16(o + 28 + (r * 5 + c) * 2, true); matrix[(r + 1) * 7 + c + 1] = x; if (x) any = true; }
    const div = v.getInt16(o + 25, true);
    if (any && div) out.push({ name: text(o, 25), div, bias: b[o + 27], matrix });
  }
  return out;
}

export function writeFlt(filters: UserFilter[]): Uint8Array {
  const head = MAGIC + VERSION, b = new Uint8Array(head.length + 2 + filters.length * 232), v = new DataView(b.buffer);
  for (let i = 0; i < head.length; i++) b[i] = head.charCodeAt(i);
  v.setUint16(head.length, filters.length, true);
  filters.forEach((f, i) => {
    const o = head.length + 2 + i * 232;
    for (let k = 0; k < Math.min(27, f.name.length); k++) b[o + k] = f.name.charCodeAt(k) & 0xff;
    v.setInt32(o + 0x1c, f.div, true); v.setInt32(o + 0x20, f.bias, true);
    for (let k = 0; k < 49; k++) v.setInt32(o + 0x24 + k * 4, f.matrix[k] ?? 0, true);
  });
  return b;
}
