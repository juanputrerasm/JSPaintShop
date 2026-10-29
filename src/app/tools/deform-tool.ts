/*
  The Deformation tool (Psp.exe "DeformCtrl.cpp"; transform in core/deform/projective.ts).
  Clicking an image puts a box with handles around the active layer's contents (a selection is
  floated first). Dragging:
    inside             moves
    a corner           resizes; with Shift keeps the proportions; with Ctrl moves only that
                       corner (perspective)
    a side             stretches; with Shift skews along that side
    the rotation bar   rotates around the center
  Apply (Tool Options), Enter or a double-click warps the layer once (one undo step); Cancel,
  Escape or another tool drops the box. The preview outlines the box; the pixels move on Apply.
*/
import type { Tool, ToolContext, ToolEvent } from "./tool.ts";
import type { ImageDocument } from "../image-document.ts";
import type { ViewTransform } from "../../render/image-view.ts";
import { CMD } from "../../ui/shell/commands.ts";
import { toolActions } from "../../ui/panels/tool-options.ts";
import { activeLayer } from "../../core/doc/image-doc.ts";
import { float, floatingIndex } from "../../core/select/floating.ts";
import { maskBounds } from "../../core/image/raster.ts";
import { quadMatrix, warpProjective, type Point } from "../../core/deform/projective.ts";

interface Box { image: ImageDocument; src: { x: number; y: number; w: number; h: number }; q: Point[] }

const HANDLE = 5;

