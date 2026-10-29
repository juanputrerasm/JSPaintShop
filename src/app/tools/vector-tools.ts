/*
  The vector tools: Draw, Preset Shapes, Text and the Vector Object Selector.

  New objects take the foreground color as their stroke and the background color as their
  fill (Style: Stroked, Filled, or Stroked & Filled). With "Create as vector" they go on the
  active vector layer, or on a new one above the active layer; without it they are painted onto
  the active raster layer.

  Draw         Single Line (drag), Bezier Curve (drag the line, then two drags for the control
               points), Freehand Line (points kept every "Curve tracking" pixels), Point to Point
               Line (click nodes, drag to pull handles, double-click to finish)
  Preset Shapes  drag the box (PSP's shapes, core/vector/path.ts)
  Text         click where the text starts: the Text Entry dialog
  Object Selector  click an object to select it; drag to move, drag a corner to resize, Delete
               removes, double-click opens its properties; Node Edit (Tool Options) shows the
               nodes, which drag on their own
*/
import type { Tool, ToolContext, ToolEvent } from "./tool.ts";
import type { ImageDocument } from "../image-document.ts";
import type { Editor } from "../editor.ts";
import type { ViewTransform } from "../../render/image-view.ts";
import { CMD } from "../../ui/shell/commands.ts";
import { toolActions } from "../../ui/panels/tool-options.ts";
import { el } from "../../shared/dom.ts";
import { openDialog } from "../../ui/shell/dialog.ts";
import { activeLayer, rasterLayer, type ImageDoc, type Layer } from "../../core/doc/image-doc.ts";
import { createRaster, type Rgba } from "../../core/image/raster.ts";
import { defaultStyle, type Contour, type TextData, type VectorObject, type VectorStyle } from "../../core/vector/objects.ts";
import { contourBounds, mapContours, polylineContour, presetShapeContour, type Point } from "../../core/vector/path.ts";
import { contourPath, drawText, renderObjects, renderVectorLayer, textBounds } from "../vector/render-vector.ts";
import { nextLayerName } from "../../core/layers/layer-ops.ts";
import { polygonMask } from "../../core/select/selection.ts";
import { flattenContour } from "../../core/vector/path.ts";
import { deleteNodes, type NodeRef } from "../../core/vector/node-edit.ts";

const css = (c: readonly number[]) => `rgb(${c[0]} ${c[1]} ${c[2]})`;

/*
  A new object's colors. Draw and Preset Shapes (help "Preset Shapes Tool Options Palette Tab 1"):
  the mouse button's color (left foreground, right background) strokes a Stroked object and
  fills a Filled one; Stroked and Filled strokes with it and fills with the other color. Text
  (button null) strokes with the foreground and fills with the background.
*/
function styleFrom(ctx: ToolContext, o: Record<string, unknown>, right: boolean | null): VectorStyle {
  const st = String(o.style ?? "Stroked"), { fg, bg } = ctx.colors;
  const main = [...(right ? bg : fg)] as Rgba, other = [...(right ? fg : bg)] as Rgba;
  const stroke = st === "Filled" ? null : right === null ? [...fg] as Rgba : main;
  const fill = st === "Stroked" ? null : right === null ? [...bg] as Rgba : st === "Filled" ? main : other;
  const s = defaultStyle(stroke, fill, Number(o.width ?? 1));
  s.antialias = o.antialias !== false;
  s.cap = ({ Flat: "butt", Round: "round", Square: "square" } as const)[String(o.cap ?? "Round") as "Flat"] ?? "round";
  s.join = ({ Miter: "miter", Round: "round", Bevel: "bevel" } as const)[String(o.join ?? "Round") as "Miter"] ?? "round";
  s.miter = Number(o.miter ?? 10);
  return s;
}

/** The vector layer new objects go on: the active one, or a new one above it. */
export function vectorTarget(doc: ImageDoc): Layer {
  const l = activeLayer(doc);
  if (l.kind === "vector") return l;
  const layer: Layer = { ...rasterLayer(nextLayerName(doc, "Vector"), createRaster(doc.width, doc.height)), kind: "vector", objects: [] };
  doc.layers.splice(doc.active + 1, 0, layer);
  doc.active += 1;
  return layer;
}

