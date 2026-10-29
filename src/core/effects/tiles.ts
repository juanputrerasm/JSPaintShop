/*
  Image > Effects > Tiles ("TilesEffect.cpp", 0x797520; DIALOG 503), docs/PSP_EXE_ANALYSIS.md
  section 17.

  1. A grid of tile corners for the shape (0x6c17f0): triangles, squares or hexagons of the
     tile size.
  2. Angularity (0x796f00): each corner inside the image moves to the pixel with the strongest
     Prewitt gradient of the image's grey (Gaussian 1.0) within size·angularity/300 of it.
  3. Each tile (0x797370) is shrunk about its centroid by 1 − border/size and filled with the
     average color of the image under the shrunk tile, drawn antialiased at 3x (0x7962b0); the
     gaps keep the border color. The coverage is the height map and the lighting mask.
  4. With smoothness, the tiles are bevelled: a pixel's height is trunc(d·255.9/k) for its
     distance d (up to k = trunc(smoothness·0.04 + 1.1)) to the nearest gap, then the map gets a
     Gaussian of smoothness·0.03 + 0.5.
  5. The shared lighting (bevel.ts lightSurface), flat at the edge when smoothness is 0.
*/
import { cloneRaster, type Raster } from "../image/raster.ts";
import { luminance } from "../color/color-space.ts";
import { gaussianPlane } from "../filters/filters.ts";
import { lightSurface, LIGHT_DEFAULTS, type Light } from "./bevel.ts";

export interface TilesParams extends Light {
  /** 0 triangle, 1 square, 2 hexagon. */
  shape: 0 | 1 | 2;
  angularity: number;
  /** 8..32. */
  size: number;
  /** 1..10. */
  border: number;
  borderColor: [number, number, number];
  smoothness: number;
}

/* Defaults from 0x7959f0: the lighting's with depth 1 and shininess 50. */
export const TILES_DEFAULTS: TilesParams = { ...LIGHT_DEFAULTS, depth: 1, shininess: 50, smoothness: 25, shape: 2, angularity: 75, size: 15, border: 1, borderColor: [0, 0, 0] };
export const TILE_SHAPES = ["Triangle", "Square", "Hexagon"];

type P = [number, number];

/* The corner grid (rows of points) and each tile's corners as [row, column] pairs. */
export function tileGrid(shape: 0 | 1 | 2, size: number, W: number, H: number): { pts: P[][]; tiles: [number, number][][] } {
  const pts: P[][] = [], tiles: [number, number][][] = [];
  if (shape === 1) {
    // 0x6c1d20: (n + 1) x (m + 1) tiles, n = trunc((W + s − 1) / s), m likewise with H.
    const s = size, cols = Math.trunc((W + s - 1) / s) + 1, rows = Math.trunc((H + s - 1) / s) + 1;
    for (let j = 0; j <= rows; j++) { const r: P[] = []; for (let i = 0; i <= cols; i++) r.push([i * s - s * 0.5, j * s - s * 0.5]); pts.push(r); }
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) tiles.push([[j, i], [j, i + 1], [j + 1, i + 1], [j + 1, i]]);
  } else if (shape === 2) {
    // 0x6c19e0: rows `half` apart; pairs of points along each row, odd rows offset.
    // a = trunc((W + 6d − 1) / 6d), b = trunc((H + 2·half − 1) / half): (a + 1) x (b + 1) tiles.
    const half = Math.trunc(size / 2), d4 = half / Math.sqrt(3), d6 = d4 * 2, d5 = d6 + d4;
    const a = Math.trunc((W + 2 * d5 - 1) / (2 * d5)), b = Math.trunc((H + 2 * half - 1) / half);
    const pairs = a + 2, prow = 2 * b + 3;
    for (let r = 0; r < prow; r++) {
      const y = r * half - half, row: P[] = [];
      for (let k = 0; k < pairs; k++) {
        const base = k * (d5 + d5) - d4;
        if (r % 2 === 0) row.push([base + d4, y], [d5 + base, y]);
        else row.push([base, y], [d6 + base + d6, y]);
      }
      pts.push(row);
    }
    for (let j = 0; j <= b; j++) for (let i = 0; i <= a; i++) {
      const c = i * 2 + (j % 2 ? 1 : 0);
      tiles.push([[j, c], [j, c + 1], [j + 1, c + 1], [j + 2, c + 1], [j + 2, c], [j + 1, c]]);
    }
  } else {
    // 0x6c1f00: rows h = √3·s/2 apart, even rows offset by s/2; tiles alternate up and down.
    // n = trunc((W + s − 1) / s), m = trunc((H + h − 1) / h): 2n + 2 tiles a row, m + 1 rows.
    const s = size, h = Math.sqrt(3) * s * 0.5, n = Math.trunc((W + s - 1) / s), m = Math.trunc((H + h - 1) / h);
    const cols = n + 2, rows = m + 3;
    for (let r = 0; r < rows; r++) { const row: P[] = []; for (let c = 0; c < cols; c++) row.push([c * s - s * 0.5 + (r % 2 === 0 ? s * 0.5 : 0), r * h - h * 0.5]); pts.push(row); }
    for (let j = 0; j <= m; j++) for (let i = 0; i < 2 * n + 2; i++) {
      const k = Math.trunc(i / 2), evenI = i % 2 === 0;
      if (j % 2 === 0) tiles.push(evenI ? [[j, k], [j + 1, k + 1], [j + 1, k]] : [[j, k], [j, k + 1], [j + 1, k + 1]]);
      else tiles.push(evenI ? [[j, k], [j, k + 1], [j + 1, k]] : [[j, k + 1], [j + 1, k + 1], [j + 1, k]]);
    }
  }
  return { pts, tiles };
}

