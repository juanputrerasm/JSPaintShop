/*
  The brush engine behind the Paint Brush, Airbrush, Eraser, Clone Brush, Color Replacer and
  Retouch tools, with PSP 6's Brush Tip options:

    Shape     Round, Square, Left Slash, Right Slash, Horizontal, Vertical, or a custom tip
    Size      1..255 pixels across
    Hardness  0..100: how much of the tip is full strength before it fades out
    Opacity   1..100: the most a stroke changes a pixel (unless Build up brush is on)
    Step      1..100: the distance between dabs, in percent of the size
    Density   1..100: the share of the tip's pixels each dab paints (100 is solid)

  A stroke keeps, per pixel, the strongest coverage any dab has given it (or, with Build up,
  coverage that adds up dab over dab), and computes each changed pixel from the layer as it
  was when the stroke began. So a slow stroke at 50% opacity is 50% wherever it went, as in
  PSP, and the tool decides what a covered pixel becomes (paint, erase, clone, retouch).
*/
import type { Mask } from "../image/raster.ts";
import type { Rect } from "../edit/history.ts";

export interface Tip { size: number; data: Float32Array }

export const TIP_SHAPES = ["Round", "Square", "Left Slash", "Right Slash", "Horizontal", "Vertical"] as const;

/** A tip's coverage map, size x size, 0..1. `custom` is a grey tip (custom brushes), scaled to the size. */
export function makeTip(shape: string, size: number, hardness: number, custom?: { size: number; data: Uint8Array }): Tip {
  size = Math.max(1, Math.round(size));
  const data = new Float32Array(size * size);
  const h = Math.min(0.999, Math.max(0, hardness / 100));
  const r = size / 2, thin = Math.max(1, size / 6) / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5 - r) / r, dy = (y + 0.5 - r) / r;
    let d: number;
    if (custom) {
      const sx = Math.floor((x / size) * custom.size), sy = Math.floor((y / size) * custom.size);
      data[y * size + x] = custom.data[sy * custom.size + sx] / 255;
      continue;
    }
    switch (shape) {
      case "Square": d = Math.max(Math.abs(dx), Math.abs(dy)); break;
      // A thin line corner to corner: "\" for Left Slash, "/" for Right Slash.
      case "Left Slash": d = Math.max((Math.abs(dx - dy) / Math.SQRT2) * (r / thin), Math.abs(dx + dy) / 2); break;
      case "Right Slash": d = Math.max((Math.abs(dx + dy) / Math.SQRT2) * (r / thin), Math.abs(dx - dy) / 2); break;
      case "Horizontal": d = Math.max(Math.abs(dx), (Math.abs(dy) * r) / thin); break;
      case "Vertical": d = Math.max((Math.abs(dx) * r) / thin, Math.abs(dy)); break;
      default: d = Math.hypot(dx, dy);
    }
    data[y * size + x] = d <= h ? 1 : d >= 1 ? 0 : 0.5 + 0.5 * Math.cos(((d - h) / (1 - h)) * Math.PI);
  }
  // A one- or two-pixel round tip would vanish under the falloff: keep its centre solid.
  if (size <= 2) data.fill(1);
  return { size, data };
}

export interface StrokeOptions {
  width: number;
  height: number;
  tip: Tip;
  /** 0..1. */
  opacity: number;
  /** Dab spacing in pixels. */
  spacing: number;
  /** 0..1. */
  density: number;
  buildUp: boolean;
  /** Painting stays inside the selection, weighted by it. */
  selection: Mask | null;
  /** A paper texture tiled under the stroke: its grey scales the coverage. */
  paper?: { width: number; height: number; data: Uint8Array } | null;
  /** What a covered pixel becomes: index p, its x and y, and its coverage 0..1. */
  pixel(p: number, x: number, y: number, coverage: number): void;
  /** Called for each dab before its pixels (Smudge and Push carry paint from dab to dab). */
  dab?(cx: number, cy: number, pressure: number): void;
}

