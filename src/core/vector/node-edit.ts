/*
  Node editing (MENU 497, the node edit context menu), from Psp.exe's node routines
  (docs/PSP_EXE_ANALYSIS.md section 15). A node is its anchor, the handle before it (in) and
  the handle after it (out); a handle sitting on its anchor is a straight segment on that side.

  Asymmetric / Smooth   0x4f44b0: both handles on one line through the anchor, along
                        (before - after), each keeping its own length
  Symmetric             0x4f6990: as Smooth, then both lengths set to their average
  Cusp                  0x7309b0: only the smooth flag clears; the handles stay
  Line Before / After   0x4f3cf0 / 0x4f3e20: that handle goes back onto the anchor
  Convert To Line       both of them (the 0x2efa case calls the two in a row)
  Curve Before / After  0x4f50a0 / 0x4f4230: a missing handle grows toward the neighbour node

  Every function returns new contours; a node is addressed as [contour, node].
*/
import type { Contour, NodeType, PathNode } from "./objects.ts";

export type NodeRef = [number, number];

const EPS = 1e-5;
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);
const hasIn = (n: PathNode) => n.inX !== n.x || n.inY !== n.y;
const hasOut = (n: PathNode) => n.outX !== n.x || n.outY !== n.y;

/* The point `len` from (ax, ay) toward (tx, ty) (0x4f3970). */
function toward(ax: number, ay: number, tx: number, ty: number, len: number): [number, number] {
  const dx = tx - ax, dy = ty - ay, d = Math.hypot(dx, dy);
  if (d < EPS) return [ax, ay];
  return [ax + (dx / d) * len, ay + (dy / d) * len];
}

function mapNodes(cs: Contour[], refs: NodeRef[], f: (n: PathNode, c: Contour, i: number) => PathNode): Contour[] {
  const want = new Set(refs.map(([c, n]) => `${c}:${n}`));
  return cs.map((c, ci) => ({ closed: c.closed, nodes: c.nodes.map((n, ni) => (want.has(`${ci}:${ni}`) ? f({ ...n }, c, ni) : n)) }));
}

const neighbour = (c: Contour, i: number, step: number): PathNode | null => {
  const j = i + step;
  if (j >= 0 && j < c.nodes.length) return c.nodes[j];
  return c.closed && c.nodes.length > 1 ? c.nodes[(j + c.nodes.length) % c.nodes.length] : null;
};

/* 0x4f44b0 with both handles out: align them, keeping their lengths. */
function align(n: PathNode): PathNode {
  const l1 = dist(n.x, n.y, n.inX, n.inY), l2 = dist(n.x, n.y, n.outX, n.outY);
  const dx = n.inX - n.outX, dy = n.inY - n.outY, d = Math.hypot(dx, dy);
  const k1 = d >= EPS ? l1 / d : 1, k2 = d >= EPS ? l2 / d : 1;
  return { ...n, inX: n.x + dx * k1, inY: n.y + dy * k1, outX: n.x - dx * k2, outY: n.y - dy * k2 };
}

/*
  A missing handle grows toward the neighbour on its side, a quarter of the distance to that
  neighbour (0x4f50a0: the distance times 0.25 at 0x882da8, then 0x4f3970), or opposite the
  other handle.
*/
function grow(n: PathNode, c: Contour, i: number, side: "in" | "out"): PathNode {
  const other = side === "in" ? hasOut(n) : hasIn(n);
  if (other) {
    // Opposite the existing handle, same length.
    const ox = side === "in" ? n.outX : n.inX, oy = side === "in" ? n.outY : n.inY;
    const [x, y] = [2 * n.x - ox, 2 * n.y - oy];
    return side === "in" ? { ...n, inX: x, inY: y } : { ...n, outX: x, outY: y };
  }
  const nb = neighbour(c, i, side === "in" ? -1 : 1);
  if (!nb) return n;
  const tx = side === "in" ? nb.outX : nb.inX, ty = side === "in" ? nb.outY : nb.inY;
  const [x, y] = toward(n.x, n.y, tx, ty, dist(n.x, n.y, nb.x, nb.y) * 0.25);
  return side === "in" ? { ...n, inX: x, inY: y } : { ...n, outX: x, outY: y };
}

