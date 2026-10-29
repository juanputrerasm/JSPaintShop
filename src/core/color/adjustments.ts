/*
  Color adjustments: the Colors menu's (Adjust, Colorize, Grey Scale, Negative, Posterize,
  Solarize, Histogram Functions) and the nine adjustment layers (Layers > New Adjustment
  Layer: Brightness/Contrast, Channel Mixer, Color Balance, Curves, Hue/Saturation, Invert,
  Levels, Posterize, Threshold).

  Each takes RGBA pixels and changes their color in place; alpha is never touched. The Colors
  menu's adjustments follow Psp.exe exactly (docs/PSP_EXE_ANALYSIS.md section 3): integer
  tables, PSP's own HSL, its truncations.

  Most adjustments are per-channel tables (lut), built once; the rest work per pixel in HSL.
*/
import { luminance, pspHslToRgb, pspRgbToHsl } from "./color-space.ts";

export type Adjustment =
  | { type: "brightnessContrast"; brightness: number; contrast: number }
  | { type: "gamma"; red: number; green: number; blue: number }
  | { type: "highlightMidtoneShadow"; dynamic: boolean; shadow: number; midtone: number; highlight: number }
  | { type: "hueSaturationLightness"; hue: number; saturation: number; lightness: number }
  | { type: "hueMap"; targets: number[]; saturation: number; lightness: number }
  /** The Hue/Saturation adjustment layer: [hue°, saturation, lightness] each; ranges add [h, s, l, b0, b1, b2, b3]. */
  | { type: "hueSaturation"; colorize: boolean; master: number[]; colorizeValues: number[]; ranges: number[][] }
  | { type: "redGreenBlue"; red: number; green: number; blue: number }
  | { type: "colorize"; hue: number; saturation: number }
  | { type: "greyScale" }
  | { type: "negative" }
  | { type: "invert" }
  | { type: "posterize"; levels: number }
  | { type: "solarize"; threshold: number }
  | { type: "threshold"; threshold: number }
  | { type: "channelMixer"; red: number[]; green: number[]; blue: number[]; monochrome: boolean }
  | { type: "colorBalance"; shadows: number[]; midtones: number[]; highlights: number[]; preserveLuminosity: boolean }
  | { type: "curves"; rgb: number[][]; red: number[][]; green: number[][]; blue: number[][] }
  | { type: "levels"; rgb: LevelsChannel; red: LevelsChannel; green: LevelsChannel; blue: LevelsChannel }
  | { type: "lut"; red: Uint8Array; green: Uint8Array; blue: Uint8Array };

/** Input black, input white, gamma, output black, output white. */
export type LevelsChannel = [number, number, number, number, number];

export const ADJUSTMENT_NAMES: Record<Adjustment["type"], string> = {
  brightnessContrast: "Brightness/Contrast", gamma: "Gamma Correction", highlightMidtoneShadow: "Highlight/Midtone/Shadow",
  hueSaturationLightness: "Hue/Saturation/Lightness", hueSaturation: "Hue/Saturation", hueMap: "Hue Map", redGreenBlue: "Red/Green/Blue", colorize: "Colorize",
  greyScale: "Grey Scale", negative: "Negative Image", invert: "Invert", posterize: "Posterize", solarize: "Solarize",
  threshold: "Threshold", channelMixer: "Channel Mixer", colorBalance: "Color Balance", curves: "Curves", levels: "Levels", lut: "Adjust",
};

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

function table(f: (v: number) => number): Uint8Array {
  const t = new Uint8Array(256);
  for (let v = 0; v < 256; v++) t[v] = clamp(f(v));
  return t;
}

