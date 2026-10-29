/*
  Gradients, as PSP 6's Gradient Editor (DIALOG 145) makes them and its .jgd files hold them:
  color stops that are a fixed color or the current foreground or background, opacity stops,
  and between two stops a midpoint where the blend is half way.

  .jgd is Photoshop's gradient file, version 3 ("8BGR"), big-endian:
    "8BGR", version 3, gradient count, then for each gradient
      name (Pascal string), color stop count, per stop: location 0..4096, midpoint 0..100,
        color model (0 RGB, 1 HSB, 8 grey), four 16-bit components, type (0 fixed,
        1 foreground, 2 background)
      opacity stop count, per stop: location, midpoint, opacity 0..255
      six bytes PSP writes as zero
  as read from PSP 6's own stock gradients.

  The fills (Flood Fill's styles): Linear along an angle, Rectangular, Sunburst (circles),
  Radial (around the centre, like a clock hand), each with repeats and a centre point.
*/
import type { Rgba } from "../image/raster.ts";
import { hslToRgb } from "../color/color-space.ts";

export interface ColorStop { at: number; mid: number; kind: "color" | "fg" | "bg"; color: [number, number, number] }
export interface OpacityStop { at: number; mid: number; opacity: number }
export interface Gradient { name: string; colors: ColorStop[]; opacities: OpacityStop[] }

const stop = (at: number, kind: ColorStop["kind"], color: [number, number, number] = [0, 0, 0]): ColorStop => ({ at, mid: 50, kind, color });
const opaque: OpacityStop[] = [{ at: 0, mid: 50, opacity: 255 }, { at: 100, mid: 50, opacity: 255 }];

/* Gradients JSPaintShop always has, whether or not PSP 6's own were imported. */
export const BUILTIN_GRADIENTS: Gradient[] = [
  { name: "Foreground-Background", colors: [stop(0, "fg"), stop(100, "bg")], opacities: opaque },
  { name: "Fading Foreground", colors: [stop(0, "fg"), stop(100, "fg")], opacities: [{ at: 0, mid: 50, opacity: 255 }, { at: 100, mid: 50, opacity: 0 }] },
  { name: "Fading Background", colors: [stop(0, "bg"), stop(100, "bg")], opacities: [{ at: 0, mid: 50, opacity: 255 }, { at: 100, mid: 50, opacity: 0 }] },
  { name: "Black-White", colors: [stop(0, "color", [0, 0, 0]), stop(100, "color", [255, 255, 255])], opacities: opaque },
  { name: "Spectrum", colors: [0, 17, 33, 50, 67, 83, 100].map((at) => stop(at, "color", hslToRgb((at / 100) * 360, 1, 0.5) as [number, number, number])), opacities: opaque },
];

/* Where between two stops (t 0..1) given a midpoint (0..100): the blend reaches half way at the midpoint. */
function bias(t: number, mid: number): number {
  const m = Math.min(0.99, Math.max(0.01, mid / 100));
  return Math.pow(t, Math.log(0.5) / Math.log(m));
}

/** 256 RGBA entries along the gradient, with foreground and background filled in. */
export function gradientTable(g: Gradient, fg: Rgba, bg: Rgba): Uint8ClampedArray {
  const out = new Uint8ClampedArray(256 * 4);
  const cs = [...g.colors].sort((a, b) => a.at - b.at), os = [...g.opacities].sort((a, b) => a.at - b.at);
  const colorOf = (s: ColorStop) => (s.kind === "fg" ? fg : s.kind === "bg" ? bg : s.color);
  for (let i = 0; i < 256; i++) {
    const p = (i / 255) * 100;
    let c: number[];
    if (!cs.length) c = [0, 0, 0];
    else if (p <= cs[0].at) c = [...colorOf(cs[0])];
    else if (p >= cs[cs.length - 1].at) c = [...colorOf(cs[cs.length - 1])];
    else {
      let k = 0;
      while (p > cs[k + 1].at) k++;
      const a = cs[k], b = cs[k + 1], t = bias((p - a.at) / Math.max(1e-6, b.at - a.at), a.mid);
      const ca = colorOf(a), cb = colorOf(b);
      c = [0, 1, 2].map((j) => ca[j] + (cb[j] - ca[j]) * t);
    }
    let o: number;
    if (!os.length) o = 255;
    else if (p <= os[0].at) o = os[0].opacity;
    else if (p >= os[os.length - 1].at) o = os[os.length - 1].opacity;
    else {
      let k = 0;
      while (p > os[k + 1].at) k++;
      const a = os[k], b = os[k + 1], t = bias((p - a.at) / Math.max(1e-6, b.at - a.at), a.mid);
      o = a.opacity + (b.opacity - a.opacity) * t;
    }
    out.set([c[0], c[1], c[2], o], i * 4);
  }
  return out;
}

export type GradientShape = "linear" | "rectangular" | "sunburst" | "radial";

export interface GradientFill {
  shape: GradientShape;
  /** Degrees, for linear and radial. */
  angle: number;
  /** Extra repetitions, 0..999. */
  repeats: number;
  /** Centre, in percent of the area. */
  cx: number;
  cy: number;
  invert: boolean;
}