export function deformTool(ctx: ToolContext): Tool {
  let box: Box | null = null;
  let drag: { kind: string; index: number; start: Point; q0: Point[] } | null = null;

  const begin = (image: ImageDocument) => {
    const doc = image.doc;
    if (doc.selection && floatingIndex(doc) < 0) ctx.ed.run("Float", (d) => float(d, ctx.colors.bg), image);
    const layer = activeLayer(doc);
    const alpha = { width: doc.width, height: doc.height, data: new Uint8Array(doc.width * doc.height) };
    for (let i = 0; i < alpha.data.length; i++) alpha.data[i] = layer.raster.data[i * 4 + 3];
    const b = maskBounds(alpha) ?? { minX: 0, minY: 0, maxX: doc.width - 1, maxY: doc.height - 1 };
    const src = { x: b.minX, y: b.minY, w: b.maxX - b.minX + 1, h: b.maxY - b.minY + 1 };
    box = { image, src, q: [[src.x, src.y], [src.x + src.w, src.y], [src.x + src.w, src.y + src.h], [src.x, src.y + src.h]] };
    image.changed({});
  };

  const apply = () => {
    if (!box) return;
    const b = box;
    box = null;
    ctx.ed.run("Deformation", (d) => {
      const layer = activeLayer(d);
      const m = quadMatrix(b.src, b.q);
      layer.raster = warpProjective(layer.raster, m, d.width, d.height, true);
    }, b.image);
  };
  const cancel = () => { const i = box?.image; box = null; i?.changed({}); };
  toolActions[CMD.TOOL_DEFORMATION] = { apply, cancel };
  window.addEventListener("keydown", (e) => {
    if (!box) return;
    if (e.key === "Enter") { e.preventDefault(); apply(); }
    else if (e.key === "Escape") { e.preventDefault(); cancel(); }
  });

  const center = (q: Point[]): Point => [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4];
  const rotHandle = (q: Point[]): Point => { const c = center(q); const top: Point = [(q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2]; const dx = top[0] - c[0], dy = top[1] - c[1], l = Math.hypot(dx, dy) || 1; return [top[0] + (dx / l) * 25, top[1] + (dy / l) * 25]; };

  const hit = (e: ToolEvent): { kind: string; index: number } | null => {
    if (!box) return null;
    const s = e.view.scale, r = (HANDLE + 2) / s;
    const near = (p: Point) => Math.abs(e.x - p[0]) <= r && Math.abs(e.y - p[1]) <= r;
    const rh = rotHandle(box.q);
    if (Math.hypot(e.x - rh[0], e.y - rh[1]) <= r * 1.5) return { kind: "rotate", index: 0 };
    for (let i = 0; i < 4; i++) if (near(box.q[i])) return { kind: "corner", index: i };
    for (let i = 0; i < 4; i++) { const a = box.q[i], b = box.q[(i + 1) % 4]; if (near([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])) return { kind: "side", index: i }; }
    // Inside the quad (convex): same side of every edge.
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = box.q[i], b = box.q[(i + 1) % 4], c = (b[0] - a[0]) * (e.y - a[1]) - (b[1] - a[1]) * (e.x - a[0]);
      if (c !== 0) { if (sign && Math.sign(c) !== sign) return null; sign = Math.sign(c); }
    }
    return { kind: "move", index: 0 };
  };

  return {
    down(e) {
      if (e.button !== 0) return;
      if (!box || box.image !== e.image) { begin(e.image); return; }
      const h = hit(e);
      if (!h) return;
      drag = { ...h, start: [e.x, e.y], q0: box.q.map((p) => [p[0], p[1]] as Point) };
    },
    move(e, dragging) {
      if (!dragging || !drag || !box || e.image !== box.image) return;
      const dx = e.x - drag.start[0], dy = e.y - drag.start[1], q0 = drag.q0, q = q0.map((p) => [p[0], p[1]] as Point);
      if (drag.kind === "move") for (const p of q) { p[0] += dx; p[1] += dy; }
      else if (drag.kind === "rotate") {
        const c = center(q0), a0 = Math.atan2(drag.start[1] - c[1], drag.start[0] - c[0]), a1 = Math.atan2(e.y - c[1], e.x - c[0]), da = a1 - a0;
        for (let i = 0; i < 4; i++) { const x = q0[i][0] - c[0], y = q0[i][1] - c[1]; q[i] = [c[0] + x * Math.cos(da) - y * Math.sin(da), c[1] + x * Math.sin(da) + y * Math.cos(da)]; }
      } else if (drag.kind === "corner") {
        const i = drag.index;
        if (e.ctrl) q[i] = [q0[i][0] + dx, q0[i][1] + dy];
        else {
          // Resize against the opposite corner, the box staying a parallelogram.
          const o = q0[(i + 2) % 4], from = q0[i];
          let sx = (from[0] + dx - o[0]) / (from[0] - o[0] || 1), sy = (from[1] + dy - o[1]) / (from[1] - o[1] || 1);
          if (e.shift) sx = sy = Math.max(Math.abs(sx), Math.abs(sy)) * Math.sign(sx || 1);
          for (let k = 0; k < 4; k++) q[k] = [o[0] + (q0[k][0] - o[0]) * sx, o[1] + (q0[k][1] - o[1]) * sy];
        }
      } else if (drag.kind === "side") {
        const i = drag.index, j = (i + 1) % 4;
        if (e.shift) {
          // Skew: the side slides along itself.
          const ax = q0[j][0] - q0[i][0], ay = q0[j][1] - q0[i][1], l = Math.hypot(ax, ay) || 1, t = (dx * ax + dy * ay) / l;
          q[i] = [q0[i][0] + (ax / l) * t, q0[i][1] + (ay / l) * t]; q[j] = [q0[j][0] + (ax / l) * t, q0[j][1] + (ay / l) * t];
        } else {
          // Stretch: the side moves along its normal.
          const ax = q0[j][0] - q0[i][0], ay = q0[j][1] - q0[i][1], l = Math.hypot(ax, ay) || 1, nx = ay / l, ny = -ax / l, t = dx * nx + dy * ny;
          q[i] = [q0[i][0] + nx * t, q0[i][1] + ny * t]; q[j] = [q0[j][0] + nx * t, q0[j][1] + ny * t];
        }
      }
      box.q = q;
      e.view.request();
    },
    up() { drag = null; },
    dblclick() { apply(); },
    deactivate() { cancel(); },
    overlay(g: CanvasRenderingContext2D, t: ViewTransform, image: ImageDocument) {
      if (!box || box.image !== image) return;
      const sp = (p: Point): Point => [t.ox + p[0] * t.scale, t.oy + p[1] * t.scale];
      const pts = box.q.map(sp);
      g.save();
      g.lineWidth = 1;
      for (const [color, off] of [["rgb(0 0 0 / 0.8)", 0], ["rgb(255 255 255 / 0.8)", 1]] as const) {
        g.strokeStyle = color;
        g.setLineDash([4, 4]);
        g.lineDashOffset = off * 4;
        g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
        g.closePath();
        g.stroke();
      }
      g.setLineDash([]);
      const handles: Point[] = [...pts, ...pts.map((p, i) => [(p[0] + pts[(i + 1) % 4][0]) / 2, (p[1] + pts[(i + 1) % 4][1]) / 2] as Point)];
      const rh = sp(rotHandle(box.q)), top: Point = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
      g.strokeStyle = "rgb(0 0 0 / 0.8)";
      g.beginPath(); g.moveTo(top[0], top[1]); g.lineTo(rh[0], rh[1]); g.stroke();
      for (const p of [...handles, rh]) { g.fillStyle = "white"; g.fillRect(p[0] - HANDLE / 2, p[1] - HANDLE / 2, HANDLE, HANDLE); g.strokeRect(p[0] - HANDLE / 2, p[1] - HANDLE / 2, HANDLE, HANDLE); }
      g.restore();
    },
  };
}