/** Put a new object on the image as one undo step. */
export function addObject(ctx: ToolContext, image: ImageDocument, obj: VectorObject, asVector: boolean, label: string): void {
  ctx.ed.run(label, (doc) => {
    if (asVector) {
      const layer = vectorTarget(doc);
      layer.objects = [...(layer.objects ?? []), obj];
      renderVectorLayer(layer, doc.width, doc.height);
      return { layers: true };
    }
    const layer = activeLayer(doc);
    if (layer.kind !== "raster" && layer.kind !== "floating") return;
    const art = renderObjects([obj], doc.width, doc.height), d = new Uint8ClampedArray(layer.raster.data), s = art.data, sel = doc.selection;
    for (let i = 0; i < d.length; i += 4) {
      let a = s[i + 3] / 255;
      if (sel) a *= sel.data[i / 4] / 255;
      if (!a) continue;
      const da = d[i + 3] / 255, oa = a + da * (1 - a);
      for (let c = 0; c < 3; c++) d[i + c] = (s[i + c] * a + d[i + c] * da * (1 - a)) / oa;
      if (!layer.lockTransparency) d[i + 3] = oa * 255;
    }
    layer.raster = { ...layer.raster, data: d };
    return { layers: true };
  }, image);
}

const drawPreview = (g: CanvasRenderingContext2D, t: ViewTransform, cs: Contour[]) => {
  const p = contourPath(mapContours(cs, (x, y) => [t.ox + x * t.scale, t.oy + y * t.scale]));
  g.save(); g.lineWidth = 1; g.strokeStyle = "rgb(0 0 0 / 0.8)"; g.setLineDash([4, 4]); g.stroke(p);
  g.strokeStyle = "rgb(255 255 255 / 0.8)"; g.lineDashOffset = 4; g.stroke(p); g.restore();
};

export function drawTool(ctx: ToolContext): Tool {
  let pts: Point[] = [];
  let bez: { a: Point; b: Point; c1: Point | null; c2: Point | null; stage: number } | null = null;
  let p2p: { nodes: Contour["nodes"]; dragging: boolean } | null = null;
  let image: ImageDocument | null = null, right = false;
  const o = () => ctx.options();
  const finish = (cs: Contour) => {
    if (!image) return;
    const opts = o();
    addObject(ctx, image, { name: "Line", visible: true, style: styleFrom(ctx, opts, right), contours: [cs] }, opts.vector !== false, "Draw");
    pts = []; bez = null; p2p = null;
  };
  return {
    down(e) {
      image = e.image;
      const kind = String(o().kind);
      if (kind === "Bezier Curve" && bez && bez.stage > 0) { (bez.stage === 1 ? (bez.c1 = [e.x, e.y]) : (bez.c2 = [e.x, e.y])); return; }
      if (kind === "Point to Point Line") {
        // The first node's button picks the color; later right-clicks add no node.
        if (!p2p) { p2p = { nodes: [], dragging: true }; right = e.button === 2; }
        else if (e.button === 2) return;
        p2p.nodes.push({ x: e.x, y: e.y, inX: e.x, inY: e.y, outX: e.x, outY: e.y, type: "symmetric" });
        p2p.dragging = true;
        return;
      }
      pts = [[e.x, e.y], [e.x, e.y]];
      right = e.button === 2;
      if (kind === "Bezier Curve") bez = { a: [e.x, e.y], b: [e.x, e.y], c1: null, c2: null, stage: 0 };
    },
    move(e, dragging) {
      if (!dragging) return;
      const kind = String(o().kind);
      if (kind === "Freehand Line") {
        const last = pts[pts.length - 1], track = Math.max(1, Number(o().tracking) / 5);
        if (Math.hypot(e.x - last[0], e.y - last[1]) >= track) pts.push([e.x, e.y]);
      } else if (kind === "Point to Point Line" && p2p?.dragging) {
        const n = p2p.nodes[p2p.nodes.length - 1];
        n.outX = e.x; n.outY = e.y; n.inX = 2 * n.x - e.x; n.inY = 2 * n.y - e.y;
      } else if (bez && bez.stage > 0) {
        if (bez.stage === 1) bez.c1 = [e.x, e.y]; else bez.c2 = [e.x, e.y];
      } else pts[1] = [e.x, e.y];
      e.view.request();
    },
    up(e) {
      const kind = String(o().kind);
      if (kind === "Single Line") { if (Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) >= 1) finish(polylineContour(pts, false)); }
      else if (kind === "Freehand Line") { if (pts.length > 1) finish(polylineContour(pts, Boolean(o().close))); }
      else if (kind === "Point to Point Line" && p2p) p2p.dragging = false;
      else if (bez) {
        if (bez.stage === 0) { bez.b = pts[1]; bez.stage = 1; }
        else if (bez.stage === 1) bez.stage = 2;
        else {
          const { a, b, c1, c2 } = bez;
          finish({ closed: false, nodes: [{ x: a[0], y: a[1], inX: a[0], inY: a[1], outX: c1![0], outY: c1![1], type: "cusp" }, { x: b[0], y: b[1], inX: c2![0], inY: c2![1], outX: b[0], outY: b[1], type: "cusp" }] });
        }
      }
      e.view.request();
    },
    dblclick() { if (p2p && p2p.nodes.length > 1) { p2p.nodes.pop(); finish({ closed: Boolean(o().close), nodes: p2p.nodes }); } },
    deactivate() { pts = []; bez = null; p2p = null; },
    overlay(g, t, img) {
      if (img !== image) return;
      if (p2p) drawPreview(g, t, [{ closed: false, nodes: p2p.nodes }]);
      else if (bez && bez.stage > 0) {
        const { a, b } = bez, c1 = bez.c1 ?? a, c2 = bez.c2 ?? b;
        drawPreview(g, t, [{ closed: false, nodes: [{ x: a[0], y: a[1], inX: a[0], inY: a[1], outX: c1[0], outY: c1[1], type: "cusp" }, { x: b[0], y: b[1], inX: c2[0], inY: c2[1], outX: b[0], outY: b[1], type: "cusp" }] }]);
      } else if (pts.length > 1) drawPreview(g, t, [polylineContour(pts, false)]);
    },
  };
}

