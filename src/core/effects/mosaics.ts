/*
  Image > Effects > Mosaic - Antique (Psp.exe 0x674370, DIALOG 27039) and Mosaic - Glass
  (0x51d660, DIALOG 27044); docs/PSP_EXE_ANALYSIS.md section 8. The image is cut into
  columns x rows tiles; each tile shows the image around its own center, zoomed; the last
  `grout` pixels on each tile's right and bottom are grout, sampled at a random offset of up to
  ±groutOpacity (MSVC rand(), x then y). Glass also bends the tile near its edges.
*/
import { cloneRaster, type Raster } from "../image/raster.ts";
import { msvcRand } from "../filters/filters.ts";
import { fold, sampleBilinear } from "./sample.ts";

export interface MosaicParams {
  columns: number;
  rows: number;
  symmetric: boolean;
  groutWidth: number;
  groutOpacity: number;
  /** Antique: tile opacity; Glass: glass curvature. */
  tile: number;
  /** Glass only: edge curvature. */
  edge: number;
}

export const MOSAIC_DEFAULTS: MosaicParams = { columns: 50, rows: 50, symmetric: true, groutWidth: 2, groutOpacity: 50, tile: 70, edge: 0 };

export function mosaicTiles(src: Raster, p: MosaicParams, glass: boolean): Raster {
  const { width: W, height: H } = src;
  const out = cloneRaster(src);
  if (W < 4 || H < 4) return out;
  const cols = Math.max(1, Math.trunc(p.columns)), rows = Math.max(1, Math.trunc(p.symmetric ? p.columns : p.rows));
  const tw = Math.max(1, Math.trunc(W / cols)), th = Math.max(1, Math.trunc(H / rows));
  const hx = tw * 0.5, hy = th * 0.5, cx = hx, cy = hy, g = Math.trunc(p.groutWidth), jitter = Math.trunc(p.groutOpacity);
  const zoom = Math.pow(25, (glass ? 1 : -1) * p.tile * 0.01), bend = Math.trunc(p.edge) + 1;
  const px = [0, 0, 0, 0];
  for (let y = 0; y < H; y++) {
    const dy = (y % th) - cy;
    const bottom = hy - g - dy - 1, tileY = Math.trunc(y / th) * th + cy;
    for (let x = 0; x < W; x++) {
      const dx = (x % tw) - cx;
      const d = Math.min(Math.min(hx - g - dx - 1, bottom), Math.min(dy + hy, dx + hx));
      let ox: number, oy: number;
      if (d < 0) {
        ox = jitter + dx - (msvcRand() % (2 * jitter + 1));
        oy = jitter + dy - (msvcRand() % (2 * jitter + 1));
      } else if (glass && d < bend) {
        ox = (dx * bend * zoom) / (d + 1);
        oy = (dy * bend * zoom) / (d + 1);
      } else {
        ox = dx * zoom;
        oy = dy * zoom;
      }
      const sx = fold(Math.trunc(x / tw) * tw + cx + ox, 1, W - 2), sy = fold(tileY + oy, 1, H - 2);
      sampleBilinear(src, Math.trunc(sx * 256), Math.trunc(sy * 256), px);
      const o = (y * W + x) * 4;
      out.data[o] = px[0]; out.data[o + 1] = px[1]; out.data[o + 2] = px[2];
    }
  }
  return out;
}
