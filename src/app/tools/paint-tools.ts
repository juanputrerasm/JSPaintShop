/*
  The painting tools, on the active layer (or on its mask under Masks > Edit), inside the
  selection:

    Paint Brush     left paints the foreground color, right the background
    Airbrush        the same, building up while the button is held still
    Eraser          to transparency, or to the background color on a Background layer
    Clone Brush     right-click picks the source (in any open image), left paints from it;
                    Aligned keeps the offset between strokes, Non-aligned starts each stroke at
                    the source point
    Color Replacer  left turns the background color (within Tolerance) into the foreground,
                    right the other way; double-click does it over the whole layer
    Retouch         the 19 modes; right-click turns paired ones around
    Dropper         left picks the foreground, right the background
    Flood Fill      the fill style over the matching region

  Shift+click draws a straight line from the last stroke's end. A stroke is one undo step.
*/
import type { Tool, ToolContext, ToolEvent } from "./tool.ts";
import type { ImageDocument } from "../image-document.ts";
import type { Resources } from "../resources.ts";
import { CMD } from "../../ui/shell/commands.ts";
import { toolOptions, MATCH_LABELS, FILL_STYLES, type OptionValue } from "./options.ts";
import { makeTip, spacingFor, Stroke } from "../../core/paint/brush.ts";
import { retouchMode, retouchPixel } from "../../core/paint/retouch.ts";
import { fillRegion, floodFill, type FillSource } from "../../core/paint/fill.ts";
import { gradientTable, type GradientShape } from "../../core/paint/gradient.ts";
import { patchChange } from "../../core/edit/record.ts";
import { activeLayer, BLEND_MODES } from "../../core/doc/image-doc.ts";
import { isBackground } from "../../core/image/geometry.ts";
import { blendCover } from "../../core/layers/blend.ts";
import { MATCH_MODES } from "../../core/select/selection.ts";
import { luminance } from "../../core/color/color-space.ts";
import { pixelAt, type Raster, type Rgba } from "../../core/image/raster.ts";
import { alertDialog } from "../../ui/shell/dialog.ts";
import type { ViewTransform } from "../../render/image-view.ts";

/** The last stroke's end per image, for Shift+click lines. */
const lastPoint = new WeakMap<ImageDocument, [number, number]>();

interface Target {
  image: ImageDocument;
  /** RGBA (layer) or one channel (mask). */
  data: Uint8ClampedArray | Uint8Array;
  channels: 1 | 4;
  before: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
  lockAlpha: boolean;
  background: boolean;
}

/* What a stroke paints on: the active layer's pixels, or its mask while editing the mask. */
function target(ctx: ToolContext, image: ImageDocument): Target | null {
  const doc = image.doc;
  const layer = activeLayer(doc);
  if (layer.kind === "vector") {
    void alertDialog("JSPaintShop", "This is a vector layer. Convert it to a raster layer (Layers > Convert to Raster) to paint on it.");
    return null;
  }
  if (image.editMask || layer.kind === "adjustment") {
    if (!layer.mask) {
      if (layer.kind !== "adjustment") return null;
      layer.mask = { width: doc.width, height: doc.height, data: new Uint8Array(doc.width * doc.height).fill(255) };
    }
    return { image, data: layer.mask.data, channels: 1, before: new Uint8Array(layer.mask.data), width: doc.width, height: doc.height, lockAlpha: false, background: false };
  }
  // Pixels painted in place: the layer gets its own raster first, so undo steps that share
  // the old raster keep it as it was.
  layer.raster = { ...layer.raster, data: new Uint8ClampedArray(layer.raster.data) };
  void ctx;
  return { image, data: layer.raster.data, channels: 4, before: new Uint8ClampedArray(layer.raster.data), width: doc.width, height: doc.height, lockAlpha: layer.lockTransparency, background: isBackground(doc, layer) };
}

function finishStroke(ctx: ToolContext, t: Target, stroke: Stroke, label: string): void {
  const r = stroke.touched;
  if (!r) return;
  const doc = t.image.doc;
  const layer = activeLayer(doc);
  const raster = t.channels === 4 ? { data: t.data, width: t.width, height: t.height, channels: 4 } : { data: t.data, width: t.width, height: t.height, channels: 1 };
  const patch = patchChange(raster, t.before, r, label, { pixels: r });
  if (!patch) return;
  // The patch writes into whichever array the layer holds at undo time, which is this one.
  void layer;
  ctx.ed.push({ ...patch, undo: () => { patch.undo(); }, redo: () => { patch.redo(); } }, t.image, false);
  t.image.changed({ pixels: r });
}

