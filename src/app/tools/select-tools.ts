/*
  The tools that pick or move, not paint:

    Arrow           drag scrolls the image (its window comes forward on the click)
    Zoom            left-click zooms in, right-click out, at the pointer
    Selection       drag a shape from its corner; Shift adds, Ctrl removes; a click alone
                    selects none; dragging inside the selection moves the selected pixels
    Freehand        Freehand (drag), Point to Point and Smart Edge (click points, double-click
                    or right-click to close); Smart Edge works as Point to Point here
    Magic Wand      click a color; Shift adds, Ctrl removes
    Mover           drag moves the layer (and its group), or the floating selection; the right
                    button moves only the marquee
    Crop            drag the crop rectangle; double-click in it or Crop Image to crop
*/
import type { Tool, ToolContext, ToolEvent } from "./tool.ts";
import type { ImageDocument } from "../image-document.ts";
import { CMD } from "../../ui/shell/commands.ts";
import { toolOptions, MATCH_LABELS } from "./options.ts";
import { toolActions } from "../../ui/panels/tool-options.ts";
import { combine, feather, floodRegion, MATCH_MODES, nonEmpty, polygonMask, shapeMask, shapePolygon, shiftMask, type Combine, type Point } from "../../core/select/selection.ts";
import { bake, defloat, float, floatingIndex, linkedLayers } from "../../core/select/floating.ts";
import { beginStep } from "../../core/edit/snapshot.ts";
import { crop } from "../../core/image/geometry.ts";
import type { Mask } from "../../core/image/raster.ts";
import type { ViewTransform } from "../../render/image-view.ts";

const mode = (e: ToolEvent): Combine => (e.shift ? "add" : e.ctrl ? "remove" : "replace");

/** Make `shape` the selection (combined by the modifier keys), feathered, as one undo step. */
function applySelection(ctx: ToolContext, image: ImageDocument, shape: Mask, how: Combine, featherBy: number): void {
  const m = featherBy > 0 ? feather(shape, featherBy) : shape;
  ctx.ed.run(how === "remove" ? "Remove from Selection" : how === "add" ? "Add to Selection" : "Selection", (d) => {
    if (how === "replace") defloat(d);
    d.selection = nonEmpty(combine(d.selection, m, how));
    return { selection: true, layers: true };
  }, image);
}

function polyline(g: CanvasRenderingContext2D, t: ViewTransform, pts: Point[], close: boolean): void {
  if (pts.length < 2) return;
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(t.ox + x * t.scale, t.oy + y * t.scale) : g.moveTo(t.ox + x * t.scale, t.oy + y * t.scale)));
  if (close) g.closePath();
  g.lineWidth = 1;
  g.setLineDash([4, 4]);
  g.strokeStyle = "#000";
  g.stroke();
  g.lineDashOffset = 4;
  g.strokeStyle = "#fff";
  g.stroke();
}

/* Dragging the selected pixels (Selection tools inside the selection, and the Mover on a floating selection). */
function pixelMover(ctx: ToolContext, e: ToolEvent, floatFirst: boolean) {
  const image = e.image, doc = image.doc;
  const step = beginStep(doc);
  if (floatFirst && floatingIndex(doc) < 0) float(doc, ctx.colors.bg);
  const f = floatingIndex(doc);
  const layers = f >= 0 ? [doc.layers[f]] : linkedLayers(doc);
  const sel0 = doc.selection;
  const x0 = e.px, y0 = e.py;
  return {
    move(m: ToolEvent) {
      const dx = m.px - x0, dy = m.py - y0;
      for (const l of layers) { l.x = dx; l.y = dy; }
      if (f >= 0 && sel0) doc.selection = shiftMask(sel0, dx, dy);
      image.changed({ layers: true });
    },
    up() {
      for (const l of layers) bake(doc, l);
      const c = step.finish("Move", { layers: true });
      if (c) ctx.ed.push(c, image);
    },
  };
}

