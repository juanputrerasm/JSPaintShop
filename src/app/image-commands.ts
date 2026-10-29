/*
  The Image menu's geometry: Flip and Mirror (active layer; with a selection, the selected
  pixels floated and flipped in place), Rotate (DIALOG 123), Resize (DIALOG 120), Canvas Size
  (DIALOG 146) and Add Borders (DIALOG 122). docs/PSP_EXE_ANALYSIS.md section 4.
*/
import type { Editor } from "./editor.ts";
import type { Colors } from "./colors.ts";
import { CMD, type CommandRegistry } from "../ui/shell/commands.ts";
import { el } from "../shared/dom.ts";
import { alertDialog, openDialog } from "../ui/shell/dialog.ts";
import { addBorders, flipRaster, rotateImage } from "../core/image/transform.ts";
import { resizeCanvas, placeRaster } from "../core/image/geometry.ts";
import { resample, resampleIndices, resampleMask, type ResampleMethod } from "../core/image/resample.ts";
import { float, floatingIndex } from "../core/select/floating.ts";
import { activeLayer, type ImageDoc } from "../core/doc/image-doc.ts";
import { maskBounds, type Rgba } from "../core/image/raster.ts";
import { extract } from "../core/image/geometry.ts";

const OK_CANCEL = [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }];

function num(value: number, min: number, max: number, step = 1): HTMLInputElement {
  return el("input", { type: "number", class: "spin", min, max, step, value });
}
const row = (label: string, ...c: Node[]) => el("label", { class: "form-row" }, el("span", {}, label), ...c);
const check = (label: string, on: boolean) => { const input = el("input", { type: "checkbox", checked: on }); return { input, row: el("label", { class: "opt-check" }, input, label) }; };
const radio = (name: string, label: string, on: boolean) => { const input = el("input", { type: "radio", name, checked: on }); return { input, row: el("label", { class: "opt-check" }, input, label) }; };

/* Flip or mirror: the floating selection (floated first when there is a selection) within its bounds, else the active layer. */
function flipDoc(doc: ImageDoc, vertical: boolean, bg: Rgba): void {
  if (doc.selection && floatingIndex(doc) < 0) float(doc, bg);
  const f = floatingIndex(doc);
  if (f >= 0 && doc.selection) {
    const layer = doc.layers[f];
    const b = maskBounds(doc.selection);
    if (!b) return;
    const part = flipRaster(extract(layer.raster, b), vertical);
    layer.raster = placeRaster(part, doc.width, doc.height, b.minX, b.minY);
    const sel = { ...doc.selection, data: new Uint8Array(doc.selection.data.length) };
    for (let y = b.minY; y <= b.maxY; y++) for (let x = b.minX; x <= b.maxX; x++) {
      const sx = vertical ? x : b.maxX - (x - b.minX), sy = vertical ? b.maxY - (y - b.minY) : y;
      sel.data[y * doc.width + x] = doc.selection.data[sy * doc.width + sx];
    }
    doc.selection = sel;
    return;
  }
  const l = activeLayer(doc);
  l.raster = flipRaster(l.raster, vertical);
  if (l.mask) {
    const m = { ...l.mask, data: new Uint8Array(l.mask.data.length) };
    for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) {
      m.data[y * doc.width + x] = l.mask.data[(vertical ? doc.height - 1 - y : y) * doc.width + (vertical ? x : doc.width - 1 - x)];
    }
    l.mask = m;
  }
}