export function presetShapesTool(ctx: ToolContext): Tool {
  let start: Point | null = null, end: Point | null = null, image: ImageDocument | null = null, right = false;
  return {
    down(e) { start = [e.x, e.y]; end = start; image = e.image; right = e.button === 2; },
    move(e, dragging) { if (dragging && start) { end = [e.x, e.y]; e.view.request(); } },
    up(e) {
      if (start && end && Math.abs(end[0] - start[0]) >= 1 && Math.abs(end[1] - start[1]) >= 1) {
        const opts = ctx.options(), shape = String(opts.shape ?? "Rectangle");
        addObject(ctx, e.image, { name: shape, visible: true, style: styleFrom(ctx, opts, right), contours: [presetShapeContour(shape, start[0], start[1], end[0], end[1])] }, opts.vector !== false, shape);
      }
      start = end = null;
      e.view.request();
    },
    overlay(g, t, img) {
      if (!start || !end || img !== image) return;
      drawPreview(g, t, [presetShapeContour(String(ctx.options().shape ?? "Rectangle"), start[0], start[1], end[0], end[1])]);
    },
  };
}

const FONTS = ["Arial", "Times New Roman", "Courier New", "Georgia", "Verdana", "Tahoma", "Trebuchet MS", "Impact", "Comic Sans MS", "Lucida Console", "Palatino Linotype", "Garamond"];

