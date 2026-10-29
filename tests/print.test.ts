/* File > Print's page layout. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultPageSetup, gridLayout, placeImage } from "../src/core/print/layout.ts";

test("an image prints at its resolution, centred, or at the margins", () => {
  const s = defaultPageSetup(true);
  const p = placeImage(s, 300, 150, 100);
  assert.deepEqual([p.pageW, p.pageH, p.w, p.h], [8.5, 11, 3, 1.5]);
  assert.equal(p.x, 2.75);
  const m = placeImage({ ...s, center: false, left: 1, top: 2, scale: 50 }, 300, 150, 100);
  assert.deepEqual([m.x, m.y, m.w, m.h], [1, 2, 1.5, 0.75]);
});

test("fit to page keeps the margins on every side; landscape swaps the paper", () => {
  const s = { ...defaultPageSetup(true), fit: true, landscape: true };
  const p = placeImage(s, 1000, 500, 72);
  assert.equal(p.pageW, 11);
  assert.ok(Math.abs(p.w - 10) < 1e-9);
  const cells = gridLayout(4, 8.5, 11, 0.5, [[2, 1], [1, 2], [3, 3], [1, 1]]);
  assert.equal(cells.length, 4);
  for (const c of cells) assert.ok(c.x >= 0.5 && c.y >= 0.5 && c.x + c.w <= 8 + 1e-9 && c.y + c.h <= 10.5 + 1e-9);
});
