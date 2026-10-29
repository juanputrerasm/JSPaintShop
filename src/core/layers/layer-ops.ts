/*
  The Layers menu as plain operations on an image. Each returns nothing and changes `doc`;
  the caller wraps it in an undo step (snapshot.ts). New rasters are made rather than old ones
  changed, so undo can share them.

    New Raster Layer   above the active layer, transparent, "Layer<n>"
    Duplicate          "Copy of <name>" above it
    Delete             never the last layer
    Arrange            Bring to Top, Move Up, Move Down, Send to Bottom
    Merge All          one opaque layer, "Background", transparency filled with a color
    Merge Visible      the visible layers into one, in the place of the lowest
    Matting            Remove Black/White Matte, Defringe: for edges antialiased onto a color
*/
import { cloneRaster, createRaster, createMask, type Rgba } from "../image/raster.ts";
import { rasterLayer, type ImageDoc, type Layer } from "../doc/image-doc.ts";
import { mergeLayers } from "./composite.ts";

/** The first "Layer<n>" not taken. */
export function nextLayerName(doc: ImageDoc, base = "Layer"): string {
  const taken = new Set(doc.layers.map((l) => l.name));
  for (let n = 1; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
}

export function addRasterLayer(doc: ImageDoc, props: Partial<Layer> = {}): Layer {
  const layer = { ...rasterLayer(nextLayerName(doc), createRaster(doc.width, doc.height)), ...props };
  doc.layers.splice(doc.active + 1, 0, layer);
  doc.active += 1;
  return layer;
}

export function duplicateLayer(doc: ImageDoc): void {
  const src = doc.layers[doc.active];
  const copy: Layer = {
    ...src, name: `Copy of ${src.name}`, raster: cloneRaster(src.raster),
    mask: src.mask ? { ...src.mask, data: new Uint8Array(src.mask.data) } : null,
    objects: src.objects ? structuredClone(src.objects) : undefined,
    adjustment: src.adjustment ? structuredClone(src.adjustment) : undefined,
  };
  doc.layers.splice(doc.active + 1, 0, copy);
  doc.active += 1;
}

export function deleteLayer(doc: ImageDoc): void {
  if (doc.layers.length <= 1) return;
  doc.layers.splice(doc.active, 1);
  doc.active = Math.max(0, Math.min(doc.active, doc.layers.length - 1));
}

export type Arrange = "top" | "up" | "down" | "bottom";

export function arrangeLayer(doc: ImageDoc, where: Arrange): void {
  const i = doc.active, n = doc.layers.length;
  const to = where === "top" ? n - 1 : where === "bottom" ? 0 : where === "up" ? Math.min(n - 1, i + 1) : Math.max(0, i - 1);
  if (to === i) return;
  moveLayer(doc, i, to);
}

/** Move a layer from one place to another (the Layer palette's drag), keeping it active. */
export function moveLayer(doc: ImageDoc, from: number, to: number): void {
  const [layer] = doc.layers.splice(from, 1);
  doc.layers.splice(to, 0, layer);
  doc.active = to;
}

/* Layers > Merge > Merge All (Flatten): one opaque layer over `background`. */
export function flatten(doc: ImageDoc, background: Rgba): void {
  const merged = mergeLayers(doc, doc.layers);
  const r = createRaster(doc.width, doc.height, [background[0], background[1], background[2], 255]);
  const s = merged.data, d = r.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = s[i + 3] / 255;
    d[i] = s[i] * a + d[i] * (1 - a); d[i + 1] = s[i + 1] * a + d[i + 1] * (1 - a); d[i + 2] = s[i + 2] * a + d[i + 2] * (1 - a);
  }
  doc.layers = [rasterLayer("Background", r)];
  doc.active = 0;
}

/* Layers > Merge > Merge Visible: the visible layers into one at the lowest one's place, named after it. */
export function mergeVisible(doc: ImageDoc): void {
  const visible = doc.layers.filter((l) => l.visible);
  if (visible.length < 2) return;
  const merged = mergeLayers(doc, visible);
  const lowest = doc.layers.indexOf(visible[0]);
  const layer = rasterLayer(visible[0].name, merged);
  const rest = doc.layers.filter((l) => !l.visible);
  const below = rest.filter((l) => doc.layers.indexOf(l) < lowest);
  doc.layers = [...below, layer, ...rest.filter((l) => doc.layers.indexOf(l) > lowest)];
  doc.active = below.length;
}

/*
  Matting. Edges antialiased against black or white carry some of that color into their
  semi-transparent pixels; removing the matte takes it back out: c = (c - m (1 - a)) / a.
*/
export function removeMatte(doc: ImageDoc, matte: 0 | 255): void {
  const layer = doc.layers[doc.active];
  const r = cloneRaster(layer.raster), d = r.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    if (a <= 0 || a >= 1) continue;
    for (let c = 0; c < 3; c++) d[i + c] = (d[i + c] - matte * (1 - a)) / a;
  }
  layer.raster = r;
}

/*
  Defringe: a semi-transparent edge pixel takes the color of the most opaque pixel within
  `amount` pixels of it, so a fringe of another color disappears.
*/
export function defringe(doc: ImageDoc, amount: number): void {
  const layer = doc.layers[doc.active];
  const src = layer.raster, r = cloneRaster(src), s = src.data, d = r.data, w = src.width, h = src.height;
  const n = Math.max(1, Math.min(10, Math.round(amount)));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (s[i + 3] === 0 || s[i + 3] === 255) continue;
    let best = -1, bestA = s[i + 3];
    for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = (yy * w + xx) * 4;
      if (s[j + 3] > bestA) { bestA = s[j + 3]; best = j; }
    }
    if (best >= 0) { d[i] = s[best]; d[i + 1] = s[best + 1]; d[i + 2] = s[best + 2]; }
  }
  layer.raster = r;
}

/** A layer mask filled with one value (Masks > New > Show All 255, Hide All 0). */
export function newMask(doc: ImageDoc, value: number): void {
  const layer = doc.layers[doc.active];
  layer.mask = createMask(doc.width, doc.height, value);
  layer.maskEnabled = true;
}
