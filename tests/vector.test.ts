/* Vector paths: preset shapes, node editing, tracing. */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Contour, PathNode } from "../src/core/vector/objects.ts";
import { polylineContour, presetShapeContour } from "../src/core/vector/path.ts";
import {
  breakAt, convertToLine, curveAfter, deleteNodes, joinEnds, mergeNodes, reverseContours, setNodeType,
} from "../src/core/vector/node-edit.ts";
import { maskContours, simplifyLoop, traceLoops } from "../src/core/vector/trace.ts";

const n = (x: number, y: number, inX = x, inY = y, outX = x, outY = y): PathNode => ({ x, y, inX, inY, outX, outY, type: "cusp" });
const len = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);

test("smooth aligns handles keeping lengths; symmetric averages them", () => {
  const c: Contour[] = [{ closed: false, nodes: [n(0, 0), n(10, 0, 8, -2, 14, 3), n(20, 0)] }];
  const s = setNodeType(c, [[0, 1]], "smooth")[0].nodes[1];
  // Collinear through the anchor.
  const cross = (s.inX - s.x) * (s.outY - s.y) - (s.inY - s.y) * (s.outX - s.x);
  assert.ok(Math.abs(cross) < 1e-9);
  assert.ok(Math.abs(len(s.x, s.y, s.inX, s.inY) - Math.hypot(2, 2)) < 1e-9);
  assert.ok(Math.abs(len(s.x, s.y, s.outX, s.outY) - 5) < 1e-9);
  const y = setNodeType(c, [[0, 1]], "symmetric")[0].nodes[1];
  assert.ok(Math.abs(len(y.x, y.y, y.inX, y.inY) - len(y.x, y.y, y.outX, y.outY)) < 1e-9);
  assert.equal(y.type, "symmetric");
  // Cusp keeps the handles.
  const k = setNodeType(c, [[0, 1]], "cusp")[0].nodes[1];
  assert.deepEqual([k.inX, k.outX], [8, 14]);
});

test("line and curve handles", () => {
  const c: Contour[] = [{ closed: false, nodes: [n(0, 0), n(9, 0, 6, 3, 12, -3), n(18, 0)] }];
  const l = convertToLine(c, [[0, 1]])[0].nodes[1];
  assert.deepEqual([l.inX, l.inY, l.outX, l.outY], [9, 0, 9, 0]);
  const g = curveAfter([{ closed: false, nodes: [n(0, 0), n(9, 0), n(18, 0)] }], [[0, 1]])[0].nodes[1];
  assert.deepEqual([g.outX, g.outY], [11.25, 0]); // a quarter of the 9 to the neighbour
});

test("reverse, break, join, merge, delete", () => {
  const sq = polylineContour([[0, 0], [10, 0], [10, 10], [0, 10]], true);
  const r = reverseContours([sq], [[0, 0]])[0];
  assert.deepEqual(r.nodes.map((p) => [p.x, p.y]), [[0, 10], [10, 10], [10, 0], [0, 0]]);
  const open = breakAt([sq], [0, 1]);
  assert.equal(open[0].closed, false);
  assert.deepEqual(open[0].nodes.map((p) => [p.x, p.y]), [[10, 0], [10, 10], [0, 10], [0, 0], [10, 0]]);
  const line = polylineContour([[0, 0], [5, 0], [10, 0]], false);
  const two = breakAt([line], [0, 1]);
  assert.equal(two.length, 2);
  const joined = joinEnds(two, [0, 1], [1, 0]);
  assert.equal(joined.length, 1);
  assert.equal(joined[0].nodes.length, 4);
  const merged = mergeNodes([line], [[0, 1], [0, 2]]);
  assert.deepEqual(merged[0].nodes.map((p) => [p.x, p.y]), [[0, 0], [7.5, 0]]);
  assert.equal(deleteNodes([line], [[0, 0], [0, 1]]).length, 0);
});

test("tracing a mask with a hole gives an outer and an inner loop", () => {
  const w = 8, h = 8, data = new Uint8Array(w * h);
  for (let y = 1; y < 7; y++) for (let x = 1; x < 7; x++) data[y * w + x] = 255;
  for (let y = 3; y < 5; y++) for (let x = 3; x < 5; x++) data[y * w + x] = 0;
  const loops = traceLoops({ width: w, height: h, data });
  assert.equal(loops.length, 2);
  const simple = loops.map((l) => simplifyLoop(l, 0.1).length).sort();
  assert.deepEqual(simple, [4, 4]);
  const cs = maskContours({ width: w, height: h, data }, 0.5, 10, 20);
  const xs = cs.flatMap((c) => c.nodes.map((p) => p.x));
  assert.equal(Math.min(...xs), 10.5);
  assert.equal(Math.max(...xs), 13.5);
});

test("rounded rectangle corner radius", () => {
  const c = presetShapeContour("Rounded Rectangle", 0, 0, 120, 120);
  assert.equal(c.nodes.length, 9);
  assert.equal(c.nodes[0].y, 10);
});

test("text on a path: PSP's placement (0x7900b0)", async () => {
  const { placeOnPath } = await import("../src/core/vector/text-path.ts");
  const line = [[0, 0], [100, 0]];
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
  // Left: from the start; each character's middle on the path, turned to its direction.
  assert.deepEqual(placeOnPath(line, false, "left", [10, 10]).map((q) => [q.x, q.y, q.angle]), [[0, 0, 0], [10, 0, 0]]);
  assert.deepEqual(placeOnPath(line, false, "center", [10, 10]).map((q) => r6(q.x)), [40, 50]);
  assert.deepEqual(placeOnPath(line, false, "right", [10, 10]).map((q) => r6(q.x)), [80, 90]);
  // Longer than the path: carries on straight past the end.
  const over = placeOnPath([[0, 0], [10, 0], [10, 10]], false, "left", [10, 10, 10]);
  assert.equal(over[2].angle, Math.PI / 2);
  assert.deepEqual([r6(over[2].x), r6(over[2].y)], [10, 10]);
  // Closed: centred on the top of the shape (y grows downward).
  const square = [[0, 0], [40, 0], [40, 40], [0, 40], [0, 0]];
  const top = placeOnPath(square, true, "center", [10, 10]);
  assert.deepEqual(top.map((q) => [r6(q.x), r6(q.y)]), [[10, 0], [20, 0]]);
  // Left alignment centres on the leftmost point of the middle line and wraps around.
  const left = placeOnPath(square, true, "left", [10, 10]);
  assert.equal(r6(left[1].x) + 0, 0);
  assert.ok(Math.abs(left[1].angle + Math.PI / 2) < 1e-9);
});
