/* Image > Effects: Drop Shadow, Cutout, Buttonize, Chisel. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMask, createRaster } from "../src/core/image/raster.ts";
import { dropShadow } from "../src/core/effects/drop-shadow.ts";
import { cutout } from "../src/core/effects/cutout.ts";
import { buttonize } from "../src/core/effects/buttonize.ts";
import { chisel } from "../src/core/effects/chisel.ts";
import { blinds } from "../src/core/effects/blinds.ts";
import { weave } from "../src/core/effects/weave.ts";
import { chrome, chromeWave } from "../src/core/effects/chrome.ts";
import { feedback } from "../src/core/effects/feedback.ts";
import { pencil } from "../src/core/effects/pencil.ts";
import { glowingEdges, neonGlow } from "../src/core/effects/glow.ts";
import { kaleidoscope, pattern } from "../src/core/effects/kaleidoscope.ts";
import { innerBevel, outerBevel, shininessTable, BEVEL_DEFAULTS } from "../src/core/effects/bevel.ts";
import { sculpture, texture, SCULPTURE_DEFAULTS, TEXTURE_DEFAULTS } from "../src/core/effects/texture.ts";

const W = 40, H = 30;
const white = () => createRaster(W, H, [255, 255, 255, 255]);
const box = () => {
  const m = createMask(W, H);
  for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) m.data[y * W + x] = 255;
  return m;
};
const px = (r: { data: Uint8ClampedArray }, x: number, y: number) => r.data[(y * W + x) * 4];

test("drop shadow darkens below-right of the selection, not inside it", () => {
  const r = dropShadow(white(), box(), true, { color: [0, 0, 0], opacity: 100, blur: 0, horizontal: 5, vertical: 5 });
  assert.equal(px(r, 22, 22), 0);
  assert.equal(px(r, 12, 12), 255);
  assert.equal(px(r, 5, 5), 255);
});

test("drop shadow on a transparent layer adds opacity", () => {
  const layer = createRaster(W, H);
  for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) layer.data.set([255, 0, 0, 255], (y * W + x) * 4);
  const r = dropShadow(layer, null, false, { color: [0, 0, 0], opacity: 50, blur: 0, horizontal: 5, vertical: 5 });
  assert.ok(r.data[(22 * W + 22) * 4 + 3] > 0);
  assert.equal(r.data[(12 * W + 12) * 4], 255);
});

test("cutout fills the hole and shades its top-left edge", () => {
  const r = cutout(white(), box(), { fill: true, interior: [200, 200, 200], shadow: [0, 0, 0], opacity: 100, blur: 0, horizontal: 3, vertical: 3 });
  assert.ok(px(r, 11, 11) < 200);
  assert.equal(px(r, 18, 18), 200);
  assert.equal(px(r, 5, 5), 255);
});

test("buttonize shades the edges and leaves the middle", () => {
  const src = createRaster(W, H, [100, 100, 100, 255]);
  const r = buttonize(src, [255, 255, 255], { height: 5, width: 5, opacity: 100, solid: true });
  assert.equal(px(r, 20, 15), 100);
  assert.ok(px(r, 1, 15) > 100);
  assert.ok(px(r, W - 1, 15) < 100);
});

test("chisel paints a band around the selection", () => {
  const r = chisel(white(), box(), [128, 128, 128], { size: 4, transparent: false });
  assert.notEqual(px(r, 8, 15), 255);
  assert.equal(px(r, 15, 15), 255);
  assert.equal(px(r, 2, 2), 255);
});

test("blinds ramp from the image to the color across each strip", () => {
  const r = blinds(white(), { width: 10, opacity: 100, horizontal: false, lightFromLeftTop: false, color: [0, 0, 0] });
  assert.equal(px(r, 0, 0), 0);
  assert.equal(px(r, 9, 0), 255);
});

test("weave shades strands and fills gaps", () => {
  const r = weave(white(), { gap: 2, width: 6, opacity: 100, weaveColor: [0, 0, 0], gapColor: [10, 20, 30], fillGaps: true });
  assert.equal(r.data[((H - 1) * W + 0) * 4], 10);
  assert.ok(r.data.some((v, i) => i % 4 === 0 && v > 10 && v < 255));
});

test("chrome: a triangle wave over grey, brightness added", () => {
  const w = chromeWave(4);
  assert.equal(w[0], 0);
  assert.ok(w[32] > 200);
  const r = chrome(createRaster(W, H, [0, 0, 0, 255]), { flaws: 4, brightness: 50, color: [255, 255, 255], useOriginal: false });
  assert.equal(px(r, 3, 3), 50);
});

test("feedback draws shrinking copies toward the center", () => {
  const src = createRaster(W, H, [255, 255, 255, 255]);
  for (let y = 0; y < H; y++) src.data.set([0, 0, 0, 255], y * W * 4); // a black left column
  const r = feedback(src, { opacity: 100, intensity: 30, horizontal: 50, vertical: 50, elliptical: false });
  assert.equal(px(r, 0, 15), 0);
  // The first copy's left edge is black too.
  let copies = 0;
  for (let x = 1; x < W / 2; x++) if (px(r, x, 15) === 0) copies++;
  assert.ok(copies > 0);
});

test("pencils leave flat areas white, draw edges dark", () => {
  const src = white();
  for (let y = 0; y < H; y++) for (let x = 20; x < W; x++) src.data.set([0, 0, 0, 255], (y * W + x) * 4);
  const r = pencil(src, { detail: 90, opacity: 100 }, false);
  assert.equal(px(r, 5, 5), 255);
  assert.ok(px(r, 19, 5) < 255 || px(r, 20, 5) < 255);
  const c = pencil(white(), { detail: 90, opacity: 100 }, true);
  assert.equal(px(c, 5, 5), 255);
});

test("glowing edges: flat is black, edges glow", () => {
  const src = createRaster(W, H, [0, 0, 0, 255]);
  for (let y = 0; y < H; y++) for (let x = 20; x < W; x++) src.data.set([255, 255, 255, 255], (y * W + x) * 4);
  const r = glowingEdges(src, { intensity: 3, sharpness: 20 });
  assert.equal(px(r, 5, 5), 0);
  assert.ok(px(r, 19, 5) > 0 || px(r, 20, 5) > 0);
  assert.ok(neonGlow(src, { intensity: 50, opacity: 50 }).data.length === src.data.length);
});

test("kaleidoscope and pattern keep a flat image flat", () => {
  const src = createRaster(W, H, [90, 90, 90, 255]);
  for (const r of [kaleidoscope(src, { horizontal: 0, vertical: 0, rotation: 0, scale: 0, petals: 10, orbits: 0, suction: 0 }),
    pattern(src, { horizontal: 0, vertical: 0, rotation: 90, scale: 0, columns: 3, rows: 3, hShift: 0, vShift: 0 })]) {
    // PSP's truncated bilinear weights can lose a level or two.
    assert.ok(r.data.every((v, i) => (i % 4 === 3 ? v === 255 : v >= 87 && v <= 90)));
  }
});

test("bevels shade the edges of the shape", () => {
  const src = createRaster(W, H, [128, 128, 128, 255]);
  const inner = innerBevel(src, box(), box(), { ...BEVEL_DEFAULTS, width: 4 });
  // The upper-left edge (lit from 315 degrees) and the lower-right differ.
  assert.notEqual(px(inner, 10, 10), px(inner, 19, 19));
  assert.equal(px(inner, 2, 2), 128);
  const outer = outerBevel(src, box(), { ...BEVEL_DEFAULTS, width: 4 });
  assert.notEqual(px(outer, 8, 15), 128);
  assert.equal(px(outer, 1, 1), 128);
  assert.equal(shininessTable(0)[255], 0);
  assert.ok(shininessTable(100)[255] > 200);
});

test("texture and sculpture light the surface", () => {
  const src = createRaster(W, H, [128, 128, 128, 255]);
  const tex = createRaster(4, 4, [0, 0, 0, 255]);
  tex.data.set([255, 255, 255, 255], 0);
  const t = texture(src, tex, TEXTURE_DEFAULTS, null);
  assert.ok(t.data.some((v, i) => i % 4 === 0 && v !== px(t, 20, 20)));
  const s = sculpture(src, [201, 157, 66], SCULPTURE_DEFAULTS, null);
  assert.equal(s.data[3], 255);
});

test("picture frame: PSP's frames have a hole; outside grows the canvas", async () => {
  const fs = await import("node:fs");
  const { readPsp } = await import("../src/core/formats/psp.ts");
  const { inflate } = await import("../src/core/formats/zlib.ts");
  const { composite } = await import("../src/core/layers/composite.ts");
  const { placeFrame, frameHole } = await import("../src/core/effects/frame.ts");
  const dir = (process.env.JSPAINTSHOP_PSP6 ?? `${process.env.HOME}/programs/Paint Shop Pro 6`) + "/Frames";
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".pfr"))) {
    const doc = (await readPsp(new Uint8Array(fs.readFileSync(`${dir}/${f}`)), inflate)).doc, art = composite(doc);
    const hole = frameHole(art);
    assert.ok(hole, f);
    const shape = doc.alphas.length ? doc.alphas[doc.alphas.length - 1].mask : null;
    const p = placeFrame(art, 200, 150, true, null, shape);
    assert.ok(p.width > 200 && p.height > 150, `${f}: ${p.width} x ${p.height}`);
    assert.equal(placeFrame(art, 200, 150, false, null).frame.width, 200);
  }
});

test("Tiles: every shape's grid covers the image; flat tiles keep the image color", async () => {
  const { tileGrid, tiles, TILES_DEFAULTS } = await import("../src/core/effects/tiles.ts");
  const W = 61, H = 47;
  for (const shape of [0, 1, 2] as const) {
    const { pts, tiles: list } = tileGrid(shape, 15, W, H);
    // A point is covered when it lies inside some tile polygon.
    const inside = (x: number, y: number) => list.some((t) => {
      const poly = t.map(([j, i]) => pts[j][i]);
      let c = false;
      for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
        const [xa, ya] = poly[a], [xb, yb] = poly[b];
        if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) c = !c;
      }
      return c;
    });
    for (const [x, y] of [[0.5, 0.5], [W - 0.5, 0.5], [0.5, H - 0.5], [W - 0.5, H - 0.5], [30.2, 20.7]]) assert.ok(inside(x, y), `shape ${shape} misses ${x},${y}`);
  }
  const r = createRaster(W, H, [200, 100, 50, 255]);
  const out = tiles(r, { ...TILES_DEFAULTS, shape: 1, angularity: 0, smoothness: 0, border: 3 }, null);
  // Gaps take the border color (black); some pixel keeps a tile.
  const px = (x: number, y: number) => [...out.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)];
  let tilesSeen = 0, gaps = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = px(x, y); if (c[0] === 0 && c[1] === 0 && c[2] === 0) gaps++; else tilesSeen++; }
  assert.ok(tilesSeen > gaps && gaps > 0);
  assert.equal(out.data[3], 255);
});

test("Tiles: PSP's grid counts (0x6c1d20, 0x6c1f00, 0x6c19e0)", async () => {
  const { tileGrid } = await import("../src/core/effects/tiles.ts");
  // Squares: (trunc((W + s − 1)/s) + 1) x (trunc((H + s − 1)/s) + 1).
  assert.equal(tileGrid(1, 15, 30, 30).tiles.length, 9);
  assert.equal(tileGrid(1, 15, 31, 30).tiles.length, 12);
  // Triangles: 2n + 2 a row, m + 1 rows; n = 2, h = √3·15/2, m = trunc((30 + h − 1)/h) = 3.
  assert.equal(tileGrid(0, 15, 30, 30).tiles.length, 6 * 4);
  // Hexagons: (a + 1) x (b + 1); half = 7, a = trunc((30 + 6d − 1)/6d) = 2, b = trunc((30 + 13)/7) = 6.
  assert.equal(tileGrid(2, 15, 30, 30).tiles.length, 3 * 7);
});
