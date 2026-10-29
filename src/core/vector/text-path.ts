/*
  Text on a path (Fit Text to Path, 33862): where each character goes. PSP's text renderer
  (Psp.exe 0x7900b0, docs/PSP_EXE_ANALYSIS.md section 15) works on the flattened path:

  - Each character starts where the previous one ended, one advance further along the path.
    From its start it walks half its advance to M; the character is turned to the direction
    from M to the next path point (points equal to M skipped) and drawn with its middle on M.
  - Open paths: left alignment starts at the path's start, centre at (path − text)/2, right
    ends the text at the path's end. Text longer than the path carries on straight past the
    ends, along the end segments (the first segment at least 2 long, 0x882d88).
  - Closed paths: the text is centred on one point of the path and wraps around it. Centre
    alignment takes the topmost crossing of the vertical line through the middle of the path's
    box (0x78e8e0); left alignment the leftmost crossing of the horizontal middle line, right
    alignment the rightmost (0x78ec30).
*/
export type Point = readonly [number, number] | number[];

export interface Placed { x: number; y: number; angle: number }

/** Each character's baseline origin and rotation, for the characters' advances in order. */
export function placeOnPath(pts: Point[], closed: boolean, align: "left" | "center" | "right", advances: number[]): Placed[] {
  const p = pts.filter((q, i) => i === 0 || q[0] !== pts[i - 1][0] || q[1] !== pts[i - 1][1]);
  if (p.length < 2) return [];
  const len: number[] = [0];
  for (let i = 1; i < p.length; i++) len.push(len[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  const total = len[len.length - 1];
  if (!(total > 0)) return [];
  const width = advances.reduce((s, a) => s + a, 0);

  // The end segments the text continues along past an open path's ends.
  const endDir = (from: number, step: number): [number, number] => {
    for (let i = from; i + step >= 0 && i + step < p.length; i += step) {
      const dx = p[i][0] - p[i + step][0], dy = p[i][1] - p[i + step][1], l = Math.hypot(dx, dy);
      if (l >= 2) return [dx / l, dy / l];
    }
    const a = p[from], b = p[from + step], l = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    return [(a[0] - b[0]) / l, (a[1] - b[1]) / l];
  };
  const back = endDir(0, 1), ahead = endDir(p.length - 1, -1);

  // The point at arc length s and the direction from it to the next distinct path point.
  const at = (s: number): Placed => {
    if (closed) s = ((s % total) + total) % total;
    else if (s < 0) return { x: p[0][0] - back[0] * s, y: p[0][1] - back[1] * s, angle: Math.atan2(-back[1], -back[0]) };
    else if (s > total) return { x: p[p.length - 1][0] + ahead[0] * (s - total), y: p[p.length - 1][1] + ahead[1] * (s - total), angle: Math.atan2(ahead[1], ahead[0]) };
    let i = 1;
    while (i < len.length - 1 && len[i] <= s) i++;
    const a = p[i - 1], b = p[i], k = (s - len[i - 1]) / (len[i] - len[i - 1]);
    const x = a[0] + (b[0] - a[0]) * k, y = a[1] + (b[1] - a[1]) * k;
    let n = i;
    while (n < p.length - 1 && p[n][0] === x && p[n][1] === y) n++;
    if (p[n][0] === x && p[n][1] === y) return { x, y, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
    return { x, y, angle: Math.atan2(p[n][1] - y, p[n][0] - x) };
  };

  let start: number;
  if (!closed) start = align === "center" ? (total - width) * 0.5 : align === "right" ? total - width : 0;
  else start = anchor(p, len, align) - width * 0.5;

  const out: Placed[] = [];
  let d = start;
  for (const w of advances) {
    const m = at(d + w * 0.5);
    out.push({ x: m.x - Math.cos(m.angle) * (w * 0.5), y: m.y - Math.sin(m.angle) * (w * 0.5), angle: m.angle });
    d += w;
  }
  return out;
}

/* The arc length of the point a closed path's text is centred on. */
function anchor(p: Point[], len: number[], align: "left" | "center" | "right"): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of p) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const vertical = align === "center";
  const line = vertical ? (maxX - minX) * 0.5 + minX : (maxY - minY) * 0.5 + minY;
  let best = vertical ? maxY + 1 : align === "left" ? maxX + 1 : minX - 1, s = 0;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i];
    const [ua, ub, va, vb] = vertical ? [a[0], b[0], a[1], b[1]] : [a[1], b[1], a[0], b[0]];
    if (!((ua < line && line <= ub) || (ub < line && line <= ua))) continue;
    const v = ub - ua === 0 ? va : ((line - ua) * (vb - va)) / (ub - ua) + va;
    const better = vertical || align === "left" ? v < best : v > best;
    if (!better) continue;
    best = v;
    const [x, y] = vertical ? [line, v] : [v, line];
    s = len[i - 1] + Math.hypot(x - a[0], y - a[1]);
  }
  return s;
}
