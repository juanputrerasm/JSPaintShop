/*
  The RAW dialogs.

    RAW Options (DIALOG 8015, opening a .raw): image size in pixels, 1..32767; color channels
      (single channel greyscale, three channel RGB, three channel CMY, four channel CMYK); file
      structure: header size in bytes (0..32767), planar or interleaved, RGB or BGR order,
      flipped (bottom up).
      PSP 6 maps the CMY and CMYK buttons the wrong way round (0x7396a0 gives CMY the CMYK
      reader); here each button reads what it says.
    RAW (DIALOG 468, saving): header size, flip top and bottom, and for 24-bit images RGB or
      BGR order and planar mode.

  Additions: a list of sizes that fit the file (core/formats/raw.ts rawSizeGuesses), a line
  saying whether the choice fits, and for a single channel the palette to show the indices
  through: greys as PSP does, a same-name .ACT or .PAL chosen with the RAW, or one loaded here.
*/
import { el } from "../../shared/dom.ts";
import { openDialog } from "../shell/dialog.ts";
import type { AppState } from "../../app/state.ts";
import { decodeActPalette, rawSizeGuesses, RAW_CHANNEL_BYTES, RAW_MAX_SIDE, type RawChannels, type RawReadOptions, type RawWriteOptions } from "../../core/formats/raw.ts";
import { readPal } from "../../core/formats/pal.ts";
import { decodeHaloPalette } from "../../core/formats/legacy.ts";

export interface RawPalette { name: string; colors: Uint8Array }

/** A palette file's colors: an .ACT (256 RGB triples) or a .PAL palette (PSP's text palette or Dr. Halo's). */
export function readPaletteFile(name: string, bytes: Uint8Array): Uint8Array | null {
  const halo = decodeHaloPalette(bytes);
  if (halo) return halo;
  if (/\.pal$/i.test(name)) {
    try { return readPal(new TextDecoder().decode(bytes)); } catch { return null; }
  }
  return decodeActPalette(bytes);
}

const CHANNELS: [RawChannels, string][] = [["grey", "Single channel (greyscale)"], ["rgb", "Three channel (RGB)"], ["cmy", "Three channel (CMY)"], ["cmyk", "Four channel (CMYK)"]];

const num = (value: number, min: number, max: number) => el("input", { type: "number", class: "spin", value, min, max, step: 1 }) as HTMLInputElement;
const radio = (name: string, label: string, checked: boolean) => {
  const input = el("input", { type: "radio", name, checked }) as HTMLInputElement;
  return { input, row: el("label", { class: "opt-check" }, input, label) };
};
const checkbox = (label: string, checked: boolean) => {
  const input = el("input", { type: "checkbox", checked }) as HTMLInputElement;
  return { input, row: el("label", { class: "opt-check" }, input, label) };
};
const group = (legend: string, ...children: Node[]) => el("fieldset", { class: "opt-group" }, el("legend", {}, legend), ...children);

