/*
  File > New (57600), PSP 6's "New Image" dialog (DIALOG 706): Image Dimensions (width and
  height in pixels, inches or centimeters; resolution in pixels per inch or per cm) and Image
  Characteristics (background color, image type), with the memory the image will take. The
  lists come from the dialog's DLGINIT. The values are remembered for next time.

  A transparent background needs 16.7 million colors, as in PSP: choosing it there switches
  the type.
*/
import { el } from "../../shared/dom.ts";
import { openDialog, alertDialog } from "../shell/dialog.ts";
import type { AppState } from "../../app/state.ts";
import { MAX_IMAGE_SIDE, type NewImageSettings } from "../../core/settings.ts";
import type { Rgba } from "../../core/image/raster.ts";
import type { ColorDepth } from "../../core/doc/image-doc.ts";

const UNITS = ["Pixels", "Inches", "Centimeters"];
const RES_UNITS = ["Pixels / inch", "Pixels / cm"];
export const BACKGROUNDS = ["Foreground Color", "Background Color", "White", "Black", "Red", "Green", "Blue", "Transparent"];
const TYPES = ["2 Colors (1 Bit)", "16 Colors (4 Bit)", "Greyscale (8 Bit)", "256 Colors (8 Bit)", "16.7 Million Colors (24 Bit)"];
const TRANSPARENT = 7, FULL_COLOR = 4;

export interface NewImageChoice { width: number; height: number; dpi: number; fill: Rgba; depth: ColorDepth; greyscale: boolean }

/** Bits per pixel of each image type. */
const TYPE_BITS: [ColorDepth, boolean][] = [[1, false], [4, false], [8, true], [8, false], [24, false]];

export function backgroundColor(index: number, fg: Rgba, bg: Rgba): Rgba {
  return ([fg, bg, [255, 255, 255, 255], [0, 0, 0, 255], [255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [0, 0, 0, 0]] as Rgba[])[index] ?? [255, 255, 255, 255];
}

/** "Memory required: 732.4 KBytes". */
export function memoryText(width: number, height: number, type: number): string {
  const bytes = (width * height * (TYPE_BITS[type][0] === 24 ? 24 : TYPE_BITS[type][0])) / 8;
  const text = bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MBytes` : `${(bytes / 1024).toFixed(1)} KBytes`;
  return `Memory required: ${text}`;
}

export async function showNewImage(app: AppState, fg: Rgba, bg: Rgba): Promise<NewImageChoice | null> {
  const s: NewImageSettings = { ...app.settings.newImage };
  const select = (options: string[], value: number) => el("select", {}, ...options.map((o, i) => el("option", { value: i, selected: i === value }, o)));
  const number = (step: string) => el("input", { type: "number", class: "spin", min: 0, step });
  const width = number("any"), height = number("any"), res = number("any");
  const units = select(UNITS, s.units), resUnit = select(RES_UNITS, s.dpiUnit);
  const background = select(BACKGROUNDS, s.background), type = select(TYPES, s.type);
  const memory = el("p", { class: "new-memory" });

  // Sizes live in pixels; the fields show them in the chosen units.
  const ppi = () => s.dpi;
  const toUnits = (px: number) => (s.units === 0 ? String(px) : String(+(px / ppi() * (s.units === 2 ? 2.54 : 1)).toFixed(3)));
  const fromUnits = (v: number) => Math.round(s.units === 0 ? v : (v / (s.units === 2 ? 2.54 : 1)) * ppi());
  const show = () => {
    width.value = toUnits(s.width);
    height.value = toUnits(s.height);
    res.value = String(s.dpiUnit === 1 ? +(s.dpi / 2.54).toFixed(3) : s.dpi);
    memory.textContent = memoryText(s.width, s.height, s.type);
  };
  const read = () => {
    const d = Number(res.value);
    if (d > 0) s.dpi = Math.max(1, Math.round(s.dpiUnit === 1 ? d * 2.54 : d));
    const w = Number(width.value), h = Number(height.value);
    if (w > 0) s.width = fromUnits(w);
    if (h > 0) s.height = fromUnits(h);
    memory.textContent = memoryText(s.width, s.height, s.type);
  };
  width.addEventListener("input", read);
  height.addEventListener("input", read);
  res.addEventListener("input", read);
  units.addEventListener("change", () => { read(); s.units = Number(units.value) as 0 | 1 | 2; show(); });
  resUnit.addEventListener("change", () => { read(); s.dpiUnit = Number(resUnit.value) as 0 | 1; show(); });
  background.addEventListener("change", () => {
    s.background = Number(background.value);
    if (s.background === TRANSPARENT && s.type !== FULL_COLOR) { s.type = FULL_COLOR; type.value = String(FULL_COLOR); show(); }
  });
  type.addEventListener("change", () => {
    s.type = Number(type.value);
    if (s.type !== FULL_COLOR && s.background === TRANSPARENT) { s.background = 2; background.value = "2"; }
    show();
  });
  show();

  const row = (label: string, ...controls: Node[]) => el("label", { class: "form-row" }, el("span", {}, label), ...controls);
  const body = el("div", { class: "new-image" },
    el("fieldset", { class: "opt-group" }, el("legend", {}, "Image Dimensions"),
      el("div", { class: "new-dims" },
        el("div", { class: "new-wh" }, row("Width", width), row("Height", height)),
        units),
      row("Resolution", res, resUnit)),
    el("fieldset", { class: "opt-group" }, el("legend", {}, "Image Characteristics"),
      row("Background color", background),
      row("Image type", type),
      memory));
  const v = await openDialog({
    title: "New Image", body, buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    beforeClose: async (value) => {
      if (value !== "ok") return true;
      read();
      if (s.width < 1 || s.height < 1 || s.width > MAX_IMAGE_SIDE || s.height > MAX_IMAGE_SIDE) {
        await alertDialog("New Image", `Width and height must be between 1 and ${MAX_IMAGE_SIDE} pixels.`);
        return false;
      }
      return true;
    },
  });
  if (v !== "ok") return null;
  app.updateSettings((st) => { st.newImage = s; });
  const [depth, greyscale] = TYPE_BITS[s.type];
  return { width: s.width, height: s.height, dpi: s.dpi, fill: backgroundColor(s.background, fg, bg), depth, greyscale };
}
