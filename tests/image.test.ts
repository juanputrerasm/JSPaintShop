/* The image model, compositing, zoom steps and color reduction. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { newImage, describeImage, rasterLayer, defaultPalette } from "../src/core/doc/image-doc.ts";
import { composite } from "../src/core/layers/composite.ts";
import { createRaster } from "../src/core/image/raster.ts";
import { stepZoom, zoomLabel, zoomScale, fitZoom } from "../src/core/view/zoom.ts";
import { medianCut } from "../src/core/color/quantize.ts";
import { memoryText } from "../src/ui/dialogs/new-image.ts";

test("new images: Background when filled, Layer1 when transparent", () => {
  const a = newImage(10, 5, 72, [255, 255, 255, 255]);
  assert.equal(a.layers[0].name, "Background");
  assert.equal(a.layers[0].raster.data[0], 255);
  assert.equal(newImage(10, 5, 72, [0, 0, 0, 0]).layers[0].name, "Layer1");
  assert.equal(describeImage(a), "10 x 5 x 16 Million");
  assert.equal(describeImage(newImage(1, 1, 72, [0, 0, 0, 255], 8, true)), "1 x 1 x Greyscale");
});

test("default palettes have the right sizes", () => {
  assert.equal(defaultPalette(1, false).length, 6);
  assert.equal(defaultPalette(4, false).length, 48);
  assert.equal(defaultPalette(8, false).length, 768);
});

test("compositing: opacity, offsets, hidden layers", () => {
  const doc = newImage(4, 4, 72, [0, 0, 255, 255]);
  const top = createRaster(2, 2, [255, 0, 0, 255]);
  doc.layers.push({ ...rasterLayer("Layer1", top, 1, 1), opacity: 128 });
  const c = composite(doc);
  const at = (x: number, y: number) => [...c.data.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4)];
  assert.deepEqual(at(0, 0), [0, 0, 255, 255]);
  const mid = at(1, 1);
  assert.ok(Math.abs(mid[0] - 128) <= 1 && Math.abs(mid[2] - 127) <= 1 && mid[3] === 255);
  doc.layers[1].visible = false;
  assert.deepEqual([...composite(doc).data.subarray(20, 24)], [0, 0, 255, 255]);
});

test("compositing onto transparency keeps the layer's color", () => {
  const doc = newImage(1, 1, 72, [0, 0, 0, 0]);
  doc.layers.push(rasterLayer("Layer2", createRaster(1, 1, [200, 100, 50, 128])));
  assert.deepEqual([...composite(doc).data], [200, 100, 50, 128]);
});

test("zoom steps along PSP's ladder", () => {
  assert.equal(stepZoom(1, 1), 2);
  assert.equal(stepZoom(1, -1), -2);
  assert.equal(stepZoom(-2, 1), 1);
  assert.equal(stepZoom(3, -5), -4);
  assert.equal(stepZoom(30, 5), 32);
  assert.equal(stepZoom(-20, -5), -24);
  assert.equal(zoomLabel(-3), "1:3");
  assert.equal(zoomScale(-4), 0.25);
  assert.equal(fitZoom(100, 100, 500, 500), 1);
  assert.equal(fitZoom(1000, 400, 500, 500), -2);
});

test("median cut keeps to the palette size", () => {
  const r = createRaster(64, 64);
  for (let i = 0; i < 64 * 64; i++) r.data.set([i & 255, (i >> 4) & 255, (i * 7) & 255, 255], i * 4);
  for (const max of [2, 16, 256]) {
    const q = medianCut(r, max, false);
    assert.ok(q.palette.length / 3 <= max);
    assert.ok(q.indices.every((k) => k < max));
  }
});

test("New Image's memory line", () => {
  assert.equal(memoryText(500, 500, 4), "Memory required: 732.4 KBytes");
  assert.equal(memoryText(2000, 2000, 4), "Memory required: 11.4 MBytes");
});

test("Decrease Color Depth: PSP's octree, web cube, ordered dither and error diffusion", async () => {
  const { octreePalette, pspDither, webSafePalette, WINDOWS_16 } = await import("../src/core/color/reduce.ts");
  const { createRaster } = await import("../src/core/image/raster.ts");
  const img = (w: number, h: number, f: (x: number, y: number) => number[]) => {
    const r = createRaster(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) r.data.set([...f(x, y), 255], (y * w + x) * 4);
    return r;
  };
  // Few colors come back exactly, in tree order (red's bit first).
  const four = img(4, 1, (x) => [[10, 20, 30], [200, 0, 0], [0, 200, 0], [10, 20, 30]][x]);
  assert.deepEqual([...octreePalette(four, 256)], [10, 20, 30, 0, 200, 0, 200, 0, 0]);
  // A gradient reduced to 8 colors: never more leaves than asked.
  const grad = img(64, 64, (x, y) => [x * 4, y * 4, (x + y) * 2]);
  assert.ok(octreePalette(grad, 8).length / 3 <= 8);
  const withWindows = octreePalette(four, 256, true);
  assert.deepEqual([...withWindows.subarray(0, 3), ...withWindows.subarray(-3)], [0, 0, 0, 255, 255, 255]);
  assert.equal(withWindows.length / 3, 23);
  // PSP's cube: entry r + 6g + 36b.
  const cube = webSafePalette();
  assert.deepEqual([...cube.subarray(3, 6)], [51, 0, 0]);
  assert.deepEqual([...cube.subarray(36 * 3, 36 * 3 + 3)], [0, 0, 51]);
  // Ordered dither on the cube: exact cube colors stay; mid values mix the two levels around them.
  const flat = img(16, 16, () => [102, 25, 255]);
  const idx = pspDither(flat, cube, "ordered");
  assert.ok(idx.every((k) => k % 6 === 2 && Math.floor(k / 36) === 5));
  const greens = new Set([...idx].map((k) => Math.floor(k / 6) % 6));
  assert.deepEqual([...greens].sort(), [0, 1]);
  // 16 colors: greys pick black, grey, silver or white.
  const grey = pspDither(img(16, 16, () => [100, 100, 100]), Uint8Array.from(WINDOWS_16), "ordered", false, 16);
  assert.deepEqual([...new Set(grey)].sort((a, b) => a - b), [0, 8]);
  // Error diffusion keeps the average: 25 % grey on black and white is about a quarter white.
  const bw = Uint8Array.from([0, 0, 0, 255, 255, 255]);
  const q = pspDither(img(32, 32, () => [64, 64, 64]), bw, "error");
  const white = [...q].filter((k) => k === 1).length / q.length;
  assert.ok(Math.abs(white - 0.25) < 0.03, `${white}`);
  // Reduce color bleeding carries less error: fewer white pixels.
  const q2 = pspDither(img(32, 32, () => [64, 64, 64]), bw, "error", true);
  assert.ok([...q2].filter((k) => k === 1).length < [...q].filter((k) => k === 1).length);
});

test("Color Balance tables (Psp.exe 0x4243e0)", async () => {
  const { colorBalanceTables } = await import("../src/core/color/adjustments.ts");
  const [r, g, b] = colorBalanceTables([0, 0, 0], [0, 0, 0], [0, 0, 0], true);
  assert.deepEqual([...r], Array.from({ length: 256 }, (_, i) => i));
  assert.deepEqual([...g], [...b]);
  // Highlights toward red lower red's white input; shadows toward cyan raise its black input.
  const [hr, hg] = colorBalanceTables([40, 0, 0], [0, 0, 0], [0, 0, 0], false);
  assert.equal(hr[215], 255);
  assert.ok(hg[215] < 255);
  const [sr] = colorBalanceTables([0, 0, 0], [0, 0, 0], [-30, 0, 0], false);
  assert.equal(sr[30], 0);
  assert.ok(sr[31] >= 0 && sr[200] > 0);
  // Preserve Luminosity: equal moves on all channels cancel.
  const [pr] = colorBalanceTables([30, 30, 30], [0, 0, 0], [-20, -20, -20], true);
  assert.deepEqual([...pr], Array.from({ length: 256 }, (_, i) => i));
});

test("Hue/Saturation adjustment layer (Psp.exe 0x425fe0, 0x824770)", async () => {
  const { applyAdjustment, defaultAdjustment, hueSaturationTables } = await import("../src/core/color/adjustments.ts");
  const a = defaultAdjustment("hueSaturation");
  assert.ok(a.type === "hueSaturation");
  const px = () => new Uint8ClampedArray([200, 40, 40, 255, 40, 200, 40, 255]);
  // Neutral: red (hue 0) is unchanged; the degree round trip moves other hues by a step,
  // as in PSP (hue 85 → 119° → 84).
  const d = px();
  applyAdjustment(d, a);
  assert.deepEqual([...d.subarray(0, 4)], [200, 40, 40, 255]);
  assert.ok(Math.abs(d[4] - 40) <= 6 && d[5] === 200);
  // Only the reds: full from 345 to 15 degrees, ramps either side; greens stay.
  a.ranges[0][1] = -100;
  const [, sat] = hueSaturationTables(a);
  assert.equal(sat[0], -255);
  assert.equal(sat[120], 0);
  assert.equal(sat[330], Math.trunc((Math.trunc((-100 * 15) / 30) * 255) / 100));
  const e = px();
  applyAdjustment(e, a);
  assert.equal(e[0], e[1]);
  assert.deepEqual([...e.subarray(4, 8)], [...d.subarray(4, 8)]);
  // Colorize: the hue and saturation are set, the lightness stays.
  const c = defaultAdjustment("hueSaturation");
  assert.ok(c.type === "hueSaturation");
  c.colorize = true; c.colorizeValues = [120, 100, 0];
  const f = px();
  applyAdjustment(f, c);
  assert.ok(f[1] > f[0] && f[1] > f[2]);
});
