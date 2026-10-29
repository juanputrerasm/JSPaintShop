/*
  The Retouch tool's 19 modes, as PSP 6 runs them (Psp.exe 0x79eee0 sets a mode up, 0x79f8b0
  computes a dab; docs/PSP_EXE_ANALYSIS.md section 20). `orig` is the layer as the stroke began,
  `s` the coverage 0..1 (tip, opacity, selection), `target` the foreground color.

    Lighten RGB, Darken RGB   each channel + 10 or - 10
    Soften, Sharpen           a 3 x 3 kernel over the neighbours, divided by the weights of the
                              ones counted (rounded): Soften 12 24 12 / 24 50 24 / 12 24 12,
                              Sharpen 0 -1 0 / -1 40 -1 / 0 -1 0
    Emboss                    the pixel up-left minus the pixel down-right, + 128, per channel
    Smudge, Push              carry paint from dab to dab (in the tool)
    Dodge, Burn               paint mid grey (128, 128, 128) in the Dodge or Burn blend mode
    Saturation, Lightness and Hue Up and Down
                              PSP's integer HLS (0..4080; 0x7ec1d0 and 0x7ec310): + or - 480,
                              clamped, hue included (it does not wrap)
    Saturation, Lightness, Hue and Color to Target
                              paint the foreground in the Saturation, Luminance, Hue or Color
                              blend mode

  The result is mixed with the pixel by the coverage. A neighbour counts when it is inside the
  image and, with a selection, inside the selection (PSP counts the neighbours under the dab).
  An addition: right-clicking turns the paired modes around (Lighten and Darken, Dodge and
  Burn, up and down, Soften and Sharpen); PSP's help does not describe a right-button use.
*/
import { blendCover, Blend } from "../layers/blend.ts";
import { RETOUCH_MODES } from "./retouch-modes.ts";

export { RETOUCH_MODES };

const OPPOSITE: Record<string, string> = {
  "Lighten RGB": "Darken RGB", "Darken RGB": "Lighten RGB", Dodge: "Burn", Burn: "Dodge",
  "Saturation Up": "Saturation Down", "Saturation Down": "Saturation Up", "Lightness Up": "Lightness Down",
  "Lightness Down": "Lightness Up", "Hue Up": "Hue Down", "Hue Down": "Hue Up", Soften: "Sharpen", Sharpen: "Soften",
};

export function retouchMode(mode: string, right: boolean): string {
  return right ? OPPOSITE[mode] ?? mode : mode;
}

/* Mode table 0x92c448: the 3 x 3 kernel (rows top to bottom), the bias, and whether to divide by the weights. */
const KERNELS: Record<string, { k: number[]; bias: number; normalize: boolean }> = {
  "Lighten RGB": { k: [0, 0, 0, 0, 1, 0, 0, 0, 0], bias: 10, normalize: false },
  "Darken RGB": { k: [0, 0, 0, 0, 1, 0, 0, 0, 0], bias: -10, normalize: false },
  Soften: { k: [12, 24, 12, 24, 50, 24, 12, 24, 12], bias: 0, normalize: true },
  Sharpen: { k: [0, -1, 0, -1, 40, -1, 0, -1, 0], bias: 0, normalize: true },
  Emboss: { k: [1, 0, 0, 0, 0, 0, 0, 0, -1], bias: 128, normalize: false },
};

/* The HLS shifts (0x79eee0 cases 9-14): hue, saturation, lightness. */
const SHIFTS: Record<string, [number, number, number]> = {
  "Saturation Up": [0, 480, 0], "Saturation Down": [0, -480, 0],
  "Lightness Up": [0, 0, 480], "Lightness Down": [0, 0, -480],
  "Hue Up": [480, 0, 0], "Hue Down": [-480, 0, 0],
};

/* The blend-mode modes: the color painted and its blend mode (the sub-tool 0x7b3210 makes). */
const PAINTED: Record<string, number> = {
  Dodge: Blend.Dodge, Burn: Blend.Burn,
  "Saturation to Target": Blend.Saturation, "Lightness to Target": Blend.Luminance, "Hue to Target": Blend.Hue, "Color to Target": Blend.Color,
};

const div = (a: number, b: number) => Math.trunc(a / b);