/** RAW Options for a file of `byteLength` bytes; null when cancelled. */
export async function showRawOpen(app: AppState, fileName: string, byteLength: number, paired: RawPalette | null): Promise<RawReadOptions | null> {
  const last = app.settings.raw;
  const guesses = () => rawSizeGuesses(byteLength, Number(header.value) || 0);
  const header = num(last.header, 0, RAW_MAX_SIDE);
  const first = rawSizeGuesses(byteLength, last.header)[0];
  const width = num(first?.width ?? 256, 1, RAW_MAX_SIDE), height = num(first?.height ?? 256, 1, RAW_MAX_SIDE);
  const startChannels = first?.channels ?? last.channels;
  const channelRadios = CHANNELS.map(([id, label]) => ({ id, ...radio("raw-ch", label, id === startChannels) }));
  const planar = radio("raw-layout", "Planar (RRR GGG...)", last.planar), interleaved = radio("raw-layout", "Interleaved (RGB RGB...)", !last.planar);
  const rgb = radio("raw-order", "Order RGB", !last.bgr), bgr = radio("raw-order", "Order BGR", last.bgr);
  const flipped = checkbox("Flipped (bottom up)", last.flipped);
  const sizes = el("select", {}) as HTMLSelectElement;
  const fill = () => {
    sizes.replaceChildren(el("option", { value: "" }, "Sizes that fit this file..."), ...guesses().map((g, i) =>
      el("option", { value: String(i) }, `${g.width} x ${g.height}, ${g.channels === "grey" ? "single channel" : "RGB"} (${g.why})`)));
  };
  fill();
  sizes.addEventListener("change", () => {
    const g = guesses()[Number(sizes.value)];
    if (!g) return;
    width.value = String(g.width); height.value = String(g.height);
    for (const r of channelRadios) r.input.checked = r.id === g.channels;
    update();
  });
  // The palette for a single channel (an addition).
  const palettes: RawPalette[] = paired ? [paired] : [];
  const paletteSel = el("select", {}) as HTMLSelectElement;
  const fillPalettes = (pick: number) => {
    paletteSel.replaceChildren(el("option", { value: "-1" }, "Greyscale"), ...palettes.map((p, i) => el("option", { value: String(i) }, p.name)));
    paletteSel.value = String(pick);
  };
  fillPalettes(paired ? 0 : -1);
  const loadPalette = el("button", { type: "button" }, "Load...") as HTMLButtonElement;
  loadPalette.addEventListener("click", () => {
    const input = el("input", { type: "file", accept: ".act,.pal" }) as HTMLInputElement;
    input.addEventListener("change", async () => {
      const f = input.files?.[0];
      if (!f) return;
      const colors = readPaletteFile(f.name, new Uint8Array(await f.arrayBuffer()));
      if (!colors) { status.textContent = `${f.name} is not an .ACT (768 bytes or more) or .PAL palette.`; return; }
      palettes.push({ name: f.name, colors });
      fillPalettes(palettes.length - 1);
    });
    input.click();
  });
  const paletteRow = el("label", { class: "form-row" }, el("span", {}, "Palette:"), paletteSel, loadPalette);
  const status = el("p", { class: "opt-hint" });
  const channels = (): RawChannels => channelRadios.find((r) => r.input.checked)?.id ?? "grey";
  const update = () => {
    const ch = channels(), isRgb = ch === "rgb";
    for (const c of [planar.input, interleaved.input, rgb.input, bgr.input]) c.disabled = !isRgb;
    paletteSel.disabled = loadPalette.disabled = ch !== "grey";
    const need = (Number(header.value) || 0) + (Number(width.value) || 0) * (Number(height.value) || 0) * RAW_CHANNEL_BYTES[ch];
    status.textContent = need === byteLength ? `Fits the file exactly (${byteLength} bytes).`
      : need < byteLength ? `Uses ${need} of the file's ${byteLength} bytes.` : `Needs ${need} bytes; the file has ${byteLength}.`;
  };
  for (const c of [width, height, header]) c.addEventListener("input", update);
  header.addEventListener("change", fill);
  for (const r of [...channelRadios.map((c) => c.input), planar.input, interleaved.input]) r.addEventListener("change", update);
  update();

  const result = await openDialog({
    title: `RAW Options - ${fileName}`,
    body: [
      group("Image size (in pixels)", el("div", { class: "opt-row" }, el("label", {}, "Width: ", width), el("label", {}, " x Height: ", height)), sizes),
      group("Color channels", ...channelRadios.map((r) => r.row), paletteRow),
      group("File structure", el("label", { class: "form-row" }, el("span", {}, "Header size (in bytes):"), header), planar.row, interleaved.row, rgb.row, bgr.row, flipped.row),
      status,
    ],
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    beforeClose: (v) => {
      if (v !== "ok") return true;
      const W = Number(width.value), H = Number(height.value), hd = Number(header.value);
      const ok = Number.isInteger(W) && Number.isInteger(H) && Number.isInteger(hd) && W >= 1 && H >= 1 && W <= RAW_MAX_SIDE && H <= RAW_MAX_SIDE && hd >= 0 && hd <= RAW_MAX_SIDE;
      if (!ok) status.textContent = `Width and height are 1 to ${RAW_MAX_SIDE}; the header is 0 to ${RAW_MAX_SIDE} bytes.`;
      return ok;
    },
  });
  if (result !== "ok") return null;
  const o: RawReadOptions = {
    width: Number(width.value), height: Number(height.value), channels: channels(), header: Number(header.value),
    planar: planar.input.checked, bgr: bgr.input.checked, flipped: flipped.input.checked,
    palette: channels() === "grey" ? palettes[Number(paletteSel.value)]?.colors ?? null : null,
  };
  app.updateSettings((s) => { s.raw = { ...s.raw, channels: o.channels, header: o.header, planar: o.planar, bgr: o.bgr, flipped: o.flipped }; });
  return o;
}

/** The RAW save options; null when cancelled. `paletted` greys out the 24-bit options. */
export async function showRawSave(app: AppState, paletted: boolean): Promise<RawWriteOptions | null> {
  const last = app.settings.raw.save;
  const header = num(last.header, 0, RAW_MAX_SIDE);
  const flip = checkbox("Flip top and bottom", last.flipped);
  const rgb = radio("raw-save-order", "RGB order", !last.bgr), bgr = radio("raw-save-order", "BGR order", last.bgr);
  const planar = checkbox("Planar mode", last.planar);
  for (const c of [rgb.input, bgr.input, planar.input]) c.disabled = paletted;
  const result = await openDialog({
    title: "RAW",
    body: [
      group("Save options", el("label", { class: "form-row" }, el("span", {}, "Header size:"), header), flip.row),
      group("24 bit options", rgb.row, bgr.row, planar.row),
      el("p", { class: "opt-hint" }, paletted ? "The image is paletted: each pixel is saved as its palette index, one byte." : "Each pixel is saved as three bytes."),
    ],
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
  });
  if (result !== "ok") return null;
  const o: RawWriteOptions = { header: Math.max(0, Math.min(RAW_MAX_SIDE, Math.trunc(Number(header.value) || 0))), flipped: flip.input.checked, bgr: bgr.input.checked, planar: planar.input.checked };
  app.updateSettings((s) => { s.raw = { ...s.raw, save: o }; });
  return o;
}
