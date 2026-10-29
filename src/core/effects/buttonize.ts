/*
  Image > Effects > Buttonize (Psp.exe 0x545d80, DIALOG 27010; docs/PSP_EXE_ANALYSIS.md
  section 8). Bands along the four edges shade the image like a raised button lit from the top
  left, using the background color: its full value and half of it toward the top and left,
  half of it fading to nothing toward the bottom and right. The corners split on a diagonal.
  Solid Edge paints the bands; Transparent Edge mixes the image back into them.

  The integer divisions are PSP's, each truncated where it truncates. PSP's path for layers
  with transparency is not read yet: their alpha is kept.
*/
import { MUL } from "../layers/blend.ts";
import { cloneRaster, type Raster } from "../image/raster.ts";

export interface ButtonizeParams {
  height: number;
  width: number;
  /** 1..100 %. */
  opacity: number;
  solid: boolean;
}

export const BUTTONIZE_DEFAULTS: ButtonizeParams = { height: 20, width: 20, opacity: 75, solid: false };

const t = Math.trunc;

export function buttonize(src: Raster, color: readonly [number, number, number], p: ButtonizeParams): Raster {
  const { width: W, height: H } = src;
  const out = cloneRaster(src), d = out.data;
  const w = Math.min(t(p.width), t(W / 2)), h = Math.min(t(p.height), t(H / 2));
  const o = t((t(p.opacity) * 255) / 100) & 0xff, io = 255 - o;
  const f = w ? Math.fround(Math.fround(h) / Math.fround(w)) : 0;
  const split = (n: number) => (f ? t(n / f) : 0);
  const C = color, hf = [C[0] >> 1, C[1] >> 1, C[2] >> 1];

  // Solid edge.
  const L = (c: number, i: number) => t((hf[i] * (w - c)) / w) + t((C[i] * c) / w);
  const R = (c: number, i: number) => t((hf[i] * (W - c)) / w);
  // Transparent edge: `v` is the pixel's own channel.
  const Lb = (c: number, i: number, v: number) => t(((hf[i] + t((hf[i] * c) / w)) * (w - c)) / w) + t((v * c) / w);
  const Rb = (c: number, i: number, v: number) => t((t((hf[i] * (W - c)) / w) * (w - W + c)) / w) + t((v * (W - c)) / w);

  for (let y = 0; y < H; y++) {
    const top = y < h, bottom = !top && y >= H - h;
    const m = y + 1; // rows into the top band
    const r = H - 1 - y; // rows into the bottom band, from the edge
    const s = top ? split(m) : bottom ? split(r) : 0;
    for (let c = 0; c < W; c++) {
      const at = (y * W + c) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const v0 = d[at + ch], ci = ch;
        let v: number | null;
        if (p.solid) {
          if (top) {
            const rc = (t((hf[ci] * (h - m)) / h) + t((C[ci] * m) / h)) & 0xff;
            v = c < s ? L(c, ci) : c >= W - s ? (c === W - s ? t((R(c, ci) + rc) / 2) : R(c, ci)) : rc;
          } else if (bottom) {
            const rb = t((hf[ci] * r) / h);
            v = c < s ? L(c, ci) : c === s && w ? t((L(c, ci) + rb) / 2) : c < W - s ? rb : R(c, ci);
          } else v = c < w ? L(c, ci) : c >= W - w ? R(c, ci) : null;
        } else {
          if (top) {
            if (c < s) v = Lb(c, ci, v0);
            else if (c < W - s) v = t(((hf[ci] + t((m * hf[ci]) / h)) * (h - m)) / h) + t((m * v0) / h);
            else if (c === W - s) v = t((t((t(((W - c) * hf[ci]) / w) + hf[ci] + t((m * hf[ci]) / h)) / 2) * (w - W + c)) / w) + t(((W - c) * v0) / w);
            else v = Rb(c, ci, v0);
          } else if (bottom) {
            if (c < s) v = Lb(c, ci, v0);
            else if (c === s && w) v = t((t((hf[ci] + t((hf[ci] * r) / h) + t((hf[ci] * c) / w)) / 2) * (w - c)) / w) + t((v0 * c) / w);
            else if (c < W - s) v = t((t((hf[ci] * r) / h) * (h - r)) / h) + t((v0 * r) / h);
            else v = Rb(c, ci, v0);
          } else v = c < w ? Lb(c, ci, v0) : c >= W - w ? Rb(c, ci, v0) : null;
        }
        if (v !== null) d[at + ch] = MUL[v0 * io + (v & 0xff) * o];
      }
    }
  }
  return out;
}
