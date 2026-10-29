/*
  Whole-image undo steps. A snapshot is the image's state with each layer copied shallowly:
  the rasters and masks themselves are shared, not copied. That works because every command
  that changes many pixels (a filter, a resize, a merge) puts a new raster in the layer
  instead of changing the old one; only brushes change pixels in place, and they record a
  pixel patch (record.ts) instead.

  So a step costs a few small objects plus whatever new rasters the command made.
*/
import type { ImageDoc, Layer } from "../doc/image-doc.ts";
import type { Change, Touch } from "./history.ts";

export type DocState = Omit<ImageDoc, "layers" | "alphas"> & { layers: Layer[]; alphas: ImageDoc["alphas"] };

export function snapshot(doc: ImageDoc): DocState {
  return { ...doc, layers: doc.layers.map((l) => ({ ...l })), alphas: [...doc.alphas], creator: { ...doc.creator } };
}

export function restore(doc: ImageDoc, state: DocState): void {
  // Optional fields the state does not have go (Object.assign would leave them).
  for (const k of Object.keys(doc) as (keyof ImageDoc)[]) if (!(k in state)) delete doc[k];
  Object.assign(doc, { ...state, layers: state.layers.map((l) => ({ ...l })), alphas: [...state.alphas], creator: { ...state.creator } });
}

function sameLayer(a: Layer, b: Layer): boolean {
  for (const k of Object.keys(a) as (keyof Layer)[]) if (a[k] !== b[k]) return false;
  return Object.keys(a).length === Object.keys(b).length;
}

/** Whether two states differ in anything a command can change. */
export function sameState(a: DocState, b: DocState): boolean {
  if (a.layers.length !== b.layers.length || a.alphas.length !== b.alphas.length) return false;
  for (const k of ["width", "height", "dpi", "depth", "greyscale", "palette", "transparentIndex", "active", "selection"] as const) if (a[k] !== b[k]) return false;
  if (JSON.stringify(a.creator) !== JSON.stringify(b.creator)) return false;
  return a.layers.every((l, i) => sameLayer(l, b.layers[i])) && a.alphas.every((x, i) => x === b.alphas[i]);
}

/*
  Run `fn` on the image and return the undo step it made, or null when it changed nothing.
  `fn` returns what it touched (all of it when it says nothing).
*/
export function transact(doc: ImageDoc, label: string, fn: (doc: ImageDoc) => Touch | void): Change | null {
  const before = snapshot(doc);
  const touch = fn(doc) ?? { image: true };
  const after = snapshot(doc);
  if (sameState(before, after)) return null;
  return { label, touch, undo: () => restore(doc, before), redo: () => restore(doc, after) };
}

/*
  A step over time (a drag): the state is taken now; `finish` makes the undo step from it to
  whatever the image is then, or null when nothing changed.
*/
export function beginStep(doc: ImageDoc): { finish(label: string, touch?: Touch): Change | null } {
  const before = snapshot(doc);
  return {
    finish(label, touch = { image: true }) {
      const after = snapshot(doc);
      if (sameState(before, after)) return null;
      return { label, touch, undo: () => restore(doc, before), redo: () => restore(doc, after) };
    },
  };
}