/** RGB to PSP's x16 HLS without rounding (0x7ec1d0): [h, s, l], each 0..4080. */
export function hls16(r: number, g: number, b: number, out: number[] = [0, 0, 0]): number[] {
  const R = r * 16, G = g * 16, B = b * 16;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  let sum = min + max;
  out[2] = sum >> 1;
  if (max === min) { out[0] = out[1] = 0; return out; }
  if (sum >> 1 > 0x7f8) sum = 0x1fe0 - min - max;
  const c = max - min;
  out[1] = div(c * 0xff0, sum);
  if (R === max) out[0] = G < B ? div((div((G - B) * 0x3c0, c) + 0x1680) * 0x33, 0x48) : div((G - B) * 0x2a8, c);
  else if (G === max) out[0] = div((B - R) * 0x2a8, c) + 0x550;
  else out[0] = div((R - G) * 0x2a8, c) + 0xaa0;
  return out;
}

const round16 = (v: number) => (v >> 4) + ((v & 15) > 7 ? 1 : 0);

/** PSP's x16 HLS back to RGB (0x7ec310). */
export function rgbFromHls16(h: number, s: number, l: number, out: number[] = [0, 0, 0]): number[] {
  if (s === 0) { out[0] = out[1] = out[2] = round16(l); return out; }
  const m2 = l < 0x7f8 ? div((s + 0xff0) * l, 0xff0) : s - div(s * l, 0xff0) + l;
  const m1 = l * 2 - m2, span = m2 - m1;
  const ch = (x: number) => (x < 0x2a8 ? div(x * span * 0x48, 0xbf40) + m1 : x < 0x7f8 ? m2 : x < 0xaa0 ? div((0xf00 - div(x * 0x48, 0x33)) * span, 0x3c0) + m1 : m1);
  let hr = h + 0x550;
  if (hr > 0xff0) hr = h - 0xaa0;
  let hb = h - 0x550;
  if (hb < 0) hb = h + 0xaa0;
  out[0] = round16(ch(hr)); out[1] = round16(ch(h)); out[2] = round16(ch(hb));
  return out;
}

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
const hls = [0, 0, 0], rgb = [0, 0, 0];

/**
 * One covered pixel. `inside(x, y)` says whether a neighbour counts (inside the image and the
 * selection).
 */
export function retouchPixel(mode: string, out: Uint8ClampedArray, orig: Uint8ClampedArray, w: number, h: number, p: number, x: number, y: number, s: number, target: [number, number, number], inside: (x: number, y: number) => boolean = () => true): void {
  const i = p * 4;
  const R = orig[i], G = orig[i + 1], B = orig[i + 2];
  const mix = (r: number, g: number, b: number) => { out[i] = R + (r - R) * s; out[i + 1] = G + (g - G) * s; out[i + 2] = B + (b - B) * s; };
  const kernel = KERNELS[mode];
  if (kernel) {
    let sr = 0, sg = 0, sb = 0, wsum = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const wgt = kernel.k[(dy + 1) * 3 + dx + 1];
      if (!wgt) continue;
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h || !inside(xx, yy)) continue;
      const q = (yy * w + xx) * 4;
      sr += orig[q] * wgt; sg += orig[q + 1] * wgt; sb += orig[q + 2] * wgt; wsum += wgt;
    }
    if (kernel.normalize && wsum !== 0) { const half = div(wsum, 2); sr = div(sr + half, wsum); sg = div(sg + half, wsum); sb = div(sb + half, wsum); }
    mix(clamp(sr + kernel.bias), clamp(sg + kernel.bias), clamp(sb + kernel.bias));
    return;
  }
  const shift = SHIFTS[mode];
  if (shift) {
    hls16(R, G, B, hls);
    for (let k = 0; k < 3; k++) if (shift[k]) hls[k] = Math.max(0, Math.min(0xff0, hls[k] + shift[k]));
    rgbFromHls16(hls[0], hls[1], hls[2], rgb);
    mix(rgb[0], rgb[1], rgb[2]);
    return;
  }
  const blend = PAINTED[mode];
  if (blend !== undefined) {
    const color = mode === "Dodge" || mode === "Burn" ? [128, 128, 128] : target;
    out[i] = R; out[i + 1] = G; out[i + 2] = B; out[i + 3] = orig[i + 3];
    blendCover(out, i, blend, color[0], color[1], color[2], 255, s, x, y, true);
  }
}