function paperOf(res: Resources, o: Record<string, OptionValue>) {
  const t = o.paper && o.paper !== "None" ? res.texture(String(o.paper)) : null;
  return t ? { width: t.width, height: t.height, data: t.data } : null;
}

interface StrokeSpec {
  label: string;
  /** Build the per-pixel function once the target is known. */
  pixel(t: Target, e: ToolEvent): ((p: number, x: number, y: number, cov: number) => void) | null;
  dab?(t: Target, e: ToolEvent): ((cx: number, cy: number) => void) | undefined;
  buildUp?: boolean;
  /** Keep dabbing while the button is held still (Airbrush). */
  flow?: boolean;
  start?(e: ToolEvent): boolean;
}

/* Painting a color over the stroke-start pixels. */
function paintPixel(t: Target, color: Rgba) {
  const lum = luminance(color[0], color[1], color[2]);
  return (p: number, _x: number, _y: number, cov: number) => {
    if (t.channels === 1) { t.data[p] = t.before[p] + (lum - t.before[p]) * cov; return; }
    const i = p * 4;
    t.data[i] = t.before[i]; t.data[i + 1] = t.before[i + 1]; t.data[i + 2] = t.before[i + 2]; t.data[i + 3] = t.before[i + 3];
    blendCover(t.data as Uint8ClampedArray, i, 0, color[0], color[1], color[2], color[3], cov, _x, _y, t.lockAlpha);
  };
}

function brushTool(ctx: ToolContext, res: Resources, id: number, spec: StrokeSpec): Tool & { overlayRadius(): number } {
  let stroke: Stroke | null = null;
  let tgt: Target | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let at: [number, number] = [0, 0];
  let pressure = 1;
  let hover: [number, number] | null = null;
  const o = () => toolOptions(ctx.app, id);
  const tipFor = (opts: Record<string, OptionValue>, size = Number(opts.size)) => {
    const shape = String(opts.shape);
    const custom = shape.startsWith("Custom: ") ? res.brushes.find((b) => `Custom: ${b.name}` === shape) : undefined;
    return makeTip(shape, size, Number(opts.hardness), custom);
  };
  const end = (e?: ToolEvent) => {
    if (timer) { clearInterval(timer); timer = null; }
    if (stroke && tgt) {
      finishStroke(ctx, tgt, stroke, spec.label);
      if (e) lastPoint.set(tgt.image, [e.x, e.y]);
    }
    stroke = null;
    tgt = null;
  };
  return {
    overlayRadius: () => Number(o().size) / 2,
    down(e) {
      if (spec.start && !spec.start(e)) return;
      // Ctrl+click picks a color, as the Dropper does.
      if (e.ctrl) { pick(ctx, e, false); return; }
      const opts = o();
      tgt = target(ctx, e.image);
      if (!tgt) return;
      const pixel = spec.pixel(tgt, e);
      if (!pixel) { tgt = null; return; }
      pressure = opts.pressureOpacity ? e.pressure : 1;
      const size = opts.pressureSize ? Math.max(1, Number(opts.size) * e.pressure) : Number(opts.size);
      stroke = new Stroke({
        width: tgt.width, height: tgt.height, tip: tipFor(opts, size), opacity: Number(opts.opacity) / 100,
        spacing: spacingFor(size, Number(opts.step)), density: Number(opts.density) / 100,
        buildUp: spec.buildUp || Boolean(opts.buildUp), selection: e.image.doc.selection, paper: paperOf(res, opts),
        pixel, dab: spec.dab?.(tgt, e),
      });
      const from = e.shift ? lastPoint.get(e.image) : undefined;
      if (from) stroke.to(from[0], from[1], pressure);
      stroke.to(e.x, e.y, pressure);
      at = [e.x, e.y];
      e.image.changed({ pixels: stroke.touched ?? undefined });
      if (spec.flow) {
        const image = e.image;
        timer = setInterval(() => { if (stroke) { stroke.dabAt(at[0], at[1], pressure); image.changed({ pixels: stroke.touched ?? undefined }); } }, 60);
      }
    },
    move(e, dragging) {
      hover = [e.x, e.y];
      if (!dragging || !stroke || !tgt || e.image !== tgt.image) { e.view.request(); return; }
      if (o().pressureOpacity) pressure = e.pressure;
      stroke.to(e.x, e.y, pressure);
      at = [e.x, e.y];
      const r = stroke.touched;
      if (r) e.image.changed({ pixels: r });
    },
    up(e) { end(e); },
    deactivate() { end(); hover = null; },
    overlay(g: CanvasRenderingContext2D, t: ViewTransform) {
      if (!hover || !ctx.app.settings.prefs.cursors.brushOutline) return;
      const r = (Number(o().size) / 2) * t.scale;
      if (r < 2) return;
      g.beginPath();
      g.arc(t.ox + hover[0] * t.scale, t.oy + hover[1] * t.scale, r, 0, Math.PI * 2);
      g.strokeStyle = "rgb(0 0 0 / 0.6)";
      g.lineWidth = 1;
      g.stroke();
      g.strokeStyle = "rgb(255 255 255 / 0.6)";
      g.beginPath();
      g.arc(t.ox + hover[0] * t.scale, t.oy + hover[1] * t.scale, r + 1, 0, Math.PI * 2);
      g.stroke();
    },
  };
}