export function arrowTool(): Tool {
  let last: [number, number] | null = null;
  return {
    down: (e) => { last = [e.clientX, e.clientY]; },
    move: (e, dragging) => {
      if (!dragging || !last) return;
      e.view.scrollBy(last[0] - e.clientX, last[1] - e.clientY);
      last = [e.clientX, e.clientY];
    },
    up: () => { last = null; },
  };
}

export function zoomTool(ctx: ToolContext): Tool {
  return {
    down: (e) => { e.view.stepZoom(e.button === 2 ? -1 : 1, e); ctx.ws.zoomed(e.image); },
  };
}

export function selectionTool(ctx: ToolContext): Tool {
  let start: [number, number] | null = null, end: [number, number] = [0, 0];
  let mover: ReturnType<typeof pixelMover> | null = null;
  let how: Combine = "replace";
  return {
    down(e) {
      if (e.button !== 0) return;
      const sel = e.image.doc.selection;
      if (!e.shift && !e.ctrl && sel && e.px >= 0 && e.py >= 0 && e.px < sel.width && e.py < sel.height && sel.data[e.py * sel.width + e.px] >= 128) {
        mover = pixelMover(ctx, e, true);
        return;
      }
      how = mode(e);
      start = [Math.round(e.x), Math.round(e.y)];
      end = start;
    },
    move(e, dragging) {
      if (!dragging) return;
      if (mover) { mover.move(e); return; }
      if (start) end = [Math.round(e.x), Math.round(e.y)];
    },
    up(e) {
      if (mover) { mover.up(); mover = null; return; }
      if (!start) return;
      const o = toolOptions(ctx.app, CMD.TOOL_SELECTION);
      const [x0, y0] = start, [x1, y1] = end;
      start = null;
      const doc = e.image.doc;
      if (Math.abs(x1 - x0) < 1 && Math.abs(y1 - y0) < 1) {
        if (how === "replace") ctx.ed.run("Select None", (d) => { defloat(d); d.selection = null; return { selection: true, layers: true }; }, e.image);
        return;
      }
      applySelection(ctx, e.image, shapeMask(doc.width, doc.height, String(o.type), x0, y0, x1, y1, Boolean(o.antialias)), how, Number(o.feather));
    },
    overlay(g, t) {
      if (!start) return;
      polyline(g, t, shapePolygon(String(toolOptions(ctx.app, CMD.TOOL_SELECTION).type), start[0], start[1], end[0], end[1]), true);
    },
  };
}

export function freehandTool(ctx: ToolContext): Tool {
  let pts: Point[] = [];
  let hover: Point | null = null;
  let how: Combine = "replace";
  let image: ImageDocument | null = null;
  const pointMode = () => String(toolOptions(ctx.app, CMD.TOOL_FREEHAND).mode) !== "Freehand";
  const finish = () => {
    const o = toolOptions(ctx.app, CMD.TOOL_FREEHAND);
    const done = pts;
    pts = [];
    hover = null;
    if (!image || done.length < 3) return;
    const d = image.doc;
    applySelection(ctx, image, polygonMask(d.width, d.height, [done], Boolean(o.antialias)), how, Number(o.feather));
  };
  return {
    down(e) {
      if (pointMode()) {
        if (e.button === 2) { finish(); return; }
        if (!pts.length) { how = mode(e); image = e.image; }
        pts.push([e.x, e.y]);
        return;
      }
      if (e.button !== 0) return;
      how = mode(e);
      image = e.image;
      pts = [[e.x, e.y]];
    },
    move(e, dragging) {
      if (pointMode()) { hover = [e.x, e.y]; return; }
      if (dragging && pts.length) pts.push([e.x, e.y]);
    },
    up() { if (!pointMode()) finish(); },
    dblclick() { if (pointMode()) finish(); },
    overlay(g, t) { polyline(g, t, hover && pointMode() ? [...pts, hover] : pts, false); },
    deactivate() { pts = []; },
  };
}