function smooth(n: PathNode, c: Contour, i: number): PathNode {
  let m = n;
  if (!hasIn(m) && !hasOut(m)) { m = grow(m, c, i, "out"); m = grow(m, c, i, "in"); }
  else if (!hasIn(m)) m = grow(m, c, i, "in");
  else if (!hasOut(m)) m = grow(m, c, i, "out");
  return align(m);
}

export function setNodeType(cs: Contour[], refs: NodeRef[], type: NodeType): Contour[] {
  return mapNodes(cs, refs, (n, c, i) => {
    if (type === "cusp") return { ...n, type };
    const m = smooth(n, c, i);
    if (type === "symmetric") {
      const l1 = dist(m.x, m.y, m.inX, m.inY), l2 = dist(m.x, m.y, m.outX, m.outY), avg = (l1 + l2) * 0.5;
      const k1 = l1 >= EPS ? avg / l1 : 1, k2 = l2 >= EPS ? avg / l2 : 1;
      return { ...m, type, inX: m.x + (m.inX - m.x) * k1, inY: m.y + (m.inY - m.y) * k1, outX: m.x + (m.outX - m.x) * k2, outY: m.y + (m.outY - m.y) * k2 };
    }
    return { ...m, type };
  });
}

export function lineBefore(cs: Contour[], refs: NodeRef[]): Contour[] {
  return mapNodes(cs, refs, (n) => ({ ...n, inX: n.x, inY: n.y, type: hasOut(n) ? "cusp" : n.type }));
}
export function lineAfter(cs: Contour[], refs: NodeRef[]): Contour[] {
  return mapNodes(cs, refs, (n) => ({ ...n, outX: n.x, outY: n.y, type: hasIn(n) ? "cusp" : n.type }));
}
export function convertToLine(cs: Contour[], refs: NodeRef[]): Contour[] {
  return lineAfter(lineBefore(cs, refs), refs);
}
export function curveBefore(cs: Contour[], refs: NodeRef[]): Contour[] {
  return mapNodes(cs, refs, (n, c, i) => (hasIn(n) ? n : grow(n, c, i, "in")));
}
export function curveAfter(cs: Contour[], refs: NodeRef[]): Contour[] {
  return mapNodes(cs, refs, (n, c, i) => (hasOut(n) ? n : grow(n, c, i, "out")));
}

const reversed = (c: Contour): Contour => ({
  closed: c.closed,
  nodes: [...c.nodes].reverse().map((n) => ({ ...n, inX: n.outX, inY: n.outY, outX: n.inX, outY: n.inY })),
});

/** Reverse Contour: the contours holding the given nodes run the other way. */
export function reverseContours(cs: Contour[], refs: NodeRef[]): Contour[] {
  const which = new Set(refs.map(([c]) => c));
  return cs.map((c, i) => (which.has(i) ? reversed(c) : c));
}
/** Reverse Path: every contour runs the other way. */
export function reversePath(cs: Contour[]): Contour[] {
  return cs.map(reversed);
}

/** Close: the open contours holding the given nodes join their ends. */
export function closeContours(cs: Contour[], refs: NodeRef[]): Contour[] {
  const which = new Set(refs.map(([c]) => c));
  return cs.map((c, i) => (which.has(i) && c.nodes.length > 2 ? { ...c, closed: true } : c));
}

