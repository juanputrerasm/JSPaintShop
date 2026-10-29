/*
  An image as PSP 6 holds it: a canvas size and resolution, a color depth, a palette for
  paletted images, the layers bottom first, and the Creator Information (File > Image
  Information, DIALOG 174).

  Plain data only: it moves between the page and the worker (`imageBuffers` lists what to
  transfer) and runs under node --test.
*/
import { createRaster, type Mask, type Raster, type Rgba } from "../image/raster.ts";
import type { VectorObject } from "../vector/objects.ts";
import type { Adjustment } from "../color/adjustments.ts";

/*
  Blend modes in PSP's own order: the order of the Layer palette's list and the number a PSP
  file stores.
*/
export const BLEND_MODES = ["Normal", "Darken", "Lighten", "Hue", "Saturation", "Color", "Luminance", "Multiply", "Screen", "Dissolve", "Overlay", "Hard Light", "Soft Light", "Difference", "Dodge", "Burn", "Exclusion"] as const;

/*
  Raster layers hold pixels; vector layers hold objects drawn into their raster; adjustment
  layers hold a color adjustment applied to everything under them; a floating selection is
  a raster layer that sits over the active layer until it is defloated.
*/
export type LayerKind = "raster" | "vector" | "adjustment" | "floating";

export interface Layer {
  name: string;
  kind: LayerKind;
  /** Where the raster's top-left pixel sits on the canvas. */
  x: number;
  y: number;
  raster: Raster;
  /** 0..255 (the Layer palette shows it as 0..100%). */
  opacity: number;
  /** Index into BLEND_MODES. */
  blend: number;
  visible: boolean;
  lockTransparency: boolean;
  /** Layer group, 0 for none. */
  group: number;
  /** The layer mask (canvas-sized), and whether it is applied. */
  mask: Mask | null;
  maskEnabled: boolean;
  /** Vector layers: the objects, bottom first. */
  objects?: VectorObject[];
  /** Adjustment layers: the adjustment. */
  adjustment?: Adjustment;
}

/*
  Color depth in bits per pixel, as the status bar and Image Information name it: 1 (2 colors),
  4 (16 colors), 8 (256 colors or greyscale), 15 (32K), 16 (64K) and 24 (16 million).
*/
export type ColorDepth = 1 | 4 | 8 | 15 | 16 | 24;

export interface Creator {
  title: string;
  artist: string;
  copyright: string;
  description: string;
  /** Seconds since 1970, 0 when unknown. */
  created: number;
  modified: number;
}

export interface ImageDoc {
  width: number;
  height: number;
  /** Pixels per inch. */
  dpi: number;
  depth: ColorDepth;
  greyscale: boolean;
  /** RGB triples, for paletted images; null for 15, 16 and 24 bit ones. */
  palette: Uint8Array | null;
  /** Colors > Set Palette Transparency: the palette entry saved as transparent (GIF, PNG), if any. */
  transparentIndex?: number;
  /**
    Paletted images opened from a file: each pixel's palette index as the file had it. Saving a
    paletted format keeps it for every pixel whose color is unchanged, so palettes with repeated
    colors (game textures) save their indices back as they were.
  */
  indices?: Uint8Array;
  /** Bottom first. */
  layers: Layer[];
  /** Index of the layer being edited. */
  active: number;
  creator: Creator;
  /** The selection (canvas-sized), or null when nothing is selected. */
  selection: Mask | null;
  /** Alpha channels (Selections > Save To Alpha Channel). */
  alphas: { name: string; mask: Mask }[];
}

export function emptyCreator(now = 0): Creator {
  return { title: "", artist: "", copyright: "", description: "", created: now, modified: now };
}

export function rasterLayer(name: string, raster: Raster, x = 0, y = 0): Layer {
  return { name, kind: "raster", x, y, raster, opacity: 255, blend: 0, visible: true, lockTransparency: false, group: 0, mask: null, maskEnabled: true };
}