/* Corners snap to the strongest edge near them (0x796f00). */
function snapCorners(pts: P[][], grey: Uint8Array, W: number, H: number, r: number): void {
  const at = (x: number, y: number) => grey[y * W + x];
  for (const row of pts) for (const p of row) {
    const px = Math.trunc(p[0]), py = Math.trunc(p[1]);
    if (px < 1 || py < 1 || px >= W - 1 || py >= H - 1) continue;
    const x0 = Math.max(1, px - r), x1 = Math.min(W - 1, px + r), y0 = Math.max(1, py - r), y1 = Math.min(H - 1, py + r);
    let best = 0, bx = px, by = py;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const gx = at(x - 1, y) + at(x - 1, y + 1) + at(x - 1, y - 1) - at(x + 1, y) - at(x + 1, y - 1) - at(x + 1, y + 1);
      const gy = at(x, y + 1) - at(x, y - 1) - at(x + 1, y - 1) - at(x - 1, y - 1) + at(x + 1, y + 1) + at(x - 1, y + 1);
      const m = gx * gx + gy * gy;
      if (m > best) { best = m; bx = x; by = y; }
    }
    p[0] = bx; p[1] = by;
  }
}

/* Rounding half away from zero, as 0x796a00 does before ftol. */
const round = (v: number) => Math.trunc(v < 0 ? v - 0.5 : v + 0.5);

interface Spans { minX: number; minY: number; maxX: number; maxY: number; left: Int32Array; right: Int32Array }

/*
  0x58b540 and 0x58b630: the bounding box of integer corners and each row's inclusive span.
  Each edge (corner i to corner i − 1) steps its rows from the lower end with
  x = trunc((y − y0)·dx / dy) + x0; a row widens to every x its edges reach.
*/
function polySpans(v: P[]): Spans {
  let minX = v[0][0], minY = v[0][1], maxX = minX, maxY = minY;
  for (const [x, y] of v) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const rows = maxY - minY + 1, left = new Int32Array(rows).fill(maxX + 1), right = new Int32Array(rows).fill(minX);
  const mark = (y: number, x: number) => { const r = y - minY; if (x < left[r]) left[r] = x; if (x > right[r]) right[r] = x; };
  for (let i = 0; i < v.length; i++) {
    let [xa, ya] = v[i], [xb, yb] = v[(i + v.length - 1) % v.length];
    if (ya > yb) [xa, ya, xb, yb] = [xb, yb, xa, ya];
    const dx = xb - xa, dy = yb - ya;
    if (dy === 0) { mark(ya, xa); mark(ya, xb); continue; }
    for (let y = ya; y <= yb; y++) mark(y, Math.trunc(((y - ya) * dx) / dy) + xa);
  }
  return { minX, minY, maxX, maxY, left, right };
}