/** The Dropper's pick (also Ctrl+click in the brushes). */
function pick(ctx: ToolContext, e: ToolEvent, merged: boolean): void {
  const doc = e.image.doc;
  const source = merged ? e.image.composite : activeLayer(doc).raster;
  const c = pixelAt(source, e.px, e.py);
  if (c) ctx.colors.set(e.button === 2 ? "bg" : "fg", c);
}

export function paintBrushTool(ctx: ToolContext, res: Resources): Tool {
  return brushTool(ctx, res, CMD.TOOL_PAINT_BRUSH, { label: "Paint Brush", pixel: (t, e) => paintPixel(t, e.button === 2 ? ctx.colors.bg : ctx.colors.fg) });
}

export function airbrushTool(ctx: ToolContext, res: Resources): Tool {
  return brushTool(ctx, res, CMD.TOOL_AIRBRUSH, { label: "Airbrush", flow: true, buildUp: true, pixel: (t, e) => paintPixel(t, e.button === 2 ? ctx.colors.bg : ctx.colors.fg) });
}

export function eraserTool(ctx: ToolContext, res: Resources): Tool {
  return brushTool(ctx, res, CMD.TOOL_ERASER, {
    label: "Eraser",
    pixel: (t) => {
      const bg = ctx.colors.bg;
      return (p, _x, _y, cov) => {
        if (t.channels === 1) { t.data[p] = t.before[p] * (1 - cov); return; }
        const i = p * 4;
        if (t.background) {
          for (let c = 0; c < 3; c++) t.data[i + c] = t.before[i + c] + (bg[c] - t.before[i + c]) * cov;
          return;
        }
        if (!t.lockAlpha) t.data[i + 3] = t.before[i + 3] * (1 - cov);
      };
    },
  });
}

export function cloneTool(ctx: ToolContext, res: Resources): Tool {
  let source: { image: ImageDocument; x: number; y: number } | null = null;
  let offset: [number, number] | null = null;
  return brushTool(ctx, res, CMD.TOOL_CLONE_BRUSH, {
    label: "Clone Brush",
    start(e) {
      if (e.button === 2) { source = { image: e.image, x: e.x, y: e.y }; offset = null; ctx.app.status("Clone source set."); return false; }
      if (!source) { ctx.app.status("Right-click to set the clone source first."); return false; }
      return true;
    },
    pixel(t, e) {
      if (!source) return null;
      const o = toolOptions(ctx.app, CMD.TOOL_CLONE_BRUSH);
      if (!offset || o.aligned === "Non-aligned") offset = [source.x - e.x, source.y - e.y];
      const [dx, dy] = offset.map(Math.round);
      const src: Raster = o.merged ? source.image.composite : source.image === t.image && t.channels === 4 ? { width: t.width, height: t.height, data: t.before as Uint8ClampedArray<ArrayBuffer> } : activeLayer(source.image.doc).raster;
      return (p, x, y, cov) => {
        const sx = x + dx, sy = y + dy;
        if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) return;
        const si = (sy * src.width + sx) * 4;
        paintPixel(t, [src.data[si], src.data[si + 1], src.data[si + 2], src.data[si + 3]])(p, x, y, cov);
      };
    },
  });
}