/** The Text Entry dialog (PSP DIALOG 27091). */
async function textEntry(ctx: ToolContext, at: Point, existing?: TextData): Promise<{ text: TextData; mode: string; style: VectorStyle } | null> {
  const fontSel = el("select", {}, ...FONTS.map((f) => el("option", { value: f, selected: f === (existing?.font ?? "Arial") }, f)));
  const size = el("input", { type: "number", class: "spin", value: existing?.size ?? 24, min: 1, max: 999 });
  const box = el("textarea", { rows: 4, cols: 40 }, existing?.text ?? "");
  const chk = (l: string, v: boolean) => { const c = el("input", { type: "checkbox", checked: v }); return [c, el("label", { class: "opt-check" }, c, l)] as const; };
  const [bold, boldRow] = chk("Bold", existing?.bold ?? false), [italic, italicRow] = chk("Italic", existing?.italic ?? false);
  const [under, underRow] = chk("Underline", existing?.underline ?? false), [strike, strikeRow] = chk("Strikeout", existing?.strikeout ?? false);
  const [aa, aaRow] = chk("Antialias", true);
  const align = el("select", {}, ...["left", "center", "right"].map((a) => el("option", { value: a, selected: a === (existing?.align ?? "left") }, a[0].toUpperCase() + a.slice(1))));
  const mode = el("select", {}, ...["Vector", "Selection", "Floating"].map((m) => el("option", {}, m)));
  const fillStyle = el("select", {}, ...["Filled", "Stroked", "Stroked & Filled"].map((m) => el("option", {}, m)));
  const width = el("input", { type: "number", class: "spin", value: 1, min: 0, max: 100 });
  const kern = el("input", { type: "number", class: "spin", value: existing?.kerning ?? 0, min: -1000, max: 1000 });
  const lead = el("input", { type: "number", class: "spin", value: existing?.leading ?? 0, min: -1000, max: 1000 });
  const preview = el("canvas", { width: 320, height: 60, class: "text-preview" }) as HTMLCanvasElement;
  const data = (): TextData => ({ text: box.value, font: fontSel.value, size: Number(size.value) || 24, bold: bold.checked, italic: italic.checked, underline: under.checked, strikeout: strike.checked, align: align.value as TextData["align"], kerning: Number(kern.value) || 0, leading: Number(lead.value) || 0, x: at[0], y: at[1] });
  const draw = () => {
    const g = preview.getContext("2d")!, t = { ...data(), x: 4, y: 44, align: "left" as const, size: Math.min(36, data().size), text: box.value.split("\n")[0] || "AaBbYyZz" };
    g.clearRect(0, 0, 320, 60);
    drawText(g, t, css(ctx.colors.bg), css(ctx.colors.fg), 1);
  };
  for (const c of [fontSel, size, box, bold, italic, under, strike, kern, lead]) c.addEventListener("input", draw);
  draw();
  const row = (l: string, c: Node) => el("label", { class: "form-row" }, el("span", {}, l), c);
  const v = await openDialog({
    title: "Text Entry",
    body: el("div", { class: "layer-props" }, row("Name:", fontSel), row("Size:", size), el("div", { class: "opt-row" }, boldRow, italicRow, underRow, strikeRow),
      row("Alignment:", align), row("Kerning:", kern), row("Leading:", lead), row("Create as:", mode), row("Style:", fillStyle), row("Stroke width:", width), aaRow,
      el("fieldset", { class: "opt-group" }, el("legend", {}, "Enter text here..."), box), preview),
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
  });
  if (v !== "ok" || !box.value) return null;
  const style = styleFrom(ctx, { style: fillStyle.value, width: Number(width.value), antialias: aa.checked }, null);
  return { text: data(), mode: mode.value, style };
}

export function textTool(ctx: ToolContext): Tool {
  return {
    async down(e) {
      if (e.button !== 0) return;
      const layer = activeLayer(e.image.doc);
      // Clicking a text object on a vector layer edits it.
      if (layer.kind === "vector") {
        const hit = [...(layer.objects ?? [])].reverse().find((o) => o.text && hitText(o, e.x, e.y));
        if (hit && hit.text) {
          const r = await textEntry(ctx, [hit.text.x, hit.text.y], hit.text);
          if (!r) return;
          ctx.ed.run("Edit Text", (doc) => {
            const l = activeLayer(doc);
            l.objects = (l.objects ?? []).map((o) => (o === hit ? { ...o, text: r.text, style: r.style } : o));
            renderVectorLayer(l, doc.width, doc.height);
            return { layers: true };
          }, e.image);
          return;
        }
      }
      const r = await textEntry(ctx, [e.x, e.y]);
      if (!r) return;
      const obj: VectorObject = { name: r.text.text.split("\n")[0].slice(0, 32), visible: true, style: r.style, contours: [], text: r.text };
      if (r.mode === "Vector") { addObject(ctx, e.image, obj, true, "Text"); return; }
      const art = renderObjects([obj], e.image.doc.width, e.image.doc.height);
      ctx.ed.run("Text", (doc) => {
        const mask = { width: doc.width, height: doc.height, data: new Uint8Array(doc.width * doc.height) };
        for (let i = 0; i < mask.data.length; i++) mask.data[i] = art.data[i * 4 + 3];
        if (r.mode === "Selection") { doc.selection = mask; return { selection: true }; }
        doc.layers.splice(doc.active + 1, 0, { ...rasterLayer("Floating Selection", art), kind: "floating" });
        doc.active += 1;
        doc.selection = mask;
        return { layers: true, selection: true };
      }, e.image);
    },
  };
}