/* A smooth curve through control points (x, y in 0..255), monotone cubic so it never overshoots. */
export function curveTable(points: number[][]): Uint8Array {
  const p = [...points].sort((a, b) => a[0] - b[0]);
  if (p.length === 0) return table((v) => v);
  if (p.length === 1) return table(() => p[0][1]);
  const n = p.length;
  const d = p.slice(0, -1).map((a, i) => (p[i + 1][1] - a[1]) / Math.max(1e-6, p[i + 1][0] - a[0]));
  const m = p.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  return table((x) => {
    if (x <= p[0][0]) return p[0][1];
    if (x >= p[n - 1][0]) return p[n - 1][1];
    let i = 0;
    while (x > p[i + 1][0]) i++;
    const h = p[i + 1][0] - p[i][0], t = (x - p[i][0]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * p[i + 1][1] + (t3 - t2) * h * m[i + 1];
  });
}

function levelsTable([inB, inW, gamma, outB, outW]: LevelsChannel): Uint8Array {
  return table((v) => {
    const t = Math.min(1, Math.max(0, (v - inB) / Math.max(1, inW - inB)));
    return outB + Math.pow(t, 1 / Math.max(0.01, gamma)) * (outW - outB);
  });
}

const trunc = Math.trunc;

/* Brightness/Contrast as Psp.exe 0x7fd5a0 builds it. */
export function brightnessContrastTable(b: number, c: number): Uint8Array {
  const t = new Uint8Array(256);
  if (c < 0) {
    const k = trunc((-c * 127) / 100);
    const step = (255 - 2 * k) / 255;
    let v = k + 1;
    for (let i = 0; i < 256; i++, v += step) t[i] = clamp(trunc(v) + b);
    return t;
  }
  const k = trunc((c * 127) / 100), hi = 255 - k;
  const ct = new Uint8Array(256);
  const step = 255 / (hi - k);
  let v = 0;
  for (let j = k + 1; j < hi; j++, v += step) ct[j] = trunc(v);
  for (let j = hi; j < 256; j++) ct[j] = 255;
  for (let i = 0; i < 256; i++) t[i] = ct[clamp(i + b)];
  return t;
}

function gammaTable(g: number): Uint8Array {
  const e = 1 / Math.max(0.0001, g), norm = 255 / Math.pow(255, e);
  return table((i) => trunc(Math.pow(i, e) * norm + 0.5));
}

/* Highlight/Midtone/Shadow, Linear method (Psp.exe 0x7fe4d0). */
export function hmsLinearTable(highlight: number, midtone: number, shadow: number): Uint8Array {
  const t = new Uint8Array(256);
  const h = trunc((highlight * 255) / 100);
  for (let i = 1; i < 256; i++) t[i] = i < h ? trunc((i * 256) / h) : 255;
  for (let i = 1; i < 255; i++) if (t[i] > 96 && t[i] < 160) t[i] = clamp(t[i] - 50 + midtone);
  const s = trunc((shadow * 255) / 100);
  for (let i = 1; i < 255; i++) t[i] = t[i] < s ? 0 : trunc(((t[i] - s) * 256) / (256 - s));
  return t;
}

/* Per-channel tables for the adjustments that have them; null for the per-pixel ones. */
/*
  Color Balance (Psp.exe 0x4243e0): one table per channel from the highlights, midtones and
  shadows values (each −100..100, index 0 cyan/red, 1 magenta/green, 2 yellow/blue).

  Stage 1, input levels. Without Preserve Luminosity: black = −shadow when the shadow is
  negative, white = 255 − highlight when the highlight is positive, and a gamma g from a target
  v for the middle (below); entries between black and white are trunc(x^g·255) with
  x = trunc((i·255 − black·255) / (white − black)) / 255. With it, only the differences
  between the channels count: black = max(shadows) − shadow, white = min(highlights) −
  highlight + 255, and the entries are the integer trunc((i·255 − black·255) / (white − black)).

  The stage 1 target (no Preserve Luminosity), with u = (white + black)·0.5 and
  f(u) = u < 127.5 ? (127.5 − u)·0.57 + 127.5 : 127.5 − (u − 127.5)·0.63:
    highlight ≥ 0, shadow ≤ 0:  v = f(u)
    highlight < 0, shadow > 0:  w = highlight + shadow, v = 127.5 + w·(w < 0 ? 0.315 : 0.285)
    otherwise:                  v = f(u) + 0.33·min(highlight, 0) + 0.24·max(shadow, 0)
  and g = ln(v/255) / ln(0.5), so the middle input lands on v.

  Stage 2, midtones: each entry becomes trunc((T[i]/255)^g·255) with g from a target m:
  without Preserve Luminosity m = 127.5 + midtone·(midtone < 0 ? 0.645 : 0.535); with it, the
  largest midtone gets hi = trunc(128 + 53F), the smallest lo = trunc(128 − 64F) for
  F = (max − min)·0.005, and the middle one 128 ± (hi − lo)·|its distance from
  min + trunc((max − min)/2)| / (max − min) (integer), or 128 when all are equal.
*/
export function colorBalanceTables(highlights: number[], midtones: number[], shadows: number[], preserve: boolean): [Uint8Array, Uint8Array, Uint8Array] {
  const inv = 0.00392156862745098, lnHalf = Math.log(0.5);
  const x = Array.from({ length: 256 }, (_, i) => i * inv);
  const gammaFor = (v: number) => Math.log(v * inv) / lnHalf;
  const f = (u: number) => (u < 127.5 ? (127.5 - u) * 0.5700000000000001 + 127.5 : 127.5 - (u - 127.5) * 0.63);
  const out: Uint8Array[] = [];
  const mxS = Math.max(...shadows), mnH = Math.min(...highlights);
  // Stage 2's midtone targets with Preserve Luminosity.
  const mx = Math.max(...midtones), mn = Math.min(...midtones), range = mx - mn;
  const F = range * 0.005, lo = Math.trunc(128 - F * 64), hi = Math.trunc(F * 53 + 128);
  const middle = midtones[0] !== mx && midtones[0] !== mn ? midtones[0] : midtones[1] === mx || midtones[1] === mn ? midtones[2] : midtones[1];
  const half = mn + Math.trunc(range / 2);
  const m = range === 0 ? 128 : half > middle ? 128 - Math.trunc(((hi - lo) * (half - middle)) / range) : Math.trunc(((hi - lo) * (middle - half)) / range) + 128;
  for (let k = 0; k < 3; k++) {
    const h = Math.trunc(highlights[k]), md = Math.trunc(midtones[k]), sh = Math.trunc(shadows[k]);
    const t = new Uint8Array(256);
    let black: number, white: number, g = 1;
    if (preserve) { black = mxS - sh; white = mnH - h + 255; }
    else {
      black = sh < 0 ? -sh : 0; white = 255 - Math.max(h, 0);
      let v: number;
      if (h >= 0 && sh <= 0) v = f((white + black) * 0.5);
      else if (h < 0 && sh > 0) { const w = h + sh; v = w < 0 ? w * 0.315 + 127.5 : w * 0.28500000000000003 + 127.5; }
      else {
        v = f((white + black) * 0.5);
        if (h < 0) v -= h * -0.33;
        if (sh > 0) v = sh * 0.24 + v;
      }
      g = gammaFor(v);
    }
    for (let i = 0; i < 256; i++) {
      if (i <= black) t[i] = 0;
      else if (i >= white) t[i] = 255;
      else {
        const idx = Math.trunc((i * 255 - black * 255) / (white - black));
        t[i] = preserve ? idx : Math.trunc(Math.pow(x[idx], g) * 255);
      }
    }
    const target = preserve ? (md === mx ? hi : md === mn ? lo : m) : md * (md < 0 ? 0.645 : 0.535) + 127.5;
    const g2 = gammaFor(target);
    for (let i = 0; i < 256; i++) t[i] = Math.trunc(Math.pow(x[t[i]], g2) * 255);
    out.push(t);
  }
  return out as [Uint8Array, Uint8Array, Uint8Array];
}

/* The last tables built for each kind of settings: an adjustment layer applies row by row. */
const built = new Map<string, { key: string; value: unknown }>();
function memo<T>(a: Adjustment, make: () => T): T {
  const key = JSON.stringify(a), hit = built.get(a.type);
  if (hit && hit.key === key) return hit.value as T;
  const value = make();
  built.set(a.type, { key, value });
  return value;
}

function tables(a: Adjustment): [Uint8Array, Uint8Array, Uint8Array] | null {
  switch (a.type) {
    case "colorBalance": return memo(a, () => colorBalanceTables(a.highlights, a.midtones, a.shadows, a.preserveLuminosity));
    case "brightnessContrast": { const t = brightnessContrastTable(a.brightness, a.contrast); return [t, t, t]; }
    case "gamma": return [gammaTable(a.red), gammaTable(a.green), gammaTable(a.blue)];
    case "highlightMidtoneShadow": {
      if (a.dynamic) return null;
      const t = hmsLinearTable(a.highlight, a.midtone, a.shadow);
      return [t, t, t];
    }
    case "redGreenBlue": return [a.red, a.green, a.blue].map((p) => table((v) => v + trunc((v * p) / 100))) as [Uint8Array, Uint8Array, Uint8Array];
    case "negative":
    case "invert": { const t = table((v) => 255 - v); return [t, t, t]; }
    case "posterize": {
      const n = Math.max(2, Math.min(255, Math.round(a.levels)));
      const t = table((v) => Math.min(255, trunc(trunc(v / (256 / n)) * (255 / (n - 1)))));
      return [t, t, t];
    }
    case "solarize": { const t = table((v) => (v > a.threshold ? 255 - v : v)); return [t, t, t]; }
    case "curves": {
      const all = curveTable(a.rgb);
      return [a.red, a.green, a.blue].map((c) => { const own = curveTable(c); return table((v) => all[own[v]]); }) as [Uint8Array, Uint8Array, Uint8Array];
    }
    case "levels": {
      const all = levelsTable(a.rgb);
      return [a.red, a.green, a.blue].map((c) => { const own = levelsTable(c); return table((v) => all[own[v]]); }) as [Uint8Array, Uint8Array, Uint8Array];
    }
    case "lut": return [a.red, a.green, a.blue];
    default: return null;
  }
}

/* Dynamic Highlight/Midtone/Shadow's lightness table from the image's own range; null when the range is under 9. */
export function hmsDynamicTable(d: Uint8ClampedArray, highlight: number, midtone: number, shadow: number, from = 0, to = d.length / 4): Uint8Array | null {
  const hsl = [0, 0, 0];
  let lo = 255, hi = 0;
  for (let i = from * 4; i < to * 4; i += 4) {
    pspRgbToHsl(d[i], d[i + 1], d[i + 2], hsl);
    if (hsl[2] > hi) hi = hsl[2];
    if (hsl[2] < lo) lo = hsl[2];
  }
  if (hi - lo < 9) return null;
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) t[i] = i;
  const mid = (lo + hi) / 2, w = (hi - mid) / 2, k = Math.log(4) / (w * w);
  const bump = (dist: number, amount: number) => trunc(Math.exp(-dist * dist * k) * amount);
  for (let l = lo; l <= hi; l++) t[l] = clamp(bump(mid - l, midtone) + bump(lo - l, shadow) + l + bump(hi - l, highlight));
  return t;
}

