/* Image > Deformations. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRaster } from "../src/core/image/raster.ts";
import { circle } from "../src/core/deform/circle.ts";

test("circle: corners take the background, a flat image stays flat inside", () => {
  const W = 30, H = 20;
  const r = circle(createRaster(W, H, [100, 100, 100, 255]), [1, 2, 3]);
  assert.deepEqual([...r.data.slice(0, 3)], [1, 2, 3]);
  const c = ((10 * W) + 15) * 4;
  assert.ok(r.data[c] >= 98 && r.data[c] <= 100);
});

test("pentagon: top corners are background, the middle keeps a flat color", async () => {
  const { pentagon } = await import("../src/core/deform/pentagon.ts");
  const W = 40, H = 40;
  const r = pentagon(createRaster(W, H, [100, 100, 100, 255]), [1, 2, 3]);
  assert.deepEqual([...r.data.slice(0, 3)], [1, 2, 3]);
  const c = ((20 * W) + 20) * 4;
  assert.ok(r.data[c] >= 98 && r.data[c] <= 100);
});

test("wind trails a bright pixel downwind", async () => {
  const { wind } = await import("../src/core/deform/wind.ts");
  const src = createRaster(10, 1, [0, 0, 0, 255]);
  src.data.set([255, 255, 255, 255], 2 * 4);
  const r = wind(src, { strength: 10, fromRight: false });
  // v = p + trunc((v − p)·88/100): the bright pixel is pulled toward the dark before it.
  assert.equal(r.data[2 * 4], 255 - Math.trunc((255 * 88) / 100));
  assert.equal(r.data[3 * 4], Math.trunc((r.data[2 * 4] * 88) / 100));
  assert.equal(r.data[1 * 4], 0);
});

test("perspective narrows one side, flat stays flat", async () => {
  const { perspectiveHorizontal, perspectiveVertical } = await import("../src/core/deform/perspective.ts");
  const W = 30, H = 20;
  for (const f of [perspectiveHorizontal, perspectiveVertical]) {
    const r = f(createRaster(W, H, [100, 100, 100, 255]), 50, [1, 2, 3]);
    assert.ok(r.data.some((v, i) => i % 4 === 0 && v === 1));
    assert.ok(r.data.every((v, i) => i % 4 !== 0 || v === 1 || (v >= 99 && v <= 100)));
  }
});

test("wave, ripple, twirl keep a flat image (nearly) flat", async () => {
  const { wave } = await import("../src/core/deform/wave.ts");
  const { ripple } = await import("../src/core/deform/ripple.ts");
  const { twirl } = await import("../src/core/deform/twirl.ts");
  const src = createRaster(30, 20, [100, 100, 100, 255]);
  for (const r of [wave(src, { ampX: 3, lenX: 10, ampY: 3, lenY: 10 }), ripple(src, { originX: 50, originY: 50, amplitude: 4, wavelength: 8 })]) {
    assert.ok(r.data.every((v, i) => i % 4 === 3 || (v >= 97 && v <= 100)));
  }
  const t = twirl(src, 180);
  assert.ok(t.data[(10 * 30 + 15) * 4] >= 97);
});

test("pinch core: 100 / 100 is the identity, flat stays flat", async () => {
  const { pinchCore, pinch, cylinderHorizontal } = await import("../src/core/deform/pinch.ts");
  const src = createRaster(20, 16, [0, 0, 0, 255]);
  for (let i = 0; i < src.data.length; i += 4) src.data[i] = (i / 4) % 251;
  assert.deepEqual([...pinchCore(src, 100, 100).data], [...src.data]);
  const flat = createRaster(20, 16, [90, 90, 90, 255]);
  for (const r of [pinch(flat, 50), cylinderHorizontal(flat, 50)]) assert.ok(r.data.every((v, i) => i % 4 === 3 || (v >= 88 && v <= 90)));
});

test("mirror, warp, curlyQs, spiky halo keep a flat image nearly flat", async () => {
  const m = await import("../src/core/deform/mirror.ts");
  const src = createRaster(30, 20, [100, 100, 100, 255]);
  for (const r of [m.rotatingMirror(src, { horizontal: 0, vertical: 0, rotation: 30 }), m.warp(src, m.WARP_DEFAULTS), m.curlyQs(src, m.CURLY_DEFAULTS), m.spikyHalo(src, m.HALO_DEFAULTS)]) {
    assert.ok(r.data.every((v, i) => i % 4 === 3 || (v >= 96 && v <= 100)));
  }
});

test("projective: the identity quad returns the image; a scaled quad scales", async () => {
  const { quadMatrix, warpProjective } = await import("../src/core/deform/projective.ts");
  const src = createRaster(8, 6, [0, 0, 0, 255]);
  for (let i = 0; i < src.data.length; i += 4) src.data[i] = i / 4;
  const id = quadMatrix({ x: 0, y: 0, w: 8, h: 6 }, [[0, 0], [8, 0], [8, 6], [0, 6]]);
  assert.deepEqual([...warpProjective(src, id, 8, 6, false).data], [...src.data]);
  const big = warpProjective(src, quadMatrix({ x: 0, y: 0, w: 8, h: 6 }, [[0, 0], [16, 0], [16, 12], [0, 12]]), 16, 12, false);
  assert.equal(big.data[(2 * 16 + 2) * 4], src.data[(1 * 8 + 1) * 4]);
});

test("skew: PSP's spans per row (25 degrees on a 20 x 10 image: D = 4, centred by 2)", async () => {
  const { skew } = await import("../src/core/deform/skew.ts");
  const { createRaster } = await import("../src/core/image/raster.ts");
  const r = createRaster(20, 10);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 20; x++) r.data.set([x * 10, y, 0, 255], (y * 20 + x) * 4);
  const out = skew(r, { horizontal: 25, vertical: 0 }, [1, 2, 3]);
  const red = (x: number, y: number) => out.data[(y * 20 + x) * 4];
  // Bottom row: columns 0..18 take source columns 2..20; column 19 is background.
  assert.equal(red(0, 9), 20);
  assert.deepEqual([...out.data.subarray((9 * 20 + 19) * 4, (9 * 20 + 19) * 4 + 3)], [1, 2, 3]);
  // Top row starts at column 3 - 2 = 1.
  assert.deepEqual([...out.data.subarray(0, 3)], [1, 2, 3]);
  assert.equal(red(1, 0), 0);
});

test("pentagon: corners and the even-width top row are background, the middle is the image", async () => {
  const { pentagon } = await import("../src/core/deform/pentagon.ts");
  const { createRaster } = await import("../src/core/image/raster.ts");
  const r = createRaster(100, 80, [200, 200, 200, 255]);
  const out = pentagon(r, [9, 9, 9]);
  const at = (x: number, y: number) => [...out.data.subarray((y * 100 + x) * 4, (y * 100 + x) * 4 + 3)];
  assert.deepEqual(at(0, 0), [9, 9, 9]);
  assert.deepEqual(at(99, 79), [9, 9, 9]);
  assert.deepEqual(at(50, 50), [200, 200, 200]);
  // The width (2 · R0) is even, so the pentagon's top row is left out.
  assert.deepEqual(at(50, 0), [9, 9, 9]);
});