function hitText(o: VectorObject, x: number, y: number): boolean {
  const b = textBounds(o.text!);
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}

export function objectBounds(o: VectorObject) {
  return o.text ? textBounds(o.text) : contourBounds(o.contours);
}

function hitObject(o: VectorObject, x: number, y: number): boolean {
  if (!o.visible) return false;
  if (o.text) return hitText(o, x, y);
  const g = new OffscreenCanvas(1, 1).getContext("2d")!, p = contourPath(o.contours);
  g.lineWidth = Math.max(4, o.style.width + 2);
  return g.isPointInPath(p, x, y, "evenodd") || g.isPointInStroke(p, x, y);
}

/*
  The vector selection the Object Selector keeps, shared with the vector object and node edit
  commands (app/vector-commands.ts): the selected objects of the active vector layer and, in
  node editing, the selected nodes of the first selected object.
*/
export const vectorSel: {
  image: ImageDocument | null;
  objects: Set<number>;
  nodeEdit: boolean;
  /** Node Edit's Drawing mode (Ctrl+E): clicks add nodes; Edit mode only moves them. */
  drawing: boolean;
  nodes: NodeRef[];
  /** Opens the right-click menu (set by app/vector-commands.ts). */
  menu?: (x: number, y: number) => void;
  /** The object whose Layer palette row was right-clicked (MENU 500's Select toggles it). */
  row?: number;
} = { image: null, objects: new Set(), nodeEdit: false, drawing: false, nodes: [] };

export function clearVectorSelection(): void {
  const image = vectorSel.image;
  vectorSel.image = null; vectorSel.objects = new Set(); vectorSel.nodes = []; vectorSel.nodeEdit = false; vectorSel.drawing = false;
  image?.changed({});
}

/** The selected objects' indices on the active vector layer of `image`, lowest first. */
export function selectedObjects(image: ImageDocument | null): number[] {
  if (!image || vectorSel.image !== image || activeLayer(image.doc).kind !== "vector") return [];
  const n = activeLayer(image.doc).objects?.length ?? 0;
  return [...vectorSel.objects].filter((i) => i < n).sort((a, b) => a - b);
}

/** Vector Properties for one object; resolves to the changed object, or null on Cancel. */
export async function objectProperties(o: VectorObject): Promise<VectorObject | null> {
  const name = el("input", { type: "text", value: o.name });
  const hex = (c: readonly number[] | null) => (c ? `#${[0, 1, 2].map((i) => c[i].toString(16).padStart(2, "0")).join("")}` : "#000000");
  const stroke = el("input", { type: "color", value: hex(o.style.stroke) }), fill = el("input", { type: "color", value: hex(o.style.fill) });
  const hasStroke = el("input", { type: "checkbox", checked: Boolean(o.style.stroke) }), hasFill = el("input", { type: "checkbox", checked: Boolean(o.style.fill) });
  const width = el("input", { type: "number", class: "spin", value: o.style.width, min: 0, max: 255 });
  const aa = el("input", { type: "checkbox", checked: o.style.antialias });
  const visible = el("input", { type: "checkbox", checked: o.visible });
  const row = (l: string, ...c: Node[]) => el("label", { class: "form-row" }, el("span", {}, l), ...c);
  const v = await openDialog({ title: "Vector Properties", body: el("div", { class: "layer-props" }, row("Name:", name), row("Stroke:", hasStroke, stroke), row("Fill:", hasFill, fill), row("Line width:", width), row("Antialias:", aa), row("Visible:", visible)), buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }] });
  if (v !== "ok") return null;
  const rgb = (h: string): Rgba => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];
  return { ...o, name: name.value, visible: visible.checked, style: { ...o.style, stroke: hasStroke.checked ? rgb(stroke.value) : null, fill: hasFill.checked ? rgb(fill.value) : null, width: Number(width.value), antialias: aa.checked } };
}

