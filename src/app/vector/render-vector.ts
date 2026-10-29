/*
  Drawing a vector layer's objects into its raster (Canvas 2D on an OffscreenCanvas): paths
  with their stroke, fill, width, caps, joins and antialiasing; text with the browser's fonts.
  PSP draws with its own rasterizer; this matches its geometry, not its exact edge pixels.
  A vector layer's raster is redrawn whenever its objects change (renderVectorLayer).
*/
import type { Layer } from "../../core/doc/image-doc.ts";
import type { Contour, TextData, VectorObject } from "../../core/vector/objects.ts";
import { createRaster, type Raster } from "../../core/image/raster.ts";
import { flattenContour } from "../../core/vector/path.ts";
import { maskContours } from "../../core/vector/trace.ts";
import { placeOnPath } from "../../core/vector/text-path.ts";

const css = (c: readonly number[]) => `rgba(${c[0]},${c[1]},${c[2]},${(c[3] ?? 255) / 255})`;

export function contourPath(cs: Contour[]): Path2D {
  const p = new Path2D();
  for (const c of cs) {
    const n = c.nodes.length;
    if (!n) continue;
    p.moveTo(c.nodes[0].x, c.nodes[0].y);
    const segs = c.closed ? n : n - 1;
    for (let k = 0; k < segs; k++) {
      const a = c.nodes[k], b = c.nodes[(k + 1) % n];
      p.bezierCurveTo(a.outX, a.outY, b.inX, b.inY, b.x, b.y);
    }
    if (c.closed) p.closePath();
  }
  return p;
}

export function textFont(t: TextData): string {
  return `${t.italic ? "italic " : ""}${t.bold ? "bold " : ""}${t.size}px ${JSON.stringify(t.font)}`;
}

/** One placed character: its baseline origin and rotation (text on a path turns each one). */
export interface Glyph { ch: string; x: number; y: number; angle: number; line: number }

const lineHeight = (t: TextData) => t.size * 1.2 + (t.leading / 1000) * t.size;

/*
  Where each character goes. Straight text: lines split on newlines, PSP's kerning and leading
  in thousandths of an em. Text on a path: PSP's placement along the path (text-path.ts).
*/
export function layoutText(g: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, t: TextData): Glyph[] {
  g.font = textFont(t);
  const track = (t.kerning / 1000) * t.size, out: Glyph[] = [];
  const advance = (ch: string) => g.measureText(ch).width + track;
  if (t.path) {
    // PSP's placement (core/vector/text-path.ts); line breaks take no room on a path.
    const text = [...t.text.replace(/[\r\n\v]/g, "")];
    const placed = placeOnPath(flattenContour(t.path, 24), t.path.closed, t.align === "center" ? "center" : t.align === "right" ? "right" : "left", text.map(advance));
    placed.forEach((q, i) => out.push({ ch: text[i], x: q.x, y: q.y, angle: q.angle, line: 0 }));
    return out;
  }
  t.text.split("\n").forEach((line, li) => {
    const w = [...line].reduce((s, ch) => s + advance(ch), 0);
    let x = t.align === "center" ? t.x - w / 2 : t.align === "right" ? t.x - w : t.x;
    const y = t.y + li * lineHeight(t);
    for (const ch of line) { out.push({ ch, x, y, angle: 0, line: li }); x += advance(ch); }
  });
  return out;
}

/** Draw text (or only the glyphs `only` keeps), with underline and strikeout on straight text. */
export function drawText(g: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, t: TextData, fill: string | null, stroke: string | null, width: number, only?: (i: number) => boolean): void {
  const glyphs = layoutText(g, t);
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  glyphs.forEach((gl, i) => {
    if (only && !only(i)) return;
    g.save();
    g.translate(gl.x, gl.y);
    if (gl.angle) g.rotate(gl.angle);
    if (fill) { g.fillStyle = fill; g.fillText(gl.ch, 0, 0); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = width; g.strokeText(gl.ch, 0, 0); }
    g.restore();
  });
  if (t.path || only || !(t.underline || t.strikeout)) return;
  t.text.split("\n").forEach((line, li) => {
    const row = glyphs.filter((gl) => gl.line === li);
    if (!row.length) return;
    const x0 = row[0].x, x1 = row[row.length - 1].x + g.measureText(row[row.length - 1].ch).width, y = row[0].y;
    g.fillStyle = fill ?? stroke ?? "#000";
    if (t.underline) g.fillRect(x0, y + t.size * 0.1, x1 - x0, Math.max(1, t.size / 15));
    if (t.strikeout) g.fillRect(x0, y - t.size * 0.3, x1 - x0, Math.max(1, t.size / 15));
    void line;
  });
}

