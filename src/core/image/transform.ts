/*
  Image > Flip, Mirror, Rotate and Add Borders (docs/PSP_EXE_ANALYSIS.md section 4).

  Flip and Mirror act on the active layer (and, with a selection, on the selected pixels,
  floated and flipped in place). Rotate turns the active layer, or every layer with All
  Layers; right angles are exact, other angles map each new pixel back into the old image
  in 1/1024-pixel fixed point around the centre and blend the four pixels around it (PSP's
  ROTATE.CPP, Psp.exe 0x7ecc00). The canvas grows to hold the turned image; what is new is
  the background color on a Background layer and transparent elsewhere.
*/
import { createRaster, type Raster, type Rgba } from "./raster.ts";
import type { ImageDoc, Layer } from "../doc/image-doc.ts";
import { isBackground, placeRaster, resizeCanvas } from "./geometry.ts";

export function flipRaster(r: Raster, vertical: boolean): Raster {
  const out = createRaster(r.width, r.height), w = r.width, h = r.height;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = vertical ? x : w - 1 - x, sy = vertical ? h - 1 - y : y;
    out.data.set(r.data.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * w + x) * 4);
  }
  return out;
}

/* Right-angle turns: 90 (clockwise), 180, 270. */
export function rotateRight(r: Raster, quarter: 1 | 2 | 3): Raster {
  const w = r.width, h = r.height;
  const out = createRaster(quarter === 2 ? w : h, quarter === 2 ? h : w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [nx, ny] = quarter === 1 ? [h - 1 - y, x] : quarter === 2 ? [w - 1 - x, h - 1 - y] : [y, w - 1 - x];
    out.data.set(r.data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (ny * out.width + nx) * 4);
  }
  return out;
}

/** The canvas size that holds a w x h image turned by `degrees`. */
export function rotatedSize(w: number, h: number, degrees: number): [number, number] {
  const a = (degrees * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  return [Math.max(1, Math.round(w * c + h * s)), Math.max(1, Math.round(w * s + h * c))];
}

/* Free rotation by `degrees` clockwise into a new W x H raster, background `fill` outside. */
export function rotateFree(r: Raster, degrees: number, W: number, H: number, fill: Rgba): Raster {
  const out = createRaster(W, H, fill);
  const a = (degrees * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const w = r.width, h = r.height, s = r.data, d = out.data;
  const cx = (w / 2) * 1024, cy = (h / 2) * 1024;
  for (let y = 0; y < H; y++) {
    const dy = y - H / 2;
    for (let x = 0; x < W; x++) {
      const dx = x - W / 2;
      // Back into the source, 1/1024 pixels.
      const fx = Math.trunc((dx * cos + dy * sin) * 1024 + cx), fy = Math.trunc((-dx * sin + dy * cos) * 1024 + cy);
      const ix = fx >> 10, iy = fy >> 10;
      if (ix < -1 || iy < -1 || ix >= w || iy >= h) continue;
      const tx = fx & 1023, ty = fy & 1023;
      const px = (xx: number, yy: number, c: number) => (xx < 0 || yy < 0 || xx >= w || yy >= h ? fill[c] : s[(yy * w + xx) * 4 + c]);
      const o = (y * W + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = px(ix, iy, c) * (1024 - tx) + px(ix + 1, iy, c) * tx;
        const bottom = px(ix, iy + 1, c) * (1024 - tx) + px(ix + 1, iy + 1, c) * tx;
        d[o + c] = (top * (1024 - ty) + bottom * ty) >> 20;
      }
    }
  }
  return out;
}

/* A raster turned by `degrees`: exact for right angles, else into a W x H raster. */
function turn(r: Raster, degrees: number, W: number, H: number, fill: Rgba): Raster {
  const q = ((degrees % 360) + 360) % 360;
  if (q === 0) return r;
  if (q % 90 === 0) return rotateRight(r, (q / 90) as 1 | 2 | 3);
  return rotateFree(r, degrees, W, H, fill);
}

/** Image > Rotate: `degrees` clockwise (negative for left), the active layer or all of them. */
export function rotateImage(doc: ImageDoc, degrees: number, allLayers: boolean, bg: Rgba): void {
  const [W, H] = rotatedSize(doc.width, doc.height, degrees);
  const fillOf = (l: Layer): Rgba => (isBackground(doc, l) ? bg : [0, 0, 0, 0]);
  if (allLayers) {
    for (const l of doc.layers) { l.raster = turn(l.raster, degrees, W, H, fillOf(l)); l.mask = null; }
    doc.width = W;
    doc.height = H;
    doc.selection = null;
    doc.alphas = [];
    return;
  }
  // One layer turned: the canvas grows to hold it, centred, and the other layers keep their place.
  const layer = doc.layers[doc.active];
  const turned = turn(layer.raster, degrees, W, H, fillOf(layer));
  const nw = Math.max(doc.width, turned.width), nh = Math.max(doc.height, turned.height);
  resizeCanvas(doc, nw, nh, Math.floor((nw - doc.width) / 2), Math.floor((nh - doc.height) / 2), bg);
  layer.raster = placeRaster(turned, nw, nh, Math.floor((nw - turned.width) / 2), Math.floor((nh - turned.height) / 2), isBackground(doc, layer) ? bg : undefined);
  layer.mask = null;
}

/** Image > Add Borders: canvas grown by the given sides, the new area the border color on the Background layer. */
export function addBorders(doc: ImageDoc, left: number, top: number, right: number, bottom: number, color: Rgba): void {
  resizeCanvas(doc, doc.width + left + right, doc.height + top + bottom, left, top, color);
}
