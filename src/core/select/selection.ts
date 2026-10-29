/*
  Selections as masks (0..255 per pixel, canvas-sized), and everything the selection tools
  and the Selections menu do to them:

    shapes        rectangle, square, ellipse, circle, rounded rectangle and square, and the
                  preset shapes (the Selection tool's Type list, strings 15200-15217), any
                  polygon (Freehand, Point to Point), antialiased by 4 x 4 supersampling
    combine       replace, add (Shift), remove (Ctrl)
    magic wand    contiguous fill by RGB value, hue, brightness, or all non-clear pixels,
                  within a tolerance
    modify        invert, feather, contract, expand, grow, select similar, transparent color
    outline       the marching ants' edges
*/
import { constrainedShape, flattenContour, PRESET_SHAPES, presetShapeContour } from "../vector/path.ts";
import { createMask, type Mask, type Raster } from "../image/raster.ts";
import { rgbToHsl, luminance } from "../color/color-space.ts";

export type Combine = "replace" | "add" | "remove";

export function combine(base: Mask | null, shape: Mask, mode: Combine): Mask {
  if (mode === "replace" || !base) return mode === "remove" ? createMask(shape.width, shape.height) : shape;
  const out = createMask(shape.width, shape.height), a = base.data, b = shape.data, d = out.data;
  for (let i = 0; i < d.length; i++) d[i] = mode === "add" ? Math.max(a[i], b[i]) : Math.max(0, a[i] - b[i]);
  return out;
}

/** Null when nothing is selected, so "no selection" has one form. */
export function nonEmpty(m: Mask | null): Mask | null {
  if (!m) return null;
  for (let i = 0; i < m.data.length; i++) if (m.data[i]) return m;
  return null;
}

export function invert(m: Mask | null, width: number, height: number): Mask {
  const out = createMask(width, height, 255);
  if (m) for (let i = 0; i < out.data.length; i++) out.data[i] = 255 - m.data[i];
  return out;
}

export type Point = [number, number];

/*
  Fill a polygon (even-odd) into a mask. With antialias each pixel is sampled 4 x 4 times;
  without, once at its centre.
*/
export function polygonMask(width: number, height: number, polys: Point[][], antialias: boolean): Mask {
  const m = createMask(width, height);
  const ss = antialias ? 4 : 1;
  const acc = new Uint16Array(width);
  let minY = Infinity, maxY = -Infinity;
  for (const p of polys) for (const [, y] of p) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(height - 1, Math.ceil(maxY));
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    acc.fill(0);
    for (let sy = 0; sy < ss; sy++) {
      const fy = y + (sy + 0.5) / ss;
      xs.length = 0;
      for (const poly of polys) {
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const [xa, ya] = poly[j], [xb, yb] = poly[i];
          if ((ya <= fy && yb > fy) || (yb <= fy && ya > fy)) xs.push(xa + ((fy - ya) / (yb - ya)) * (xb - xa));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        // Sub-columns whose centre lies between the two crossings.
        const from = Math.max(0, Math.ceil(xs[k] * ss - 0.5)), to = Math.min(width * ss - 1, Math.ceil(xs[k + 1] * ss - 0.5) - 1);
        for (let sx = from; sx <= to; sx++) acc[(sx / ss) | 0]++;
      }
    }
    const row = y * width;
    for (let x = 0; x < width; x++) if (acc[x]) m.data[row + x] = Math.min(255, Math.round((acc[x] * 255) / (ss * ss)));
  }
  return m;
}

/** Points around an ellipse in the box, enough for a smooth edge. */
export function ellipsePoints(x0: number, y0: number, x1: number, y1: number): Point[] {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
  const n = Math.max(24, Math.ceil((rx + ry) * 1.5));
  return Array.from({ length: n }, (_, i) => [cx + rx * Math.cos((i / n) * 2 * Math.PI), cy + ry * Math.sin((i / n) * 2 * Math.PI)] as Point);
}




/*
  The shapes of the Selection tool's Type list and the Preset Shapes tool, as polygons in the
  box (x0, y0)-(x1, y1). The order is PSP's.
*/
export const SHAPES = PRESET_SHAPES;
export type ShapeName = typeof SHAPES[number];

/** Square, Rounded Square and Circle keep equal sides; the drag point sets the size. */
export const constrained = constrainedShape;

/* The selection shapes are PSP's preset shapes (core/vector/path.ts), flattened. */
export function shapePolygon(shape: string, x0: number, y0: number, x1: number, y1: number): Point[] {
  if (constrained(shape)) {
    const s = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    x1 = x0 + Math.sign(x1 - x0 || 1) * s;
    y1 = y0 + Math.sign(y1 - y0 || 1) * s;
  }
  return flattenContour(presetShapeContour(shape, x0, y0, x1, y1), 24);
}

