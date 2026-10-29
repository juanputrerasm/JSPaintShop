/*
  From full color to a palette, for saving a GIF (or a paletted BMP) from an image with more
  colors than the format holds.

  `exactPalette` keeps the colors when there are few enough. Otherwise `medianCut` builds a
  palette by splitting the color box with the widest range at its median, and every pixel
  takes the nearest palette color. Colors > Decrease Color Depth, with its choice of
  palettes and dithering, comes with the Colors menu.

  Pixels under half opacity become the transparent index when `transparent` is asked for.
*/
import type { Raster } from "../image/raster.ts";
import type { IndexedPixels } from "../formats/bmp.ts";

export interface Indexed extends IndexedPixels { transparent: number }

function bitsFor(colors: number): 1 | 4 | 8 {
  return colors <= 2 ? 1 : colors <= 16 ? 4 : 8;
}

/** The image's own colors, when there are at most `max` (one fewer if a transparent index is needed). */
export function exactPalette(r: Raster, max = 256, transparent = true): Indexed | null {
  const d = r.data, n = r.width * r.height;
  const map = new Map<number, number>();
  const indices = new Uint8Array(n);
  let clear = -1;
  const colors: number[] = [];
  for (let i = 0; i < n; i++) {
    if (transparent && d[i * 4 + 3] < 128) {
      if (clear < 0) { clear = colors.length; colors.push(-1); }
      indices[i] = clear;
      continue;
    }
    const key = (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2];
    let k = map.get(key);
    if (k === undefined) {
      if (colors.length >= max) return null;
      k = colors.length;
      map.set(key, k);
      colors.push(key);
    }
    indices[i] = k;
  }
  const palette = new Uint8Array(Math.max(2, colors.length) * 3);
  colors.forEach((c, i) => { if (c >= 0) { palette[i * 3] = c >> 16; palette[i * 3 + 1] = (c >> 8) & 255; palette[i * 3 + 2] = c & 255; } });
  return { indices, palette, bits: bitsFor(colors.length), transparent: clear };
}

/** A palette of at most `max` colors by median cut, and each pixel's nearest color. */
export function medianCut(r: Raster, max = 256, transparent = true): Indexed {
  const exact = exactPalette(r, max, transparent);
  if (exact) return exact;
  const d = r.data, n = r.width * r.height;
  let hasClear = false;
  // Count colors at 5 bits per channel: enough to choose a palette, fast to sort.
  const counts = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    if (transparent && d[i * 4 + 3] < 128) { hasClear = true; continue; }
    const key = ((d[i * 4] >> 3) << 10) | ((d[i * 4 + 1] >> 3) << 5) | (d[i * 4 + 2] >> 3);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const target = max - (hasClear ? 1 : 0);
  type Box = { colors: number[] };
  const channel = (c: number, k: number) => (c >> (10 - 5 * k)) & 31;
  const range = (box: Box, k: number) => {
    let lo = 31, hi = 0;
    for (const c of box.colors) { const v = channel(c, k); if (v < lo) lo = v; if (v > hi) hi = v; }
    return hi - lo;
  };
  const boxes: Box[] = [{ colors: [...counts.keys()] }];
  while (boxes.length < target) {
    let best = -1, bestRange = 0, bestK = 0;
    boxes.forEach((box, i) => {
      if (box.colors.length < 2) return;
      for (let k = 0; k < 3; k++) { const rg = range(box, k); if (rg > bestRange) { bestRange = rg; best = i; bestK = k; } }
    });
    if (best < 0) break;
    const box = boxes[best];
    box.colors.sort((a, b) => channel(a, bestK) - channel(b, bestK));
    // Split where half the pixels fall on each side.
    const total = box.colors.reduce((s, c) => s + counts.get(c)!, 0);
    let acc = 0, cut = 1;
    for (; cut < box.colors.length - 1; cut++) { acc += counts.get(box.colors[cut - 1])!; if (acc >= total / 2) break; }
    boxes.splice(best, 1, { colors: box.colors.slice(0, cut) }, { colors: box.colors.slice(cut) });
  }
  const size = boxes.length + (hasClear ? 1 : 0);
  const palette = new Uint8Array(Math.max(2, size) * 3);
  const clear = hasClear ? boxes.length : -1;
  boxes.forEach((box, i) => {
    let r0 = 0, g0 = 0, b0 = 0, w = 0;
    for (const c of box.colors) { const k = counts.get(c)!; r0 += channel(c, 0) * k; g0 += channel(c, 1) * k; b0 += channel(c, 2) * k; w += k; }
    palette[i * 3] = Math.round(((r0 / w) * 255) / 31); palette[i * 3 + 1] = Math.round(((g0 / w) * 255) / 31); palette[i * 3 + 2] = Math.round(((b0 / w) * 255) / 31);
  });
  const indices = new Uint8Array(n);
  const cache = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    if (hasClear && d[i * 4 + 3] < 128) { indices[i] = clear; continue; }
    const key = (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2];
    let k = cache.get(key);
    if (k === undefined) { k = nearest(palette, boxes.length, d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); cache.set(key, k); }
    indices[i] = k;
  }
  return { indices, palette, bits: bitsFor(size), transparent: clear };
}

export function nearest(palette: Uint8Array, count: number, r: number, g: number, b: number): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < count; i++) {
    const dr = palette[i * 3] - r, dg = palette[i * 3 + 1] - g, db = palette[i * 3 + 2] - b;
    const dist = dr * dr * 2 + dg * dg * 4 + db * db * 3;
    if (dist < bestD) { bestD = dist; best = i; }
  }
  return best;
}

/** Map pixels onto a given palette (an image already paletted keeps its palette on save). */
export function toPalette(r: Raster, palette: Uint8Array, hint?: Uint8Array): Indexed {
  const count = palette.length / 3;
  const n = r.width * r.height, d = r.data;
  const indices = new Uint8Array(n);
  const cache = new Map<number, number>();
  const keep = hint && hint.length === n ? hint : null;
  for (let i = 0; i < n; i++) {
    // The file's own index while the pixel still has its color.
    const h = keep ? keep[i] : -1;
    if (h >= 0 && h < count && palette[h * 3] === d[i * 4] && palette[h * 3 + 1] === d[i * 4 + 1] && palette[h * 3 + 2] === d[i * 4 + 2]) { indices[i] = h; continue; }
    const key = (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2];
    let k = cache.get(key);
    if (k === undefined) { k = nearest(palette, count, d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); cache.set(key, k); }
    indices[i] = k;
  }
  return { indices, palette, bits: bitsFor(count), transparent: -1 };
}