/** Apply `a` to pixels `from` to `to` (pixel indexes) of `d`. */
export function applyAdjustment(d: Uint8ClampedArray, a: Adjustment, from = 0, to = d.length / 4): void {
  if (a.type === "highlightMidtoneShadow" && a.dynamic) {
    const lt = hmsDynamicTable(d, a.highlight, a.midtone, a.shadow, from, to);
    if (!lt) return;
    const hsl = [0, 0, 0], c = [0, 0, 0];
    for (let i = from * 4; i < to * 4; i += 4) {
      pspRgbToHsl(d[i], d[i + 1], d[i + 2], hsl);
      const l = lt[hsl[2]];
      pspHslToRgb(hsl[0], l === 0 || l === 255 ? 0 : hsl[1], l, c);
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
    }
    return;
  }
  if (a.type === "hueSaturationLightness" || a.type === "hueMap" || a.type === "colorize") { pspHslAdjust(d, a, from, to); return; }
  if (a.type === "hueSaturation") { hueSaturationLayer(d, a, from, to); return; }
  const t = tables(a);
  if (t) {
    const [r, g, b] = t;
    for (let i = from * 4; i < to * 4; i += 4) { d[i] = r[d[i]]; d[i + 1] = g[d[i + 1]]; d[i + 2] = b[d[i + 2]]; }
    return;
  }
  for (let i = from * 4; i < to * 4; i += 4) {
    const R = d[i], G = d[i + 1], B = d[i + 2];
    switch (a.type) {
      case "greyScale": { const y = luminance(R, G, B); d[i] = d[i + 1] = d[i + 2] = y; break; }
      case "threshold": { const y = luminance(R, G, B) >= a.threshold ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = y; break; }
      case "channelMixer": {
        // JLayer 0x824420: one integer division per output channel, then clipped.
        const mix = (m: number[]) => clamp(Math.trunc((R * m[0] + G * m[1] + B * m[2] + m[3] * 255) / 100));
        if (a.monochrome) { const y = mix(a.red); d[i] = d[i + 1] = d[i + 2] = y; }
        else { d[i] = mix(a.red); d[i + 1] = mix(a.green); d[i + 2] = mix(a.blue); }
        break;
      }
    }
  }
}

