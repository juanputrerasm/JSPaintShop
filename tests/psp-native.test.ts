/*
  PSP 6's own vector and adjustment layers, the saved selection and alpha channels
  (docs/PSP_EXE_ANALYSIS.md section 19). The files are built here with the layout jff.dll reads.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readPsp } from "../src/core/formats/psp.ts";
import { writePsp } from "../src/core/formats/psp-write.ts";
import { deflate, inflate } from "../src/core/formats/zlib.ts";
import { PSP_SIGNATURE } from "../src/core/formats/psp.ts";
import { newImage } from "../src/core/doc/image-doc.ts";
import { createMask } from "../src/core/image/raster.ts";

class B {
  parts: number[] = [];
  u8(v: number) { this.parts.push(v & 255); return this; }
  u16(v: number) { this.parts.push(v & 255, (v >> 8) & 255); return this; }
  u32(v: number) { for (let i = 0; i < 4; i++) this.parts.push((v >>> (i * 8)) & 255); return this; }
  i32(v: number) { return this.u32(v >>> 0); }
  f64(v: number) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); this.parts.push(...b); return this; }
  str(s: string) { this.u16(s.length); for (const c of s) this.parts.push(c.charCodeAt(0)); return this; }
  raw(b: number[]) { this.parts.push(...b); return this; }
}
const chunk = (f: (b: B) => void) => { const b = new B(); f(b); return new B().u32(b.parts.length + 4).raw(b.parts).parts; };
const block = (id: number, data: number[]) => new B().raw([0x7e, 0x42, 0x4b, 0]).u16(id).u32(data.length).raw(data).parts;
const paint = (rgb: number) => block(15, [...chunk((b) => b.u16(1)), ...chunk((b) => b.u32(rgb).u32(0xffffffff))]);

function layer(name: string, type: number, ext: number[]): number[] {
  const info = chunk((b) => {
    b.str(name).u8(type);
    for (let i = 0; i < 8; i++) b.i32(0); // image and saved rectangles
    b.u8(200).u8(0).u8(1).u8(0).u8(0); // opacity, blend, visible, protect, group
    for (let i = 0; i < 8; i++) b.i32(0); // mask rectangles
    b.u8(1).u8(0).u8(0).u16(0);
    for (let i = 0; i < 10; i++) b.raw([0, 0, 255, 255]);
  });
  return block(4, [...info, ...ext, ...chunk((b) => b.u16(0).u16(0))]);
}

function file(layers: number[][]): Uint8Array {
  const head = [...PSP_SIGNATURE].map((c) => c.charCodeAt(0));
  while (head.length < 32) head.push(0);
  const img = chunk((b) => b.i32(40).i32(30).f64(72).u8(1).u16(2).u16(24).u16(1).u32(1 << 24).u8(0).u32(3600).i32(0).u16(layers.length).u32(1));
  return Uint8Array.from([...head, 4, 0, 0, 0, ...block(0, img), ...block(3, layers.flat())]);
}

const node = (x: number, y: number, start: boolean, flags: number) => chunk((b) => { b.f64(x).f64(y).f64(x).f64(y).f64(x + 5).f64(y); b.u8(start ? 1 : 0).u16(flags); });

test("PSP 6 vector layers: paths with stroke, fill, line style and contours; text", async () => {
  const path = block(14, [
    ...chunk((b) => b.u16(2).u32(1 | 4).u32(0).u32(0)),
    ...chunk((b) => { b.str("Star").u8(1).u16(3).u8(1).u8(2).u8(1).f64(4); }),
    ...paint(0x0000ff), ...paint(0x00ff00),
    ...chunk((b) => b.u32(4)),
    ...node(1, 2, true, 1), ...node(10, 2, false, 0x80),
    ...node(20, 20, true, 2), ...node(25, 25, false, 0),
  ]);
  const text = block(14, [
    ...chunk((b) => b.u16(1).u32(4).u32(0).u32(0)),
    ...chunk((b) => { b.u8(0).i32(3).i32(4); for (const v of [1, 0, 0, 0, 1, 0, 10, 20, 1]) b.f64(v); }),
    ...chunk((b) => b.u32(5)),
    ...chunk((b) => b.u16(3)), ...chunk((b) => b.u32(1)),
    ...chunk((b) => b.u16(2)), ...chunk((b) => { b.str("Times New Roman").u32(1 | 4).u32(700).u32(0).i32(18).u8(0).u32(0).u32(0); }), ...paint(0xff0000),
    ...chunk((b) => b.u16(1)), ...chunk((b) => b.u32(72)),
    ...chunk((b) => b.u16(3)), ...chunk((b) => b.u32(1)),
    ...chunk((b) => b.u16(1)), ...chunk((b) => b.u32(105)),
  ]);
  const ext = block(13, [...chunk((b) => b.u32(2)), ...path, ...text]);
  const { doc, warnings } = await readPsp(file([layer("Vector 1", 3, ext)]), inflate);
  assert.deepEqual(warnings, []);
  const l = doc.layers[0];
  assert.equal(l.kind, "vector");
  assert.equal(l.opacity, 200);
  const [p, t] = l.objects!;
  assert.equal(p.name, "Star");
  assert.equal(p.visible, true);
  assert.deepEqual(p.style, { stroke: [255, 0, 0, 255], fill: [0, 255, 0, 255], width: 3, antialias: true, cap: "butt", join: "bevel", miter: 4 });
  assert.equal(p.contours.length, 2);
  assert.equal(p.contours[0].closed, true);
  assert.equal(p.contours[1].closed, false);
  assert.deepEqual([p.contours[0].nodes[0].type, p.contours[1].nodes[0].type], ["smooth", "symmetric"]);
  assert.equal(p.contours[0].nodes[1].outX, 15);
  assert.equal(t.text?.text, "H\ni");
  assert.equal(t.text?.font, "Times New Roman");
  assert.deepEqual([t.text?.size, t.text?.bold, t.text?.italic, t.text?.underline, t.text?.align], [18, true, true, true, "center"]);
  assert.deepEqual([t.text?.x, t.text?.y], [13, 24]);
  assert.deepEqual(t.style.fill, [0, 0, 255, 255]);
  assert.equal(t.style.antialias, false);
});

test("PSP 6 adjustment layers: each type's settings", async () => {
  const adj = (type: number, data: number[]) => block(12, [...chunk((b) => b.u16(type)), ...data]);
  const levels = chunk((b) => {
    for (const g of [1, 1.5, 1, 0.5]) b.f64(g);
    for (const v of [255, 250, 255, 255]) b.i32(v); // input white
    for (const v of [0, 10, 0, 0]) b.i32(v); // input black
    for (const v of [255, 255, 240, 255]) b.i32(v); // output white
    for (const v of [0, 0, 0, 5]) b.i32(v); // output black
  });
  const curve = (pts: number[][]) => chunk((b) => { b.u8(0).u16(pts.length); for (let i = 0; i < 18; i++) b.u8(pts[i]?.[0] ?? 0).u8(pts[i]?.[1] ?? 0); for (let i = 0; i < 256; i++) b.u8(i); });
  const id = [[0, 0], [255, 255]];
  const mixer = chunk((b) => { b.u8(1); for (const v of [0, 0, 100, 0, 0, 100, 0, 0, 50, 25, 25, 0]) b.i32(v); });
  const balance = chunk((b) => { b.u8(0); for (let i = 1; i <= 9; i++) b.i32(i); });
  const hsl = chunk((b) => { b.u8(0); for (const v of [10, -20, 30, 200, 25, 0]) b.i32(v); for (let i = 0; i < 42; i++) b.i32(i === 1 ? 40 : i % 7 >= 3 ? 15 * (i % 7) : 0); });
  const { doc, warnings } = await readPsp(file([
    layer("Levels", 4, adj(1, levels)),
    layer("Curves", 4, adj(2, [...curve(id), ...curve(id), ...curve([[0, 0], [128, 200], [255, 255]]), ...curve(id)])),
    layer("BC", 4, adj(3, chunk((b) => b.i32(-12).i32(40)))),
    layer("CB", 4, adj(4, balance)),
    layer("HSL", 4, adj(5, hsl)),
    layer("Mixer", 4, adj(6, mixer)),
    layer("Invert", 4, adj(7, [])),
    layer("Threshold", 4, adj(8, chunk((b) => b.u32(100)))),
    layer("Posterize", 4, adj(9, chunk((b) => b.u32(6)))),
  ]), inflate);
  assert.deepEqual(warnings, []);
  const a = doc.layers.map((l) => l.adjustment);
  assert.deepEqual(a[0], { type: "levels", rgb: [0, 255, 1, 0, 255], blue: [10, 250, 1.5, 0, 255], green: [0, 255, 1, 0, 240], red: [0, 255, 0.5, 5, 255] });
  assert.deepEqual(a[1]?.type === "curves" && a[1].green, [[0, 0], [128, 200], [255, 255]]);
  assert.deepEqual(a[2], { type: "brightnessContrast", brightness: -12, contrast: 40 });
  assert.deepEqual(a[3], { type: "colorBalance", preserveLuminosity: false, highlights: [1, 2, 3], midtones: [4, 5, 6], shadows: [7, 8, 9] });
  const hs = a[4];
  assert.ok(hs?.type === "hueSaturation");
  assert.equal(hs.colorize, false);
  assert.deepEqual([hs.master, hs.colorizeValues], [[10, -20, 30], [200, 25, 0]]);
  assert.deepEqual(hs.ranges[0], [0, 40, 0, 45, 60, 75, 90]);
  assert.deepEqual(a[5], { type: "channelMixer", monochrome: true, blue: [0, 0, 100, 0], green: [0, 100, 0, 0], red: [50, 25, 25, 0] });
  assert.deepEqual(a.slice(6), [{ type: "invert" }, { type: "threshold", threshold: 100 }, { type: "posterize", levels: 6 }]);
  assert.ok(doc.layers.every((l) => l.kind === "adjustment"));
});

test("PSP: the selection and alpha channels are saved and read back", async () => {
  const doc = newImage(6, 4, 72, [255, 255, 255, 255]);
  doc.selection = createMask(6, 4, 0);
  doc.selection.data[7] = 255;
  const alpha = createMask(6, 4, 0);
  alpha.data.fill(128, 0, 6);
  doc.alphas = [{ name: "Saved 1", mask: alpha }];
  const back = (await readPsp(await writePsp(doc, deflate, 1000), inflate)).doc;
  assert.equal(back.selection?.data[7], 255);
  assert.equal(back.selection?.data[8], 0);
  assert.equal(back.alphas.length, 1);
  assert.equal(back.alphas[0].name, "Saved 1");
  assert.deepEqual([...back.alphas[0].mask.data.subarray(0, 8)], [128, 128, 128, 128, 128, 128, 0, 0]);
});
