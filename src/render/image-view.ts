/*
  An image window's view, on a 2D canvas: the composite at the window's zoom, over PSP's
  transparency checkerboard, with View > Grid lines and View > Rulers along the top and left.

  The canvas stays put (sticky) inside a spacer the size of the zoomed image, so the window's
  own scroll bars scroll the image and the canvas only ever draws what is visible. An image
  smaller than its window is centred in it.

  Image pixels are drawn crisp when zoomed in and smoothed when zoomed out.
*/
import { el } from "../shared/dom.ts";
import type { ImageDocument } from "../app/image-document.ts";
import { zoomScale, stepZoom, fitZoom } from "../core/view/zoom.ts";
import type { Touch } from "../core/edit/history.ts";
import { CHECKER_SIZES, TRANSPARENCY_SCHEMES, type Preferences } from "../core/settings.ts";

export const RULER = 18;

export interface ViewSettings { grid: boolean; rulers: boolean; prefs: Preferences }

/** Where the image is on the canvas: screen = origin + image * scale. */
export interface ViewTransform { ox: number; oy: number; scale: number }

/** Drawn over the image after each redraw (marching ants, tool outlines), in screen pixels. */
export type Overlay = (g: CanvasRenderingContext2D, t: ViewTransform) => void;

export class ImageView {
  readonly element: HTMLElement;
  readonly scroller: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  zoom = 1;
  private spacer: HTMLElement;
  private top: HTMLCanvasElement;
  private left: HTMLCanvasElement;
  /** The composite as a canvas, refreshed by rectangle when the image changes. */
  private source: HTMLCanvasElement;
  private frame = 0;
  readonly doc: ImageDocument;
  readonly overlays: Overlay[] = [];
  private settings: () => ViewSettings;
  private off: () => void;
  private resize: ResizeObserver;

  constructor(doc: ImageDocument, settings: () => ViewSettings) {
    this.doc = doc;
    this.settings = settings;
    this.canvas = el("canvas", { class: "view-canvas" });
    // The canvas sticks inside the spacer, which is as big as the zoomed image, so it stays in view however far it scrolls.
    this.spacer = el("div", { class: "view-spacer" }, this.canvas);
    this.scroller = el("div", { class: "view-scroller", tabindex: "0" }, this.spacer);
    this.top = el("canvas", { class: "ruler ruler-top", height: RULER });
    this.left = el("canvas", { class: "ruler ruler-left", width: RULER });
    this.element = el("div", { class: "image-view" }, el("div", { class: "ruler-corner" }), this.top, this.left, this.scroller);
    this.source = el("canvas");
    this.loadSource();
    this.off = doc.on("changed", (t) => this.onChanged(t));
    this.scroller.addEventListener("scroll", () => this.request());
    this.resize = new ResizeObserver(() => this.layout());
    this.resize.observe(this.scroller);
    this.applySettings();
  }

  dispose(): void {
    this.off();
    this.resize.disconnect();
    cancelAnimationFrame(this.frame);
  }

  /** Rulers on or off, grid changes: after a settings change. */
  applySettings(): void {
    this.element.classList.toggle("with-rulers", this.settings().rulers);
    this.layout();
  }

  /* The composite as shown: Colors > View Palette Transparency clears the transparent entry's color. */
  private shownPixels(): ImageData {
    const c = this.doc.composite, d = this.doc.doc, t = d.transparentIndex;
    if (!this.doc.viewPaletteTransparency || t === undefined || !d.palette) return new ImageData(c.data, c.width, c.height);
    const out = new Uint8ClampedArray(c.data), p = d.palette;
    for (let i = 0; i < out.length; i += 4) if (out[i] === p[t * 3] && out[i + 1] === p[t * 3 + 1] && out[i + 2] === p[t * 3 + 2]) out[i + 3] = 0;
    return new ImageData(out, c.width, c.height);
  }

  private loadSource(): void {
    const c = this.doc.composite;
    this.source.width = c.width;
    this.source.height = c.height;
    this.source.getContext("2d")!.putImageData(this.shownPixels(), 0, 0);
  }

