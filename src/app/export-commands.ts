/*
  File > Export > Transparent GIF and JPEG File: PSP 6's two wizards ("GifWiz.cpp").

  Transparent GIF Wizard  transparency (DIALOG 27019, or 27023 when the image has transparent
                          areas), the web page's background color (3004), the web-safe palette
                          (150), quality and size (27020, nine steps of colors), the result
                          (27021) with its file size; Finish saves.
  JPEG Wizard             quality and size (512, compression 0..100), Standard or Progressive
                          (549), the result (544); Finish saves.

  Progressive JPEG is listed but greyed: the browser's JPEG encoder writes baseline only.
*/
import type { Editor } from "./editor.ts";
import type { AppState } from "./state.ts";
import type { Colors } from "./colors.ts";
import type { WorkerClient } from "../shared/worker-client.ts";
import { CMD, type CommandRegistry } from "../ui/shell/commands.ts";
import { el } from "../shared/dom.ts";
import { openDialog, alertDialog } from "../ui/shell/dialog.ts";
import { pickSaveFile, writeTarget } from "../ui/shell/file-dialogs.ts";
import { composite } from "../core/layers/composite.ts";
import { encodeGif } from "../core/formats/gif.ts";
import { GIF_WIZARD_COLORS, prepareGif, type GifExportOptions } from "../core/formats/gif-export.ts";
import type { Raster, Rgba } from "../core/image/raster.ts";

interface Page { title: string; body: HTMLElement; enter?: () => void | Promise<void> }

/* Back, Next and Finish over a list of pages; resolves true on Finish. */
async function wizard(title: string, pages: Page[]): Promise<boolean> {
  let at = 0;
  const holder = el("div", { class: "wiz-page" });
  const count = el("div", { class: "wiz-count" });
  const back = el("button", { type: "button" }, "< Back"), next = el("button", { type: "button" }, "Next >");
  const show = async () => {
    holder.replaceChildren(el("h3", { class: "wiz-title" }, pages[at].title), pages[at].body);
    count.textContent = `page ${at + 1} of ${pages.length}`;
    back.disabled = at === 0;
    next.disabled = at === pages.length - 1;
    await pages[at].enter?.();
  };
  back.addEventListener("click", () => { if (at > 0) { at--; void show(); } });
  next.addEventListener("click", () => { if (at < pages.length - 1) { at++; void show(); } });
  void show();
  const v = await openDialog({
    title, className: "wiz-dialog",
    body: [holder, el("div", { class: "wiz-nav" }, count, back, next)],
    buttons: [{ label: "Finish", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
  });
  return v === "ok";
}

const hex = (c: readonly number[]) => `#${[0, 1, 2].map((i) => c[i].toString(16).padStart(2, "0")).join("")}`;
const rgb = (h: string): Rgba => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];

/* A checkerboard preview of a raster, scaled to fit 240 x 160. */
function preview(r: Raster): HTMLCanvasElement {
  const s = Math.min(1, 240 / r.width, 160 / r.height), w = Math.max(1, Math.round(r.width * s)), h = Math.max(1, Math.round(r.height * s));
  const c = el("canvas", { width: w, height: h, class: "wiz-preview" }) as HTMLCanvasElement;
  const g = c.getContext("2d")!;
  for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) { g.fillStyle = ((x + y) / 8) & 1 ? "#c0c0c0" : "#ffffff"; g.fillRect(x, y, 8, 8); }
  const src = new OffscreenCanvas(r.width, r.height);
  src.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
  g.drawImage(src, 0, 0, w, h);
  return c;
}

const slider = (min: number, max: number, value: number, left: string, right: string, on: (v: number) => void) => {
  const r = el("input", { type: "range", min, max, value, class: "wiz-slider" });
  r.addEventListener("input", () => on(Number(r.value)));
  return el("div", { class: "wiz-slider-row" }, el("span", {}, left), r, el("span", {}, right));
};
const radio = (name: string, label: string, checked: boolean, on: () => void, disabled = false) => {
  const r = el("input", { type: "radio", name, checked, disabled });
  r.addEventListener("change", () => { if (r.checked) on(); });
  return el("label", { class: `opt-check${disabled ? " disabled" : ""}` }, r, label);
};
const note = (text: string) => el("p", { class: "wiz-text" }, text);

