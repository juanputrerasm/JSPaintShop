/*
  Floating selections and the clipboard's edits, as PSP 6 does them:

    float      the selected pixels of the active layer lift into a floating selection (a
               layer of its own over the active one); the place they came from is cleared
    defloat    the floating pixels drop onto the layer under them
    promote    the floating selection (or a copy of the selected pixels) becomes a layer
    clear      Edit > Clear (Del): the selected pixels cleared, to the background color on a
               Background layer
    paste      as a new layer, as a floating selection (whole, or with the background color
               clear), or scaled into the selection
*/
import { createMask, maskBounds, type Mask, type Raster, type Rgba } from "../image/raster.ts";
import { rasterLayer, type ImageDoc, type Layer } from "../doc/image-doc.ts";
import { extract, isBackground, placeRaster } from "../image/geometry.ts";
import { resample } from "../image/resample.ts";
import { blendPixel } from "../layers/blend.ts";
import { nextLayerName } from "../layers/layer-ops.ts";
import type { Rect } from "../edit/history.ts";

export const FLOATING_NAME = "Floating Selection";

export function floatingIndex(doc: ImageDoc): number {
  return doc.layers.findIndex((l) => l.kind === "floating");
}

/** Clear the masked part of a layer: transparent, or `background` on a Background layer. */
export function clearMasked(doc: ImageDoc, layer: Layer, mask: Mask | null, background: Rgba): void {
  const r = { ...layer.raster, data: new Uint8ClampedArray(layer.raster.data) };
  const bg = isBackground(doc, layer);
  const d = r.data;
  for (let p = 0; p < d.length / 4; p++) {
    const m = mask ? mask.data[p] / 255 : 1;
    if (m <= 0) continue;
    const i = p * 4;
    if (bg) { d[i] += (background[0] - d[i]) * m; d[i + 1] += (background[1] - d[i + 1]) * m; d[i + 2] += (background[2] - d[i + 2]) * m; d[i + 3] = 255; }
    else if (!layer.lockTransparency) d[i + 3] = d[i + 3] * (1 - m);
  }
  layer.raster = r;
}

/** The selected pixels of `layer`, canvas-sized, with the selection as their opacity. */
export function selectedPixels(layer: Layer, mask: Mask | null): Raster {
  const out = { width: layer.raster.width, height: layer.raster.height, data: new Uint8ClampedArray(layer.raster.data) };
  if (mask) for (let p = 0; p < mask.data.length; p++) out.data[p * 4 + 3] = out.data[p * 4 + 3] * (mask.data[p] / 255);
  return out;
}

export function float(doc: ImageDoc, background: Rgba): void {
  if (!doc.selection || floatingIndex(doc) >= 0) return;
  const layer = doc.layers[doc.active];
  const lifted = selectedPixels(layer, doc.selection);
  clearMasked(doc, layer, doc.selection, background);
  doc.layers.splice(doc.active + 1, 0, { ...rasterLayer(FLOATING_NAME, lifted), kind: "floating" });
  doc.active += 1;
}

export function defloat(doc: ImageDoc): void {
  const f = floatingIndex(doc);
  if (f < 0) return;
  const floating = doc.layers[f];
  const target = doc.layers[Math.max(0, f - 1)];
  if (f > 0) {
    const r = { ...target.raster, data: new Uint8ClampedArray(target.raster.data) };
    const s = floating.raster.data, w = r.width;
    for (let y = 0; y < floating.raster.height; y++) for (let x = 0; x < floating.raster.width; x++) {
      const tx = x + floating.x, ty = y + floating.y;
      if (tx < 0 || ty < 0 || tx >= w || ty >= r.height) continue;
      const si = (y * floating.raster.width + x) * 4;
      if (!s[si + 3]) continue;
      const di = (ty * w + tx) * 4;
      blendPixel(r.data, di, 0, s[si], s[si + 1], s[si + 2], s[si + 3], floating.opacity, tx, ty, target.lockTransparency);
    }
    target.raster = r;
  }
  doc.layers.splice(f, 1);
  doc.active = Math.max(0, f - 1);
}

