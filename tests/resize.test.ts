/* Resize (Psp.exe 0x5ee800, jff.dll ResizeDIB, bicummx.cpp), the Deformation tool's apply (0x51b160), Picture Frame's hole and greyscale Tiles. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRaster, type Raster } from "../src/core/image/raster.ts";
import { resample, resampleIndices, resampleMask, smartMethod } from "../src/core/image/resample.ts";
import { warpProjective, type Matrix } from "../src/core/deform/projective.ts";
import { frameHole, placeFrame } from "../src/core/effects/frame.ts";
import { tiles, TILES_DEFAULTS } from "../src/core/effects/tiles.ts";

function ramp(w: number, h: number): Raster {
  const r = createRaster(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    r.data[o] = x * 30; r.data[o + 1] = y * 40; r.data[o + 2] = (x * y * 7) & 255; r.data[o + 3] = 255;
  }
  return r;
}

test("smart size: the axis further from 100% decides; above 100 (truncated) is bicubic", () => {
  assert.equal(smartMethod(100, 100, 200, 100), "bicubic");
  assert.equal(smartMethod(100, 100, 50, 100), "bilinear");
  // 100.5% truncates to 100: the box filter.
  assert.equal(smartMethod(1000, 1000, 1005, 1005), "bilinear");
  // Width shrinks by 40%, height grows by 10%: the width decides.
  assert.equal(smartMethod(100, 100, 60, 110), "bilinear");
  assert.equal(smartMethod(100, 100, 90, 140), "bicubic");
});

test("pixel resize: integer scale in 1/10000, rows from the bottom", () => {
  const src = ramp(3, 2), out = resample(src, 7, 5, "pixel");
  // S = trunc(7/3 · 10000) = 23333: columns 0 0 0 1 1 2 2.
  const cols = [0, 1, 2, 3, 4, 5, 6].map((x) => out.data[x * 4] / 30);
  assert.deepEqual(cols, [0, 0, 0, 1, 1, 2, 2]);
  // S = 25000 for rows: DIB rows 0 0 0 1 1 from the bottom, so the top two rows are source row 0.
  const rows = [0, 1, 2, 3, 4].map((y) => out.data[y * 7 * 4 + 1] / 40);
  assert.deepEqual(rows, [0, 0, 1, 1, 1]);
  const idx = Uint8Array.from([0, 1, 2, 3, 4, 5]);
  assert.deepEqual([...resampleIndices(idx, 3, 2, 7, 5)].slice(0, 7), [0, 0, 0, 1, 1, 2, 2]);
});

test("bicubic (MMX): flat colors stay flat; same size is a copy", () => {
  const flat = createRaster(9, 7, [120, 60, 200, 255]);
  const up = resample(flat, 23, 17, "bicubic");
  for (let i = 0; i < up.data.length; i += 4) assert.deepEqual([...up.data.subarray(i, i + 4)], [120, 60, 200, 255]);
  const r = ramp(5, 5);
  assert.deepEqual([...resample(r, 5, 5, "bicubic").data], [...r.data]);
  const m = resampleMask({ width: 4, height: 4, data: new Uint8Array(16).fill(255) }, 9, 9, "bicubic");
  assert.ok(m.data.every((v) => v === 255));
});

test("deformation apply: identity copies; a half-pixel shift averages, edges fade to clear", () => {
  const src = ramp(6, 4);
  const id: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  assert.deepEqual([...warpProjective(src, id, 6, 4, true).data], [...src.data]);
  const half: Matrix = [1, 0, 0.5, 0, 1, 0, 0, 0, 1];
  const out = warpProjective(src, half, 6, 4, true);
  // Between columns 0 (0) and 1 (30): 15.
  assert.equal(out.data[0], 15);
  // The last column samples past the edge: half its value, half transparent.
  // 255 + ((0 − 255)·512 >> 10) = 127, and the red 150 + ((0 − 150)·512 >> 10) = 75.
  assert.equal(out.data[5 * 4 + 3], 127);
  assert.equal(out.data[5 * 4], 75);
});

test("picture frame: the hole is the clear box, unless the opaque one is smaller", () => {
  const f = createRaster(20, 16, [10, 20, 30, 255]);
  for (let y = 4; y < 12; y++) for (let x = 5; x < 15; x++) f.data[(y * 20 + x) * 4 + 3] = 0;
  assert.deepEqual(frameHole(f), { minX: 5, minY: 4, maxX: 14, maxY: 11 });
  // Alpha 1 still counts as clear (threshold 1).
  f.data[(0 * 20 + 0) * 4 + 3] = 1;
  assert.deepEqual(frameHole(f), { minX: 0, minY: 0, maxX: 14, maxY: 11 });
  f.data[3] = 255;
  // Outside: s = 40 / 8 = 5; left 5·5, right 5·5, top (4 − 1)·5 − 1, bottom (16 − 11)·5 − 1.
  const p = placeFrame(f, 50, 40, true, null);
  assert.equal(p.width, 50 + 25 + 25 - 2);
  assert.equal(p.height, 40 + 14 + 24);
  // The color under clear pixels is white before stretching.
  const inside = placeFrame(f, 20, 16, false, null).frame;
  assert.deepEqual([...inside.data.subarray((8 * 20 + 10) * 4, (8 * 20 + 10) * 4 + 3)], [255, 255, 255]);
});

test("tiles on a greyscale image stay grey, with the border color's red as the border", () => {
  const W = 40, H = 30, img = createRaster(W, H);
  for (let i = 0; i < W * H; i++) { const v = (i * 37) & 255; img.data.set([v, v, v, 255], i * 4); }
  const out = tiles(img, { ...TILES_DEFAULTS, borderColor: [200, 10, 10], color: [255, 128, 0] }, null, true);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    assert.equal(out.data[o], out.data[o + 1]);
    assert.equal(out.data[o], out.data[o + 2]);
  }
});