/** The Hue/Saturation ranges' names and default bounds (Psp.exe 0x42fc90). */
export const HUE_RANGES: [string, number[]][] = [
  ["Reds", [315, 345, 15, 45]], ["Yellows", [15, 45, 75, 105]], ["Greens", [75, 105, 135, 165]],
  ["Cyans", [135, 165, 195, 225]], ["Blues", [195, 225, 255, 285]], ["Magentas", [255, 285, 315, 345]],
];

/*
  The Hue/Saturation adjustment layer's tables (Psp.exe 0x425fe0), one entry per hue degree:
  every entry starts at the master values (the colorize values when colorizing, without the
  ranges). A range with any nonzero value adds, over its bounds b0 < b1 < b2 < b3 (wrapping at
  360, each stretch L degrees long): trunc(v·(k − b0)/L) rising from b0, v from b1 to b2, and
  trunc(v·n/L) falling from b2 (n counting down from trunc(L)). Saturation is then ×255/100
  (integer) and lightness is held to −100..100.
*/
export function hueSaturationTables(a: Adjustment & { type: "hueSaturation" }): [Int32Array, Int32Array, Int32Array] {
  const hue = new Int32Array(360), sat = new Int32Array(360), light = new Int32Array(360);
  const base = a.colorize ? a.colorizeValues : a.master;
  hue.fill(Math.trunc(base[0])); sat.fill(Math.trunc(base[1])); light.fill(Math.trunc(base[2]));
  const span = (from: number, to: number) => (from > to ? 360 - (from - to) : to - from);
  if (!a.colorize) for (const r of a.ranges) {
    const [vh, vs, vl, b0, b1, b2, b3] = r.map(Math.trunc);
    if (!vh && !vs && !vl) continue;
    const add = (k: number, h: number, s: number, l: number) => { const i = k % 360; hue[i] += h; sat[i] += s; light[i] += l; };
    let L = span(b0, b1);
    for (let k = b0; k < b0 + Math.trunc(L); k++) { const t = (k - b0) / L; add(k, Math.trunc(vh * t), Math.trunc(vs * t), Math.trunc(vl * t)); }
    for (let k = b1; k < b1 + span(b1, b2); k++) add(k, vh, vs, vl);
    L = span(b2, b3);
    for (let k = b2, n = Math.trunc(L); k < b2 + Math.trunc(L); k++, n--) { const t = n / L; add(k, Math.trunc(vh * t), Math.trunc(vs * t), Math.trunc(vl * t)); }
  }
  for (let i = 0; i < 360; i++) { sat[i] = trunc((sat[i] * 255) / 100); light[i] = Math.max(-100, Math.min(100, light[i])); }
  return [hue, sat, light];
}