export function promote(doc: ImageDoc): void {
  const f = floatingIndex(doc);
  if (f >= 0) {
    const l = doc.layers[f];
    doc.layers[f] = { ...l, kind: "raster", name: "Promoted Selection", raster: placeRaster(l.raster, doc.width, doc.height, l.x, l.y), x: 0, y: 0 };
    doc.active = f;
    return;
  }
  if (!doc.selection) return;
  const copy = selectedPixels(doc.layers[doc.active], doc.selection);
  doc.layers.splice(doc.active + 1, 0, rasterLayer("Promoted Selection", copy));
  doc.active += 1;
}

/** Bounds of the selection, or of the whole canvas when there is none. */
export function selectionBounds(doc: ImageDoc): Rect {
  return (doc.selection && maskBounds(doc.selection)) ?? { minX: 0, minY: 0, maxX: doc.width - 1, maxY: doc.height - 1 };
}

/** What Copy puts on the clipboard: the selected part of a raster, cropped to the selection. */
export function copyRegion(source: Raster, doc: ImageDoc): { raster: Raster; x: number; y: number } {
  const b = selectionBounds(doc);
  return { raster: extract(source, b, doc.selection), x: b.minX, y: b.minY };
}

export function pasteAsLayer(doc: ImageDoc, clip: Raster, x: number, y: number): void {
  doc.layers.splice(doc.active + 1, 0, rasterLayer(nextLayerName(doc), placeRaster(clip, doc.width, doc.height, x, y)));
  doc.active += 1;
}

/** Paste as a floating selection at (x, y); with `transparent`, the color `clear` drops out. */
/* `clear`: Paste As Transparent Selection's color, cleared within `tolerance` percent per channel (Preferences > Miscellaneous). */
export function pasteFloating(doc: ImageDoc, clip: Raster, x: number, y: number, clear?: Rgba, tolerance = 0): void {
  defloat(doc);
  let r = placeRaster(clip, doc.width, doc.height, x, y);
  if (clear) {
    r = { ...r, data: new Uint8ClampedArray(r.data) };
    const t = Math.round((255 * tolerance) / 100);
    for (let i = 0; i < r.data.length; i += 4) {
      if (Math.abs(r.data[i] - clear[0]) <= t && Math.abs(r.data[i + 1] - clear[1]) <= t && Math.abs(r.data[i + 2] - clear[2]) <= t) r.data[i + 3] = 0;
    }
  }
  const sel = createMask(doc.width, doc.height);
  for (let p = 0; p < sel.data.length; p++) sel.data[p] = r.data[p * 4 + 3];
  doc.layers.splice(doc.active + 1, 0, { ...rasterLayer(FLOATING_NAME, r), kind: "floating" });
  doc.active += 1;
  doc.selection = sel;
}

/* Paste Into Selection: the clip scaled to the selection's bounds, floating, cut to the selection's shape. */
export function pasteInto(doc: ImageDoc, clip: Raster): void {
  if (!doc.selection) return;
  const b = selectionBounds(doc);
  const scaled = resample(clip, b.maxX - b.minX + 1, b.maxY - b.minY + 1, "smart");
  const sel = doc.selection;
  defloat(doc);
  const r = placeRaster(scaled, doc.width, doc.height, b.minX, b.minY);
  for (let p = 0; p < sel.data.length; p++) r.data[p * 4 + 3] = r.data[p * 4 + 3] * (sel.data[p] / 255);
  doc.layers.splice(doc.active + 1, 0, { ...rasterLayer(FLOATING_NAME, r), kind: "floating" });
  doc.active += 1;
  doc.selection = sel;
}

/** The layers moving together with the active one: its link group (Layer palette's Group). */
export function linkedLayers(doc: ImageDoc): Layer[] {
  const active = doc.layers[doc.active];
  if (active.kind === "floating" || !active.group) return [active];
  return doc.layers.filter((l) => l.group === active.group);
}

/** Bake a layer's move offset into its pixels (the Mover's drop). */
export function bake(doc: ImageDoc, layer: Layer): void {
  if (!layer.x && !layer.y) return;
  layer.raster = placeRaster(layer.raster, doc.width, doc.height, layer.x, layer.y);
  layer.x = 0;
  layer.y = 0;
}
