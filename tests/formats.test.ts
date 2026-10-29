/* BMP, GIF, PSP and the PNG/JPEG headers. PSP's own stock files are read when the install is found. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { decodeBmp, encodeBmp } from "../src/core/formats/bmp.ts";
import { decodeGif, encodeGif } from "../src/core/formats/gif.ts";
import { readPsp, unRle, isPsp } from "../src/core/formats/psp.ts";
import { inflate } from "../src/core/formats/zlib.ts";
import { pngInfo, setPngDpi, jpegInfo, setJpegDpi } from "../src/core/formats/info.ts";
import { detectFormat, formatByName } from "../src/core/formats/formats.ts";
import { medianCut, exactPalette } from "../src/core/color/quantize.ts";
import { createRaster, type Raster } from "../src/core/image/raster.ts";

const PSP6 = process.env.JSPAINTSHOP_PSP6 ?? join(homedir(), "programs/Paint Shop Pro 6");
const hasPsp6 = existsSync(join(PSP6, "Psp.exe"));

function gradient(w: number, h: number, alpha = false): Raster {
  const r = createRaster(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    r.data.set([x * 7 & 255, y * 13 & 255, (x * y) & 255, alpha && x < 2 ? 0 : 255], o);
  }
  return r;
}

test("BMP: 24 bits round trip, with resolution, odd widths padded", () => {
  const r = gradient(7, 5);
  const back = decodeBmp(encodeBmp(r, 300));
  assert.equal(back.depth, 24);
  assert.equal(back.dpi, 300);
  assert.deepEqual(back.raster.data, r.data);
});

test("BMP: paletted round trip at 1, 4 and 8 bits", () => {
  for (const colors of [2, 16, 200]) {
    const r = createRaster(9, 3);
    for (let i = 0; i < 27; i++) r.data.set([(i % colors) * 3, 0, 255 - (i % colors), 255], i * 4);
    const idx = exactPalette(r, 256, false)!;
    const back = decodeBmp(encodeBmp(r, 72, idx));
    assert.equal(back.depth, idx.bits);
    assert.deepEqual(back.raster.data, r.data);
  }
});

test("BMP: RLE8 with a run, an absolute run and end of line", () => {
  const pixels = [3, 1, 0, 3, 2, 3, 2, 0, 0, 0, 1];
  // width 3, height 2: row 0 (bottom) = 1,1,1 ; row 1 = 2,3,2
  const header = new Uint8Array(54 + 4 * 4);
  const v = new DataView(header.buffer);
  header.set([0x42, 0x4d]);
  v.setUint32(10, 54 + 16, true); v.setUint32(14, 40, true); v.setInt32(18, 3, true); v.setInt32(22, 2, true);
  v.setUint16(26, 1, true); v.setUint16(28, 8, true); v.setUint32(30, 1, true); v.setUint32(46, 4, true);
  header.set([0, 0, 0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 0], 54);
  const bytes = new Uint8Array([...header, 3, 1, 0, 0, 0, 3, 2, 3, 2, 0, 0, 1]);
  void pixels;
  const img = decodeBmp(bytes);
  const at = (x: number, y: number) => [...img.raster.data.subarray((y * 3 + x) * 4, (y * 3 + x) * 4 + 3)];
  assert.deepEqual(at(0, 1), [255, 0, 0]); // index 1, bottom row
  assert.deepEqual(at(0, 0), [0, 255, 0]); // index 2, top row
  assert.deepEqual(at(1, 0), [0, 0, 255]); // index 3
});

test("GIF: the classic 1 x 1 transparent GIF", () => {
  const img = decodeGif(Uint8Array.from(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")));
  assert.equal(img.raster.width, 1);
  assert.equal(img.raster.data[3], 0);
});

test("GIF: round trip of an image with few colors keeps every pixel", () => {
  const r = createRaster(37, 23);
  for (let i = 0; i < 37 * 23; i++) r.data.set([(i * 37) % 200, (i * 11) % 50, 9, 255], i * 4);
  const idx = medianCut(r, 256);
  const back = decodeGif(encodeGif(r, idx, idx.transparent));
  assert.deepEqual(back.raster.data, r.data);
});

test("GIF: a big full-color image survives LZW table resets", () => {
  const r = gradient(300, 200, true);
  const idx = medianCut(r, 256);
  assert.ok(idx.palette.length / 3 <= 256);
  const back = decodeGif(encodeGif(r, idx, idx.transparent));
  assert.equal(back.raster.data[3], 0, "transparent corner stays transparent");
  for (let i = 0; i < r.data.length; i += 4 * 97) {
    if (r.data[i + 3] === 0) continue;
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(back.raster.data[i + c] - r.data[i + c]) < 48);
  }
});

test("PSP run-length coding", () => {
  assert.deepEqual([...unRle(Uint8Array.from([131, 7, 2, 1, 2]), 5)], [7, 7, 7, 1, 2]);
});

test("PNG and JPEG headers: depth and resolution, and writing the resolution", () => {
  // A 1 x 1 paletted PNG with no pHYs.
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEX/AAAZ4gk3AAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==", "base64"));
  assert.deepEqual(pngInfo(png), { depth: 1, greyscale: false, dpi: 0 });
  assert.equal(pngInfo(setPngDpi(png, 300)).dpi, 300);
  assert.equal(detectFormat(setPngDpi(png, 300))?.id, "png");
  const jfif = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0]);
  assert.deepEqual(jpegInfo(jfif), { depth: 8, greyscale: true, dpi: 0 });
  assert.equal(jpegInfo(setJpegDpi(jfif, 150)).dpi, 150);
});

test("formats by name", () => {
  assert.equal(formatByName("A.JPG")?.id, "jpeg");
  assert.equal(formatByName("frame.pfr")?.id, "psp");
  assert.equal(formatByName("x.xyz"), null);
});

const stock = (rel: string) => readFileSync(join(PSP6, rel));

test("PSP: a PSP 5 tube (file version 3)", { skip: !hasPsp6 && "PSP 6 install not found" }, async () => {
  const bytes = stock("Tubes/Neon Spikes.tub");
  assert.ok(isPsp(bytes));
  const { doc, version, warnings } = await readPsp(bytes, inflate);
  assert.deepEqual(version, [3, 0]);
  assert.deepEqual([doc.width, doc.height, doc.dpi, doc.depth], [600, 450, 72, 24]);
  assert.equal(doc.layers.length, 1);
  const l = doc.layers[0];
  assert.deepEqual([l.name, l.x, l.y, l.raster.width, l.raster.height], ["Merged", 14, 5, 579, 438]);
  assert.equal(doc.creator.title, "Neon Spikes");
  assert.deepEqual(warnings, []);
});

test("PSP: a PSP 6 frame (file version 4) with its creator", { skip: !hasPsp6 && "PSP 6 install not found" }, async () => {
  const { doc, version } = await readPsp(stock("Frames/Aqua Beveled.pfr"), inflate);
  assert.deepEqual(version, [4, 0]);
  assert.deepEqual([doc.width, doc.height], [1024, 819]);
  assert.equal(doc.creator.title, "Aqua Beveled");
  const r = doc.layers[0].raster;
  // The frame is opaque along its edge and clear in the middle.
  assert.equal(r.data[((410 * 1024) + 5) * 4 + 3], 255);
  assert.equal(r.data[((410 * 1024) + 512) * 4 + 3], 0);
});

test("PSP: a frame's alpha channel is read (bitmap chunk, then the channel)", { skip: !hasPsp6 && "PSP 6 install not found" }, async () => {
  const { doc, warnings } = await readPsp(stock("Frames/Round Wood.pfr"), inflate);
  assert.equal(doc.dpi, 150);
  assert.deepEqual(warnings, []);
  assert.equal(doc.alphas.length, 1);
  assert.equal(doc.alphas[0].name, "Selection #0");
  const values = new Set(doc.alphas[0].mask.data);
  assert.ok(values.has(0) && values.has(255));
});

test("PSP: write and read back layers, blend modes, masks, palette and creator", async () => {
  const { writePsp } = await import("../src/core/formats/psp-write.ts");
  const { deflate } = await import("../src/core/formats/zlib.ts");
  const { newImage, rasterLayer } = await import("../src/core/doc/image-doc.ts");
  const { createMask } = await import("../src/core/image/raster.ts");
  const doc = newImage(5, 3, 96, [10, 20, 30, 255]);
  doc.creator.title = "Test";
  const top = rasterLayer("Glow", gradient(5, 3, true));
  Object.assign(top, { opacity: 128, blend: 8, visible: false, lockTransparency: true, group: 2, mask: createMask(5, 3, 77), maskEnabled: false });
  doc.layers.push(top);
  doc.active = 1;
  const { doc: back, version } = await readPsp(await writePsp(doc, deflate, 1000), inflate);
  assert.deepEqual(version, [4, 0]);
  assert.deepEqual([back.width, back.height, back.dpi, back.active], [5, 3, 96, 1]);
  assert.equal(back.creator.title, "Test");
  const l = back.layers[1];
  assert.deepEqual([l.name, l.opacity, l.blend, l.visible, l.lockTransparency, l.group, l.maskEnabled], ["Glow", 128, 8, false, true, 2, false]);
  assert.deepEqual(l.raster.data, top.raster.data);
  assert.equal(l.mask?.data[7], 77);
  assert.deepEqual(back.layers[0].raster.data, doc.layers[0].raster.data);

  const grey = newImage(4, 4, 72, [100, 100, 100, 255], 8, true);
  const g = (await readPsp(await writePsp(grey, deflate), inflate)).doc;
  assert.equal(g.greyscale, true);
  assert.equal(g.layers[0].raster.data[0], 100);
});

test("PSP: our files read like PSP 6's own (same layer header bytes)", { skip: !hasPsp6 && "PSP 6 install not found" }, async () => {
  const { writePsp } = await import("../src/core/formats/psp-write.ts");
  const { deflate } = await import("../src/core/formats/zlib.ts");
  const { doc } = await readPsp(stock("Frames/Aqua Beveled.pfr"), inflate);
  const again = await readPsp(await writePsp(doc, deflate), inflate);
  assert.deepEqual(again.doc.layers[0].raster.data, doc.layers[0].raster.data);
  const ours = await writePsp(doc, deflate);
  const theirs = stock("Frames/Aqua Beveled.pfr");
  const find = (b: Uint8Array) => { for (let i = 36; i < b.length; i++) if (b[i] === 0x7e && b[i + 4] === 4 && b[i + 5] === 0 && b[i + 1] === 0x42) return i; return -1; };
  const a = find(ours), t = find(theirs);
  // The layer chunk (after the block header) is the same bytes in both.
  assert.deepEqual([...ours.subarray(a + 10, a + 10 + 128)], [...theirs.subarray(t + 10, t + 10 + 128)]);
});

test("TGA, PCX and PNM round trips", async () => {
  const { decodeTga, encodeTga, decodePcx, encodePcx, decodePnm, encodePnm } = await import("../src/core/formats/more.ts");
  const r = gradient(13, 7, true);
  assert.deepEqual(decodeTga(encodeTga(r, true)).raster.data, r.data);
  const opaque = gradient(13, 7);
  assert.deepEqual(decodePcx(encodePcx(opaque, 72)).raster.data, opaque.data);
  const few = createRaster(9, 4);
  for (let i = 0; i < 36; i++) few.data.set([i % 5 * 40, 0, 0, 255], i * 4);
  assert.deepEqual(decodePcx(encodePcx(few, 72, exactPalette(few, 256, false)!)).raster.data, few.data);
  assert.deepEqual(decodePnm(encodePnm(opaque, false)).raster.data, opaque.data);
});

test("pspud.flt: PSP's sample filter reads and round-trips", async () => {
  const { readFlt, writeFlt } = await import("../src/core/formats/flt.ts");
  const fs = await import("node:fs");
  const path = (process.env.JSPAINTSHOP_PSP6 ?? `${process.env.HOME}/programs/Paint Shop Pro 6`) + "/pspud.flt";
  if (!fs.existsSync(path)) return;
  const f = readFlt(new Uint8Array(fs.readFileSync(path)));
  assert.equal(f[0].name, "Sample Blur");
  assert.equal(f[0].div, 9);
  assert.equal(f[0].matrix.filter((x) => x === 1).length, 9);
  assert.deepEqual(readFlt(writeFlt(f)), f);
});

test("Transparent GIF export: matching color, existing areas, color count, web-safe", async () => {
  const { prepareGif, GIF_WIZARD_COLORS } = await import("../src/core/formats/gif-export.ts");
  const r = createRaster(4, 1);
  r.data.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 100, 0, 0, 0, 0]);
  const base = { color: [255, 0, 0, 255] as [number, number, number, number], background: [255, 255, 255, 255] as [number, number, number, number], webSafe: false, colors: 256 };
  const c = prepareGif(r, { ...base, transparency: "color" });
  assert.equal(c.raster.data[3], 0);
  assert.equal(c.indexed.indices[0], c.indexed.transparent);
  // The 100/255 blue pixel blends over white and stays opaque.
  assert.equal(c.raster.data[11], 255);
  assert.ok(c.raster.data[8] > 100);
  const e = prepareGif(r, { ...base, transparency: "existing" });
  assert.equal(e.raster.data[11], 0);
  assert.equal(e.raster.data[15], 0);
  const n = prepareGif(r, { ...base, transparency: "none" });
  assert.equal(n.indexed.transparent, -1);
  const w = prepareGif(r, { ...base, transparency: "existing", webSafe: true });
  assert.equal(w.indexed.palette.length / 3, 217);
  assert.deepEqual(GIF_WIZARD_COLORS, [256, 181, 128, 91, 64, 45, 32, 23, 16]);
});

test("TIFF: LZW round trip, RGB and RGBA, several strips, resolution", async () => {
  const { decodeTiff, encodeTiff, lzwDecode, lzwEncode } = await import("../src/core/formats/tiff.ts");
  const { inflate } = await import("../src/core/formats/zlib.ts");
  const text = new TextEncoder().encode("TOBEORNOTTOBEORTOBEORNOT#".repeat(400));
  assert.deepEqual(lzwDecode(lzwEncode(text), text.length), text);
  const noisy = Uint8Array.from({ length: 70000 }, (_, i) => (i * 7919) % 251);
  assert.deepEqual(lzwDecode(lzwEncode(noisy), noisy.length), noisy);
  const r = gradient(130, 90, false);
  const back = await decodeTiff(encodeTiff(r, 150), inflate);
  assert.deepEqual(back.raster.data, r.data);
  assert.equal(back.dpi, 150);
  const t = gradient(40, 30, true);
  const plain = await decodeTiff(encodeTiff(t, 72, false), inflate);
  assert.deepEqual(plain.raster.data, t.data);
});

test("PSD: layers with position, opacity, blend, visibility and mask round trip", async () => {
  const { readPsd, writePsd } = await import("../src/core/formats/psd.ts");
  const { newImage, rasterLayer } = await import("../src/core/doc/image-doc.ts");
  const doc = newImage(40, 30, 150, [255, 255, 255, 255]);
  const top = rasterLayer("Top", gradient(20, 10, true), 5, 7);
  top.opacity = 128; top.blend = 7; top.visible = false;
  top.mask = { width: 40, height: 30, data: Uint8Array.from({ length: 1200 }, (_, i) => i % 255) };
  doc.layers.push(top);
  const back = await readPsd(writePsd(doc, doc.layers[0].raster));
  assert.equal(back.doc.layers.length, 2);
  assert.equal(back.doc.dpi, 150);
  const t = back.doc.layers[1];
  assert.deepEqual([t.name, t.x, t.y, t.opacity, t.blend, t.visible], ["Top", 5, 7, 128, 7, false]);
  assert.deepEqual(t.raster.data, top.raster.data);
  assert.deepEqual(t.mask?.data, top.mask.data);
});

test("legacy formats: IFF ILBM, MSP, MacPaint, ICO and CLP", async () => {
  const L = await import("../src/core/formats/legacy.ts");
  const be32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const be16 = (v: number) => [(v >> 8) & 255, v & 255];
  const chunk = (id: string, data: number[]) => [...[...id].map((c) => c.charCodeAt(0)), ...be32(data.length), ...data, ...(data.length & 1 ? [0] : [])];
  // A 16 x 2 ILBM with 2 planes, ByteRun1: row 0 is color 1, row 1 color 2.
  const bmhd = [...be16(16), ...be16(2), 0, 0, 0, 0, 2, 0, 1, 0, 0, 0, 10, 11, ...be16(16), ...be16(2)];
  const cmap = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255];
  const body = [0xff, 0xff, 0xff, 0x00, 0xff, 0x00, 0xff, 0xff, 0xff];
  const form = [...chunk("BMHD", bmhd), ...chunk("CMAP", cmap), ...chunk("BODY", body)];
  const iff = Uint8Array.from([..."FORM"].map((c) => c.charCodeAt(0)).concat(be32(form.length + 4), [..."ILBM"].map((c) => c.charCodeAt(0)), form));
  assert.ok(L.isIff(iff));
  const img = L.decodeIff(iff);
  assert.deepEqual([...img.raster.data.subarray(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...img.raster.data.subarray(16 * 4, 16 * 4 + 4)], [0, 255, 0, 255]);
  // MSP 1: 8 x 1, the first pixel black (0 bit), the rest white.
  const msp = new Uint8Array(33); msp.set([..."DanM"].map((c) => c.charCodeAt(0))); msp.set([8, 0, 1, 0], 4); msp[32] = 0x7f;
  const m = L.decodeMsp(msp);
  assert.deepEqual([m.raster.data[0], m.raster.data[4]], [0, 255]);
  // MacPaint: a run of 0xFF bytes is a black row.
  const mac = new Uint8Array(512 + 2 + 720 * 2);
  mac[512] = (256 - 71) & 255; mac[513] = 0xff; // -71: 72 bytes of 0xFF
  for (let y = 1; y < 720; y++) { mac[512 + y * 2] = (256 - 71) & 255; mac[513 + y * 2] = 0; }
  const mp = L.decodeMacPaint(mac);
  assert.equal(mp.raster.width, 576);
  assert.equal(mp.raster.data[0], 0);
  assert.equal(mp.raster.data[576 * 4], 255);
  // A 2 x 2 32-bit icon.
  const dib = [40, 0, 0, 0, 2, 0, 0, 0, 4, 0, 0, 0, 1, 0, 32, 0, ...Array(24).fill(0)];
  const px = [0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255, 255, 255, 255, 128];
  const mask = Array(8).fill(0);
  const icoData = [...dib, ...px, ...mask];
  const ico = Uint8Array.from([0, 0, 1, 0, 1, 0, 2, 2, 0, 0, 1, 0, 32, 0, icoData.length, 0, 0, 0, 22, 0, 0, 0, ...icoData]);
  assert.ok(L.isIco(ico));
  const ic = L.decodeIco(ico);
  // Bottom-up: the first stored row is the bottom one.
  assert.deepEqual([...ic.raster.data.subarray(8, 12)], [255, 0, 0, 255]);
  assert.deepEqual([...ic.raster.data.subarray(12, 16)], [0, 255, 0, 255]);
  // A clipboard file whose CF_DIB is a 1 x 1 24-bit bitmap.
  const cdib = [40, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 24, 0, ...Array(24).fill(0), 10, 20, 30, 0];
  const clp = new Uint8Array(4 + 89 + cdib.length);
  clp.set([0x50, 0xc3, 1, 0, 8, 0]);
  new DataView(clp.buffer).setUint32(6, cdib.length, true);
  new DataView(clp.buffer).setUint32(10, 4 + 89, true);
  clp.set(cdib, 4 + 89);
  const c = L.decodeClp(clp);
  assert.deepEqual([...c.raster.data.subarray(0, 3)], [30, 20, 10]);
});

test("PICT: a version 2 DirectBitsRect picture", async () => {
  const { decodePict, isPict } = await import("../src/core/formats/pict.ts");
  const w16 = (v: number) => [(v >> 8) & 255, v & 255], w32 = (v: number) => [...w16(v >>> 16), ...w16(v & 0xffff)];
  const rect = [...w16(0), ...w16(0), ...w16(1), ...w16(2)];
  const body = [
    ...w16(0), ...rect, 0x00, 0x11, 0x02, 0xff, 0x0c, 0x00, ...Array(24).fill(0),
    0x00, 0x9a, ...w32(0xff), ...w16(0x8008), ...rect, ...w16(0), ...w16(1), ...w32(0), ...w32(0x480000), ...w32(0x480000),
    ...w16(16), ...w16(32), ...w16(3), ...w16(8), ...w32(0), ...w32(0), ...w32(0), ...rect, ...rect, ...w16(0),
    0, 10, 20, 30, 0, 40, 50, 60, 0x00, 0xff,
  ];
  const b = Uint8Array.from([...Array(512).fill(0), ...body]);
  assert.ok(isPict(b));
  const r = decodePict(b);
  assert.deepEqual([r.raster.width, r.raster.height, r.dpi], [2, 1, 72]);
  assert.deepEqual([...r.raster.data], [10, 20, 30, 255, 40, 50, 60, 255]);
});

test("WPG: a 1-bit bitmap record with RLE runs and a repeated row", async () => {
  const { decodeWpg, isWpg } = await import("../src/core/formats/legacy.ts");
  const head = [0xff, 0x57, 0x50, 0x43, 16, 0, 0, 0, 1, 0x16, 1, 0, 0, 0, 0, 0];
  // 16 x 2 at 1 bit: row 0 is 0xFF 0x00 (a run of 0xFF, then one literal), row 1 repeats it.
  const data = [16, 0, 2, 0, 1, 0, 75, 0, 75, 0, 0x81, 0xff, 0x01, 0x00, 0x00, 0x01];
  const rec = [0x0b, data.length, ...data, 0x10, 0x00];
  const b = Uint8Array.from([...head, ...rec]);
  assert.ok(isWpg(b));
  const r = decodeWpg(b);
  assert.deepEqual([r.raster.width, r.raster.height, r.dpi], [16, 2, 75]);
  // Bit 1 is palette entry 1 (white), 0 is black.
  assert.equal(r.raster.data[0], 255);
  assert.equal(r.raster.data[8 * 4], 0);
  assert.equal(r.raster.data[16 * 4], 255);
});