export function magicWandTool(ctx: ToolContext): Tool {
  return {
    down(e) {
      if (e.button !== 0) return;
      const o = toolOptions(ctx.app, CMD.TOOL_MAGIC_WAND);
      const doc = e.image.doc;
      const source = o.merged ? e.image.composite : doc.layers[doc.active].raster;
      const match = MATCH_MODES[Math.max(0, MATCH_LABELS.indexOf(String(o.match) as typeof MATCH_LABELS[number]))];
      applySelection(ctx, e.image, floodRegion(source, e.px, e.py, match, Number(o.tolerance)), mode(e), Number(o.feather));
    },
  };
}

export function moverTool(ctx: ToolContext): Tool {
  let mover: ReturnType<typeof pixelMover> | null = null;
  let marquee: { sel0: Mask; x0: number; y0: number; step: ReturnType<typeof beginStep>; image: ImageDocument } | null = null;
  return {
    down(e) {
      const doc = e.image.doc;
      if (e.button === 2) {
        if (doc.selection) marquee = { sel0: doc.selection, x0: e.px, y0: e.py, step: beginStep(doc), image: e.image };
        return;
      }
      mover = pixelMover(ctx, e, false);
    },
    move(e, dragging) {
      if (!dragging) return;
      if (mover) mover.move(e);
      else if (marquee) { e.image.doc.selection = shiftMask(marquee.sel0, e.px - marquee.x0, e.py - marquee.y0); e.image.changed({ selection: true }); }
    },
    up() {
      if (mover) { mover.up(); mover = null; }
      if (marquee) { const c = marquee.step.finish("Move Selection", { selection: true }); if (c) ctx.ed.push(c, marquee.image); marquee = null; }
    },
  };
}

export function cropTool(ctx: ToolContext): Tool {
  const rects = new WeakMap<ImageDocument, [number, number, number, number]>();
  let dragging: ImageDocument | null = null;
  const doCrop = (image: ImageDocument | null) => {
    const r = image && rects.get(image);
    if (!image || !r) return;
    const [x0, y0, x1, y1] = r;
    rects.delete(image);
    ctx.ed.run("Crop", (d) => crop(d, { minX: Math.min(x0, x1), minY: Math.min(y0, y1), maxX: Math.max(x0, x1) - 1, maxY: Math.max(y0, y1) - 1 }, ctx.colors.bg), image);
  };
  toolActions[CMD.TOOL_CROP] = { crop: () => doCrop(ctx.ws.active) };
  return {
    down(e) {
      if (e.button !== 0) return;
      const p = [Math.round(e.x), Math.round(e.y)];
      rects.set(e.image, [p[0], p[1], p[0], p[1]]);
      dragging = e.image;
    },
    move(e, isDragging) {
      if (!isDragging || dragging !== e.image) return;
      const r = rects.get(e.image)!;
      r[2] = Math.max(0, Math.min(e.image.doc.width, Math.round(e.x)));
      r[3] = Math.max(0, Math.min(e.image.doc.height, Math.round(e.y)));
    },
    up(e) {
      dragging = null;
      const r = rects.get(e.image);
      if (r && (Math.abs(r[2] - r[0]) < 1 || Math.abs(r[3] - r[1]) < 1)) rects.delete(e.image);
    },
    dblclick(e) {
      const r = rects.get(e.image);
      if (r && e.x >= Math.min(r[0], r[2]) && e.x <= Math.max(r[0], r[2]) && e.y >= Math.min(r[1], r[3]) && e.y <= Math.max(r[1], r[3])) doCrop(e.image);
    },
    overlay(g, t, image) {
      const r = rects.get(image);
      if (!r) return;
      const [x0, y0, x1, y1] = r.map((v, i) => (i % 2 ? t.oy : t.ox) + v * t.scale);
      const w = image.doc.width * t.scale, h = image.doc.height * t.scale;
      g.fillStyle = "rgb(0 0 0 / 0.35)";
      g.beginPath();
      g.rect(t.ox, t.oy, w, h);
      g.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      g.fill("evenodd");
      polyline(g, { ox: 0, oy: 0, scale: 1 }, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], true);
    },
  };
}
