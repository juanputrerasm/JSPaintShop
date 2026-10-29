/*
  Recording changes, from JSTraxx core/edit/record.ts. Two kinds cover every edit:

    a pixel patch  a rectangle of a raster (a layer's RGBA, a mask, a selection), copied
                   before and after; small, so a brush stroke costs only what it touched;
    a snapshot     named fields of an object (a layer's name, opacity, blend mode...),
                   deep-copied before and after.

  Both are taken around the edit: start recording, make the change, finish. For a drag the
  start is taken on the press and the finish on the release, so the whole drag is one step.
*/
import type { Change, Rect, Touch } from "./history.ts";

type Pixels = Uint8Array | Uint8ClampedArray | Uint16Array | Float32Array;

/** A raster the recorder can patch: `channels` values per pixel, rows of `width` pixels. */
export interface RasterLike { data: Pixels; width: number; height: number; channels: number }

export function clampRect(r: Rect, width: number, height: number): Rect | null {
  const out = { minX: Math.max(0, r.minX), minY: Math.max(0, r.minY), maxX: Math.min(width - 1, r.maxX), maxY: Math.min(height - 1, r.maxY) };
  return out.minX > out.maxX || out.minY > out.maxY ? null : out;
}

function copyRect(raster: RasterLike, r: Rect): Pixels {
  const { data, width, channels } = raster;
  const w = (r.maxX - r.minX + 1) * channels, h = r.maxY - r.minY + 1;
  const out = new (data.constructor as { new (n: number): Pixels })(w * h);
  for (let j = 0; j < h; j++) {
    const at = ((r.minY + j) * width + r.minX) * channels;
    out.set(data.subarray(at, at + w), j * w);
  }
  return out;
}

function pasteRect(raster: RasterLike, r: Rect, patch: Pixels): void {
  const { data, width, channels } = raster;
  const w = (r.maxX - r.minX + 1) * channels, h = r.maxY - r.minY + 1;
  for (let j = 0; j < h; j++) data.set(patch.subarray(j * w, (j + 1) * w), ((r.minY + j) * width + r.minX) * channels);
}

export interface Recording { finish(label?: string): Change | null }

/** Start recording a rectangle of a raster. `touch` names what changes there. */
export function recordPixels(raster: RasterLike, rect: Rect, label: string, touch: (r: Rect) => Touch = (r) => ({ pixels: r })): Recording {
  const r = clampRect(rect, raster.width, raster.height);
  const before = r ? copyRect(raster, r) : null;
  return {
    finish(finalLabel = label) {
      if (!r || !before) return null;
      const after = copyRect(raster, r);
      let same = true;
      for (let i = 0; i < after.length && same; i++) same = after[i] === before[i];
      if (same) return null;
      return { label: finalLabel, touch: touch(r), undo: () => pasteRect(raster, r, before), redo: () => pasteRect(raster, r, after) };
    },
  };
}

/** Start recording fields of an object; finish compares and makes the change. */
export function recordFields<T extends object, K extends keyof T>(target: T, keys: readonly K[], label: string, touch: Touch): Recording {
  const before = keys.map((k) => structuredClone(target[k]));
  return {
    finish(finalLabel = label) {
      const after = keys.map((k) => structuredClone(target[k]));
      if (equalValues(before, after)) return null;
      const put = (values: unknown[]) => keys.forEach((k, i) => { target[k] = structuredClone(values[i]) as T[K]; });
      return { label: finalLabel, touch, undo: () => put(before), redo: () => put(after) };
    },
  };
}

/** Deep equality for plain data (arrays, typed arrays, objects, numbers, strings). */
export function equalValues(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return Number.isNaN(a) && Number.isNaN(b as number);
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    const x = a as unknown as ArrayLike<number>, y = b as unknown as ArrayLike<number>;
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!equalValues((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

/*
  A step from a full copy taken before an edit (a brush stroke keeps one to paint from):
  only the rectangle that changed is kept, before and after.
*/
export function patchChange(target: RasterLike, before: Pixels, rect: Rect, label: string, touch: Touch): Change | null {
  const r = clampRect(rect, target.width, target.height);
  if (!r) return null;
  const old = copyRect({ ...target, data: before }, r);
  const now = copyRect(target, r);
  return { label, touch, undo: () => pasteRect(target, r, old), redo: () => pasteRect(target, r, now) };
}
