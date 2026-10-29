/*
  The marching ants around the selection, crawling, unless Selections > Hide Marquee is on;
  and Masks > View Mask's red overlay where the active layer's mask hides it.
*/
import type { Workspace } from "../workspace.ts";
import type { ImageDocument } from "../image-document.ts";
import type { ImageView, ViewTransform } from "../../render/image-view.ts";
import { outline } from "../../core/select/selection.ts";
import type { Mask } from "../../core/image/raster.ts";
import { activeLayer } from "../../core/doc/image-doc.ts";

const paths = new WeakMap<Mask, Path2D>();
const maskImages = new WeakMap<Mask, HTMLCanvasElement>();
let phase = 0;

function path(m: Mask): Path2D {
  let p = paths.get(m);
  if (!p) {
    p = new Path2D();
    for (const [x0, y0, x1, y1] of outline(m)) { p.moveTo(x0, y0); p.lineTo(x1, y1); }
    paths.set(m, p);
  }
  return p;
}

function maskImage(m: Mask): HTMLCanvasElement {
  let c = maskImages.get(m);
  if (!c) {
    c = document.createElement("canvas");
    c.width = m.width;
    c.height = m.height;
    const img = new ImageData(m.width, m.height);
    for (let i = 0; i < m.data.length; i++) { img.data[i * 4] = 255; img.data[i * 4 + 3] = (255 - m.data[i]) * 0.5; }
    c.getContext("2d")!.putImageData(img, 0, 0);
    maskImages.set(m, c);
  }
  return c;
}

export function marqueeOverlay(view: ImageView, image: ImageDocument): void {
  view.overlays.push((g: CanvasRenderingContext2D, t: ViewTransform) => {
    const doc = image.doc;
    const layer = activeLayer(doc);
    if (image.viewMask && layer.mask) {
      g.imageSmoothingEnabled = t.scale < 1;
      g.drawImage(maskImage(layer.mask), t.ox, t.oy, doc.width * t.scale, doc.height * t.scale);
    }
    const sel = doc.selection;
    if (!sel || image.hideMarquee) return;
    g.translate(t.ox, t.oy);
    g.scale(t.scale, t.scale);
    const p = path(sel);
    g.lineWidth = 1 / t.scale;
    g.setLineDash([4 / t.scale, 4 / t.scale]);
    g.lineDashOffset = -phase / t.scale;
    g.strokeStyle = "#000";
    g.stroke(p);
    g.lineDashOffset = (4 - phase) / t.scale;
    g.strokeStyle = "#fff";
    g.stroke(p);
  });
}

/** The crawl: every view with a visible selection redraws a few times a second. */
export function startMarquee(ws: Workspace): void {
  setInterval(() => {
    phase = (phase + 1) % 8;
    for (const v of ws.views) if (v.doc.doc.selection && !v.doc.hideMarquee) v.request();
  }, 140);
}