export function bindImageCommands(registry: CommandRegistry, ed: Editor, colors: Colors): void {
  const has = () => ed.image !== null;
  registry.bind(CMD.IMAGE_FLIP, () => ed.run("Flip", (d) => flipDoc(d, true, colors.bg)), { enabled: has });
  registry.bind(CMD.IMAGE_MIRROR, () => ed.run("Mirror", (d) => flipDoc(d, false, colors.bg)), { enabled: has });

  let rotateLast = { right: true, degrees: 90, free: 45, all: false };
  registry.bind(CMD.IMAGE_ROTATE, async () => {
    const r = rotateLast;
    const right = radio("dir", "Right", r.right), left = radio("dir", "Left", !r.right);
    const d90 = radio("deg", "90", r.degrees === 90), d180 = radio("deg", "180", r.degrees === 180), d270 = radio("deg", "270", r.degrees === 270), free = radio("deg", "Free:", r.degrees === 0);
    const freeValue = num(r.free, 0.01, 359.99, 0.01);
    const all = check("All Layers", r.all);
    const v = await openDialog({
      title: "Rotate", body: el("div", { class: "layer-props" },
        el("fieldset", { class: "opt-group" }, el("legend", {}, "Direction"), right.row, left.row),
        el("fieldset", { class: "opt-group" }, el("legend", {}, "Degrees"), d90.row, d180.row, d270.row, el("div", { class: "opt-check" }, free.row, freeValue, "(.01-359.99)")),
        all.row),
      buttons: OK_CANCEL,
    });
    if (v !== "ok") return;
    const degrees = d90.input.checked ? 90 : d180.input.checked ? 180 : d270.input.checked ? 270 : Math.max(0.01, Math.min(359.99, Number(freeValue.value) || 0));
    rotateLast = { right: right.input.checked, degrees: free.input.checked ? 0 : degrees, free: Number(freeValue.value) || 45, all: all.input.checked };
    ed.run("Rotate", (d) => rotateImage(d, right.input.checked ? degrees : -degrees, all.input.checked, colors.bg));
  }, { enabled: has });

  registry.bind(CMD.IMAGE_RESIZE, async () => {
    const doc = ed.image?.doc;
    if (!doc) return;
    const byPixels = radio("by", "Pixel Size", true), byPercent = radio("by", "Percentage of Original", false), byPrint = radio("by", "Actual / Print Size", false);
    const w = num(doc.width, 1, 32767), h = num(doc.height, 1, 32767);
    const pw = num(100, 1, 9999), ph = num(100, 1, 9999);
    const iw = num(+(doc.width / doc.dpi).toFixed(3), 0.001, 9999, 0.001), ih = num(+(doc.height / doc.dpi).toFixed(3), 0.001, 9999, 0.001), res = num(doc.dpi, 1, 9999);
    // DLGINIT of DIALOG 120: the Resize Type list, in PSP's order.
    const type = el("select", {}, ...["Smart size", "Bilinear resample", "Bicubic resample", "Pixel resize"].map((t) => el("option", {}, t)));
    const all = check("Resize All Layers", true), aspect = check("Maintain aspect ratio", true);
    const ratio = doc.width / doc.height;
    const link = (a: HTMLInputElement, b: HTMLInputElement, f: (x: number) => number) => a.addEventListener("input", () => { if (aspect.input.checked) b.value = String(+f(Number(a.value)).toFixed(3)); });
    link(w, h, (x) => Math.round(x / ratio)); link(h, w, (x) => Math.round(x * ratio));
    link(pw, ph, (x) => x); link(ph, pw, (x) => x);
    link(iw, ih, (x) => x / ratio); link(ih, iw, (x) => x * ratio);
    const v = await openDialog({
      title: "Resize", body: el("div", { class: "layer-props" },
        byPixels.row, row("Width x Height", w, h), byPercent.row, row("Width x Height %", pw, ph), byPrint.row, row("Width x Height (in)", iw, ih), row("Resolution", res),
        row("Resize Type", type), all.row, aspect.row),
      buttons: OK_CANCEL,
    });
    if (v !== "ok") return;
    let nw: number, nh: number, dpi = doc.dpi;
    if (byPercent.input.checked) { nw = Math.round((doc.width * Number(pw.value)) / 100); nh = Math.round((doc.height * Number(ph.value)) / 100); }
    else if (byPrint.input.checked) { dpi = Number(res.value) || doc.dpi; nw = Math.round(Number(iw.value) * dpi); nh = Math.round(Number(ih.value) * dpi); }
    else { nw = Number(w.value); nh = Number(h.value); }
    nw = Math.max(1, Math.min(32767, nw)); nh = Math.max(1, Math.min(32767, nh));
    let method = (["smart", "bilinear", "bicubic", "pixel"] as ResampleMethod[])[type.selectedIndex];
    // Psp.exe 0x5ee800: images that are neither 24-bit nor greyscale are only pixel resized.
    if (!(doc.depth === 24 || doc.greyscale)) {
      if (method === "bilinear" || method === "bicubic") {
        await alertDialog("JSPaintShop", "Resampling is only supported for greyscale images or 24 bit true-color images.");
        return;
      }
      method = "pixel";
    }
    if (nw === doc.width && nh === doc.height) return;
    ed.run("Resize", (d) => {
      if (all.input.checked) {
        for (const l of d.layers) {
          l.raster = resample(l.raster, nw, nh, method);
          if (l.mask) l.mask = resampleMask(l.mask, nw, nh, method);
        }
        if (d.indices) d.indices = resampleIndices(d.indices, d.width, d.height, nw, nh);
        d.width = nw; d.height = nh; d.selection = null; d.alphas = []; d.dpi = dpi;
      } else {
        // Psp.exe 0x738b60: the layer's contents are resized by the image's ratio about their center.
        const l = activeLayer(d), r = l.raster;
        let minX = r.width, minY = r.height, maxX = -1, maxY = -1;
        for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
          if (!r.data[(y * r.width + x) * 4 + 3]) continue;
          if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        if (maxX < 0) return;
        const bw = maxX - minX + 1, bh = maxY - minY + 1;
        const tw = Math.max(1, Math.trunc((bw * nw) / d.width)), th = Math.max(1, Math.trunc((bh * nh) / d.height));
        const part = resample(extract(r, { minX, minY, maxX, maxY }), tw, th, method);
        l.raster = placeRaster(part, d.width, d.height, minX + Math.trunc(bw / 2) - Math.trunc(tw / 2), minY + Math.trunc(bh / 2) - Math.trunc(th / 2));
      }
    });
  }, { enabled: has });

  registry.bind(CMD.IMAGE_CANVAS_SIZE, async () => {
    const doc = ed.image?.doc;
    if (!doc) return;
    const w = num(doc.width, 1, 32767), h = num(doc.height, 1, 32767);
    const ch = check("Center Image Horizontally", true), cv = check("Center Image Vertically", true);
    const top = num(0, -32767, 32767), left = num(0, -32767, 32767);
    const v = await openDialog({
      title: "Change Canvas Size", body: el("div", { class: "layer-props" },
        row("New Width:", w), row("New Height:", h), el("p", { class: "opt-hint" }, `Current: ${doc.width} x ${doc.height}`),
        ch.row, cv.row, row("Top:", top), row("Left:", left)),
      buttons: OK_CANCEL,
    });
    if (v !== "ok") return;
    const nw = Math.max(1, Number(w.value)), nh = Math.max(1, Number(h.value));
    const dx = ch.input.checked ? Math.floor((nw - doc.width) / 2) : Number(left.value) || 0;
    const dy = cv.input.checked ? Math.floor((nh - doc.height) / 2) : Number(top.value) || 0;
    ed.run("Canvas Size", (d) => resizeCanvas(d, nw, nh, dx, dy, colors.bg));
  }, { enabled: has });

  registry.bind(CMD.IMAGE_ADD_BORDERS, async () => {
    if (!ed.image) return;
    const sym = check("Symmetric", true);
    const t = num(10, 0, 9999), b = num(10, 0, 9999), l = num(10, 0, 9999), r = num(10, 0, 9999);
    for (const x of [t, b, l, r]) x.addEventListener("input", () => { if (sym.input.checked) for (const y of [t, b, l, r]) if (y !== x) y.value = x.value; });
    const v = await openDialog({ title: "Add Borders", body: el("div", { class: "layer-props" }, sym.row, row("Top:", t), row("Bottom:", b), row("Left:", l), row("Right:", r), el("p", { class: "opt-hint" }, "The border takes the background color.")), buttons: OK_CANCEL });
    if (v !== "ok") return;
    ed.run("Add Borders", (d) => addBorders(d, Number(l.value) || 0, Number(t.value) || 0, Number(r.value) || 0, Number(b.value) || 0, colors.bg));
  }, { enabled: () => Boolean(ed.image && ed.image.doc.layers.length === 1) });
}