const floor3 = (v: number) => Math.floor(v / 3) * 3;
const ceil3 = (v: number) => Math.ceil(v / 3) * 3;

/*
  Greyscale images (0x797370 picks 0x7965f0 for 8-bit images): the same steps on one channel.
  The angularity's grey is the image itself (no conversion before the Gaussian), each tile is
  the average grey, the border is BorderColor's first byte (its red), and the lighting
  (0x488f60) uses the light color's grey, (77·R + 151·G + 28·B) >> 8.
*/
export function tiles(image: Raster, p: TilesParams, selection: Uint8Array | null, greyscale = false): Raster {
  const { width: W, height: H, data: src } = image;
  if (greyscale) {
    const [r, g, b] = p.color;
    const light = ((g * 0x97 + r * 0x4d + b * 0x1c) >> 8) & 0xff;
    p = { ...p, borderColor: [p.borderColor[0], p.borderColor[0], p.borderColor[0]], color: [light, light, light] };
  }
  const size = Math.max(8, Math.min(32, Math.trunc(p.size)));
  const { pts, tiles: list } = tileGrid(p.shape, size, W, H);
  if (p.angularity > 0) {
    // The grey in DIB rows (bottom up), like the corner grid.
    let grey = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = ((H - 1 - y) * W + x) * 4; grey[y * W + x] = greyscale ? src[i] : luminance(src[i], src[i + 1], src[i + 2]); }
    grey = gaussianPlane(grey, W, H, 1);
    const r = Math.trunc((size * Math.trunc(p.angularity)) / 300);
    if (r > 0) snapCorners(pts, grey, W, H, r);
  }
  /*
    The tiles (0x797370, 0x796a00). PSP works on bottom-up DIB rows, so the grid starts at the
    bottom left: grid row y is image row H − 1 − y. Each tile is shrunk about the mean of its
    corners by 1 − border/size, colored with the integer average of the image under the shrunk
    tile (corners rounded), and drawn at three times the resolution (0x7962b0): a pixel's
    coverage is (256 per covered subpixel of its 3 x 3, + 4) / 9, its color
    (border·(256 − a) + tile·a) >> 8 and its height (a·255) >> 8.
  */
  const color = cloneRaster(image);
  for (let i = 0; i < W * H; i++) color.data.set(p.borderColor, i * 4);
  const MW = W + 2, MH = H + 2;
  let map = new Uint8Array(MW * MH);
  const scale = 1 - Math.trunc(p.border) / size;
  const [br, bgc, bb] = p.borderColor;
  for (const t of list) {
    const poly = t.map(([j, i]) => pts[j][i]);
    const cx = poly.reduce((q, c) => q + c[0], 0) / poly.length, cy = poly.reduce((q, c) => q + c[1], 0) / poly.length;
    const small = poly.map(([x, y]): P => [(x - cx) * scale + cx, (y - cy) * scale + cy]);
    // The average color (0x795e50): rows inside the image, spans clipped to it.
    const one = polySpans(small.map(([x, y]): P => [round(x), round(y)]));
    let n = 0, r = 0, g = 0, b = 0;
    for (let y = one.minY; y <= one.maxY; y++) {
      if (y < 0 || y >= H) continue;
      const x0 = Math.max(0, one.left[y - one.minY]), x1 = Math.min(W - 1, one.right[y - one.minY]);
      const row = (H - 1 - y) * W;
      for (let x = x0; x <= x1; x++) { const o = (row + x) * 4; r += src[o]; g += src[o + 1]; b += src[o + 2]; n++; }
    }
    if (n <= 0) n = 1;
    let tr = Math.trunc(r / n), tg = Math.trunc(g / n), tb = Math.trunc(b / n);
    if (greyscale) tg = tb = tr;
    // The tile at three times the resolution.
    const three = polySpans(small.map(([x, y]): P => [round(x * 3), round(y * 3)]));
    const x0 = floor3(three.minX), x1 = ceil3(three.maxX + 1), y0 = floor3(three.minY), y1 = ceil3(three.maxY + 1);
    const acc = new Int32Array(x1 - x0);
    for (let R = Math.max(0, y0 / 3); R <= Math.min(y1 / 3, H - 1); R++) {
      acc.fill(0);
      for (let sy = R * 3; sy < R * 3 + 3; sy++) {
        if (sy < three.minY || sy > three.maxY) continue;
        const k = sy - three.minY;
        for (let x = three.left[k]; x <= three.right[k]; x++) acc[x - x0] += 256;
      }
      const top = H - 1 - R;
      for (let sx = 0; sx < acc.length; sx += 3) {
        const X = (x0 + sx) / 3;
        if (X < 0 || X >= W) continue;
        const a = Math.trunc((acc[sx] + acc[sx + 1] + acc[sx + 2] + 4) / 9);
        if (!a) continue;
        const o = (top * W + X) * 4, inv = 256 - a;
        color.data[o] = (br * inv + tr * a) >> 8;
        color.data[o + 1] = (bgc * inv + tg * a) >> 8;
        color.data[o + 2] = (bb * inv + tb * a) >> 8;
        map[(top + 1) * MW + X + 1] = (a * 255) >> 8;
      }
    }
  }
  const tileMask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) tileMask[y * W + x] = map[(y + 1) * MW + x + 1];
  const smooth = Math.trunc(p.smoothness);
  if (smooth >= 1) {
    // Bevel: height by the distance to the nearest gap, within k (0x797520's tail).
    const k = Math.trunc(smooth * 0.01 * 4 + 1.1), step = 255.9 / k;
    const out = map.slice();
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      if (map[y * MW + x] <= 0xbf) continue;
      let best = k * k;
      let x0 = x - k, x1 = x + k, y0 = y - k, y1 = y + k;
      if (x0 < 0) { best = Math.min(best, (x + 1) ** 2); x0 = 0; }
      if (x1 >= MW) { best = Math.min(best, (MW - x) ** 2); x1 = MW - 1; }
      if (y0 < 0) { best = Math.min(best, (y + 1) ** 2); y0 = 0; }
      if (y1 >= MH) { best = Math.min(best, (MH - y) ** 2); y1 = MH - 1; }
      if (best > 1) {
        search: for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
          if (map[yy * MW + xx] < 0xc0) {
            const d = (yy - y) ** 2 + (xx - x) ** 2;
            if (d < best) { best = d; if (d === 1) break search; }
          }
        }
      }
      out[y * MW + x] = Math.min(255, Math.trunc(Math.sqrt(best) * step));
    }
    map = gaussianPlane(out, MW, MH, smooth * 0.01 * 3 + 0.5);
  }
  // Light the tiles only (the gaps keep the border color), inside the selection.
  const lightMask = new Uint8Array(W * H);
  for (let i = 0; i < lightMask.length; i++) lightMask[i] = selection ? Math.min(tileMask[i], selection[i]) : tileMask[i];
  const lit = lightSurface(color, map, p, lightMask, undefined, smooth ? 0 : 1);
  if (selection) {
    // Outside the selection the image is unchanged.
    for (let i = 0; i < W * H; i++) {
      const m = selection[i];
      if (m === 255) continue;
      for (let c = 0; c < 3; c++) lit.data[i * 4 + c] = Math.round((lit.data[i * 4 + c] * m + src[i * 4 + c] * (255 - m)) / 255);
    }
  }
  for (let i = 0; i < W * H; i++) lit.data[i * 4 + 3] = src[i * 4 + 3];
  return lit;
}
