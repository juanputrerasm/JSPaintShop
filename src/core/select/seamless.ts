/*
  Selections > Convert to Seamless Pattern: a new image the size of the selection that tiles
  without seams. The selection's own pixels are blended with copies of themselves shifted by
  half the tile, the copy's weight growing towards the tile edges, so opposite edges meet.
*/
import { createRaster, type Raster } from "../image/raster.ts";
import type { Rect } from "../edit/history.ts";

export function seamless(src: Raster, r: Rect): Raster {
  const w = r.maxX - r.minX + 1, h = r.maxY - r.minY + 1;
  const out = createRaster(w, h), d = out.data, s = src.data;
  const at = (x: number, y: number) => ((r.minY + ((y % h) + h) % h) * src.width + r.minX + ((x % w) + w) % w) * 4;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // 0 in the middle of the tile, 1 at its edges.
    const ex = Math.abs(x - (w - 1) / 2) / ((w - 1) / 2 || 1), ey = Math.abs(y - (h - 1) / 2) / ((h - 1) / 2 || 1);
    const t = Math.max(ex, ey) ** 2;
    const a = at(x, y), b = at(x + Math.floor(w / 2), y + Math.floor(h / 2)), o = (y * w + x) * 4;
    for (let c = 0; c < 4; c++) d[o + c] = s[a + c] * (1 - t) + s[b + c] * t;
  }
  return out;
}
