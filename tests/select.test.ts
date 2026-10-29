/* Selections, floating selections, crop, resampling, seamless patterns. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMask, createRaster, maskBounds } from "../src/core/image/raster.ts";
import { combine, feather, floodRegion, growSelection, invert, morph, outline, polygonMask, shapeMask, shiftMask, removeColor, SHAPES } from "../src/core/select/selection.ts";
import { newImage } from "../src/core/doc/image-doc.ts";
import { float, defloat, floatingIndex, pasteFloating, pasteInto, promote, clearMasked, copyRegion } from "../src/core/select/floating.ts";
import { crop, resizeCanvas } from "../src/core/image/geometry.ts";
import { resample } from "../src/core/image/resample.ts";
import { seamless } from "../src/core/select/seamless.ts";

const count = (m: { data: Uint8Array }, min = 128) => m.data.reduce((n, v) => n + (v >= min ? 1 : 0), 0);

test("rectangle and ellipse masks cover the right area", () => {
  assert.equal(count(shapeMask(20, 20, "Rectangle", 2, 3, 12, 8, false)), 50);
  const e = shapeMask(100, 100, "Circle", 0, 0, 60, 60, true);
  // PSP's circle closes with a flatter segment (its first node has no in-handle): a little under πr².
  assert.ok(Math.abs(count(e) - Math.PI * 900) < Math.PI * 900 * 0.05, String(count(e)));
  for (const s of SHAPES) assert.ok(count(shapeMask(50, 50, s, 5, 5, 45, 45, false)) > 50, s);
});

test("antialiased polygons have partial edges", () => {
  const m = polygonMask(10, 10, [[[0.5, 0.5], [9.5, 0.5], [0.5, 9.5]]], true);
  assert.ok(m.data.some((v) => v > 0 && v < 255));
});

test("combine, invert, shift", () => {
  const a = shapeMask(10, 10, "Rectangle", 0, 0, 5, 10, false), b = shapeMask(10, 10, "Rectangle", 3, 0, 10, 10, false);
  assert.equal(count(combine(a, b, "add")), 100);
  assert.equal(count(combine(a, b, "remove")), 30);
  assert.equal(count(invert(a, 10, 10)), 50);
  assert.deepEqual(maskBounds(shiftMask(a, 2, 1)), { minX: 2, minY: 1, maxX: 6, maxY: 9 });
});

test("expand, contract and feather", () => {
  const m = shapeMask(30, 30, "Rectangle", 10, 10, 20, 20, false);
  assert.deepEqual(maskBounds(morph(m, 2)), { minX: 8, minY: 8, maxX: 21, maxY: 21 });
  assert.deepEqual(maskBounds(morph(m, -2)), { minX: 12, minY: 12, maxX: 17, maxY: 17 });
  const f = feather(m, 4);
  assert.ok(f.data[15 * 30 + 15] > 240 && f.data[15 * 30 + 8] > 0 && f.data[15 * 30 + 9] < 200 && f.data[15 * 30 + 4] === 0);
});

test("magic wand: contiguous by color within tolerance, grow, transparent color", () => {
  const r = createRaster(6, 1);
  [[0, 0, 0], [10, 10, 10], [200, 0, 0], [0, 0, 0], [0, 0, 0], [5, 5, 5]].forEach((c, i) => r.data.set([...c, 255], i * 4));
  assert.deepEqual([...floodRegion(r, 0, 0, "rgb", 10).data], [255, 255, 0, 0, 0, 0]);
  assert.deepEqual([...floodRegion(r, 0, 0, "rgb", 0, false).data], [255, 0, 0, 255, 255, 0]);
  const grown = growSelection(r, floodRegion(r, 3, 0, "rgb", 0), "rgb", 10);
  assert.deepEqual([...grown.data], [0, 0, 0, 255, 255, 255]);
  const all = createMask(6, 1, 255);
  assert.deepEqual([...removeColor(r, all, [0, 0, 0], 0).data], [0, 255, 255, 0, 0, 255]);
});

test("the outline of a square is four runs", () => {
  assert.equal(outline(shapeMask(10, 10, "Rectangle", 2, 2, 6, 6, false)).length, 4);
});

test("float lifts the selected pixels, defloat drops them back", () => {
  const doc = newImage(4, 4, 72, [255, 0, 0, 255]);
  doc.selection = shapeMask(4, 4, "Rectangle", 0, 0, 2, 2, false);
  float(doc, [255, 255, 255, 255]);
  assert.equal(floatingIndex(doc), 1);
  assert.deepEqual([...doc.layers[0].raster.data.subarray(0, 4)], [255, 255, 255, 255], "the Background takes the background color");
  doc.layers[1].x = 2; // moved right two pixels
  defloat(doc);
  assert.equal(doc.layers.length, 1);
  assert.deepEqual([...doc.layers[0].raster.data.subarray(8, 12)], [255, 0, 0, 255]);
});

test("clear on a transparent layer, promote, copy region", () => {
  const doc = newImage(4, 4, 72, [0, 255, 0, 255]);
  doc.layers[0].name = "Layer1";
  doc.selection = shapeMask(4, 4, "Rectangle", 0, 0, 2, 4, false);
  const c = copyRegion(doc.layers[0].raster, doc);
  assert.deepEqual([c.raster.width, c.raster.height, c.x], [2, 4, 0]);
  promote(doc);
  assert.equal(doc.layers.length, 2);
  clearMasked(doc, doc.layers[0], doc.selection, [0, 0, 0, 255]);
  assert.equal(doc.layers[0].raster.data[3], 0);
  assert.equal(doc.layers[0].raster.data[3 * 4 + 3], 255);
});

test("paste as a selection and into a selection", () => {
  const doc = newImage(10, 10, 72, [0, 0, 0, 255]);
  const clip = createRaster(2, 2, [255, 255, 255, 255]);
  pasteFloating(doc, clip, 3, 3);
  assert.deepEqual(maskBounds(doc.selection!), { minX: 3, minY: 3, maxX: 4, maxY: 4 });
  doc.selection = shapeMask(10, 10, "Rectangle", 0, 0, 8, 6, false);
  pasteInto(doc, clip);
  const f = doc.layers[floatingIndex(doc)].raster;
  assert.equal(f.data[(5 * 10 + 7) * 4 + 3], 255);
  assert.equal(f.data[(7 * 10 + 7) * 4 + 3], 0);
});

test("crop and canvas size move every layer, mask and the selection", () => {
  const doc = newImage(10, 10, 72, [0, 0, 255, 255]);
  doc.selection = shapeMask(10, 10, "Rectangle", 2, 2, 5, 5, false);
  crop(doc, { minX: 2, minY: 2, maxX: 6, maxY: 5 }, [255, 255, 255, 255]);
  assert.deepEqual([doc.width, doc.height, doc.selection], [5, 4, null]);
  resizeCanvas(doc, 7, 4, 1, 0, [255, 255, 255, 255]);
  assert.deepEqual([...doc.layers[0].raster.data.subarray(0, 4)], [255, 255, 255, 255]);
  assert.deepEqual([...doc.layers[0].raster.data.subarray(4, 8)], [0, 0, 255, 255]);
});

test("resampling keeps flat colors flat by every method", () => {
  const r = createRaster(8, 6, [30, 60, 90, 255]);
  for (const m of ["pixel", "bilinear", "bicubic", "smart"] as const) for (const [w, h] of [[16, 12], [3, 2], [5, 9]]) {
    const out = resample(r, w, h, m);
    assert.equal(out.width, w);
    for (let i = 0; i < out.data.length; i += 4) assert.deepEqual([...out.data.subarray(i, i + 4)], [30, 60, 90, 255], `${m} ${w}x${h}`);
  }
});

test("a seamless tile's opposite edges match", () => {
  const r = createRaster(40, 40);
  for (let i = 0; i < 1600; i++) r.data.set([i % 40 * 6, Math.floor(i / 40) * 6, 0, 255], i * 4);
  const t = seamless(r, { minX: 5, minY: 5, maxX: 24, maxY: 24 });
  for (let y = 0; y < 20; y++) {
    const left = t.data[(y * 20) * 4], right = t.data[(y * 20 + 19) * 4];
    assert.ok(Math.abs(left - right) <= 12, `row ${y}`);
  }
});