/*
  JLayer 0x824770: by the pixel's hue in degrees d = trunc(H·359/255), the new hue is
  ((hue[d] + 360 + d) mod 360)·255/359 and the saturation S + sat[d] (held to 0..255); when
  colorizing, d is (hue[0] + 360) mod 360 and the saturation is sat[d] alone. Back to RGB with
  the same lightness, each channel then moves toward 0 (lightness < 0: c + c·l/100) or 255
  (c + (255 − c)·l/100), integer.
*/
function hueSaturationLayer(d: Uint8ClampedArray, a: Adjustment & { type: "hueSaturation" }, from: number, to: number): void {
  const [hue, sat, light] = memo(a, () => hueSaturationTables(a));
  const hsl = [0, 0, 0], c = [0, 0, 0];
  for (let i = from * 4; i < to * 4; i += 4) {
    pspRgbToHsl(d[i], d[i + 1], d[i + 2], hsl);
    let deg: number, h: number, s: number;
    if (a.colorize) { deg = (hue[0] + 360) % 360; h = trunc((deg * 255) / 359) & 255; s = sat[deg]; }
    else { deg = trunc((hsl[0] * 359) / 255); h = trunc((((hue[deg] + 360 + deg) % 360) * 255) / 359) & 255; s = sat[deg] + hsl[1]; }
    pspHslToRgb(h, s < 0 ? 0 : s > 255 ? 255 : s, hsl[2], c);
    const l = light[deg];
    for (let k = 0; k < 3; k++) d[i + k] = l < 0 ? c[k] + trunc((c[k] * l) / 100) : c[k] + trunc(((255 - c[k]) * l) / 100);
  }
}

