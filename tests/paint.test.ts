/* The brush engine, gradients and .jgd files, flood fill and retouch. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { makeTip, Stroke, spacingFor, TIP_SHAPES } from "../src/core/paint/brush.ts";
import { gradientTable, gradientPosition, readJgd, writeJgd, BUILTIN_GRADIENTS } from "../src/core/paint/gradient.ts";
import { fillRegion, floodFill } from "../src/core/paint/fill.ts";
import { retouchPixel } from "../src/core/paint/retouch.ts";
import { createRaster, createMask } from "../src/core/image/raster.ts";

const PSP6 = process.env.JSPAINTSHOP_PSP6 ?? join(homedir(), "programs/Paint Shop Pro 6");

test("tips: full in the middle, empty in the corners, every shape", () => {
  const round = makeTip("Round", 21, 50);
  assert.equal(round.data[10 * 21 + 10], 1);
  assert.equal(round.data[0], 0);
  for (const s of TIP_SHAPES) assert.ok(makeTip(s, 15, 100).data.some((v) => v === 1), s);
  assert.equal(makeTip("Round", 1, 0).data[0], 1);
});

test("a stroke never covers a pixel more than its opacity, unless it builds up", () => {
  for (const buildUp of [false, true]) {
    const s = new Stroke({ width: 40, height: 10, tip: makeTip("Round", 6, 100), opacity: 0.5, spacing: 1, density: 1, buildUp, selection: null, pixel: () => {} });
    s.to(3, 5);
    s.to(36, 5);
    const max = Math.max(...s.coverage);
    if (buildUp) assert.ok(max > 0.9);
    else assert.equal(max, 0.5);
    assert.deepEqual([s.touched!.minX, s.touched!.maxX], [0, 38]);
  }
});

test("strokes stay inside the selection", () => {
  const sel = createMask(20, 20);
  sel.data.fill(255, 0, 200); // the top half
  const s = new Stroke({ width: 20, height: 20, tip: makeTip("Square", 20, 100), opacity: 1, spacing: spacingFor(20, 25), density: 1, buildUp: false, selection: sel, pixel: () => {} });
  s.to(10, 10);
  assert.equal(s.coverage[5 * 20 + 5], 1);
  assert.equal(s.coverage[15 * 20 + 5], 0);
});

test("gradient tables honour stops, fg/bg and opacity", () => {
  const t = gradientTable(BUILTIN_GRADIENTS[0], [255, 0, 0, 255], [0, 0, 255, 255]);
  assert.deepEqual([...t.subarray(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...t.subarray(255 * 4, 256 * 4)], [0, 0, 255, 255]);
  const fade = gradientTable(BUILTIN_GRADIENTS[1], [0, 255, 0, 255], [0, 0, 0, 255]);
  assert.equal(fade[255 * 4 + 3], 0);
});

test("gradient geometry", () => {
  const lin = { shape: "linear" as const, angle: 0, repeats: 0, cx: 50, cy: 50, invert: false };
  assert.ok(gradientPosition(lin, 5, 0, 10, 10) < 0.1);
  assert.ok(gradientPosition(lin, 5, 10, 10, 10) > 0.9);
  const sun = { ...lin, shape: "sunburst" as const };
  assert.equal(gradientPosition(sun, 5, 5, 10, 10), 0);
  assert.equal(gradientPosition({ ...lin, repeats: 1 }, 5, 10, 10, 10), gradientPosition({ ...lin, repeats: 1 }, 5, 0, 10, 10));
});

test(".jgd round trip, and PSP 6's own gradients", () => {
  const back = readJgd(writeJgd(BUILTIN_GRADIENTS));
  assert.deepEqual(back.map((g) => g.name), BUILTIN_GRADIENTS.map((g) => g.name));
  assert.equal(back[0].colors[1].kind, "bg");
  const dir = join(PSP6, "Gradients");
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".jgd"))) {
    const [g] = readJgd(readFileSync(join(dir, f)));
    assert.ok(g.name.length > 0, f);
    assert.ok(g.colors.length >= 2 && g.opacities.length >= 1, f);
  }
});

test("flood fill: the matching region only, with opacity and blend", () => {
  const r = createRaster(4, 1);
  r.data.set([0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
  const o = { match: "rgb" as const, tolerance: 0, blend: 0, opacity: 1, sample: r, selection: null, lockTransparency: false };
  const out = floodFill(r, fillRegion(0, 0, o), { kind: "solid", color: [255, 0, 0, 255] }, o);
  assert.deepEqual([...out.data], [255, 0, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
  const half = floodFill(r, fillRegion(2, 0, o), { kind: "solid", color: [0, 0, 0, 255] }, { ...o, opacity: 0.5 });
  assert.equal(half.data[8], 127);
});

test("retouch modes move pixels the right way", () => {
  const orig = new Uint8ClampedArray([100, 100, 100, 255]);
  const out = new Uint8ClampedArray(orig);
  const run = (mode: string) => { out.set(orig); retouchPixel(mode, out, orig, 1, 1, 0, 0, 0, 1, [255, 0, 0]); return [...out.subarray(0, 3)]; };
  assert.ok(run("Lighten RGB")[0] > 100);
  assert.ok(run("Darken RGB")[0] < 100);
  assert.ok(run("Dodge")[0] > 100);
  assert.ok(run("Burn")[0] < 100);
  const c = run("Color to Target");
  assert.ok(c[0] > c[1]);
  // PSP's values (0x79f8b0): + and - 10, and the HLS shifts of 480 / 16 = 30 levels.
  assert.deepEqual(run("Lighten RGB"), [110, 110, 110]);
  assert.deepEqual(run("Darken RGB"), [90, 90, 90]);
  assert.deepEqual(run("Lightness Up"), [130, 130, 130]);
});

test("retouch: PSP's 3 x 3 kernels count only the neighbours there are", () => {
  // A 3 x 3 grey image, 90 around a 180 centre.
  const orig = new Uint8ClampedArray(36);
  for (let p = 0; p < 9; p++) orig.set([p === 4 ? 180 : 90, p === 4 ? 180 : 90, p === 4 ? 180 : 90, 255], p * 4);
  const at = (mode: string, x: number, y: number) => { const out = new Uint8ClampedArray(orig); retouchPixel(mode, out, orig, 3, 3, y * 3 + x, x, y, 1, [0, 0, 0]); return out[(y * 3 + x) * 4]; };
  // Soften at the centre: (90 * 144 + 180 * 50 + 97) / 194.
  assert.equal(at("Soften", 1, 1), Math.trunc((90 * 144 + 180 * 50 + 97) / 194));
  // Sharpen at the centre: (180 * 40 - 4 * 90 + 18) / 36; at a corner only two neighbours count.
  assert.equal(at("Sharpen", 1, 1), Math.trunc((180 * 40 - 360 + 18) / 36));
  assert.equal(at("Sharpen", 0, 0), Math.trunc((90 * 40 - 90 - 90 + 19) / 38));
  // Emboss: up-left minus down-right, + 128; the corner has no up-left neighbour.
  assert.equal(at("Emboss", 1, 1), 128);
  assert.equal(at("Emboss", 0, 0), 0); // 128 - 180, clamped
  assert.equal(at("Emboss", 2, 2), 255); // 180 + 128, clamped
});

test("retouch: PSP's x16 HLS round-trips", async () => {
  const { hls16, rgbFromHls16 } = await import("../src/core/paint/retouch.ts");
  for (const c of [[255, 0, 0], [12, 200, 90], [30, 30, 220], [250, 240, 10], [128, 128, 128], [1, 2, 3]]) {
    const [h, s, l] = hls16(c[0], c[1], c[2]);
    const back = rgbFromHls16(h, s, l);
    back.forEach((v, k) => assert.ok(Math.abs(v - c[k]) <= 1, `${c} -> ${back}`));
  }
  assert.deepEqual(hls16(0, 255, 0), [0x550, 0xff0, 0x7f8]);
});

test("picture tubes: PSP's tubes read their tube block and cut into cells", async () => {
  const { readPsp } = await import("../src/core/formats/psp.ts");
  const { inflate } = await import("../src/core/formats/zlib.ts");
  const { composite } = await import("../src/core/layers/composite.ts");
  const { tubeCells, TubePlacer } = await import("../src/core/paint/tube.ts");
  const dir = join(PSP6, "Tubes");
  if (!existsSync(dir)) return;
  const r = await readPsp(new Uint8Array(readFileSync(join(dir, "Neon Spikes.tub"))), inflate);
  assert.deepEqual(r.tube && [r.tube.step, r.tube.across, r.tube.down, r.tube.count, r.tube.placement, r.tube.selection], [6, 4, 3, 12, 1, 1]);
  const cells = tubeCells(composite(r.doc), r.tube!);
  assert.equal(cells.length, 12);
  const p = new TubePlacer(10, 12, 1, 1);
  assert.equal(p.place(5, null, [0, 0], 0.5, 0), null);
  assert.equal(p.place(10, null, [0, 0], 0.5, 0), 1);
});

test("Export Picture Tube: the tube block round-trips through the PSP writer", async () => {
  const { readPsp } = await import("../src/core/formats/psp.ts");
  const { writePsp } = await import("../src/core/formats/psp-write.ts");
  const { inflate, deflate } = await import("../src/core/formats/zlib.ts");
  const { newImage } = await import("../src/core/doc/image-doc.ts");
  const doc = newImage(40, 20, 72, [0, 0, 0, 0]);
  const tube = { name: "Test", step: 25, across: 4, down: 2, count: 8, placement: 0, selection: 2 };
  const r = await readPsp(await writePsp(doc, deflate, 0, tube), inflate);
  assert.deepEqual(r.tube, tube);
});
