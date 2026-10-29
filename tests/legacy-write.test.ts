/* Saving the older formats (docs/PSP_EXE_ANALYSIS.md section 21): each reads back through JSPaintShop's own reader. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRaster, type Raster } from "../src/core/image/raster.ts";
import { encodeClp, encodeCut, encodeGemImg, encodeIff, encodeMacPaint, encodeMsp, encodePict, encodeRas, encodeWpg } from "../src/core/formats/legacy-write.ts";
import { decodeClp, decodeCut, decodeGemImg, decodeIff, decodeMacPaint, decodeMsp, decodeWpg } from "../src/core/formats/legacy.ts";
import { decodeRas } from "../src/core/formats/more.ts";
import { decodePict } from "../src/core/formats/pict.ts";
import { detectFormat } from "../src/core/formats/formats.ts";

const W = 21, H = 7;
const mono = Uint8Array.from([0, 0, 0, 255, 255, 255]);
const pal16 = Uint8Array.from({ length: 48 }, (_, i) => (i * 37) & 0xff);
const pal256 = Uint8Array.from({ length: 768 }, (_, i) => (i * 13 + (i >> 3)) & 0xff);
const idx = (n: number, w = W, h = H) => Uint8Array.from({ length: w * h }, (_, i) => (i < w ? 3 : (i * 7) >> 2) % n);
const rasterOf = (indices: Uint8Array, pal: Uint8Array, w = W, h = H): Raster => {
  const r = createRaster(w, h);
  indices.forEach((k, i) => r.data.set([pal[k * 3], pal[k * 3 + 1], pal[k * 3 + 2], 255], i * 4));
  return r;
};
const same = (a: Raster, b: Raster) => assert.deepEqual([...a.data], [...b.data]);

test("MacPaint and Microsoft Paint: 2 colors", () => {
  const i2 = idx(2, 576, 720);
  same(decodeMacPaint(encodeMacPaint({ indices: i2, palette: mono, bits: 1 }, 576, 720)).raster, rasterOf(i2, mono, 576, 720));
  assert.throws(() => encodeMacPaint({ indices: idx(2), palette: mono, bits: 1 }, W, H), /576 x 720/);
  const i = idx(2);
  same(decodeMsp(encodeMsp({ indices: i, palette: mono, bits: 1 }, W, H)).raster, rasterOf(i, mono));
  assert.throws(() => encodeMsp({ indices: idx(16), palette: pal16, bits: 4 }, W, H), /2 Colors/);
});

test("GEM IMG, Dr. Halo, WPG: palette indexes", () => {
  const i = idx(2);
  same(decodeGemImg(encodeGemImg({ indices: i, palette: mono, bits: 1 }, W, H)).raster, rasterOf(i, mono));
  const g = decodeGemImg(encodeGemImg({ indices: idx(16), palette: pal16, bits: 4 }, W, H));
  assert.equal(g.depth, 4);
  const i8 = idx(256);
  const cut = decodeCut(encodeCut({ indices: i8, palette: pal256, bits: 8 }, W, H));
  assert.deepEqual([...cut.raster.data].filter((_, k) => k % 4 === 0), [...i8]);
  for (const [bits, pal] of [[1, mono], [4, pal16], [8, pal256]] as const) {
    const ii = idx(1 << bits);
    const back = decodeWpg(encodeWpg({ indices: ii, palette: pal, bits }, W, H, 300));
    same(back.raster, rasterOf(ii, pal));
  }
});

test("Sun raster, Clipboard, IFF and PICT: paletted and full color", () => {
  const full = createRaster(W, H);
  for (let k = 0; k < W * H; k++) full.data.set([k * 3, 255 - k, (k * 11) & 255, 255], k * 4);
  const i8 = idx(256), r8 = rasterOf(i8, pal256);
  const i1 = idx(2), r1 = rasterOf(i1, mono);
  for (const [name, enc, dec] of [
    ["ras", (r: Raster, p: Parameters<typeof encodeRas>[1]) => encodeRas(r, p), decodeRas],
    ["clp", (r: Raster, p: Parameters<typeof encodeRas>[1]) => encodeClp(r, p, 96), decodeClp],
    ["iff", (r: Raster, p: Parameters<typeof encodeRas>[1]) => encodeIff(r, p), decodeIff],
    ["pict", (r: Raster, p: Parameters<typeof encodeRas>[1]) => encodePict(r, p), decodePict],
  ] as const) {
    same(dec(enc(full, null)).raster, full);
    same(dec(enc(r8, { indices: i8, palette: pal256, bits: 8 })).raster, r8);
    same(dec(enc(r1, { indices: i1, palette: mono, bits: 1 })).raster, r1);
    assert.equal(detectFormat(enc(full, null), `x.${name === "pict" ? "pct" : name}`)?.id, name);
  }
  same(decodeIff(encodeIff(full, null, false)).raster, full);
});

test("IFF: HAM6 and Extra Half-Brite as PSP reads them", () => {
  const be32 = (v: number) => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const chunk = (id: string, data: number[]) => [...[...id].map((c) => c.charCodeAt(0)), ...be32(data.length), ...data, ...(data.length & 1 ? [0] : [])];
  const ilbm = (planes: number, camg: number, cmap: number[], pixels: number[]) => {
    const w = pixels.length, body: number[] = [];
    for (let k = 0; k < planes; k++) { let byte = 0; pixels.forEach((v, x) => { if ((v >> k) & 1) byte |= 0x80 >> x; }); body.push(byte, 0); }
    const bmhd = [0, w, 0, 1, 0, 0, 0, 0, planes, 0, 0, 0, 0, 0, 1, 1, 0, w, 0, 1];
    const inner = [..."ILBM"].map((c) => c.charCodeAt(0)).concat(chunk("BMHD", bmhd), chunk("CMAP", cmap), chunk("CAMG", be32(camg)), chunk("BODY", body));
    return Uint8Array.from([..."FORM"].map((c) => c.charCodeAt(0)).concat(be32(inner.length), inner));
  };
  const cmap = Array.from({ length: 48 }, (_, i) => (i * 17) & 0xff);
  const ham = decodeIff(ilbm(6, 0x800, cmap, [0x01, 0x1f, 0x2a, 0x33]));
  const px = (x: number) => [...ham.raster.data.subarray(x * 4, x * 4 + 3)];
  assert.equal(ham.depth, 24);
  assert.deepEqual(px(0), [cmap[3] & 0xf0, cmap[4] & 0xf0, cmap[5] & 0xf0]);
  assert.deepEqual(px(1), [cmap[3] & 0xf0, cmap[4] & 0xf0, 0xf0]);
  assert.deepEqual(px(2), [0xa0, cmap[4] & 0xf0, 0xf0]);
  assert.deepEqual(px(3), [0xa0, 0x30, 0xf0]);
  const ehbMap = Array.from({ length: 96 }, (_, i) => (i * 5 + 40) & 0xff);
  const ehb = decodeIff(ilbm(6, 0x80, ehbMap, [33]));
  assert.deepEqual([...ehb.raster.data.subarray(0, 3)], [ehbMap[3] >> 1, ehbMap[4] >> 1, ehbMap[5] >> 1]);
});

test("WPG 2: palette, 8-bit run-length bitmap", () => {
  const le16 = (v: number) => [v & 255, v >> 8];
  const head = [0xff, 0x57, 0x50, 0x43, 16, 0, 0, 0, 1, 0x16, 2, 0, 0, 0, 0, 0];
  const rec = (type: number, data: number[]) => [0x1b, type, 0, data.length, ...data];
  const pal = rec(0x0c, [...le16(0), ...le16(3), 10, 20, 30, 0, 40, 50, 60, 0, 70, 80, 90, 0]);
  // 4 x 3: row 0 = literal 0 1 2 1; row 1 = sample 2 four times; row 2 = the previous row again.
  const data = [0x03, 0, 1, 2, 1, 0x83, 2, 0xfe, 0];
  const bmp = rec(0x0e, [...le16(4), ...le16(3), 4, 1, ...data]);
  const file = Uint8Array.from([...head, ...pal, ...bmp, ...rec(2, [])]);
  const d = decodeWpg(file);
  assert.equal(d.depth, 8);
  const idxOf = (x: number, y: number) => { const i = (y * 4 + x) * 4; return [d.raster.data[i], d.raster.data[i + 1], d.raster.data[i + 2]]; };
  assert.deepEqual(idxOf(1, 0), [40, 50, 60]);
  assert.deepEqual(idxOf(3, 1), [70, 80, 90]);
  assert.deepEqual(idxOf(0, 2), [70, 80, 90]);
});

test("Dr. Halo palette: PSP's .PAL layout, read back with its image", async () => {
  const { encodeHaloPalette } = await import("../src/core/formats/legacy-write.ts");
  const { decodeHaloPalette, decodeCut } = await import("../src/core/formats/legacy.ts");
  const { encodeCut } = await import("../src/core/formats/legacy-write.ts");
  const pal = new Uint8Array(768);
  for (let i = 0; i < 768; i++) pal[i] = (i * 7) & 255;
  const b = encodeHaloPalette(pal);
  assert.equal(b.length, 2048);
  assert.deepEqual([...b.subarray(0, 7)], [0x41, 0x48, 0xe3, 0, 0, 0, 10]);
  assert.deepEqual([b[12], b[14], b[16], b[18]], [255, 255, 255, 255]);
  // Entry 0 at byte 40; entry 78 starts the second block.
  assert.deepEqual([...b.subarray(40, 46)], [pal[0], 0, pal[1], 0, pal[2], 0]);
  assert.deepEqual([...b.subarray(512, 518)], [pal[234], 0, pal[235], 0, pal[236], 0]);
  // The last block's tail keeps the third block's bytes.
  assert.deepEqual([...b.subarray(1536 + 48, 2048)], [...b.subarray(1024 + 48, 1536)]);
  assert.deepEqual([...decodeHaloPalette(b)!], [...pal]);
  const img = decodeCut(encodeCut({ indices: Uint8Array.from([0, 1, 2, 3]), palette: pal, bits: 8 }, 2, 2), pal);
  assert.deepEqual([...img.raster.data.subarray(4, 8)], [pal[3], pal[4], pal[5], 255]);
  assert.equal(img.greyscale, false);
});
