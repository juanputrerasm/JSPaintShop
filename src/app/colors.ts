/*
  The foreground and background colors (the Color palette's active colors). The painting
  tools paint with the foreground on a left click and the background on a right click, as
  in PSP. Black on white to start, as PSP does.
*/
import { Emitter } from "../shared/emitter.ts";
import type { Rgba } from "../core/image/raster.ts";

export class Colors extends Emitter<{ changed: void }> {
  fg: Rgba = [0, 0, 0, 255];
  bg: Rgba = [255, 255, 255, 255];

  set(which: "fg" | "bg", c: Rgba): void {
    this[which] = [c[0], c[1], c[2], 255];
    this.emit("changed", undefined);
  }

  swap(): void {
    [this.fg, this.bg] = [this.bg, this.fg];
    this.emit("changed", undefined);
  }
}