/* The adjustments that work in PSP's HSL (Psp.exe 0x7fdb60, 0x6acee0, 0x7fe0d0). */
function pspHslAdjust(d: Uint8ClampedArray, a: Adjustment & { type: "hueSaturationLightness" | "hueMap" | "colorize" }, from: number, to: number): void {
  const hsl = [0, 0, 0], c = [0, 0, 0];
  let hT: Uint8Array | null = null, sT: Uint8Array | null = null, lT: Uint8Array | null = null;
  if (a.type === "hueSaturationLightness") {
    const shift = trunc((a.hue * 255) / 100);
    hT = new Uint8Array(256); sT = new Uint8Array(256); lT = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      let h = shift + i;
      if (h < 0) h += 255; else if (h > 255) h -= 255;
      hT[i] = h;
      sT[i] = clamp(trunc((i * a.saturation) / 100) + i);
      lT[i] = clamp(trunc((i * a.lightness) / 100) + i);
    }
  }
  const ds = trunc((a.type === "hueMap" ? a.saturation * 255 + 50 : 0) / 100), dl = trunc((a.type === "hueMap" ? a.lightness * 255 + 50 : 0) / 100);
  for (let i = from * 4; i < to * 4; i += 4) {
    pspRgbToHsl(d[i], d[i + 1], d[i + 2], hsl);
    if (a.type === "colorize") pspHslToRgb(a.hue & 255, a.saturation & 255, hsl[2], c);
    else if (a.type === "hueMap") {
      const deg = trunc((hsl[0] * 359) / 255);
      const u = deg + 18 > 359 ? deg - 342 : deg + 18;
      const band = trunc(u / 36);
      let nd = a.targets[band] - band * 36 + deg;
      if (nd < 0) nd += 360; else if (nd > 359) nd -= 360;
      pspHslToRgb(trunc((nd * 255) / 359), clamp(hsl[1] + ds), clamp(hsl[2] + dl), c);
    } else pspHslToRgb(hT![hsl[0]], sT![hsl[1]], lT![hsl[2]], c);
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
  }
}

/*
  Colors > Histogram Functions. Equalize spreads the brightness so every level is about as
  common; Stretch moves the darkest level to black and the brightest to white (ignoring the
  extreme 0.5% at each end). Both are tables built from the image's own histogram.
*/
const ycc = (d: Uint8ClampedArray, i: number) => [
  (306 * d[i] + 601 * d[i + 1] + 117 * d[i + 2]) >> 10,
  (512 * d[i] - 429 * d[i + 1] - 83 * d[i + 2]) >> 10,
  (512 * d[i + 2] - 339 * d[i + 1] - 173 * d[i]) >> 10,
];