export function shapeMask(width: number, height: number, shape: string, x0: number, y0: number, x1: number, y1: number, antialias: boolean): Mask {
  return polygonMask(width, height, [shapePolygon(shape, x0, y0, x1, y1)], antialias);
}

/* Separable box blur, three passes (close to a Gaussian): Feather, and the Feather options. */
export function feather(m: Mask, radius: number): Mask {
  const r = Math.round(radius);
  if (r <= 0) return m;
  const { width: w, height: h } = m;
  let src = Float32Array.from(m.data);
  let tmp = new Float32Array(w * h);
  // Three box passes of radius k spread an edge about 3k pixels: feather N spreads it about N.
  const k = Math.max(1, Math.round(r / 3));
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = -k; x <= k; x++) sum += src[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = sum / (2 * k + 1);
        sum += src[y * w + Math.min(w - 1, x + k + 1)] - src[y * w + Math.max(0, x - k)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -k; y <= k; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        src[y * w + x] = sum / (2 * k + 1);
        sum += tmp[Math.min(h - 1, y + k + 1) * w + x] - tmp[Math.max(0, y - k) * w + x];
      }
    }
  }
  const out = createMask(w, h);
  for (let i = 0; i < out.data.length; i++) out.data[i] = Math.round(src[i]);
  return out;
}

/* Expand (grow > 0) or contract (grow < 0) by whole pixels, round: max or min over a disc. */
export function morph(m: Mask, grow: number): Mask {
  const n = Math.round(Math.abs(grow));
  if (!n) return m;
  const { width: w, height: h } = m;
  const out = createMask(w, h);
  const offsets: [number, number][] = [];
  for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++) if (dx * dx + dy * dy <= n * n + n) offsets.push([dx, dy]);
  const expand = grow > 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = expand ? 0 : 255;
    for (const [dx, dy] of offsets) {
      const xx = x + dx, yy = y + dy;
      const s = xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : m.data[yy * w + xx];
      if (expand ? s > v : s < v) v = s;
      if (expand ? v === 255 : v === 0) break;
    }
    out.data[y * w + x] = v;
  }
  return out;
}

export type MatchMode = "rgb" | "hue" | "brightness" | "all";
export const MATCH_MODES: MatchMode[] = ["rgb", "hue", "brightness", "all"];

/* How far apart two pixels are in the chosen terms, 0..255 (PSP's tolerance is 0..200). */
function distance(d: Uint8ClampedArray, i: number, j: number, mode: MatchMode, hsl: number[], hsl2: number[]): number {
  switch (mode) {
    case "rgb": return Math.max(Math.abs(d[i] - d[j]), Math.abs(d[i + 1] - d[j + 1]), Math.abs(d[i + 2] - d[j + 2]));
    case "brightness": return Math.abs(luminance(d[i], d[i + 1], d[i + 2]) - luminance(d[j], d[j + 1], d[j + 2]));
    case "hue": {
      rgbToHsl(d[i], d[i + 1], d[i + 2], hsl);
      rgbToHsl(d[j], d[j + 1], d[j + 2], hsl2);
      const dh = Math.abs(hsl[0] - hsl2[0]);
      return (Math.min(dh, 360 - dh) * 255) / 180;
    }
    case "all": return d[j + 3] ? 0 : 255;
  }
}

/** The region around (x, y) whose pixels match the clicked one within `tolerance` (Magic Wand, Flood Fill). */
export function floodRegion(r: Raster, x: number, y: number, mode: MatchMode, tolerance: number, contiguous = true): Mask {
  const { width: w, height: h, data: d } = r;
  const out = createMask(w, h);
  if (x < 0 || y < 0 || x >= w || y >= h) return out;
  const seed = (y * w + x) * 4;
  const hsl = [0, 0, 0], hsl2 = [0, 0, 0];
  const match = (p: number) => {
    const j = p * 4;
    if (mode === "all") return d[j + 3] > 0;
    // A clear pixel matches only clear pixels (and the other way round).
    if ((d[seed + 3] === 0) !== (d[j + 3] === 0)) return false;
    return distance(d, seed, j, mode, hsl, hsl2) <= tolerance;
  };
  if (!contiguous) {
    for (let p = 0; p < w * h; p++) if (match(p)) out.data[p] = 255;
    return out;
  }
  const stack = [y * w + x];
  out.data[y * w + x] = 255;
  while (stack.length) {
    const p = stack.pop()!;
    const px = p % w, py = (p - px) / w;
    const visit = (q: number) => { if (!out.data[q] && match(q)) { out.data[q] = 255; stack.push(q); } };
    if (px > 0) visit(p - 1);
    if (px < w - 1) visit(p + 1);
    if (py > 0) visit(p - w);
    if (py < h - 1) visit(p + w);
  }
  return out;
}

