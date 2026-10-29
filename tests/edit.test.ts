/* Undo history and the two recorders. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { History, group, mergeTouch, type Change } from "../src/core/edit/history.ts";
import { recordPixels, recordFields } from "../src/core/edit/record.ts";

function counter(log: string[], name: string): Change {
  return { label: name, touch: {}, undo: () => log.push(`-${name}`), redo: () => log.push(`+${name}`) };
}

test("undo and redo walk the stacks, and a new change drops the redo stack", () => {
  const log: string[] = [];
  const h = new History();
  h.push(counter(log, "a"));
  h.push(counter(log, "b"));
  assert.equal(h.undoLabel, "b");
  h.undo();
  assert.deepEqual(log, ["-b"]);
  assert.equal(h.redoLabel, "b");
  h.push(counter(log, "c"));
  assert.equal(h.canRedo, false);
  assert.deepEqual(h.undoLabels, ["a", "c"]);
});

test("the save point survives undo and redo back to it, and is lost when overwritten", () => {
  const log: string[] = [];
  const h = new History();
  h.push(counter(log, "a"));
  h.markSaved();
  h.push(counter(log, "b"));
  assert.equal(h.atSavePoint, false);
  h.undo();
  assert.equal(h.atSavePoint, true);
  h.undo();
  h.push(counter(log, "c"));
  assert.equal(h.atSavePoint, false);
});

test("the limit drops the oldest changes", () => {
  const h = new History(2);
  for (const n of ["a", "b", "c"]) h.push(counter([], n));
  assert.deepEqual(h.undoLabels, ["b", "c"]);
});

test("a group undoes its changes last first", () => {
  const log: string[] = [];
  const g = group("both", [counter(log, "a"), counter(log, "b")]);
  g.undo();
  g.redo();
  assert.deepEqual(log, ["-b", "-a", "+a", "+b"]);
});

test("mergeTouch joins rectangles and flags", () => {
  assert.deepEqual(mergeTouch({ pixels: { minX: 0, minY: 0, maxX: 1, maxY: 1 } }, { pixels: { minX: 5, minY: 2, maxX: 6, maxY: 3 }, layers: true }),
    { pixels: { minX: 0, minY: 0, maxX: 6, maxY: 3 }, layers: true });
});

test("recordPixels patches only the rectangle, clamped to the raster", () => {
  const raster = { width: 4, height: 3, channels: 4, data: new Uint8ClampedArray(4 * 3 * 4) };
  const rec = recordPixels(raster, { minX: 2, minY: 1, maxX: 9, maxY: 9 }, "Paint");
  raster.data.fill(200, (1 * 4 + 2) * 4, (1 * 4 + 4) * 4);
  const change = rec.finish()!;
  assert.deepEqual(change.touch, { pixels: { minX: 2, minY: 1, maxX: 3, maxY: 2 } });
  change.undo();
  assert.ok(raster.data.every((v) => v === 0));
  change.redo();
  assert.equal(raster.data[(1 * 4 + 3) * 4], 200);
  assert.equal(recordPixels(raster, { minX: 0, minY: 0, maxX: 1, maxY: 1 }, "Nothing").finish(), null);
  assert.equal(recordPixels(raster, { minX: 10, minY: 10, maxX: 12, maxY: 12 }, "Outside").finish(), null);
});

test("recordFields snapshots named fields", () => {
  const layer = { name: "Background", opacity: 100, other: 1 };
  const rec = recordFields(layer, ["name", "opacity"], "Layer Properties", { layers: true });
  layer.opacity = 50;
  const change = rec.finish()!;
  change.undo();
  assert.equal(layer.opacity, 100);
  change.redo();
  assert.equal(layer.opacity, 50);
});
