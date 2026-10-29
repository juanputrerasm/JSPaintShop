/*
  Tracing a coverage mask into closed contours, for Convert Text to Curves. PSP 6 reads the
  glyph outlines from the font (GetGlyphOutline); a browser cannot, so the text is drawn
  large, traced along its pixel edges and simplified. Holes come out as their own contours and
  draw with the even-odd rule, like PSP's text curves.
*/
import type { Contour } from "./objects.ts";
import type { Point } from "./path.ts";

export interface CoverageMask { width: number; height: number; data: Uint8Array }

/** The closed loops between covered (128 and over) and empty pixels, in pixel-corner coordinates. */
export function traceLoops(m: CoverageMask): Point[][] {
  const { width: w, height: h, data } = m;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] >= 128;
  // Directed edges with the covered pixel on their right: start vertex key -> end vertices.
  const key = (x: number, y: number) => y * (w + 1) + x;
  const next = new Map<number, number[]>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = key(x0, y0), list = next.get(k);
    if (list) list.push(key(x1, y1)); else next.set(k, [key(x1, y1)]);
  };
  for (let y = 0; y <= h; y++) for (let x = 0; x < w; x++) {
    const above = on(x, y - 1), below = on(x, y);
    if (above === below) continue;
    if (below) add(x, y, x + 1, y); else add(x + 1, y, x, y);
  }
  for (let x = 0; x <= w; x++) for (let y = 0; y < h; y++) {
    const left = on(x - 1, y), right = on(x, y);
    if (left === right) continue;
    if (left) add(x, y, x, y + 1); else add(x, y + 1, x, y);
  }
  const loops: Point[][] = [];
  const xy = (k: number): Point => [k % (w + 1), Math.floor(k / (w + 1))];
  for (const [start, outs] of next) {
    while (outs.length) {
      const loop: Point[] = [xy(start)];
      let prev = start, cur = outs.pop()!;
      while (cur !== start) {
        loop.push(xy(cur));
        const list = next.get(cur);
        if (!list || !list.length) break;
        // At a pinch point two edges leave: take the right turn so touching corners stay apart.
        let pick = list.length - 1;
        if (list.length > 1) {
          const [px, py] = xy(prev), [cx, cy] = xy(cur), dx = cx - px, dy = cy - py;
          pick = list.findIndex((k) => { const [nx, ny] = xy(k); return dx * (ny - cy) - dy * (nx - cx) > 0; });
          if (pick < 0) pick = list.length - 1;
        }
        prev = cur;
        cur = list.splice(pick, 1)[0];
      }
      if (loop.length > 2) loops.push(loop);
    }
  }
  return loops;
}

/* Douglas-Peucker on a closed loop. */
export function simplifyLoop(loop: Point[], tolerance: number): Point[] {
  if (loop.length < 4) return loop;
  // Split at the point farthest from the first so the loop is two open runs.
  let far = 0, best = -1;
  for (let i = 1; i < loop.length; i++) { const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]); if (d > best) { best = d; far = i; } }
  const run = (pts: Point[]): Point[] => {
    if (pts.length < 3) return pts;
    const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1], l = Math.hypot(bx - ax, by - ay) || 1;
    let idx = 0, max = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / l;
      if (d > max) { max = d; idx = i; }
    }
    if (max <= tolerance) return [pts[0], pts[pts.length - 1]];
    return [...run(pts.slice(0, idx + 1)).slice(0, -1), ...run(pts.slice(idx))];
  };
  const a = run(loop.slice(0, far + 1)), b = run([...loop.slice(far), loop[0]]);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  // The split points stay even on a straight edge: drop those that lie on their neighbours' line.
  for (let i = 0; out.length > 3 && i < out.length;) {
    const p = out[(i + out.length - 1) % out.length], q = out[i], r = out[(i + 1) % out.length];
    const l = Math.hypot(r[0] - p[0], r[1] - p[1]) || 1;
    if (Math.abs((r[0] - p[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (r[1] - p[1])) / l <= tolerance) out.splice(i, 1);
    else i++;
  }
  return out;
}

/** A mask's outline as contours of corner nodes, scaled by `scale` and moved by (ox, oy). */
export function maskContours(m: CoverageMask, scale = 1, ox = 0, oy = 0, tolerance = 0.75): Contour[] {
  return traceLoops(m).map((loop) => simplifyLoop(loop, tolerance)).filter((l) => l.length > 2).map((l) => ({
    closed: true,
    nodes: l.map(([x, y]) => { const px = ox + x * scale, py = oy + y * scale; return { x: px, y: py, inX: px, inY: py, outX: px, outY: py, type: "cusp" as const }; }),
  }));
}
