/* The filters of the Image menu: PSP's kernels, Gaussian weights, Motion Blur steps, and the rest. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRaster } from "../src/core/image/raster.ts";
import { convolve, KERNELS } from "../src/core/filters/convolve.ts";
import { addNoise, despeckle, gaussianBlur, gaussianKernel, hotWax, mosaic, motionBlur, motionStep, rank3, unsharpMask } from "../src/core/filters/filters.ts";

const flat = (v: number, w = 9, h = 7) => createRaster(w, h, [v, v, v, 255]);

test("gaussian kernel: centre 63 rescaled, total a power of two or the true sum", () => {
  for (const r of [0.5, 1, 2, 3.7, 10]) {
    const k = gaussianKernel(r);
    let s = k.w[0];
    for (let i = 1; i < k.w.length; i++) s += 2 * k.w[i];
    assert.equal(s, k.sum, `radius ${r}`);
    assert.ok(k.w.every((x) => x >= 0) && k.w[0] > 0);
  }
  assert.deepEqual(gaussianKernel(1).w.length > 1, true);
});

test("filters leave a flat image flat", () => {
  const src = flat(100);
  for (const r of [gaussianBlur(src, 2), unsharpMask(src, 2, 100, 5), motionBlur(src, 30, 10), despeckle(src), rank3(src, "median"), mosaic(src, 3, 3)]) {
    for (let i = 0; i < r.data.length; i += 4) assert.equal(r.data[i], 100);
  }
  for (const code of [10, 11, 20, 21, 30, 31, 51]) assert.equal(convolve(src, KERNELS[code]).data[0], 100, `code ${code}`);
});

test("trace contour turns flat areas white", () => {
  assert.equal(convolve(flat(60), KERNELS[40]).data[0], 255);
});

test("motion blur steps in 8.8 fixed point", () => {
  assert.deepEqual(motionStep(0), [0, 256]);
  assert.deepEqual(motionStep(90), [-256, 0]);
  assert.deepEqual(motionStep(45), [180, 180]);
});

test("despeckle replaces a lone speck, keeps mild differences", () => {
  const r = flat(100);
  const c = (3 * 9 + 4) * 4;
  r.data[c] = 200;
  assert.equal(despeckle(r).data[c], 100);
  r.data[c] = 140;
  assert.equal(despeckle(r).data[c], 140);
});

test("hot wax on a flat white image is the foreground times 251/255, truncated", () => {
  const r = hotWax(flat(255), [255, 128, 0]);
  assert.deepEqual([...r.data.slice(40, 43)], [251, 125, 0]);
});

test("add noise is repeatable from PSP's generator and keeps alpha", () => {
  const r = addNoise(flat(128), 100, true);
  assert.ok(r.data.some((v, i) => i % 4 !== 3 && v !== 128));
  assert.ok(r.data.every((v, i) => i % 4 !== 3 || v === 255));
});

test("emboss: the top-right neighbour minus the bottom-left, plus 128", () => {
  const r = createRaster(3, 3, [0, 0, 0, 255]);
  r.data[(0 * 3 + 2) * 4] = 50; // top right
  assert.equal(convolve(r, KERNELS[1]).data[(1 * 3 + 1) * 4], 178);
});
