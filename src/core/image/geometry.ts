/*
  Changing the canvas: its size (Image > Canvas Size, Add Borders, Crop), and moving pixels
  around it. Every layer, layer mask, alpha channel and the selection change together; new
  rasters are made, so undo can keep the old ones.

  New canvas area is transparent, except on a layer called Background, which takes the given
  background color (PSP fills a background layer's new area with the background color).
*/
import { createRaster, createMask, type Mask, type Raster, type Rgba } from "./raster.ts";
import type { ImageDoc, Layer } from "../doc/image-doc.ts";
import type { Rect } from "../edit/history.ts";

export function isBackground(doc: ImageDoc, layer: Layer): boolean {
  return doc.layers[0] === layer && layer.name === "Background" && layer.kind === "raster";
}

/** Copy `src` into a new raster of w x h with its top-left at (dx, dy). */
export function placeRaster(src: Raster, w: number, h: number, dx: number, dy: number, fill?: Rgba): Raster {
  const out = createRaster(w, h, fill);
  for (let y = 0; y < src.height; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= h) continue;
    const x0 = Math.max(0, -dx), x1 = Math.min(src.width, w - dx);
    if (x1 > x0) out.data.set(src.data.subarray((y * src.width + x0) * 4, (y * src.width + x1) * 4), (ty * w + x0 + dx) * 4);
  }
  return out;
}

export function placeMask(src: Mask, w: number, h: number, dx: number, dy: number, fill = 0): Mask {
  const out = createMask(w, h, fill);
  for (let y = 0; y < src.height; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= h) continue;
    const x0 = Math.max(0, -dx), x1 = Math.min(src.width, w - dx);
    if (x1 > x0) out.data.set(src.data.subarray(y * src.width + x0, y * src.width + x1), ty * w + x0 + dx);
  }
  return out;
}

/** A new canvas w x h with the old one's top-left at (dx, dy). */
export function resizeCanvas(doc: ImageDoc, w: number, h: number, dx: number, dy: number, background: Rgba): void {
  for (const l of doc.layers) {
    l.raster = placeRaster(l.raster, w, h, dx + l.x, dy + l.y, isBackground(doc, l) ? background : undefined);
    l.x = 0;
    l.y = 0;
    // A mask's new area shows the layer, as the mask's own default does.
    if (l.mask) l.mask = placeMask(l.mask, w, h, dx, dy, 255);
  }
  doc.alphas = doc.alphas.map((a) => ({ ...a, mask: placeMask(a.mask, w, h, dx, dy) }));
  doc.selection = doc.selection ? placeMask(doc.selection, w, h, dx, dy) : null;
  doc.width = w;
  doc.height = h;
}

/** Image > Crop to Selection and the Crop tool: keep the rectangle (inclusive). */
export function crop(doc: ImageDoc, r: Rect, background: Rgba): void {
  const x0 = Math.max(0, Math.floor(r.minX)), y0 = Math.max(0, Math.floor(r.minY));
  const x1 = Math.min(doc.width - 1, Math.ceil(r.maxX)), y1 = Math.min(doc.height - 1, Math.ceil(r.maxY));
  if (x1 < x0 || y1 < y0) return;
  resizeCanvas(doc, x1 - x0 + 1, y1 - y0 + 1, -x0, -y0, background);
  doc.selection = null;
}

/** Copy the part of `r` inside the rectangle (inclusive), masked by `mask` when given. */
export function extract(r: Raster, rect: Rect, mask?: Mask | null): Raster {
  const w = rect.maxX - rect.minX + 1, h = rect.maxY - rect.minY + 1;
  const out = createRaster(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x + rect.minX, sy = y + rect.minY;
    if (sx < 0 || sy < 0 || sx >= r.width || sy >= r.height) continue;
    const si = (sy * r.width + sx) * 4, di = (y * w + x) * 4;
    const m = mask ? mask.data[sy * r.width + sx] / 255 : 1;
    out.data[di] = r.data[si]; out.data[di + 1] = r.data[si + 1]; out.data[di + 2] = r.data[si + 2];
    out.data[di + 3] = r.data[si + 3] * m;
  }
  return out;
}