/** Break at a node: a closed contour opens there; an open one splits in two. */
export function breakAt(cs: Contour[], ref: NodeRef): Contour[] {
  const [ci, ni] = ref, c = cs[ci];
  if (!c || !c.nodes[ni]) return cs;
  const out = cs.slice();
  if (c.closed) {
    const nodes = [...c.nodes.slice(ni), ...c.nodes.slice(0, ni + 1)].map((n) => ({ ...n }));
    nodes[0] = { ...nodes[0], inX: nodes[0].x, inY: nodes[0].y };
    nodes[nodes.length - 1] = { ...nodes[nodes.length - 1], outX: nodes[nodes.length - 1].x, outY: nodes[nodes.length - 1].y };
    out[ci] = { closed: false, nodes };
    return out;
  }
  if (ni === 0 || ni === c.nodes.length - 1) return cs;
  const a = c.nodes.slice(0, ni + 1).map((n) => ({ ...n })), b = c.nodes.slice(ni).map((n) => ({ ...n }));
  a[a.length - 1] = { ...a[a.length - 1], outX: a[a.length - 1].x, outY: a[a.length - 1].y };
  b[0] = { ...b[0], inX: b[0].x, inY: b[0].y };
  out.splice(ci, 1, { closed: false, nodes: a }, { closed: false, nodes: b });
  return out;
}

/** Join Select: two selected end points of open contours become one contour (the same contour's ends close it). */
export function joinEnds(cs: Contour[], a: NodeRef, b: NodeRef): Contour[] {
  const ca = cs[a[0]], cb = cs[b[0]];
  if (!ca || !cb || ca.closed || cb.closed) return cs;
  const isEnd = (c: Contour, i: number) => i === 0 || i === c.nodes.length - 1;
  if (!isEnd(ca, a[1]) || !isEnd(cb, b[1])) return cs;
  if (a[0] === b[0]) return closeContours(cs, [a]);
  // a's contour ends at the joined point, b's starts there.
  const first = a[1] === 0 ? reversed(ca) : ca, second = b[1] === 0 ? cb : reversed(cb);
  const joined: Contour = { closed: false, nodes: [...first.nodes, ...second.nodes].map((n) => ({ ...n })) };
  const out = cs.filter((_, i) => i !== a[0] && i !== b[0]);
  out.splice(Math.min(a[0], b[0]), 0, joined);
  return out;
}

/** Merge: runs of selected nodes in a contour become one node at their average. */
export function mergeNodes(cs: Contour[], refs: NodeRef[]): Contour[] {
  const want = new Set(refs.map(([c, n]) => `${c}:${n}`));
  return cs.map((c, ci) => {
    const nodes: PathNode[] = [];
    let run: PathNode[] = [];
    const flush = () => {
      if (!run.length) return;
      if (run.length === 1) nodes.push(run[0]);
      else {
        const x = run.reduce((s, n) => s + n.x, 0) / run.length, y = run.reduce((s, n) => s + n.y, 0) / run.length;
        const f = run[0], l = run[run.length - 1];
        nodes.push({ x, y, inX: f.inX - f.x + x, inY: f.inY - f.y + y, outX: l.outX - l.x + x, outY: l.outY - l.y + y, type: "cusp" });
      }
      run = [];
    };
    c.nodes.forEach((n, ni) => { if (want.has(`${ci}:${ni}`)) run.push(n); else { flush(); nodes.push(n); } });
    flush();
    return { closed: c.closed && nodes.length > 2, nodes };
  });
}

/** Delete nodes; contours left with fewer than two nodes go. */
export function deleteNodes(cs: Contour[], refs: NodeRef[]): Contour[] {
  const want = new Set(refs.map(([c, n]) => `${c}:${n}`));
  return cs
    .map((c, ci) => ({ closed: c.closed, nodes: c.nodes.filter((_, ni) => !want.has(`${ci}:${ni}`)) }))
    .filter((c) => c.nodes.length > 1)
    .map((c) => ({ ...c, closed: c.closed && c.nodes.length > 2 }));
}

/** All nodes of the contours, for Select All. */
export function allNodes(cs: Contour[]): NodeRef[] {
  return cs.flatMap((c, ci) => c.nodes.map((_, ni) => [ci, ni] as NodeRef));
}
