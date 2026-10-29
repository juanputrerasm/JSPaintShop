/*
  The Color palette (C), docked on the right as in PSP 6: the available colors (the spectrum,
  or the image's own palette when it is paletted), the foreground and background swatches
  with the swap arrow, and the color under the pointer.

  Left-click a color for the foreground, right-click for the background. Click a swatch for
  the Color dialog; right-click it for Recent Colors.
*/
import { el, clear } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";
import type { Colors } from "../../app/colors.ts";
import type { Editor } from "../../app/editor.ts";
import { hslToRgb, toHex } from "../../core/color/color-space.ts";
import { showColorDialog, showRecentColors } from "../dialogs/color-dialog.ts";
import type { Rgba } from "../../core/image/raster.ts";

export function colorPalette(app: AppState, colors: Colors, ed: Editor, dock: HTMLElement): void {
  const spectrum = el("canvas", { class: "available-colors", width: 150, height: 120, title: "Available colors" });
  const readout = el("div", { class: "color-readout" });
  const fgBox = el("button", { class: "swatch fg", title: "Foreground color (click to change, right-click for recent colors)" });
  const bgBox = el("button", { class: "swatch bg", title: "Background color (click to change, right-click for recent colors)" });
  const swap = el("button", { class: "swatch-swap", title: "Swap colors", onclick: () => colors.swap() }, "⇄");
  const body = el("div", { class: "color-palette" },
    el("div", { class: "opt-hint" }, "Available colors"), spectrum, readout,
    el("div", { class: "opt-hint" }, "Active colors"), el("div", { class: "swatches" }, fgBox, bgBox, swap));
  clear(dock);
  dock.append(el("header", { class: "bar-title" }, "Color"), body);

  // The spectrum: hue across, lightness down (white at the top, black at the bottom), and a grey strip.
  const colorAt = (x: number, y: number): Rgba => {
    const w = spectrum.width, h = spectrum.height;
    const palette = ed.image?.doc.depth && ed.image.doc.depth <= 8 ? ed.image.doc.palette : null;
    if (palette) {
      const n = palette.length / 3, cols = 16, rows = Math.ceil(n / cols);
      const i = Math.min(n - 1, Math.floor((y / h) * rows) * cols + Math.floor((x / w) * cols));
      return [palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2], 255];
    }
    if (x >= w - 12) { const v = Math.round((1 - y / h) * 255); return [v, v, v, 255]; }
    const c = hslToRgb((x / (w - 12)) * 360, 1, 1 - y / h);
    return [c[0], c[1], c[2], 255];
  };
  const draw = () => {
    const g = spectrum.getContext("2d")!;
    const img = g.createImageData(spectrum.width, spectrum.height);
    for (let y = 0; y < spectrum.height; y++) for (let x = 0; x < spectrum.width; x++) img.data.set(colorAt(x, y), (y * spectrum.width + x) * 4);
    g.putImageData(img, 0, 0);
  };
  const remember = (c: Rgba) => {
    const hex = toHex(c[0], c[1], c[2]);
    app.updateSettings((s) => { s.recentColors = [hex, ...s.recentColors.filter((x) => x !== hex)].slice(0, 10); });
  };
  const show = () => {
    fgBox.style.background = toHex(colors.fg[0], colors.fg[1], colors.fg[2]);
    bgBox.style.background = toHex(colors.bg[0], colors.bg[1], colors.bg[2]);
  };
  const at = (e: PointerEvent) => {
    const r = spectrum.getBoundingClientRect();
    return colorAt(Math.floor(((e.clientX - r.left) / r.width) * spectrum.width), Math.floor(((e.clientY - r.top) / r.height) * spectrum.height));
  };
  spectrum.addEventListener("pointermove", (e) => { const c = at(e); readout.textContent = `R:${c[0]} G:${c[1]} B:${c[2]}  ${toHex(c[0], c[1], c[2])}`; });
  spectrum.addEventListener("pointerdown", (e) => { const c = at(e); colors.set(e.button === 2 ? "bg" : "fg", c); remember(c); });
  // Right-clicks here pick colors; they must not reach the dock's toolbar menu (MENU 436).
  spectrum.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); });
  const pick = async (which: "fg" | "bg", recent: boolean) => {
    const c = recent ? await showRecentColors(app, colors[which]) : await showColorDialog(app, colors[which], which === "fg" ? "Foreground Color" : "Background Color");
    if (c) { colors.set(which, c); remember(c); }
  };
  fgBox.addEventListener("click", () => pick("fg", false));
  bgBox.addEventListener("click", () => pick("bg", false));
  fgBox.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); void pick("fg", true); });
  bgBox.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); void pick("bg", true); });
  swap.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); });
  colors.on("changed", show);
  app.on("image", draw);
  show();
  draw();
}
