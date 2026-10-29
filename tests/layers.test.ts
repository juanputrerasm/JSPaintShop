/* Blend modes, masks, adjustment layers, undo snapshots and the Layers menu operations. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { newImage, rasterLayer, type ImageDoc } from "../src/core/doc/image-doc.ts";
import { createRaster, createMask } from "../src/core/image/raster.ts";
import { composite } from "../src/core/layers/composite.ts";
import { blendPixel, Blend } from "../src/core/layers/blend.ts";
import { transact } from "../src/core/edit/snapshot.ts";
import { addRasterLayer, arrangeLayer, deleteLayer, duplicateLayer, flatten, mergeVisible, removeMatte, nextLayerName, moveLayer } from "../src/core/layers/layer-ops.ts";
import { defaultAdjustment } from "../src/core/color/adjustments.ts";

function px(mode: number, base: number[], top: number[], sa = 1): number[] {
  const d = new Uint8ClampedArray([...base, 255]);
  blendPixel(d, 0, mode, top[0], top[1], top[2], 255, Math.round(sa * 255), 0, 0);
  return [...d.subarray(0, 3)];
}

test("separable blend modes", () => {
  assert.deepEqual(px(Blend.Multiply, [200, 100, 0], [128, 255, 255]), [100, 100, 0]);
  assert.deepEqual(px(Blend.Screen, [0, 255, 128], [0, 0, 128]), [0, 255, 192]);
  assert.deepEqual(px(Blend.Darken, [10, 200, 50], [100, 100, 100]), [10, 100, 50]);
  assert.deepEqual(px(Blend.Lighten, [10, 200, 50], [100, 100, 100]), [100, 200, 100]);
  assert.deepEqual(px(Blend.Difference, [200, 50, 0], [50, 200, 0]), [150, 150, 0]);
  assert.deepEqual(px(Blend.Exclusion, [255, 0, 255], [255, 255, 0]), [0, 255, 255]);
  assert.deepEqual(px(Blend.Normal, [0, 0, 0], [255, 255, 255], 0.5), [128, 128, 128]);
  // Overlay and Hard Light halve with a shift, as PSP does: 100·200 >> 7 = 156.
  assert.deepEqual(px(Blend.Overlay, [100, 100, 100], [200, 200, 200]), [156, 156, 156]);
});

test("HSL blend modes keep what they should", () => {
  // Luminance from the layer: a grey layer on red gives a red of the grey's lightness.
  const lum = px(Blend.Luminance, [255, 0, 0], [64, 64, 64]);
  assert.ok(lum[0] > lum[1] && lum[1] === lum[2]);
  // Color from the layer onto grey keeps the grey's lightness: still grey when the layer is grey.
  assert.deepEqual(px(Blend.Color, [128, 128, 128], [90, 90, 90]), [128, 128, 128]);
});

test("Dissolve shows each pixel fully or not at all", () => {
  for (let x = 0; x < 50; x++) {
    const d = new Uint8ClampedArray([0, 0, 0, 255]);
    blendPixel(d, 0, Blend.Dissolve, 255, 255, 255, 255, 128, x, 7);
    assert.ok(d[0] === 0 || d[0] === 255);
  }
});

test("layer masks and adjustment layers", () => {
  const doc = newImage(2, 1, 72, [100, 100, 100, 255]);
  const top = rasterLayer("Top", createRaster(2, 1, [200, 0, 0, 255]));
  top.mask = createMask(2, 1);
  top.mask.data[1] = 255;
  doc.layers.push(top);
  let c = composite(doc);
  assert.deepEqual([...c.data], [100, 100, 100, 255, 200, 0, 0, 255]);
  top.maskEnabled = false;
  assert.deepEqual([...composite(doc).data.subarray(0, 4)], [200, 0, 0, 255]);
  doc.layers.push({ ...rasterLayer("Inv", createRaster(1, 1)), kind: "adjustment", adjustment: defaultAdjustment("invert") });
  c = composite(doc);
  assert.deepEqual([...c.data.subarray(0, 4)], [55, 255, 255, 255]);
  assert.deepEqual([...composite(doc, undefined, undefined, { only: 0 }).data.subarray(0, 4)], [100, 100, 100, 255]);
});

test("undo snapshots: a step restores and replays, and an empty step is none", () => {
  const doc = newImage(4, 4, 72, [255, 255, 255, 255]);
  const step = transact(doc, "New Raster Layer", (d) => { addRasterLayer(d); })!;
  assert.equal(doc.layers.length, 2);
  step.undo();
  assert.equal(doc.layers.length, 1);
  assert.equal(doc.active, 0);
  step.redo();
  assert.equal(doc.layers.length, 2);
  assert.equal(transact(doc, "Nothing", () => {}), null);
  const opacity = transact(doc, "Opacity", (d) => { d.layers[1].opacity = 10; })!;
  opacity.undo();
  assert.equal(doc.layers[1].opacity, 255);
});

function three(): ImageDoc {
  const doc = newImage(2, 2, 72, [0, 0, 255, 255]);
  addRasterLayer(doc);
  addRasterLayer(doc);
  return doc;
}

test("layer names, duplicate, delete, arrange, move", () => {
  const doc = three();
  assert.deepEqual(doc.layers.map((l) => l.name), ["Background", "Layer1", "Layer2"]);
  assert.equal(nextLayerName(doc), "Layer3");
  duplicateLayer(doc);
  assert.equal(doc.layers[3].name, "Copy of Layer2");
  assert.notEqual(doc.layers[3].raster, doc.layers[2].raster);
  deleteLayer(doc);
  assert.equal(doc.layers.length, 3);
  doc.active = 0;
  arrangeLayer(doc, "top");
  assert.deepEqual(doc.layers.map((l) => l.name), ["Layer1", "Layer2", "Background"]);
  assert.equal(doc.active, 2);
  moveLayer(doc, 2, 0);
  assert.equal(doc.layers[0].name, "Background");
});

test("merge visible keeps hidden layers, flatten makes one opaque Background", () => {
  const doc = three();
  doc.layers[1].raster = createRaster(2, 2, [255, 0, 0, 128]);
  doc.layers[2].visible = false;
  mergeVisible(doc);
  assert.deepEqual(doc.layers.map((l) => l.name), ["Background", "Layer2"]);
  flatten(doc, [255, 255, 255, 255]);
  assert.equal(doc.layers.length, 1);
  assert.equal(doc.layers[0].name, "Background");
  assert.equal(doc.layers[0].raster.data[3], 255);
});

test("removing a white matte undoes an edge antialiased onto white", () => {
  const doc = newImage(1, 1, 72, [0, 0, 0, 0]);
  // Pure red at half opacity, its color pulled halfway to white.
  doc.layers[0].raster = createRaster(1, 1, [255, 128, 128, 128]);
  removeMatte(doc, 255);
  const d = doc.layers[0].raster.data;
  assert.ok(d[0] >= 254 && d[1] <= 2 && d[3] === 128);
});