/** The box text covers, in image coordinates. */
export function textBounds(t: TextData): { minX: number; minY: number; maxX: number; maxY: number } {
  const g = new OffscreenCanvas(1, 1).getContext("2d")!;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const gl of layoutText(g, t)) {
    const w = g.measureText(gl.ch).width, c = Math.cos(gl.angle), s = Math.sin(gl.angle);
    for (const [u, v] of [[0, -t.size], [w, -t.size], [w, t.size * 0.3], [0, t.size * 0.3]]) {
      const x = gl.x + u * c - v * s, y = gl.y + u * s + v * c;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return minX === Infinity ? { minX: t.x, minY: t.y - t.size, maxX: t.x, maxY: t.y } : { minX, minY, maxX, maxY };
}

/*
  Convert Text to Curves: the text drawn four times larger, traced and scaled back
  (core/vector/trace.ts). As Single Shape gives one object; As Character Shapes one per character.
*/
export function textToCurves(o: VectorObject, perCharacter: boolean): VectorObject[] {
  const t = o.text!;
  const SS = 4, b = textBounds(t), pad = 2;
  const w = Math.ceil((b.maxX - b.minX + pad * 2) * SS), h = Math.ceil((b.maxY - b.minY + pad * 2) * SS);
  if (w <= 0 || h <= 0 || w * h > 64e6) return [];
  const trace = (only?: (i: number) => boolean): Contour[] => {
    const c = new OffscreenCanvas(w, h), g = c.getContext("2d")!;
    g.scale(SS, SS);
    g.translate(pad - b.minX, pad - b.minY);
    drawText(g, t, "#000", null, 0, only);
    const img = g.getImageData(0, 0, w, h), data = new Uint8Array(w * h);
    for (let i = 0; i < data.length; i++) data[i] = img.data[i * 4 + 3];
    return maskContours({ width: w, height: h, data }, 1 / SS, b.minX - pad, b.minY - pad, 0.75);
  };
  const shape = (contours: Contour[], name: string): VectorObject => ({ name, visible: o.visible, style: { ...o.style }, contours });
  if (!perCharacter) return [shape(trace(), o.name)];
  const glyphs = layoutText(new OffscreenCanvas(1, 1).getContext("2d")!, t);
  return glyphs.map((gl, i) => ({ gl, i })).filter(({ gl }) => gl.ch.trim()).map(({ gl, i }) => shape(trace((k) => k === i), gl.ch)).filter((s) => s.contours.length);
}

export function drawObject(g: OffscreenCanvasRenderingContext2D, o: VectorObject): void {
  if (!o.visible) return;
  const s = o.style;
  g.imageSmoothingEnabled = s.antialias;
  if (o.text) { drawText(g, o.text, s.fill ? css(s.fill) : null, s.stroke ? css(s.stroke) : null, s.width); return; }
  const p = contourPath(o.contours);
  if (s.fill) { g.fillStyle = css(s.fill); g.fill(p, "evenodd"); }
  if (s.stroke && s.width > 0) {
    g.strokeStyle = css(s.stroke);
    g.lineWidth = s.width;
    g.lineCap = s.cap;
    g.lineJoin = s.join;
    g.miterLimit = s.miter;
    g.stroke(p);
  }
}

/** The objects drawn on a clear width x height raster. */
export function renderObjects(objects: VectorObject[], width: number, height: number): Raster {
  const c = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
  const g = c.getContext("2d")!;
  for (const o of objects) {
    if (o.style.antialias || !o.visible) { drawObject(g, o); continue; }
    // Canvas paths are always antialiased: draw the object alone and cut its edges at half.
    const a = new OffscreenCanvas(c.width, c.height), ag = a.getContext("2d")!;
    drawObject(ag, o);
    const img = ag.getImageData(0, 0, c.width, c.height);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] >= 128 ? 255 : 0;
    ag.putImageData(img, 0, 0);
    g.drawImage(a, 0, 0);
  }
  const out = createRaster(width, height);
  out.data.set(g.getImageData(0, 0, width, height).data);
  return out;
}

/** Redraw a vector layer's raster from its objects. */
export function renderVectorLayer(layer: Layer, width: number, height: number): void {
  if (layer.kind !== "vector") return;
  layer.raster = renderObjects(layer.objects ?? [], width, height);
}
