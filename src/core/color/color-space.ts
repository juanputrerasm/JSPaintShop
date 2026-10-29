/*
  Color conversions: HSL (hue 0..360, saturation and lightness 0..1), PSP's HSL on 0..255 as
  its color dialogs show it, CMYK for channel splitting, and luminance.
*/

/** PSP's luminance, 0..255: (30R + 59G + 11B) / 100, integer (Grey Scale, Psp.exe 0x801df0). */
export function luminance(r: number, g: number, b: number): number {
  return Math.trunc((r * 30 + g * 59 + b * 11) / 100);
}

export function rgbToHsl(r: number, g: number, b: number, out: number[] = [0, 0, 0]): number[] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  out[0] = h; out[1] = s; out[2] = l;
  return out;
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

export function hslToRgb(h: number, s: number, l: number, out: number[] = [0, 0, 0]): number[] {
  if (s <= 0) {
    out[0] = out[1] = out[2] = Math.round(l * 255);
    return out;
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q, hh = h / 360;
  out[0] = Math.round(hue2rgb(p, q, hh + 1 / 3) * 255);
  out[1] = Math.round(hue2rgb(p, q, hh) * 255);
  out[2] = Math.round(hue2rgb(p, q, hh - 1 / 3) * 255);
  return out;
}

/** CMYK, each 0..255, as Channel Splitting > Split to CMYK makes its four greyscale images. */
export function rgbToCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const k = 255 - Math.max(r, g, b);
  if (k === 255) return [0, 0, 0, 255];
  const f = 255 / (255 - k);
  return [Math.round((255 - r - k) * f), Math.round((255 - g - k) * f), Math.round((255 - b - k) * f), k];
}

export function cmykToRgb(c: number, m: number, y: number, k: number): [number, number, number] {
  const f = (255 - k) / 255;
  return [Math.round((255 - c) * f), Math.round((255 - m) * f), Math.round((255 - y) * f)];
}

/** "#rrggbb" for the HTML Code field. */
export function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function fromHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/*
  PSP's own HSL, all three on 0..255, in fixed point with values x16 and rounding on the low
  four bits (Psp.exe 0x7ebde0 and 0x7ebf50). The Colors menu's adjustments, Colorize and the
  color dialogs use these, so they are kept exact rather than replaced by float HSL.
*/
const round16 = (v: number) => (v >> 4) + ((v & 15) >= 8 ? 1 : 0);

export function pspRgbToHsl(r: number, g: number, b: number, out: number[] = [0, 0, 0]): number[] {
  const R = r * 16, G = g * 16, B = b * 16;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  let sum = min + max;
  const half = Math.trunc(sum / 2);
  const l = (half >> 4) + ((half & 15) < 8 ? 0 : 1);
  out[2] = l & 255;
  if (max === min) { out[0] = 0; out[1] = 0; return out; }
  if (out[2] > 128) sum = 0x1fe0 - min - max;
  const c = max - min;
  out[1] = round16(Math.trunc((c * 0xff0) / sum)) & 255;
  let h: number;
  if (R === max) h = G < B ? Math.trunc(((Math.trunc(((G - B) * 0x3c0) / c) + 0x1680) * 0x33) / 0x48) : Math.trunc(((G - B) * 0x2a8) / c);
  else if (G === max) h = Math.trunc(((B - R) * 0x2a8) / c) + 0x550;
  else h = Math.trunc(((R - G) * 0x2a8) / c) + 0xaa0;
  out[0] = round16(h) & 255;
  return out;
}

export function pspHslToRgb(h: number, s: number, l: number, out: number[] = [0, 0, 0]): number[] {
  if (s === 0) { out[0] = out[1] = out[2] = l; return out; }
  const m2 = l < 128 ? Math.trunc(((s + 255) * l) / 255) : s - Math.trunc((s * l) / 255) + l;
  const m1 = l * 2 - m2;
  const H = h * 16, lo = m1 * 16, hi = m2 * 16, span = (m2 - m1) * 16;
  // Red: hue + 120 degrees.
  let hr = H + 0x550;
  if (hr > 0xff0) hr = H - 0xaa0;
  let v: number;
  if (hr < 0x2a8) v = Math.trunc(Math.trunc((hr * span * 0x48) / 0x33) / 0x3c0) + lo;
  else if (hr < 0x7f8) v = hi;
  else if (hr < 0xaa0) v = Math.trunc(((0xf00 - Math.trunc((hr * 0x48) / 0x33)) * span) / 0x3c0) + lo;
  else v = lo;
  out[0] = round16(v) & 255;
  // Green: hue.
  if (H < 0x2a8) v = Math.trunc(Math.trunc((span * H * 0x48) / 0x33) / 0x3c0) + lo;
  else if (H < 0x7f8) v = hi;
  else if (H > 0xa9f) v = lo;
  else v = Math.trunc(((0xf00 - Math.trunc((h * 0x480) / 0x33)) * span) / 0x3c0) + lo;
  out[1] = round16(v) & 255;
  // Blue: hue - 120 degrees.
  let hb = H - 0x550;
  if (hb < 0) hb = H + 0xaa0;
  if (hb < 0x2a8) v = Math.trunc((hb * span * 0x48) / 0xbf40) + lo;
  else if (hb < 0x7f8) v = hi;
  else if (hb < 0xaa0) v = Math.trunc(((0xf00 - Math.trunc((hb * 0x48) / 0x33)) * span) / 0x3c0) + lo;
  else v = lo;
  out[2] = round16(v) & 255;
  return out;
}