export class Stroke {
  readonly coverage: Float32Array;
  readonly bounds: Rect = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  private o: StrokeOptions;
  private last: [number, number] | null = null;
  /** Distance carried over from the last segment, so dabs stay evenly spaced. */
  private carry = 0;
  private seed = 1;

  constructor(o: StrokeOptions) {
    this.o = o;
    this.coverage = new Float32Array(o.width * o.height);
  }

  get touched(): Rect | null {
    return this.bounds.maxX < this.bounds.minX ? null : this.bounds;
  }

  private random(): number {
    this.seed = (Math.imul(this.seed, 1103515245) + 12345) >>> 0;
    return (this.seed >>> 8) / 16777216;
  }

  /** One dab centred on (cx, cy). */
  dabAt(cx: number, cy: number, pressure = 1): void {
    const { tip, width: W, height: H, selection, paper } = this.o;
    this.o.dab?.(cx, cy, pressure);
    const s = tip.size, x0 = Math.round(cx - s / 2), y0 = Math.round(cy - s / 2);
    const strength = this.o.opacity * pressure;
    const dense = this.o.density < 1;
    for (let ty = 0; ty < s; ty++) {
      const y = y0 + ty;
      if (y < 0 || y >= H) continue;
      for (let tx = 0; tx < s; tx++) {
        const x = x0 + tx;
        if (x < 0 || x >= W) continue;
        let a = tip.data[ty * s + tx] * strength;
        if (a <= 0) continue;
        if (dense && this.random() >= this.o.density) continue;
        const p = y * W + x;
        if (selection) a *= selection.data[p] / 255;
        if (paper) a *= paper.data[(y % paper.height) * paper.width + (x % paper.width)] / 255;
        if (a <= 0) continue;
        const old = this.coverage[p];
        const next = this.o.buildUp ? old + a * (1 - old) : Math.max(old, a);
        if (next <= old) continue;
        this.coverage[p] = next;
        this.o.pixel(p, x, y, next);
        if (x < this.bounds.minX) this.bounds.minX = x;
        if (x > this.bounds.maxX) this.bounds.maxX = x;
        if (y < this.bounds.minY) this.bounds.minY = y;
        if (y > this.bounds.maxY) this.bounds.maxY = y;
      }
    }
  }

  /** Start (a single dab) or continue the stroke to (x, y), dabbing every `spacing` pixels. */
  to(x: number, y: number, pressure = 1): void {
    if (!this.last) {
      this.last = [x, y];
      this.dabAt(x, y, pressure);
      return;
    }
    const [lx, ly] = this.last;
    const dist = Math.hypot(x - lx, y - ly);
    const step = Math.max(0.5, this.o.spacing);
    let t = step - this.carry;
    while (t <= dist) {
      this.dabAt(lx + ((x - lx) * t) / dist, ly + ((y - ly) * t) / dist, pressure);
      t += step;
    }
    this.carry = dist - (t - step);
    this.last = [x, y];
  }
}

/** Spacing in pixels from PSP's Step (percent of the size). */
export function spacingFor(size: number, step: number): number {
  return Math.max(1, (size * step) / 100);
}

/*
  PSP 6's brush types (MENU 290): each sets the Brush Tip options to a preset. PSP's own
  values are not documented; these give each type its character.
*/
export const BRUSH_TYPES: Record<string, { shape: string; hardness: number; step: number; density: number; opacity?: number }> = {
  Normal: { shape: "Round", hardness: 50, step: 25, density: 100 },
  Paintbrush: { shape: "Round", hardness: 40, step: 20, density: 100 },
  Pen: { shape: "Round", hardness: 100, step: 10, density: 100 },
  Pencil: { shape: "Round", hardness: 90, step: 15, density: 90, opacity: 90 },
  Marker: { shape: "Square", hardness: 100, step: 10, density: 100, opacity: 80 },
  Crayon: { shape: "Round", hardness: 100, step: 25, density: 45 },
  Chalk: { shape: "Round", hardness: 60, step: 30, density: 60 },
  Charcoal: { shape: "Square", hardness: 30, step: 30, density: 35 },
};
