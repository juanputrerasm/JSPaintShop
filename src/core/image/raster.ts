/*
  A raster: RGBA, 8 bits per channel, straight (not premultiplied) alpha, rows top to bottom.
  Every layer, mask and composite is one of these, so the recorders in core/edit and the
  canvas both take it as it is.
*/
import type { Rect } from "../edit/history.ts";

export interface Raster { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> }

export type Rgba = [number, number, number, number];

/*
  A mask: one byte per pixel, 0 (none) to 255 (full), canvas-sized. Selections, layer masks
  and alpha channels are masks.
*/
export interface Mask { width: number; height: number; data: Uint8Array<ArrayBuffer> }

export function createMask(width: number, height: number, value = 0): Mask {
  const data = new Uint8Array(width * height);
  if (value) data.fill(value);
  return { width, height, data };
}

/** The smallest rectangle holding every non-zero mask pixel, or null when the mask is empty. */
export function maskBounds(m: Mask): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = m.width, minY = m.height, maxX = -1, maxY = -1;
  for (let y = 0; y < m.height; y++) {
    const row = y * m.width;
    for (let x = 0; x < m.width; x++) {
      if (!m.data[row + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      maxY = y;
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

export function createRaster(width: number, height: number, fill?: Rgba): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill && (fill[0] || fill[1] || fill[2] || fill[3])) {
    const word = new Uint32Array(data.buffer);
    word.fill(new Uint32Array(new Uint8ClampedArray(fill).buffer)[0]);
  }
  return { width, height, data };
}

export function cloneRaster(r: Raster): Raster {
  return { width: r.width, height: r.height, data: new Uint8ClampedArray(r.data) };
}

/** The whole raster as a rectangle (inclusive). */
export function fullRect(width: number, height: number): Rect {
  return { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 };
}

export function pixelAt(r: Raster, x: number, y: number): Rgba | null {
  if (x < 0 || y < 0 || x >= r.width || y >= r.height) return null;
  const o = (y * r.width + x) * 4;
  return [r.data[o], r.data[o + 1], r.data[o + 2], r.data[o + 3]];
}

/** Whether any pixel is less than fully opaque. */
export function hasTransparency(r: Raster): boolean {
  for (let i = 3; i < r.data.length; i += 4) if (r.data[i] !== 255) return true;
  return false;
}