/*
  A new image (File > New, DIALOG 706). PSP names the only layer "Background" when it is
  filled, "Layer1" when the background is transparent.
*/
export function newImage(width: number, height: number, dpi: number, fill: Rgba, depth: ColorDepth = 24, greyscale = false, now = 0): ImageDoc {
  const name = fill[3] === 0 ? "Layer1" : "Background";
  return {
    width, height, dpi, depth, greyscale,
    palette: depth <= 8 ? defaultPalette(depth, greyscale) : null,
    layers: [rasterLayer(name, createRaster(width, height, fill))],
    active: 0,
    creator: emptyCreator(now),
    selection: null,
    alphas: [],
  };
}

/*
  The palette a new paletted image starts with: greys for a greyscale image, black and white
  for 2 colors, the 16 Windows colors, and for 256 colors the 6 x 6 x 6 web cube then greys.
*/
export function defaultPalette(depth: ColorDepth, greyscale: boolean): Uint8Array {
  if (greyscale) return Uint8Array.from({ length: 768 }, (_, i) => Math.floor(i / 3));
  if (depth === 1) return Uint8Array.from([0, 0, 0, 255, 255, 255]);
  if (depth === 4) return Uint8Array.from([0, 0, 0, 128, 0, 0, 0, 128, 0, 128, 128, 0, 0, 0, 128, 128, 0, 128, 0, 128, 128, 128, 128, 128,
    192, 192, 192, 255, 0, 0, 0, 255, 0, 255, 255, 0, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255]);
  const p = new Uint8Array(768);
  let i = 0;
  for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) { p[i++] = r * 51; p[i++] = g * 51; p[i++] = b * 51; }
  for (let k = 0; i < 768; k++) { const v = Math.round((k * 255) / 39); p[i++] = v; p[i++] = v; p[i++] = v; }
  return p;
}

/** The buffers to transfer when an image moves to or from the worker. */
export function imageBuffers(doc: ImageDoc): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const l of doc.layers) {
    out.add(l.raster.data.buffer as ArrayBuffer);
    if (l.mask) out.add(l.mask.data.buffer as ArrayBuffer);
  }
  if (doc.selection) out.add(doc.selection.data.buffer as ArrayBuffer);
  for (const a of doc.alphas) out.add(a.mask.data.buffer as ArrayBuffer);
  if (doc.palette) out.add(doc.palette.buffer as ArrayBuffer);
  return [...out];
}

/** "640 x 480 x 16 Million", as PSP's status bar sizes an image. */
export function describeImage(doc: ImageDoc): string {
  return `${doc.width} x ${doc.height} x ${depthName(doc.depth, doc.greyscale)}`;
}

export function depthName(depth: ColorDepth, greyscale: boolean): string {
  if (greyscale) return "Greyscale";
  return { 1: "2", 4: "16", 8: "256", 15: "32K", 16: "64K", 24: "16 Million" }[depth];
}

/** Bytes the layers' pixels take, for Image Information's Memory Used. */
export function memoryUsed(doc: ImageDoc): number {
  return doc.layers.reduce((n, l) => n + l.raster.data.byteLength + (l.mask?.data.byteLength ?? 0), 0);
}

/** The layer being edited. */
export function activeLayer(doc: ImageDoc): Layer {
  return doc.layers[Math.max(0, Math.min(doc.layers.length - 1, doc.active))];
}

/*
  Every raster at canvas size and position 0, 0: files may store a layer as a smaller
  rectangle with an offset, and the editor works on whole-canvas layers.
*/
export function normalizeLayers(doc: ImageDoc): void {
  for (const l of doc.layers) {
    if (l.x === 0 && l.y === 0 && l.raster.width === doc.width && l.raster.height === doc.height) continue;
    const r = createRaster(doc.width, doc.height);
    const src = l.raster;
    for (let y = 0; y < src.height; y++) {
      const ty = y + l.y;
      if (ty < 0 || ty >= doc.height) continue;
      const x0 = Math.max(0, -l.x), x1 = Math.min(src.width, doc.width - l.x);
      if (x1 <= x0) continue;
      r.data.set(src.data.subarray((y * src.width + x0) * 4, (y * src.width + x1) * 4), (ty * doc.width + x0 + l.x) * 4);
    }
    l.raster = r;
    l.x = 0;
    l.y = 0;
  }
}
