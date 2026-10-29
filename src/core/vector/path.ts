/*
  Vector paths: PSP 6's preset shapes as contours, flattening Bezier contours to polygons,
  bounds and transforms. Preset shapes: shapes.generated.ts (docs/PSP_EXE_ANALYSIS.md
  section 14). The shapes are drawn in their design box and scaled to the dragged box; Square,
  Rounded Square and Circle keep equal sides.
*/
import type { Contour, PathNode } from "./objects.ts";
import { PRESET_SHAPE_NODES } from "./shapes.generated.ts";

export type Point = [number, number];

export const PRESET_SHAPES = ["Rectangle", "Square", "Rounded Rectangle", "Rounded Square", "Ellipse", "Circle", "Triangle", "Pentagon", "Hexagon", "Octagon", "Star 1", "Star 2", "Arrow 1", "Arrow 2", "Arrow 3"] as const;

export function constrainedShape(shape: string): boolean {
  return shape === "Square" || shape === "Rounded Square" || shape === "Circle";
}

const node = (a: Point, i: Point, o: Point): PathNode => ({ x: a[0], y: a[1], inX: i[0], inY: i[1], outX: o[0], outY: o[1], type: "cusp" });

/* Rounded Rectangle (0x6d6310): corner radius min((w + h)/24, w/2, h/2), handles at half of it. */
function roundedRect(w: number, h: number): PathNode[] {
  let r = ((h * 0.08333333333333333 + w * 0.08333333333333333) * 0.5);
  if (r > w * 0.5) r = w * 0.5;
  else if (h * 0.5 < r) r = h * 0.5;
  const d = r * 0.5;
  return [
    node([0, r], [0, r], [0, r]), node([0, h - r], [0, h - r], [0, h - d]), node([r, h], [d, h], [r, h]),
    node([w - r, h], [w - r, h], [w - d, h]), node([w, h - r], [w, h - d], [w, h - r]), node([w, r], [w, r], [w, d]),
    node([w - r, 0], [w - d, 0], [w - r, 0]), node([r, 0], [r, 0], [d, 0]), node([0, r], [0, d], [0, r]),
  ];
}

/** The preset shape between two drag corners, as one closed contour. */
export function presetShapeContour(shape: string, x0: number, y0: number, x1: number, y1: number): Contour {
  let l = Math.min(x0, x1), t = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
  if (constrainedShape(shape)) {
    const s = Math.max(w, h);
    w = h = s;
    if (x1 < x0) l = x0 - s;
    if (y1 < y0) t = y0 - s;
  }
  if (shape === "Rounded Rectangle") return { closed: true, nodes: roundedRect(w, h).map((n) => ({ ...n, x: n.x + l, y: n.y + t, inX: n.inX + l, inY: n.inY + t, outX: n.outX + l, outY: n.outY + t })) };
  const src = PRESET_SHAPE_NODES[shape] ?? PRESET_SHAPE_NODES.Rectangle;
  let mx = 0, my = 0;
  for (const n of src) for (const p of n) { if (p[0] > mx) mx = p[0]; if (p[1] > my) my = p[1]; }
  const sx = w / (mx || 1), sy = h / (my || 1);
  const at = (p: Point): Point => [l + p[0] * sx, t + p[1] * sy];
  return { closed: true, nodes: src.map(([a, i, o]) => node(at(a), at(i), at(o))) };
}

/** A contour as a polygon, each Bezier segment cut into `steps` pieces. */
export function flattenContour(c: Contour, steps = 16): Point[] {
  const out: Point[] = [];
  const n = c.nodes.length;
  if (!n) return out;
  out.push([c.nodes[0].x, c.nodes[0].y]);
  const segs = c.closed ? n : n - 1;
  for (let k = 0; k < segs; k++) {
    const a = c.nodes[k], b = c.nodes[(k + 1) % n];
    const straight = a.outX === a.x && a.outY === a.y && b.inX === b.x && b.inY === b.y;
    if (straight) { out.push([b.x, b.y]); continue; }
    for (let s = 1; s <= steps; s++) {
      const t = s / steps, u = 1 - t;
      out.push([u * u * u * a.x + 3 * u * u * t * a.outX + 3 * u * t * t * b.inX + t * t * t * b.x, u * u * u * a.y + 3 * u * u * t * a.outY + 3 * u * t * t * b.inY + t * t * t * b.y]);
    }
  }
  return out;
}

export function contourBounds(cs: Contour[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cs) for (const n of c.nodes) for (const [x, y] of [[n.x, n.y], [n.inX, n.inY], [n.outX, n.outY]]) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

/** Apply `f` to every point of the contours (anchors and handles). */
export function mapContours(cs: Contour[], f: (x: number, y: number) => Point): Contour[] {
  return cs.map((c) => ({ closed: c.closed, nodes: c.nodes.map((n) => {
    const [x, y] = f(n.x, n.y), [inX, inY] = f(n.inX, n.inY), [outX, outY] = f(n.outX, n.outY);
    return { ...n, x, y, inX, inY, outX, outY };
  }) }));
}

/** A polyline (Draw tool lines) as a contour of corner nodes. */
export function polylineContour(points: Point[], closed: boolean): Contour {
  return { closed, nodes: points.map((p) => node(p, p, p)) };
}
