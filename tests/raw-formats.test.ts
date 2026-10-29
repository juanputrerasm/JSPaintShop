/* RAW, Scitex CT and PC Paint (docs/PSP_EXE_ANALYSIS.md section 18). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeActPalette, decodeRaw, encodeRaw, rawSizeGuesses, RAW_READ_DEFAULTS, RAW_WRITE_DEFAULTS } from "../src/core/formats/raw.ts";
import { decodeSct, encodeSct, isSct, sctCmykToRgb, sctFromRgb, sctNumber } from "../src/core/formats/scitex.ts";
import { decodePcPaint, EGA_COLORS, encodePcPaint, isPcPaint } from "../src/core/formats/pcpaint.ts";
import { detectFormat, formatByName } from "../src/core/formats/formats.ts";
import { toPalette } from "../src/core/color/quantize.ts";
import type { Raster } from "../src/core/image/raster.ts";

const rgbRaster = (W: number, H: number, f: (x: number, y: number) => [number, number, number]): Raster => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set([...f(x, y), 255], (y * W + x) * 4);
  return { width: W, height: H, data };
};
const px = (r: Raster, x: number, y: number) => [...r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 3)];

test("RAW: single channel opens as greys, or through a palette, keeping the indices", () => {
  const bytes = Uint8Array.from([9, 9, 0, 1, 2, 3]);
  const grey = decodeRaw(bytes, { ...RAW_READ_DEFAULTS, width: 2, height: 2, header: 2 });
  assert.equal(grey.depth, 8);
  assert.equal(grey.greyscale, true);
  assert.deepEqual(px(grey.raster, 1, 1), [3, 3, 3]);
  const pal = new Uint8Array(768);
  pal.set([10, 20, 30], 3 * 3);
  const colored = decodeRaw(bytes, { ...RAW_READ_DEFAULTS, width: 2, height: 2, header: 2, flipped: true, palette: pal });
  assert.equal(colored.greyscale, false);
  assert.deepEqual(px(colored.raster, 1, 0), [10, 20, 30]);
  assert.deepEqual([...colored.indices!], [2, 3, 0, 1]);
  assert.throws(() => decodeRaw(bytes, { ...RAW_READ_DEFAULTS, width: 3, height: 3 }), /needs 9 bytes/);
});

test("RAW: RGB interleaved and planar, both orders, and CMY / CMYK", () => {
  const img = rgbRaster(3, 2, (x, y) => [x * 50, y * 70, 200 - x]);
  for (const planar of [false, true]) for (const bgr of [false, true]) for (const flipped of [false, true]) {
    const o = { ...RAW_WRITE_DEFAULTS, header: 4, planar, bgr, flipped };
    const back = decodeRaw(encodeRaw(img, o), { ...RAW_READ_DEFAULTS, width: 3, height: 2, channels: "rgb", header: 4, planar, bgr, flipped });
    assert.deepEqual([...back.raster.data], [...img.data], `planar ${planar} bgr ${bgr} flipped ${flipped}`);
  }
  // Interleaved BGR bytes, top down.
  const bytes = encodeRaw(img, { ...RAW_WRITE_DEFAULTS, bgr: true });
  assert.deepEqual([...bytes.subarray(0, 3)], [200, 0, 0]);
  const cmy = decodeRaw(Uint8Array.from([255, 0, 55]), { ...RAW_READ_DEFAULTS, width: 1, height: 1, channels: "cmy" });
  assert.deepEqual(px(cmy.raster, 0, 0), [0, 255, 200]);
  const cmyk = decodeRaw(Uint8Array.from([100, 0, 200, 100]), { ...RAW_READ_DEFAULTS, width: 1, height: 1, channels: "cmyk" });
  assert.deepEqual(px(cmyk.raster, 0, 0), [55, 155, 0]);
});

test("RAW: paletted images save one index a pixel, keeping repeated palette colors", () => {
  const pal = new Uint8Array(768);
  pal.set([0, 0, 0], 0); pal.set([7, 7, 7], 205 * 3); pal.set([0, 0, 0], 9 * 3);
  const raw = Uint8Array.from([0, 9, 205, 9]);
  const d = decodeRaw(raw, { ...RAW_READ_DEFAULTS, width: 2, height: 2, palette: pal });
  const idx = toPalette(d.raster, pal, d.indices).indices;
  assert.deepEqual([...encodeRaw(d.raster, RAW_WRITE_DEFAULTS, idx)], [0, 9, 205, 9]);
  // Without the hint the black pixels all become entry 0.
  assert.deepEqual([...toPalette(d.raster, pal).indices], [0, 0, 205, 0]);
});

test("RAW: size guesses (OpenPhotex texture sides, JSPod sizes, factor pairs)", () => {
  assert.deepEqual(rawSizeGuesses(65536)[0], { width: 256, height: 256, channels: "grey", why: "square texture" });
  assert.deepEqual(rawSizeGuesses(1024)[0], { width: 32, height: 32, channels: "grey", why: "square texture" });
  assert.deepEqual(rawSizeGuesses(64000)[0], { width: 320, height: 200, channels: "grey", why: "screen size" });
  assert.deepEqual(rawSizeGuesses(65536 * 3).find((g) => g.channels === "rgb"), { width: 256, height: 256, channels: "rgb", why: "square texture" });
  const nonSquare = rawSizeGuesses(32768);
  assert.deepEqual([nonSquare[0].width, nonSquare[0].height], [256, 128]);
  assert.deepEqual([nonSquare[1].width, nonSquare[1].height], [128, 256]);
  assert.deepEqual([rawSizeGuesses(4096 + 32, 32)[0].width], [64]);
  assert.ok(rawSizeGuesses(7).length > 0);
});

test("RAW: .ACT palettes, 6-bit only when the brightest channel is 63", () => {
  const vga = new Uint8Array(768); vga[0] = 63; vga[1] = 32;
  assert.deepEqual([...decodeActPalette(vga)!.subarray(0, 2)], [255, 130]);
  const dark = new Uint8Array(772); dark[0] = 60;
  assert.equal(decodeActPalette(dark)![0], 60);
  assert.equal(decodeActPalette(new Uint8Array(100)), null);
});

test("Scitex CT: header, CMYK conversion and round trip", () => {
  assert.equal(sctNumber(2.5), "+.25000000E+01");
  assert.equal(sctNumber(0.05), "+.50000000E-01");
  assert.deepEqual(sctCmykToRgb(255, 255, 255, 255), [255, 255, 255]);
  assert.deepEqual(sctCmykToRgb(0, 0, 0, 0), [0, 0, 0]);
  const img = rgbRaster(5, 3, (x, y) => [x * 60, 255 - y * 100, 128]);
  const bytes = encodeSct(img, 300, "TEST");
  assert.ok(isSct(bytes));
  assert.equal(bytes.length, 0x800 + 6 * 4 * 3);
  assert.equal(String.fromCharCode(...bytes.subarray(0x420, 0x42c)), "+00000000003");
  const back = decodeSct(bytes);
  assert.equal(back.dpi, 300);
  for (let i = 0; i < img.data.length; i++) assert.ok(Math.abs(back.raster.data[i] - img.data[i]) <= 2, `byte ${i}: ${back.raster.data[i]} vs ${img.data[i]}`);
  assert.deepEqual(sctFromRgb(255, 255, 255, true), [255, 255, 255, 255]);
  assert.equal(detectFormat(bytes, "x.ct")?.id, "sct");
});

test("PC Paint: 1, 4 and 8-bit round trips, bottom-up rows, EGA planes", () => {
  for (const depth of [1, 4, 8] as const) {
    const W = 13, H = 4, n = 1 << depth;
    const pal = Uint8Array.from({ length: n * 3 }, (_, i) => (i * 37) & 0xfc);
    const idx = Uint8Array.from({ length: W * H }, (_, i) => (i < 6 ? 0 : (i * 7) % n));
    const bytes = encodePcPaint(idx, W, H, pal, depth);
    assert.ok(isPcPaint(bytes));
    const back = decodePcPaint(bytes);
    assert.equal(back.depth, depth);
    assert.deepEqual([...back.indices!], [...idx], `depth ${depth}`);
    if (depth > 1) assert.deepEqual([...back.palette!.subarray(0, 6)], [...pal.subarray(0, 6)]);
  }
  // Four 1-bit planes, uncompressed, EGA palette: pixel 0 has planes 0 and 2 set = 5.
  const head = [0x34, 0x12, 8, 0, 1, 0, 0, 0, 0, 0, 0x31, 0xff, 0, 3, 0, 16, 0];
  const egaMap = Array.from({ length: 16 }, (_, i) => i);
  egaMap[5] = 0x3f;
  const file = Uint8Array.from([...head, ...egaMap, 0, 0, 0x80, 0x00, 0x80, 0x00]);
  const ega = decodePcPaint(file);
  assert.equal(ega.depth, 4);
  assert.equal(ega.indices![0], 5);
  assert.deepEqual(px(ega.raster, 0, 0), [255, 255, 255]);
  assert.deepEqual([...EGA_COLORS.subarray(3, 6)], [0, 0, 0xaa]);
  assert.equal(detectFormat(file, "a.pic")?.id, "pic");
  assert.equal(formatByName("a.raw")?.id, "raw");
  assert.equal(detectFormat(new Uint8Array(10), "a.RAW")?.id, "raw");
});