export function bindExportCommands(registry: CommandRegistry, ed: Editor, app: AppState, colors: Colors, worker: WorkerClient): void {
  const has = () => ed.image !== null;

  registry.bind(CMD.FILE_EXPORT_TRANSPARENT_GIF, async () => {
    const image = ed.image;
    if (!image) return;
    const flat = composite(image.doc);
    const hasTransparent = flat.data.some((v, i) => (i & 3) === 3 && v < 255);
    const o: GifExportOptions = { transparency: hasTransparent ? "existing" : "none", color: [...colors.bg] as Rgba, background: [...colors.bg] as Rgba, webSafe: false, colors: 256 };
    let slot = 0;
    const transColor = el("input", { type: "color", value: hex(o.color) });
    transColor.addEventListener("input", () => { o.color = rgb(transColor.value); });
    const bgColor = el("input", { type: "color", value: hex(o.background) });
    bgColor.addEventListener("input", () => { o.background = rgb(bgColor.value); });
    const result = el("div", { class: "wiz-result" });
    let bytes: Uint8Array | null = null;
    const pages: Page[] = [
      { title: "Welcome to the Transparent GIF Wizard", body: el("div", {},
        note(hasTransparent ? "Your image contains some transparent areas. These will remain transparent in the final output. You may instead select a color that will become transparent." : "Please select the color that will be transparent."),
        radio("gt", "No transparency", o.transparency === "none", () => { o.transparency = "none"; }),
        radio("gt", "Convert matching colors to transparent", false, () => { o.transparency = "color"; }),
        hasTransparent ? radio("gt", "Use existing transparent areas", true, () => { o.transparency = "existing"; }) : el("span"),
        el("label", { class: "form-row" }, el("span", {}, "The parts of the image that match this color will become transparent:"), transColor)) },
      { title: "What is the color of your background?", body: el("div", {},
        note("The Wizard needs to know the background color of your Web page. This may be the same as the transparent color you selected earlier, or it may be different."),
        el("label", { class: "form-row" }, el("span", {}, "Background color:"), bgColor)) },
      { title: "Web-safe palette", body: el("div", {},
        note("There is a set of colors which is guaranteed to view properly with most web browsers, called the Web-safe palette. If you choose not to use this palette, the image may look better on your system, but worse when viewed by other people over the web."),
        radio("gw", "Yes, use Web-safe colors only", false, () => { o.webSafe = true; }),
        radio("gw", "No, choose the best colors", true, () => { o.webSafe = false; })) },
      { title: "Quality and size", body: el("div", {},
        note("The number of colors in a GIF file is limited to 256 or less. A small number of colors may result in a smaller file. A large number of colors may result in a better looking image."),
        slider(0, 8, slot, "Better Image Quality", "Smaller File Size", (v) => { slot = v; o.colors = GIF_WIZARD_COLORS[v]; })) },
      { title: "Result", body: result, enter: () => {
        const { raster, indexed } = prepareGif(flat, o);
        bytes = encodeGif(raster, indexed, indexed.transparent);
        result.replaceChildren(note("This is the result of the settings you have chosen. The checkerboard shows the areas that are transparent."), preview(raster),
          note(`${indexed.palette.length / 3} colors, ${bytes.length.toLocaleString()} bytes. Click Finish to save your transparent GIF file.`));
      } },
    ];
    if (!(await wizard("Transparent GIF Wizard", pages))) return;
    if (!bytes) { const p = prepareGif(flat, o); bytes = encodeGif(p.raster, p.indexed, p.indexed.transparent); }
    try {
      const target = await pickSaveFile(image.name, "CompuServe Graphics Interchange", ".gif", "image/gif");
      if (target) await writeTarget(target, bytes, "image/gif");
    } catch (err) {
      await alertDialog("Transparent GIF Wizard", err instanceof Error ? err.message : String(err));
    }
  }, { enabled: has });

  registry.bind(CMD.FILE_EXPORT_JPEG_FILE, async () => {
    const image = ed.image;
    if (!image) return;
    let compression = 100 - app.settings.jpegQuality;
    const result = el("div", { class: "wiz-result" });
    let bytes: Uint8Array | null = null;
    const encode = async () => worker.call<Uint8Array>("file.write", { doc: image.doc, format: "jpeg", quality: Math.max(1, 100 - compression) });
    const value = el("span", { class: "wiz-value" }, String(compression));
    const pages: Page[] = [
      { title: "Welcome to the JPEG Wizard", body: el("div", {},
        note("The compression value in a JPEG affects the size and the quality of the file. A larger compression value may result in a smaller file. A smaller value may result in a better looking image."),
        slider(0, 100, compression, "Better Image Quality", "Smaller File Size", (v) => { compression = v; value.textContent = String(v); }), value) },
      { title: "Format", body: el("div", {},
        note("JPEG files may be encoded as either standard or progressive. This affects how the image is shown on a slow connection."),
        radio("jf", "Standard", true, () => undefined),
        radio("jf", "Progressive (not available: the browser writes standard JPEG files only)", false, () => undefined, true)) },
      { title: "Result", body: result, enter: async () => {
        result.replaceChildren(note("Compressing..."));
        bytes = await encode();
        const back = await worker.call<{ doc: { layers: { raster: Raster }[] } }>("file.read", { bytes, name: "preview.jpg" });
        result.replaceChildren(note("This is the result of the settings you have chosen."), preview(back.doc.layers[0].raster),
          note(`${bytes.length.toLocaleString()} bytes. Click Finish to save your JPEG file.`));
      } },
    ];
    if (!(await wizard("JPEG Wizard", pages))) return;
    try {
      bytes ??= await encode();
      const target = await pickSaveFile(image.name, "JPEG - JFIF Compliant", ".jpg", "image/jpeg");
      if (target) await writeTarget(target, bytes, "image/jpeg");
      app.updateSettings((s) => { s.jpegQuality = Math.max(1, 100 - compression); });
    } catch (err) {
      await alertDialog("JPEG Wizard", err instanceof Error ? err.message : String(err));
    }
  }, { enabled: has });
}