  private onChanged(touch: Touch): void {
    const c = this.doc.composite;
    if (touch.image || this.source.width !== c.width || this.source.height !== c.height || !touch.pixels) {
      this.loadSource();
      this.layout();
      return;
    }
    const r = touch.pixels;
    this.source.getContext("2d")!.putImageData(this.shownPixels(), 0, 0, r.minX, r.minY, r.maxX - r.minX + 1, r.maxY - r.minY + 1);
    this.request();
  }

  get scale(): number {
    return zoomScale(this.zoom);
  }

  /** The zoomed image's size on screen. */
  private zoomedSize(): { w: number; h: number } {
    return { w: Math.max(1, Math.round(this.doc.doc.width * this.scale)), h: Math.max(1, Math.round(this.doc.doc.height * this.scale)) };
  }

  /** Where the image's top-left corner is in the canvas (scrolled, or centred when it fits). */
  private origin(): { x: number; y: number } {
    const { w, h } = this.zoomedSize();
    const cw = this.scroller.clientWidth, ch = this.scroller.clientHeight;
    return {
      x: w <= cw ? Math.floor((cw - w) / 2) : -this.scroller.scrollLeft,
      y: h <= ch ? Math.floor((ch - h) / 2) : -this.scroller.scrollTop,
    };
  }

  /** Image coordinates (fractional) of a point on the screen. */
  toImage(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.scroller.getBoundingClientRect();
    const o = this.origin();
    return { x: (clientX - r.left - o.x) / this.scale, y: (clientY - r.top - o.y) / this.scale };
  }

  /*
    Set the zoom, keeping the image point under `anchor` (a screen point) where it is; with no
    anchor, the centre of the view stays put.
  */
  setZoom(z: number, anchor?: { clientX: number; clientY: number }): void {
    if (z === this.zoom) return;
    const r = this.scroller.getBoundingClientRect();
    const ax = anchor ? anchor.clientX - r.left : this.scroller.clientWidth / 2;
    const ay = anchor ? anchor.clientY - r.top : this.scroller.clientHeight / 2;
    const p = this.toImage(r.left + ax, r.top + ay);
    this.zoom = z;
    this.layout();
    this.scroller.scrollLeft = p.x * this.scale - ax;
    this.scroller.scrollTop = p.y * this.scale - ay;
    this.request();
  }

  stepZoom(steps: number, anchor?: { clientX: number; clientY: number }): void {
    this.setZoom(stepZoom(this.zoom, steps), anchor);
  }

  /** The largest zoom that shows the whole image in a space this big (a new window's first zoom). */
  fitZoom(spaceW: number, spaceH: number): number {
    return fitZoom(this.doc.doc.width, this.doc.doc.height, spaceW, spaceH);
  }

  /** The window body size that shows the whole image at this zoom (Window > Fit to Image). */
  contentSize(): { w: number; h: number } {
    const { w, h } = this.zoomedSize();
    const extra = this.settings().rulers ? RULER : 0;
    return { w: w + extra, h: h + extra };
  }

  scrollBy(dx: number, dy: number): void {
    this.scroller.scrollLeft += dx;
    this.scroller.scrollTop += dy;
  }