function replacer(t: Target, from: Rgba, to: Rgba, tolerance: number) {
  const paint = paintPixel(t, to);
  return (p: number, x: number, y: number, cov: number) => {
    if (t.channels === 1) return;
    const i = p * 4;
    if (Math.max(Math.abs(t.before[i] - from[0]), Math.abs(t.before[i + 1] - from[1]), Math.abs(t.before[i + 2] - from[2])) <= tolerance) paint(p, x, y, cov);
  };
}

export function colorReplacerTool(ctx: ToolContext, res: Resources): Tool {
  const tool = brushTool(ctx, res, CMD.TOOL_COLOR_REPLACER, {
    label: "Color Replacer",
    pixel: (t, e) => {
      const tol = Number(toolOptions(ctx.app, CMD.TOOL_COLOR_REPLACER).tolerance);
      return e.button === 2 ? replacer(t, ctx.colors.fg, ctx.colors.bg, tol) : replacer(t, ctx.colors.bg, ctx.colors.fg, tol);
    },
  });
  // Double-click replaces the color over the whole layer (inside the selection).
  tool.dblclick = (e) => {
    const tol = Number(toolOptions(ctx.app, CMD.TOOL_COLOR_REPLACER).tolerance);
    ctx.ed.run("Color Replacer", (d) => {
      const l = activeLayer(d);
      const r = { ...l.raster, data: new Uint8ClampedArray(l.raster.data) };
      const t: Target = { image: e.image, data: r.data, channels: 4, before: l.raster.data, width: d.width, height: d.height, lockAlpha: l.lockTransparency, background: false };
      const f = replacer(t, ctx.colors.bg, ctx.colors.fg, tol);
      for (let p = 0; p < d.width * d.height; p++) {
        const m = d.selection ? d.selection.data[p] / 255 : 1;
        if (m > 0) f(p, p % d.width, Math.floor(p / d.width), m);
      }
      l.raster = r;
    }, e.image);
  };
  return tool;
}

export function retouchTool(ctx: ToolContext, res: Resources): Tool {
  return brushTool(ctx, res, CMD.TOOL_RETOUCH, {
    label: "Retouch",
    pixel: (t, e) => {
      if (t.channels === 1) return null;
      const mode = retouchMode(String(toolOptions(ctx.app, CMD.TOOL_RETOUCH).mode), e.button === 2);
      const fg = ctx.colors.fg;
      if (mode === "Smudge" || mode === "Push") return () => {};
      const sel = t.image.doc.selection;
      const inside = sel ? (x: number, y: number) => sel.data[y * t.width + x] > 0 : undefined;
      return (p, x, y, cov) => retouchPixel(mode, t.data as Uint8ClampedArray, t.before as Uint8ClampedArray, t.width, t.height, p, x, y, cov, [fg[0], fg[1], fg[2]], inside);
    },
    // Smudge picks up the colors under each dab and carries them on; Push carries what it first picked up.
    dab: (t, e) => {
      const mode = String(toolOptions(ctx.app, CMD.TOOL_RETOUCH).mode);
      if (t.channels === 1 || (mode !== "Smudge" && mode !== "Push")) return undefined;
      const o = toolOptions(ctx.app, CMD.TOOL_RETOUCH);
      const size = Math.max(1, Math.round(Number(o.size)));
      const tip = makeTip(String(o.shape), size, Number(o.hardness));
      const strength = Number(o.opacity) / 100;
      let carried: Float32Array | null = null;
      const d = t.data as Uint8ClampedArray;
      void e;
      return (cx, cy) => {
        const x0 = Math.round(cx - size / 2), y0 = Math.round(cy - size / 2);
        const sel = t.image.doc.selection;
        if (carried) {
          for (let ty = 0; ty < size; ty++) for (let tx = 0; tx < size; tx++) {
            const x = x0 + tx, y = y0 + ty;
            if (x < 0 || y < 0 || x >= t.width || y >= t.height) continue;
            let a = tip.data[ty * size + tx] * strength;
            if (sel) a *= sel.data[y * t.width + x] / 255;
            if (a <= 0) continue;
            const i = (y * t.width + x) * 4, k = (ty * size + tx) * 4;
            for (let c = 0; c < 4; c++) d[i + c] = d[i + c] + (carried[k + c] - d[i + c]) * a;
          }
        }
        if (!carried || mode === "Smudge") {
          const next = carried ?? new Float32Array(size * size * 4);
          for (let ty = 0; ty < size; ty++) for (let tx = 0; tx < size; tx++) {
            const x = Math.min(t.width - 1, Math.max(0, x0 + tx)), y = Math.min(t.height - 1, Math.max(0, y0 + ty));
            const i = (y * t.width + x) * 4, k = (ty * size + tx) * 4;
            for (let c = 0; c < 4; c++) next[k + c] = carried ? next[k + c] * 0.5 + d[i + c] * 0.5 : d[i + c];
          }
          carried = next;
        }
      };
    },
  });
}