/*
  The position (0..1) along the gradient for a point in a w x h area: the fill geometry
  shared by Flood Fill and the gradient previews.
*/
export function gradientPosition(f: GradientFill, x: number, y: number, w: number, h: number): number {
  let t: number;
  const cx = (f.cx / 100) * w, cy = (f.cy / 100) * h;
  const a = (f.angle * Math.PI) / 180;
  if (f.shape === "linear") {
    // 0 degrees runs top to bottom, as PSP's angle points; the line spans the area's extent along it.
    const dx = Math.sin(a), dy = -Math.cos(a);
    const half = (Math.abs(dx) * w + Math.abs(dy) * h) / 2;
    t = ((x - w / 2) * dx + (y - h / 2) * dy) / (2 * half || 1) + 0.5;
    t = 1 - t;
  } else if (f.shape === "rectangular") {
    t = Math.max(Math.abs(x - cx) / Math.max(cx, w - cx, 1), Math.abs(y - cy) / Math.max(cy, h - cy, 1));
  } else if (f.shape === "sunburst") {
    const r = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) || 1;
    t = Math.hypot(x - cx, y - cy) / r;
  } else {
    t = ((Math.atan2(x - cx, -(y - cy)) - a) / (2 * Math.PI)) % 1;
    if (t < 0) t += 1;
  }
  t = Math.min(1, Math.max(0, t));
  if (f.repeats > 0) {
    const n = f.repeats + 1;
    const u = t * n;
    const k = Math.floor(u);
    t = k % 2 ? 1 - (u - k) : u - k;
  }
  return f.invert ? 1 - t : t;
}

// ---- .jgd ----------------------------------------------------------------

export function readJgd(b: Uint8Array): Gradient[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== "8BGR") throw new Error("Not a gradient file: no 8BGR signature.");
  if (v.getUint16(4) !== 3) throw new Error(`Gradient file version ${v.getUint16(4)} cannot be read; only version 3.`);
  const count = v.getUint16(6);
  let at = 8;
  const out: Gradient[] = [];
  for (let g = 0; g < count && at < b.length; g++) {
    const len = b[at];
    const name = String.fromCharCode(...b.subarray(at + 1, at + 1 + len));
    at += 1 + len;
    const n = v.getUint16(at); at += 2;
    const colors: ColorStop[] = [];
    for (let i = 0; i < n; i++) {
      const loc = v.getUint32(at), mid = v.getUint32(at + 4), model = v.getUint16(at + 8);
      const c = [v.getUint16(at + 10), v.getUint16(at + 12), v.getUint16(at + 14), v.getUint16(at + 16)];
      const type = v.getUint16(at + 18);
      at += 20;
      let rgb: [number, number, number];
      if (model === 8) { const k = Math.round(c[0] / 257); rgb = [k, k, k]; }
      else if (model === 1) rgb = hslToRgb((c[0] / 65535) * 360, c[1] / 65535, c[2] / 65535 / 2) as [number, number, number];
      else rgb = [Math.round(c[0] / 257), Math.round(c[1] / 257), Math.round(c[2] / 257)];
      colors.push({ at: (loc / 4096) * 100, mid, kind: type === 1 ? "fg" : type === 2 ? "bg" : "color", color: rgb });
    }
    const m = v.getUint16(at); at += 2;
    const opacities: OpacityStop[] = [];
    for (let i = 0; i < m; i++) {
      opacities.push({ at: (v.getUint32(at) / 4096) * 100, mid: v.getUint32(at + 4), opacity: v.getUint16(at + 8) });
      at += 10;
    }
    at += 6;
    out.push({ name, colors, opacities });
  }
  return out;
}

export function writeJgd(gradients: Gradient[]): Uint8Array {
  const parts: number[] = [];
  const u16 = (n: number) => parts.push((n >> 8) & 255, n & 255);
  const u32 = (n: number) => { u16((n >>> 16) & 0xffff); u16(n & 0xffff); };
  parts.push(0x38, 0x42, 0x47, 0x52);
  u16(3);
  u16(gradients.length);
  for (const g of gradients) {
    const name = g.name.slice(0, 255);
    parts.push(name.length, ...[...name].map((c) => Math.min(255, c.charCodeAt(0))));
    u16(g.colors.length);
    for (const s of g.colors) {
      u32(Math.round((s.at / 100) * 4096)); u32(Math.round(s.mid)); u16(0);
      u16(s.color[0] * 257); u16(s.color[1] * 257); u16(s.color[2] * 257); u16(0);
      u16(s.kind === "fg" ? 1 : s.kind === "bg" ? 2 : 0);
    }
    u16(g.opacities.length);
    for (const s of g.opacities) { u32(Math.round((s.at / 100) * 4096)); u32(Math.round(s.mid)); u16(Math.round(s.opacity)); }
    for (let i = 0; i < 6; i++) parts.push(0);
  }
  return Uint8Array.from(parts);
}