/* Map luma through `t` in YCbCr and back (Psp.exe 0x7ffd10, 0x8009e0). */
function mapLuma(d: Uint8ClampedArray, t: Uint8Array, mask?: Uint8Array | null): void {
  for (let p = 0, i = 0; i < d.length; p++, i += 4) {
    if (mask && !mask[p]) continue;
    const [y, cr, cb] = ycc(d, i);
    const Y = t[Math.max(0, Math.min(255, y))];
    d[i] = clamp(Y + ((1400 * cr) >> 10));
    d[i + 1] = clamp(Y - ((714 * cr) >> 10) - ((348 * cb) >> 10));
    d[i + 2] = clamp(Y + ((1770 * cb) >> 10));
  }
}

/** Histogram Equalize: luma through its own cumulative histogram. */
export function equalize(d: Uint8ClampedArray, mask?: Uint8Array | null): void {
  const hist = new Float64Array(256);
  let n = 0;
  for (let p = 0, i = 0; i < d.length; p++, i += 4) { if (mask && !mask[p]) continue; hist[Math.max(0, Math.min(255, ycc(d, i)[0]))]++; n++; }
  const t = new Uint8Array(256);
  let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; t[v] = trunc((acc * 255) / Math.max(1, n)); }
  mapLuma(d, t, mask);
}

/** Histogram Stretch: luma scaled by 255 / range, then the minimum subtracted (as PSP does). */
export function stretch(d: Uint8ClampedArray, mask?: Uint8Array | null): void {
  let lo = 255, hi = 0;
  for (let p = 0, i = 0; i < d.length; p++, i += 4) {
    if (mask && !mask[p]) continue;
    const y = ycc(d, i)[0];
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  const scale = hi > lo ? 255 / (hi - lo) : 1;
  mapLuma(d, table((v) => trunc(v * scale - lo)), mask);
}

/** The adjustment layer types with their starting values (the dialogs' defaults). */
export function defaultAdjustment(type: Adjustment["type"]): Adjustment {
  const ident: number[][] = [[0, 0], [255, 255]];
  const lv: LevelsChannel = [0, 255, 1, 0, 255];
  switch (type) {
    case "brightnessContrast": return { type, brightness: 0, contrast: 0 };
    case "gamma": return { type, red: 1, green: 1, blue: 1 };
    case "highlightMidtoneShadow": return { type, dynamic: false, shadow: 0, midtone: 50, highlight: 100 };
    case "hueSaturationLightness": return { type, hue: 0, saturation: 0, lightness: 0 };
    case "hueMap": return { type, targets: Array.from({ length: 10 }, (_, i) => i * 36), saturation: 0, lightness: 0 };
    case "redGreenBlue": return { type, red: 0, green: 0, blue: 0 };
    case "colorize": return { type, hue: 0, saturation: 128 };
    case "posterize": return { type, levels: 8 };
    case "solarize": return { type, threshold: 128 };
    case "threshold": return { type, threshold: 128 };
    case "channelMixer": return { type, red: [100, 0, 0, 0], green: [0, 100, 0, 0], blue: [0, 0, 100, 0], monochrome: false };
    case "colorBalance": return { type, shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0], preserveLuminosity: true };
    case "hueSaturation": return { type, colorize: false, master: [0, 0, 0], colorizeValues: [0, 25, 0], ranges: HUE_RANGES.map(([, b]) => [0, 0, 0, ...b]) };
    case "curves": return { type, rgb: ident, red: ident, green: ident, blue: ident };
    case "levels": return { type, rgb: [...lv], red: [...lv], green: [...lv], blue: [...lv] };
    case "lut": { const t = table((v) => v); return { type, red: t, green: t, blue: t }; }
    default: return { type } as Adjustment;
  }
}