  private layout(): void {
    const { w, h } = this.zoomedSize();
    this.spacer.style.width = `${w}px`;
    this.spacer.style.height = `${h}px`;
    const dpr = window.devicePixelRatio || 1;
    const cw = this.scroller.clientWidth, ch = this.scroller.clientHeight;
    for (const [c, width, height] of [[this.canvas, cw, ch], [this.top, cw, RULER], [this.left, RULER, ch]] as const) {
      c.style.width = `${width}px`;
      c.style.height = `${height}px`;
      if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) { c.width = Math.round(width * dpr); c.height = Math.round(height * dpr); }
    }
    this.request();
  }

  request(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  }

  private draw(): void {
    const g = this.canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const cw = this.scroller.clientWidth, ch = this.scroller.clientHeight;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    const o = this.origin();
    const { w, h } = this.zoomedSize();
    // What of the image is on screen.
    const x0 = Math.max(0, o.x), y0 = Math.max(0, o.y), x1 = Math.min(cw, o.x + w), y1 = Math.min(ch, o.y + h);
    if (x1 > x0 && y1 > y0) {
      this.checker(g, x0, y0, x1, y1);
      g.imageSmoothingEnabled = this.scale < 1;
      g.imageSmoothingQuality = "high";
      g.drawImage(this.source, o.x, o.y, w, h);
      if (this.settings().grid) this.grid(g, o, x0, y0, x1, y1);
    }
    for (const f of this.overlays) { g.save(); f(g, { ox: o.x, oy: o.y, scale: this.scale }); g.restore(); }
    if (this.settings().rulers) this.rulers(o);
  }

  /* The checkerboard, fixed to the screen like PSP's, under the visible part of the image. */
  private checker(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
    // Preferences > Transparency: the grid size and the scheme's two colors (or the custom pair).
    const t = this.settings().prefs.transparency, CHECK = CHECKER_SIZES[t.size];
    const scheme = TRANSPARENCY_SCHEMES[t.scheme], custom = t.scheme === TRANSPARENCY_SCHEMES.length - 1;
    g.fillStyle = custom ? t.color1 : scheme[1];
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.fillStyle = custom ? t.color2 : scheme[2];
    for (let y = Math.floor(y0 / CHECK) * CHECK; y < y1; y += CHECK) {
      for (let x = Math.floor(x0 / CHECK) * CHECK + ((y / CHECK) % 2 ? CHECK : 0); x < x1; x += CHECK * 2) {
        const ax = Math.max(x, x0), ay = Math.max(y, y0);
        g.fillRect(ax, ay, Math.min(x + CHECK, x1) - ax, Math.min(y + CHECK, y1) - ay);
      }
    }
  }

  private grid(g: CanvasRenderingContext2D, o: { x: number; y: number }, x0: number, y0: number, x1: number, y1: number): void {
    // Preferences > Rulers and Units: spacing in the grid units (inches and cm by the image's resolution).
    const r = this.settings().prefs.rulers, dpi = this.doc.doc.dpi;
    const unit = r.gridUnits === 1 ? dpi : r.gridUnits === 2 ? dpi / 2.54 : 1;
    const sx = r.gridX * unit * this.scale, sy = r.gridY * unit * this.scale;
    if (sx < 4 || sy < 4) return;
    g.save();
    g.beginPath();
    g.strokeStyle = r.gridColor;
    g.lineWidth = 1;
    for (let x = o.x + Math.ceil((x0 - o.x) / sx) * sx; x < x1; x += sx) { g.moveTo(Math.round(x) + 0.5, y0); g.lineTo(Math.round(x) + 0.5, y1); }
    for (let y = o.y + Math.ceil((y0 - o.y) / sy) * sy; y < y1; y += sy) { g.moveTo(x0, Math.round(y) + 0.5); g.lineTo(x1, Math.round(y) + 0.5); }
    g.stroke();
    g.restore();
  }

  /* Rulers in pixels, numbered every 50, 100... so labels never crowd. */
  private rulers(o: { x: number; y: number }): void {
    const dpr = window.devicePixelRatio || 1;
    const styles = getComputedStyle(this.element);
    const face = styles.getPropertyValue("--face-2") || "#f7f6f4", ink = styles.getPropertyValue("--text") || "#000";
    const steps = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
    const label = steps.find((s) => s * this.scale >= 50) ?? 10000;
    const tick = steps.find((s) => s * this.scale >= 5) ?? label;
    for (const [c, horizontal] of [[this.top, true], [this.left, false]] as const) {
      const g = c.getContext("2d")!;
      const len = horizontal ? c.width / dpr : c.height / dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = face;
      g.fillRect(0, 0, horizontal ? len : RULER, horizontal ? RULER : len);
      g.strokeStyle = ink;
      g.fillStyle = ink;
      g.font = "9px system-ui, sans-serif";
      g.beginPath();
      const start = horizontal ? o.x : o.y;
      const first = Math.ceil(-start / this.scale / tick) * tick;
      for (let v = first; start + v * this.scale < len; v += tick) {
        const p = Math.round(start + v * this.scale) + 0.5;
        const size = v % label === 0 ? RULER : v % (tick * 5) === 0 ? 8 : 4;
        if (horizontal) { g.moveTo(p, RULER); g.lineTo(p, RULER - size); }
        else { g.moveTo(RULER, p); g.lineTo(RULER - size, p); }
        if (v % label === 0) {
          if (horizontal) g.fillText(String(v), p + 2, 9);
          else { g.save(); g.translate(9, p + 2); g.rotate(Math.PI / 2); g.fillText(String(v), 0, 0); g.restore(); }
        }
      }
      g.stroke();
    }
  }
}