export function dropperTool(ctx: ToolContext): Tool {
  return { down: (e) => pick(ctx, e, Boolean(toolOptions(ctx.app, CMD.TOOL_DROPPER).merged)) };
}

/** The Flood Fill tool's fill source from its options. */
export function fillSource(ctx: ToolContext, res: Resources, o: Record<string, OptionValue>, right: boolean): FillSource | null {
  const fg = right ? ctx.colors.bg : ctx.colors.fg, bg = right ? ctx.colors.fg : ctx.colors.bg;
  const style = FILL_STYLES.indexOf(String(o.style) as typeof FILL_STYLES[number]);
  if (style <= 0) return { kind: "solid", color: fg };
  if (style === 1) {
    const name = String(o.pattern);
    const open = ctx.ws.images.find((i) => i.name === name);
    const stored = res.patterns.find((p) => p.name === name);
    const pattern = open?.composite ?? stored?.raster;
    return pattern ? { kind: "pattern", pattern, offsetX: 0, offsetY: 0 } : null;
  }
  const g = res.gradients.find((x) => x.name === o.gradient) ?? res.gradients[0];
  const shapes: GradientShape[] = ["linear", "rectangular", "sunburst", "radial"];
  return { kind: "gradient", table: gradientTable(g, fg, bg), fill: { shape: shapes[style - 2], angle: Number(o.angle), repeats: Number(o.repeats), cx: Number(o.cx), cy: Number(o.cy), invert: Boolean(o.invert) } };
}

export function floodFillTool(ctx: ToolContext, res: Resources): Tool {
  return {
    down(e) {
      if (e.ctrl) { pick(ctx, e, false); return; }
      const o = toolOptions(ctx.app, CMD.TOOL_FLOOD_FILL);
      const src = fillSource(ctx, res, o, e.button === 2);
      if (!src) { ctx.app.status("Choose a pattern source on the Pattern tab first."); return; }
      const doc = e.image.doc;
      const layer = activeLayer(doc);
      if (layer.kind === "vector") { void alertDialog("JSPaintShop", "Convert the vector layer to raster to fill on it."); return; }
      const matchIndex = MATCH_LABELS.indexOf(String(o.match) as typeof MATCH_LABELS[number]);
      const opts = {
        match: matchIndex < 0 ? null : MATCH_MODES[matchIndex], tolerance: Number(o.tolerance),
        blend: Math.max(0, BLEND_MODES.indexOf(String(o.blend) as typeof BLEND_MODES[number])), opacity: Number(o.opacity) / 100,
        sample: o.merged ? e.image.composite : layer.raster, selection: doc.selection, lockTransparency: layer.lockTransparency, paper: paperOf(res, o),
      };
      if (e.px < 0 || e.py < 0 || e.px >= doc.width || e.py >= doc.height) return;
      const region = fillRegion(e.px, e.py, opts);
      ctx.ed.run("Flood Fill", (d) => { const l = activeLayer(d); l.raster = floodFill(l.raster, region, src, opts); }, e.image);
    },
  };
}
