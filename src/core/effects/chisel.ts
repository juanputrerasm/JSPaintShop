/*
  Image > Effects > Chisel (Psp.exe 0x542330, DIALOG 219; docs/PSP_EXE_ANALYSIS.md
  section 8). A bevelled band of `size` pixels is cut around the outside of the selection (or
  the layer's opaque area): the shape as a 0/255 mask, grown by `size` passes in which every
  pixel outside it takes its highest 8-neighbour minus 255/size, then lit like Hot Wax with
  the light (-31, -31) over a height of 34. "Background Color" paints the band in the
  background color shaded; "Transparent" shades the image under it.

  The band's first and last rows use only the row and its neighbour (below for the first, above
  for the last), and in their end columns the vertical term is the horizontal difference, as
  PSP computes them.
*/
import { cloneRaster, maskBounds, type Mask, type Raster } from "../image/raster.ts";

export interface ChiselParams {
  /** 1..100. */
  size: number;
  transparent: boolean;
}

export const CHISEL_DEFAULTS: ChiselParams = { size: 10, transparent: false };

export function chisel(layer: Raster, shape: Mask | null, color: readonly [number, number, number], p: ChiselParams): Raster {
  const { width: W, height: H } = layer;
  const out = cloneRaster(layer);
  const size = Math.max(1, Math.min(100, Math.trunc(p.size)));
  // A selection counts above 64; a layer's transparency anywhere it is not clear.
  const src = new Uint8Array(W * H);
  if (shape) for (let i = 0; i < src.length; i++) src[i] = shape.data[i] > 0x40 ? 255 : 0;
  else for (let i = 0; i < src.length; i++) src[i] = layer.data[i * 4 + 3] ? 255 : 0;
  const r = maskBounds({ width: W, height: H, data: src });
  if (!r) return out;
  const w = r.maxX - r.minX + 1 + 2 * size, h = r.maxY - r.minY + 1 + 2 * size;
  const x0 = r.minX - size, y0 = r.minY - size;
  let ramp = new Uint8Array(w * h);
  for (let y = r.minY; y <= r.maxY; y++) for (let x = r.minX; x <= r.maxX; x++) ramp[(y - y0) * w + x - x0] = src[y * W + x];

  const step = Math.trunc(255 / size) & 0xff;
  for (let pass = 0; pass < size; pass++) {
    const next = ramp.slice();
    for (let y = 1; y < h - 1; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (ramp[i] === 255) continue;
      let m = 0;
      for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
        if ((!j && !k) || x + k < 0 || x + k >= w) continue;
        const v = ramp[i + j * w + k];
        if (v > m) m = v;
      }
      if (m) next[i] = (m - step) & 0xff;
    }
    ramp = next;
  }

  const at = (x: number, y: number) => ramp[y * w + x];
  const d = out.data;
  for (let y = 0; y < h; y++) {
    const iy = y0 + y;
    if (iy < 0 || iy >= H) continue;
    for (let x = 0; x < w; x++) {
      const v = at(x, y), ix = x0 + x;
      if (v === 0 || v === 255 || ix < 0 || ix >= W) continue;
      const L = x > 0 ? x - 1 : x, R = x < w - 1 ? x + 1 : x;
      let dx = 0, dy = 0;
      if (y > 0 && y < h - 1) {
        for (const yy of [y - 1, y, y + 1]) dx += at(L, yy) - at(R, yy);
        for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) dy += at(xx, y - 1) - at(xx, y + 1);
      } else {
        // The first and last rows (0x542330): the row and its one neighbour; in the end columns
        // PSP's vertical term is the horizontal difference along the row.
        const n = y === 0 ? Math.min(h - 1, 1) : y - 1;
        dx = at(L, y) - at(R, y) + at(L, n) - at(R, n);
        if (x === 0 || x === w - 1) dy = at(L, y) - at(R, y);
        else for (let xx = x - 1; xx <= x + 1; xx++) dy += at(xx, n) - at(xx, y);
      }
      let shade: number;
      if (!dx && !dy) shade = 0xfb;
      else {
        const num = 0x2156 - 31 * (dx + dy);
        shade = num < 0 ? 0 : Math.trunc(num / Math.sqrt(dx * dx + dy * dy + 0x484));
      }
      const o = (iy * W + ix) * 4;
      for (let c = 0; c < 3; c++) d[o + c] = ((p.transparent ? d[o + c] : color[c]) * shade) >> 8;
    }
  }
  return out;
}