/*
  Grow Selection: the selection plus the pixels next to it that match a selected neighbour.
  Select Similar: every pixel anywhere matching a selected pixel's color. Both use the Magic
  Wand's match mode and tolerance.
*/
export function growSelection(r: Raster, sel: Mask, mode: MatchMode, tolerance: number): Mask {
  const { width: w, height: h, data: d } = r;
  const out = createMask(w, h);
  out.data.set(sel.data);
  const stack: number[] = [];
  for (let p = 0; p < w * h; p++) if (sel.data[p] >= 128) stack.push(p);
  const hsl = [0, 0, 0], hsl2 = [0, 0, 0];
  while (stack.length) {
    const p = stack.pop()!;
    const px = p % w;
    for (const q of [px > 0 ? p - 1 : -1, px < w - 1 ? p + 1 : -1, p - w, p + w]) {
      if (q < 0 || q >= w * h || out.data[q]) continue;
      if (distance(d, p * 4, q * 4, mode, hsl, hsl2) <= tolerance) { out.data[q] = 255; stack.push(q); }
    }
  }
  return out;
}

export function selectSimilar(r: Raster, sel: Mask, mode: MatchMode, tolerance: number): Mask {
  const d = r.data, n = r.width * r.height;
  // The distinct selected colors (at most a few thousand are compared; the rest are near duplicates).
  const seen = new Set<number>();
  const seeds: number[] = [];
  for (let p = 0; p < n && seeds.length < 4096; p++) {
    if (sel.data[p] < 128) continue;
    const key = (d[p * 4] << 16) | (d[p * 4 + 1] << 8) | d[p * 4 + 2];
    if (!seen.has(key)) { seen.add(key); seeds.push(p * 4); }
  }
  const out = createMask(r.width, r.height);
  const hsl = [0, 0, 0], hsl2 = [0, 0, 0];
  for (let p = 0; p < n; p++) {
    if (sel.data[p] >= 128) { out.data[p] = 255; continue; }
    for (const s of seeds) if (distance(d, s, p * 4, mode, hsl, hsl2) <= tolerance) { out.data[p] = 255; break; }
  }
  return out;
}

/* Selections > Modify > Transparent Color: deselect the pixels of one color (within tolerance). */
export function removeColor(r: Raster, sel: Mask, color: [number, number, number], tolerance: number): Mask {
  const out = createMask(sel.width, sel.height), d = r.data;
  for (let p = 0; p < sel.data.length; p++) {
    const near = Math.max(Math.abs(d[p * 4] - color[0]), Math.abs(d[p * 4 + 1] - color[1]), Math.abs(d[p * 4 + 2] - color[2])) <= tolerance;
    out.data[p] = near ? 0 : sel.data[p];
  }
  return out;
}

/** A mask from an image: its brightness, its opacity, or 255 wherever it is not clear (Masks > New > From Image). */
export function maskFromRaster(r: Raster, source: "luminance" | "opacity" | "nonzero", invertIt = false): Mask {
  const m = createMask(r.width, r.height), d = r.data;
  for (let p = 0; p < m.data.length; p++) {
    const i = p * 4;
    let v = source === "luminance" ? luminance(d[i], d[i + 1], d[i + 2]) : source === "opacity" ? d[i + 3] : d[i + 3] ? 255 : 0;
    if (invertIt) v = 255 - v;
    m.data[p] = v;
  }
  return m;
}

/** A mask moved by whole pixels; what comes in from outside is unselected. */
export function shiftMask(m: Mask, dx: number, dy: number): Mask {
  const out = createMask(m.width, m.height);
  const { width: w, height: h } = m;
  for (let y = 0; y < h; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= h) continue;
    const x0 = Math.max(0, dx), x1 = Math.min(w, w + dx);
    if (x1 > x0) out.data.set(m.data.subarray(sy * w + x0 - dx, sy * w + x1 - dx), y * w + x0);
  }
  return out;
}

/*
  The marching ants: the edges between selected (128 and over) and unselected pixels, as
  line runs in image coordinates.
*/
export function outline(m: Mask): number[][] {
  const { width: w, height: h, data } = m;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] >= 128;
  const runs: number[][] = [];
  for (let y = 0; y <= h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const edge = x < w && on(x, y - 1) !== on(x, y);
      if (edge && start < 0) start = x;
      if (!edge && start >= 0) { runs.push([start, y, x, y]); start = -1; }
    }
  }
  for (let x = 0; x <= w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const edge = y < h && on(x - 1, y) !== on(x, y);
      if (edge && start < 0) start = y;
      if (!edge && start >= 0) { runs.push([x, start, x, y]); start = -1; }
    }
  }
  return runs;
}
