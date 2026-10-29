/*
  The Picture Tube tool's placement (Psp.exe 0x7b5e40, "ToolPictureTube.cpp";
  docs/PSP_EXE_ANALYSIS.md section 10). A tube is one image cut into cells (across x down,
  `count` of them); while painting, a cell is placed when the pointer has moved `step` pixels
  (Continuous) or a random 0..step pixels (Random: trunc(rand()·step/32767), drawn anew after
  each placement). The cell is chosen by the selection mode:
    0 Random       trunc(rand()·count / 32768)
    1 Incremental  the next, back to the first after the last
    2 Angular      the stroke direction: a = (270 − degrees) mod 360,
                   cell trunc(((trunc(180/count) + a) mod 360)·count / 360)
    3 Pressure     trunc(count·pressure / 257), pressure 0..256
    4 Velocity     trunc(count·ms since the last cell / 300), at most count − 1
*/
import { createRaster, type Raster } from "../image/raster.ts";
import { msvcRand } from "../filters/filters.ts";

export interface TubeSpec { step: number; across: number; down: number; count: number; placement: number; selection: number }

export function tubeCells(image: Raster, t: TubeSpec): Raster[] {
  const across = Math.max(1, t.across), down = Math.max(1, t.down);
  const cw = Math.trunc(image.width / across), ch = Math.trunc(image.height / down);
  const count = Math.max(1, Math.min(t.count > 0 ? t.count : across * down, across * down));
  const cells: Raster[] = [];
  for (let i = 0; i < count; i++) {
    const cx = (i % across) * cw, cy = Math.trunc(i / across) * ch, cell = createRaster(cw, ch);
    for (let y = 0; y < ch; y++) cell.data.set(image.data.subarray(((cy + y) * image.width + cx) * 4, ((cy + y) * image.width + cx + cw) * 4), y * cw * 4);
    cells.push(cell);
  }
  return cells;
}

export class TubePlacer {
  private next = -1;
  private cell = 0;
  private lastTime = 0;
  private step: number;
  private count: number;
  private placement: number;
  private selection: number;
  constructor(step: number, count: number, placement: number, selection: number) {
    this.step = step; this.count = count; this.placement = placement; this.selection = selection;
  }

  /**
    Whether to place a cell after moving `distance` pixels since the last one; the stroke runs
    from `from` to `to`. Returns the cell index or null.
  */
  place(distance: number, from: [number, number] | null, to: [number, number], pressure: number, now: number): number | null {
    const d = Math.trunc(distance), n = this.count;
    if (this.placement === 0) {
      if (this.next === -1) this.next = Math.trunc((msvcRand() * this.step) / 0x7fff);
      if (d < this.next) return null;
      this.next = Math.trunc((msvcRand() * this.step) / 0x7fff);
    } else {
      if (this.next === -1) this.next = this.step;
      if (d < this.next) return null;
    }
    switch (this.selection) {
      case 0: this.cell = (msvcRand() * n) >> 15; break;
      case 1: this.cell = this.cell + 1 > n - 1 ? 0 : this.cell + 1; break;
      case 2: {
        if (!from) return null;
        const deg = Math.trunc((Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI);
        const a = (270 - deg) % 360;
        if (a < 0) return null;
        this.cell = Math.trunc((((Math.trunc(180 / n) + a) % 360) * n) / 360);
        break;
      }
      case 3: this.cell = Math.trunc((n * Math.round(pressure * 256)) / 257); break;
      case 4: this.cell = Math.min(n - 1, Math.trunc((n * (now - this.lastTime)) / 300)); this.lastTime = now; break;
      default: this.cell = 0;
    }
    return Math.max(0, Math.min(n - 1, this.cell));
  }
}