/** Replace some objects of the active vector layer as one undo step. */
export function changeObjects(ed: Editor, image: ImageDocument, label: string, f: (objects: VectorObject[]) => VectorObject[]): void {
  ed.run(label, (doc) => {
    const l = activeLayer(doc);
    if (l.kind !== "vector") return;
    l.objects = f(l.objects ?? []);
    renderVectorLayer(l, doc.width, doc.height);
    return { layers: true };
  }, image);
}

export function objectSelectorTool(ctx: ToolContext): Tool {
  let drag: { kind: "move" | "corner" | "node" | "draw"; corner: number; start: Point; before: VectorObject[]; index: number; node?: NodeRef } | null = null;
  const layerOf = (image: ImageDocument) => { const l = activeLayer(image.doc); return l.kind === "vector" ? l : null; };
  const primary = (image: ImageDocument) => selectedObjects(image)[0] ?? -1;
  const show = (image: ImageDocument, objects: VectorObject[]) => {
    const l = layerOf(image);
    if (!l) return;
    l.objects = objects;
    renderVectorLayer(l, image.doc.width, image.doc.height);
    image.changed({ layers: true });
  };
  const transform = (o: VectorObject, f: (x: number, y: number) => Point, sx = 1): VectorObject => ({
    ...o, contours: mapContours(o.contours, f),
    text: o.text ? (() => { const [x, y] = f(o.text.x, o.text.y); return { ...o.text, x, y, size: Math.max(1, o.text.size * sx), path: o.text.path ? mapContours([o.text.path], f)[0] : undefined }; })() : undefined,
  });
  toolActions[CMD.TOOL_VECTOR_OBJECT_SELECTION] = { node: () => { vectorSel.nodeEdit = !vectorSel.nodeEdit; vectorSel.nodes = []; vectorSel.image?.changed({}); } };
  window.addEventListener("keydown", (e) => {
    const image = vectorSel.image;
    if (!image || (e.key !== "Delete" && e.key !== "Backspace") || (e.target as HTMLElement)?.closest?.("input,textarea")) return;
    const idx = selectedObjects(image);
    if (!idx.length) return;
    if (vectorSel.nodeEdit && vectorSel.nodes.length) {
      const refs = vectorSel.nodes, i = idx[0];
      vectorSel.nodes = [];
      changeObjects(ctx.ed, image, "Delete Nodes", (os) => os.map((o, k) => (k === i ? { ...o, contours: deleteNodes(o.contours, refs) } : o)));
      return;
    }
    vectorSel.objects = new Set();
    changeObjects(ctx.ed, image, "Delete Vector Objects", (os) => os.filter((_, k) => !idx.includes(k)));
  });
  const corners = (b: { minX: number; minY: number; maxX: number; maxY: number }): Point[] => [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]];
  return {
    down(e: ToolEvent) {
      const l = layerOf(e.image);
      if (!l) return;
      if (e.button === 2) { if (vectorSel.image === e.image) vectorSel.menu?.(e.clientX, e.clientY); return; }
      if (e.button !== 0) return;
      if (vectorSel.image !== e.image) { vectorSel.image = e.image; vectorSel.objects = new Set(); vectorSel.nodes = []; }
      const objs = l.objects ?? [], r = 6 / e.view.scale, p = primary(e.image), o = objs[p];
      if (o) {
        if (vectorSel.nodeEdit) {
          for (let ci = 0; ci < o.contours.length; ci++) for (let ni = 0; ni < o.contours[ci].nodes.length; ni++) {
            const n = o.contours[ci].nodes[ni];
            if (Math.abs(n.x - e.x) > r || Math.abs(n.y - e.y) > r) continue;
            const has = vectorSel.nodes.some(([a, b]) => a === ci && b === ni);
            if (e.shift) { if (!has) vectorSel.nodes.push([ci, ni]); }
            else if (e.ctrl) vectorSel.nodes = vectorSel.nodes.filter(([a, b]) => a !== ci || b !== ni);
            else if (!has) vectorSel.nodes = [[ci, ni]];
            drag = { kind: "node", corner: 0, start: [e.x, e.y], before: objs, index: p, node: [ci, ni] };
            e.image.changed({});
            return;
          }
          if (vectorSel.drawing) {
            // Drawing mode: extend the contour from its selected start or end node, else start a
            // new contour (PSP's help, "Adding Nodes"); dragging pulls out symmetric handles.
            const n = { x: e.x, y: e.y, inX: e.x, inY: e.y, outX: e.x, outY: e.y, type: "symmetric" as const };
            const sel = vectorSel.nodes.length === 1 ? vectorSel.nodes[0] : null;
            const c = sel ? o.contours[sel[0]] : null;
            let contours: Contour[], at: NodeRef;
            if (c && !c.closed && sel![1] === c.nodes.length - 1) {
              contours = o.contours.map((x, k) => (k === sel![0] ? { ...x, nodes: [...x.nodes, n] } : x)); at = [sel![0], c.nodes.length];
            } else if (c && !c.closed && sel![1] === 0) {
              contours = o.contours.map((x, k) => (k === sel![0] ? { ...x, nodes: [n, ...x.nodes] } : x)); at = [sel![0], 0];
            } else {
              contours = [...o.contours, { closed: false, nodes: [n] }]; at = [o.contours.length, 0];
            }
            vectorSel.nodes = [at];
            drag = { kind: "draw", corner: 0, start: [e.x, e.y], before: objs, index: p, node: at };
            show(e.image, objs.map((x, k) => (k === p ? { ...x, contours } : x)));
            return;
          }
        }
        const b = objectBounds(o);
        if (b && !e.shift && !e.ctrl) {
          const k = corners(b).findIndex(([x, y]) => Math.abs(x - e.x) <= r && Math.abs(y - e.y) <= r);
          if (k >= 0) { drag = { kind: "corner", corner: k, start: [e.x, e.y], before: objs, index: p }; return; }
        }
      }
      let hit = -1;
      for (let i = objs.length - 1; i >= 0; i--) if (hitObject(objs[i], e.x, e.y)) { hit = i; break; }
      if (e.shift) { if (hit >= 0) vectorSel.objects.add(hit); }
      else if (e.ctrl) { if (hit >= 0) vectorSel.objects.delete(hit); }
      else if (hit < 0) vectorSel.objects = new Set();
      else if (!vectorSel.objects.has(hit)) vectorSel.objects = new Set([hit]);
      if (hit !== p) vectorSel.nodes = [];
      if (hit >= 0 && vectorSel.objects.has(hit)) drag = { kind: "move", corner: 0, start: [e.x, e.y], before: objs, index: hit };
      e.image.changed({});
    },
    move(e, dragging) {
      if (!dragging || !drag || vectorSel.image !== e.image) return;
      const dx = e.x - drag.start[0], dy = e.y - drag.start[1], before = drag.before, sel = vectorSel.objects;
      if (drag.kind === "draw") {
        const [ci, ni] = drag.node!, objs = layerOf(e.image)?.objects ?? [];
        show(e.image, objs.map((o, i) => (i !== drag!.index ? o : { ...o, contours: o.contours.map((c, k) => (k !== ci ? c : { ...c, nodes: c.nodes.map((n, j) => (j !== ni ? n : { ...n, outX: e.x, outY: e.y, inX: 2 * n.x - e.x, inY: 2 * n.y - e.y })) })) })));
        return;
      }
      if (drag.kind === "move") show(e.image, before.map((o, i) => (sel.has(i) ? transform(o, (x, y) => [x + dx, y + dy]) : o)));
      else if (drag.kind === "node") {
        const moving = new Set(vectorSel.nodes.map(([a, b]) => `${a}:${b}`));
        show(e.image, before.map((o, i) => (i !== drag!.index ? o : { ...o, contours: o.contours.map((c, ci) => ({ ...c, nodes: c.nodes.map((n, ni) => (!moving.has(`${ci}:${ni}`) ? n : { ...n, x: n.x + dx, y: n.y + dy, inX: n.inX + dx, inY: n.inY + dy, outX: n.outX + dx, outY: n.outY + dy })) })) })));
      } else {
        const b = objectBounds(before[drag.index])!, cs = corners(b), fixed = cs[(drag.corner + 2) % 4], from = cs[drag.corner];
        const sx = (from[0] + dx - fixed[0]) / (from[0] - fixed[0] || 1), sy = (from[1] + dy - fixed[1]) / (from[1] - fixed[1] || 1);
        show(e.image, before.map((o, i) => (sel.has(i) ? transform(o, (x, y) => [fixed[0] + (x - fixed[0]) * sx, fixed[1] + (y - fixed[1]) * sy], Math.abs(sy)) : o)));
      }
    },
    up(e) {
      const l = layerOf(e.image);
      if (drag && l && l.objects !== drag.before) {
        // Put the original back and redo the change as one undo step.
        const after = l.objects!, kind = drag.kind;
        l.objects = drag.before;
        changeObjects(ctx.ed, e.image, kind === "move" ? "Move Vector Objects" : kind === "node" ? "Move Nodes" : kind === "draw" ? "Add Node" : "Resize Vector Objects", () => after);
      }
      drag = null;
    },
    async dblclick(e) {
      const image = e.image, i = primary(image), o = layerOf(image)?.objects?.[i];
      if (!o) return;
      const next = await objectProperties(o);
      if (next) changeObjects(ctx.ed, image, "Vector Properties", (os) => os.map((x, k) => (k === i ? next : x)));
    },
    deactivate() { clearVectorSelection(); drag = null; },
    overlay(g, t, image) {
      const idx = selectedObjects(image), objs = layerOf(image)?.objects ?? [];
      if (!idx.length) return;
      const sp = ([x, y]: Point): Point => [t.ox + x * t.scale, t.oy + y * t.scale];
      g.save();
      for (const i of idx) {
        const o = objs[i], b = objectBounds(o);
        if (!b) continue;
        const cs = corners(b).map(sp);
        g.strokeStyle = "rgb(0 0 0 / 0.8)"; g.setLineDash([4, 4]); g.beginPath(); cs.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.stroke(); g.setLineDash([]);
        g.fillStyle = "white";
        for (const p of cs) { g.fillRect(p[0] - 3, p[1] - 3, 6, 6); g.strokeRect(p[0] - 3, p[1] - 3, 6, 6); }
      }
      const o = objs[idx[0]];
      if (vectorSel.nodeEdit && o) {
        const picked = new Set(vectorSel.nodes.map(([a, b]) => `${a}:${b}`));
        o.contours.forEach((c, ci) => c.nodes.forEach((n, ni) => {
          const p = sp([n.x, n.y]), on = picked.has(`${ci}:${ni}`);
          if (on) {
            g.strokeStyle = "#06f";
            for (const h of [[n.inX, n.inY], [n.outX, n.outY]] as Point[]) {
              if (h[0] === n.x && h[1] === n.y) continue;
              const q = sp(h);
              g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke();
              g.beginPath(); g.arc(q[0], q[1], 3, 0, Math.PI * 2); g.stroke();
            }
          }
          g.fillStyle = on ? "#06f" : "white"; g.strokeStyle = "#06f";
          g.fillRect(p[0] - 3, p[1] - 3, 6, 6); g.strokeRect(p[0] - 3, p[1] - 3, 6, 6);
        }));
      }
      g.restore();
    },
  };
}

/** Layers > Convert to Raster: the vector layer keeps its pixels and loses its objects. */
export function convertToRaster(doc: ImageDoc): void {
  const l = activeLayer(doc);
  if (l.kind !== "vector") return;
  renderVectorLayer(l, doc.width, doc.height);
  l.kind = "raster";
  delete l.objects;
}

/** The selection a vector layer's objects make (Selections > From Vector Object is not PSP 6's; used by Paste As New Vector Selection). */
export function objectsMask(objects: VectorObject[], width: number, height: number) {
  const polys = objects.flatMap((o) => o.contours.map((c) => flattenContour(c, 16)));
  return polygonMask(width, height, polys, true);
}
