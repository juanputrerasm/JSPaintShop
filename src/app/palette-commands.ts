/*
  Colors menu: Decrease and Increase Color Depth (DIALOGS 180-184), the palette commands
  (Edit, Load, Save, Set and View Palette Transparency) and Channel Splitting/Combining.

  A paletted image has one layer, as in PSP: decreasing the depth of a layered image merges
  it first.
*/
import type { Editor } from "./editor.ts";
import type { Workspace } from "./workspace.ts";
import type { Colors } from "./colors.ts";
import { ImageDocument } from "./image-document.ts";
import { CMD, type CommandRegistry } from "../ui/shell/commands.ts";
import { el } from "../shared/dom.ts";
import { openDialog, alertDialog, confirmDialog } from "../ui/shell/dialog.ts";
import { pickOpenFile, pickSaveFile, writeTarget } from "../ui/shell/file-dialogs.ts";
import { showColorDialog } from "../ui/dialogs/color-dialog.ts";
import type { AppState } from "./state.ts";
import { applyPalette, medianCutPalette, octreePalette, pspDither, reduceBits, webSafePalette, WINDOWS_16, type PspReduction, type Reduction } from "../core/color/reduce.ts";
import { readPal, writePal } from "../core/formats/pal.ts";
import { flatten } from "../core/layers/layer-ops.ts";
import { newImage, rasterLayer, type ColorDepth, type ImageDoc } from "../core/doc/image-doc.ts";
import { luminance, pspHslToRgb, pspRgbToHsl, rgbToCmyk, cmykToRgb } from "../core/color/color-space.ts";
import { createRaster } from "../core/image/raster.ts";
import { arithmetic, ARITHMETIC } from "../core/color/arithmetic.ts";

const OK_CANCEL = [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }];
const radios = (name: string, labels: string[], on: number) => {
  const inputs = labels.map((l, i) => el("input", { type: "radio", name, checked: i === on }));
  return { inputs, rows: labels.map((l, i) => el("label", { class: "opt-check" }, inputs[i], l)), value: () => inputs.findIndex((x) => x.checked) };
};

/* Put the merged image on `pal`, as the one layer of a paletted image. */
function toPalette(doc: ImageDoc, pal: Uint8Array, how: Reduction, depth: ColorDepth, bg: [number, number, number, number]): void {
  if (doc.layers.length > 1 || doc.layers[0].raster.data.some((v, i) => (i & 3) === 3 && v < 255)) flatten(doc, bg);
  const r = { ...doc.layers[0].raster, data: new Uint8ClampedArray(doc.layers[0].raster.data) };
  doc.indices = applyPalette(r, pal, how);
  doc.layers = [rasterLayer("Background", r)];
  doc.active = 0;
  const full = new Uint8Array(Math.max(pal.length, (1 << depth) * 3));
  full.set(pal);
  doc.palette = full;
  doc.depth = depth;
  doc.greyscale = false;
  delete doc.transparentIndex;
}

export function bindPaletteCommands(app: AppState, registry: CommandRegistry, ed: Editor, ws: Workspace, colors: Colors): void {
  const has = () => ed.image !== null;
  const paletted = () => Boolean(ed.image && ed.image.doc.depth <= 8 && ed.image.doc.palette);
  // PSP's enable rules (Psp.exe 0x4d88e0) test the DIB's bit count; 32K and 64K images are 24 bit there.
  const bitCount = () => (ed.image ? (ed.image.doc.depth > 8 ? 24 : ed.image.doc.depth) : 0);
  const bitsAtLeast = (n: number) => () => Boolean(ed.image) && bitCount() >= n;
  // A paletted DIB always carries 2^bits entries; the ones a palette does not fill are black.
  const fullPalette = (pal: Uint8Array, depth: number) => { const out = new Uint8Array(Math.max(pal.length, (1 << depth) * 3)); out.set(pal); return out; };

  /*
    DIALOGS 182 (256 colors), 184 (16 colors) and 180 (X colors): the palette, the reduction
    (no ordered dither for X colors; ordered dither needs the standard palette, which PSP maps
    from its thresholds), Boost marked colors (the selection, 1 to 10 times; median cut),
    Include Windows colors (256 and X) and Reduce color bleeding (error diffusion).
  */
  const reduceDialog = async (title: string, colorsCount: number | null, palettes: string[], windows: boolean) => {
    const pal = radios("pal", palettes, 0);
    const methods = colorsCount === null ? ["Nearest color", "Error diffusion"] : ["Nearest color", "Ordered dither", "Error diffusion"];
    const red = radios("red", methods, methods.length - 1);
    const count = el("input", { type: "number", class: "spin", min: 2, max: 256, value: 256 });
    const boost = el("input", { type: "checkbox" }), boostBy = el("input", { type: "number", class: "spin", min: 1, max: 10, value: 1 });
    const include = el("input", { type: "checkbox" }), bleed = el("input", { type: "checkbox" });
    const standard = palettes.length - 1;
    const sync = () => {
      const ordered = colorsCount !== null ? red.inputs[1] : null;
      if (ordered) { ordered.disabled = pal.value() !== standard; if (ordered.disabled && ordered.checked) red.inputs[2].checked = true; }
      boost.disabled = boostBy.disabled = pal.value() !== 0;
      include.disabled = pal.value() === standard;
      bleed.disabled = !red.inputs[red.inputs.length - 1].checked;
    };
    for (const i of [...pal.inputs, ...red.inputs]) i.addEventListener("change", sync);
    sync();
    const v = await openDialog({
      title, buttons: OK_CANCEL,
      body: el("div", { class: "layer-props" },
        colorsCount === null ? el("label", { class: "form-row" }, el("span", {}, "Number of colors (2-256):"), count) : null,
        el("fieldset", { class: "opt-group" }, el("legend", {}, "Palette"), ...pal.rows),
        el("fieldset", { class: "opt-group" }, el("legend", {}, "Reduction method"), ...red.rows),
        el("fieldset", { class: "opt-group" }, el("legend", {}, "Options"),
          el("label", { class: "opt-check" }, boost, "Boost marked colors by ", boostBy, " (1 to 10)"),
          windows ? el("label", { class: "opt-check" }, include, "Include Windows' colors") : null,
          el("label", { class: "opt-check" }, bleed, "Reduce color bleeding"))),
    });
    if (v !== "ok") return null;
    const method = methods[red.value()];
    return {
      palette: pal.value() === standard ? "standard" : pal.value() === 1 ? "octree" : "median",
      reduction: (method === "Nearest color" ? "nearest" : method === "Ordered dither" ? "ordered" : "error") as PspReduction,
      count: Math.max(2, Math.min(256, Number(count.value) || 256)),
      boost: boost.checked && !boost.disabled ? Math.max(1, Math.min(10, Number(boostBy.value) || 1)) : 1,
      include: windows && include.checked && !include.disabled,
      bleeding: bleed.checked && !bleed.disabled,
    };
  };

  const decrease = (id: number, title: string, n: number | null, depth: ColorDepth, palettes: string[], standard: () => Uint8Array, standardCount: number, windows: boolean, minBits: number) =>
    registry.bind(id, async () => {
      const image = ed.image;
      if (!image) return;
      if (image.doc.layers.length > 1 && !(await confirmDialog("JSPaintShop", "This image has layers. It will be merged into one layer first.", "Merge"))) return;
      const o = await reduceDialog(title, n, palettes, windows);
      if (!o) return;
      ed.run(title, (d) => {
        const tmp = { ...d, layers: [...d.layers] };
        flatten(tmp, colors.bg);
        const src = tmp.layers[0].raster;
        const count = n ?? o.count;
        let pal: Uint8Array, used: number;
        if (o.palette === "standard") { pal = standard(); used = standardCount; }
        else {
          pal = o.palette === "octree" ? octreePalette(src, count, o.include) : medianCutPalette(src, count, o.include, d.selection?.data ?? null, o.boost);
          used = pal.length / 3;
        }
        if (d.layers.length > 1 || d.layers[0].raster.data.some((v, i) => (i & 3) === 3 && v < 255)) flatten(d, colors.bg);
        const r = { ...d.layers[0].raster, data: new Uint8ClampedArray(d.layers[0].raster.data) };
        const indices = pspDither(r, pal, o.reduction, o.bleeding, used);
        const bits: ColorDepth = n === null ? (count <= 16 ? 4 : 8) : depth;
        const full = fullPalette(pal, bits);
        d.layers = [rasterLayer("Background", r)];
        d.active = 0;
        d.palette = full;
        d.indices = indices;
        d.depth = bits;
        d.greyscale = false;
        delete d.transparentIndex;
      }, image);
    }, { enabled: bitsAtLeast(minBits) });
  // PSP's standard 256 palette is the 216-color cube followed by 40 black entries.
  const cube256 = () => { const p = new Uint8Array(768); p.set(webSafePalette()); return p; };
  decrease(CMD.COLORS_DECREASE_COLOR_DEPTH_16_COLORS_4_BIT, "Decrease Color Depth - 16 Colors", 16, 4, ["Optimized Median Cut", "Optimized Octree", "Windows'"], () => Uint8Array.from(WINDOWS_16), 16, false, 5);
  decrease(CMD.COLORS_DECREASE_COLOR_DEPTH_256_COLORS_8_BIT, "Decrease Color Depth - 256 Colors", 256, 8, ["Optimized Median Cut", "Optimized Octree", "Standard / Web-safe"], cube256, 216, true, 24);
  decrease(CMD.COLORS_DECREASE_COLOR_DEPTH_X_COLORS_4_8_BIT, "Decrease Color Depth - X Colors", null, 8, ["Optimized Median Cut", "Optimized Octree", "Standard / Web-safe"], cube256, 216, true, 5);

  registry.bind(CMD.COLORS_DECREASE_COLOR_DEPTH_2_COLORS_1_BIT, async () => {
    const image = ed.image;
    if (!image) return;
    const comp = radios("comp", ["Grey values", "Red components", "Green components", "Blue components"], 0);
    const red = radios("red", ["Nearest color", "Ordered dither", "Floyd-Steinberg", "Burkes", "Stucki"], 2);
    const v = await openDialog({ title: "Decrease Color Depth - 2 Colors", buttons: OK_CANCEL, body: el("div", { class: "layer-props" },
      el("fieldset", { class: "opt-group" }, el("legend", {}, "Palette component"), ...comp.rows),
      el("fieldset", { class: "opt-group" }, el("legend", {}, "Reduction method"), ...red.rows)) });
    if (v !== "ok") return;
    ed.run("Decrease Color Depth - 2 Colors", (d) => {
      flatten(d, colors.bg);
      const r = d.layers[0].raster;
      const c = comp.value();
      for (let i = 0; i < r.data.length; i += 4) {
        const g = c === 0 ? luminance(r.data[i], r.data[i + 1], r.data[i + 2]) : r.data[i + c - 1];
        r.data[i] = r.data[i + 1] = r.data[i + 2] = g;
      }
      toPalette(d, Uint8Array.from([0, 0, 0, 255, 255, 255]), (["nearest", "ordered", "floyd", "burkes", "stucki"] as Reduction[])[red.value()], 1, colors.bg);
    }, image);
  }, { enabled: () => bitCount() > 1 });

  const bits = (id: number, title: string, green: 5 | 6, depth: ColorDepth) => registry.bind(id, () => ed.run(title, (d) => {
    flatten(d, colors.bg);
    const r = { ...d.layers[0].raster, data: new Uint8ClampedArray(d.layers[0].raster.data) };
    reduceBits(r, green);
    d.layers[0].raster = r;
    d.depth = depth;
    d.palette = null;
    delete d.transparentIndex;
  }), { enabled: () => bitCount() === 24 });
  bits(CMD.COLORS_DECREASE_COLOR_DEPTH_32K_COLORS_24_BIT, "Decrease Color Depth - 32K Colors", 5, 15);
  bits(CMD.COLORS_DECREASE_COLOR_DEPTH_64K_COLORS_24_BIT, "Decrease Color Depth - 64K Colors", 6, 16);

  // jdib's INCDEPTH (Psp.exe 0x7f3d40): the indexes stay, the palette grows to 2^bits entries
  // with the old colors first and black after them.
  const increase = (id: number, title: string, depth: ColorDepth, ok: (d: ImageDoc) => boolean) => registry.bind(id, () => ed.run(title, (d) => {
    d.depth = depth;
    if (depth > 8) { d.palette = null; d.greyscale = false; delete d.transparentIndex; delete d.indices; }
    else if (d.palette) d.palette = fullPalette(d.palette, depth);
  }), { enabled: () => Boolean(ed.image && ok(ed.image.doc)) });
  increase(CMD.COLORS_INCREASE_COLOR_DEPTH_16_COLORS_4_BIT, "Increase Color Depth - 16 Colors", 4, (d) => d.depth === 1);
  increase(CMD.COLORS_INCREASE_COLOR_DEPTH_256_COLORS_8_BIT, "Increase Color Depth - 256 Colors", 8, (d) => d.depth < 8);
  increase(CMD.COLORS_INCREASE_COLOR_DEPTH_16_MILLION_COLORS_24_BIT, "Increase Color Depth - 16 Million Colors", 24, (d) => d.depth < 24);

  // ---- Palette transparency ----
  // Set Palette Transparency: none, the background color's nearest entry, or a chosen entry.
  registry.bind(CMD.COLORS_SET_PALETTE_TRANSPARENCY, async () => {
    const image = ed.image;
    if (!image?.doc.palette) return;
    const d = image.doc, count = d.palette!.length / 3;
    const nearest = (c: readonly number[]) => {
      let best = 0, bd = Infinity;
      for (let k = 0; k < count; k++) { const e = (d.palette![k * 3] - c[0]) ** 2 + (d.palette![k * 3 + 1] - c[1]) ** 2 + (d.palette![k * 3 + 2] - c[2]) ** 2; if (e < bd) { bd = e; best = k; } }
      return best;
    };
    const how = radios("ptr", ["No transparency", "Set the transparency value to the current background color", "Set the transparency value to palette entry:"], d.transparentIndex === undefined ? 0 : 2);
    const entry = el("input", { type: "number", class: "spin", min: 0, max: count - 1, value: d.transparentIndex ?? nearest(colors.bg) });
    const swatch = el("span", { class: "color-swatch" });
    const show = () => { const k = Math.max(0, Math.min(count - 1, Number(entry.value) || 0)); swatch.style.background = `rgb(${d.palette![k * 3]} ${d.palette![k * 3 + 1]} ${d.palette![k * 3 + 2]})`; };
    entry.addEventListener("input", show); show();
    const v = await openDialog({ title: "Set Palette Transparency", buttons: OK_CANCEL, body: el("div", { class: "layer-props" }, how.rows[0], how.rows[1], el("div", { class: "form-row" }, how.rows[2], entry, swatch)) });
    if (v !== "ok") return;
    const k = [undefined, nearest(colors.bg), Math.max(0, Math.min(count - 1, Number(entry.value) || 0))][how.value()];
    ed.run("Set Palette Transparency", (doc) => { if (k === undefined) delete doc.transparentIndex; else doc.transparentIndex = k; return { image: true }; }, image);
    if (k !== undefined && !image.viewPaletteTransparency) { image.viewPaletteTransparency = true; image.changed({ image: true }); }
  }, { enabled: paletted });
  registry.bind(CMD.COLORS_VIEW_PALETTE_TRANSPARENCY, () => {
    const image = ed.image;
    if (!image) return;
    image.viewPaletteTransparency = !image.viewPaletteTransparency;
    image.changed({ image: true });
  }, { enabled: () => Boolean(ed.image?.doc.transparentIndex !== undefined && ed.image?.doc.palette), checked: () => Boolean(ed.image?.viewPaletteTransparency) });

  // ---- Palette ----
  registry.bind(CMD.COLORS_EDIT_PALETTE, async () => {
    const image = ed.image;
    if (!image?.doc.palette) return;
    const pal = new Uint8Array(image.doc.palette);
    const grid = el("div", { class: "pal-edit" });
    const draw = () => grid.replaceChildren(...Array.from({ length: pal.length / 3 }, (_, i) => el("button", {
      type: "button", class: "color-swatch", title: `${i}: ${pal[i * 3]}, ${pal[i * 3 + 1]}, ${pal[i * 3 + 2]}`,
      style: { background: `rgb(${pal[i * 3]} ${pal[i * 3 + 1]} ${pal[i * 3 + 2]})` },
      onclick: async () => { const c = await showColorDialog(app, [pal[i * 3], pal[i * 3 + 1], pal[i * 3 + 2], 255]); if (c) { pal.set(c.slice(0, 3), i * 3); draw(); } },
    })));
    draw();
    const v = await openDialog({ title: "Edit Palette", body: grid, buttons: OK_CANCEL });
    if (v !== "ok") return;
    ed.run("Edit Palette", (d) => {
      const old = d.palette!;
      // Every pixel keeps its index: its color follows the palette entry.
      const map = new Map<number, number>();
      for (let k = 0; k < old.length / 3; k++) map.set((old[k * 3] << 16) | (old[k * 3 + 1] << 8) | old[k * 3 + 2], k);
      for (const l of d.layers) {
        const r = { ...l.raster, data: new Uint8ClampedArray(l.raster.data) };
        for (let i = 0; i < r.data.length; i += 4) {
          const k = map.get((r.data[i] << 16) | (r.data[i + 1] << 8) | r.data[i + 2]);
          if (k !== undefined) r.data.set(pal.subarray(k * 3, k * 3 + 3), i);
        }
        l.raster = r;
      }
      d.palette = pal;
      return { palette: true, image: true };
    }, image);
  }, { enabled: paletted });
  registry.bind(CMD.COLORS_LOAD_PALETTE, async () => {
    const f = await pickOpenFile("Palette", [".pal"]);
    if (!f || !ed.image) return;
    try {
      const pal = readPal(await f.file.text());
      ed.run("Load Palette", (d) => toPalette(d, pal, "nearest", pal.length / 3 <= 2 ? 1 : pal.length / 3 <= 16 ? 4 : 8, colors.bg));
    } catch (err) { await alertDialog("JSPaintShop", err instanceof Error ? err.message : String(err)); }
  }, { enabled: has });
  registry.bind(CMD.COLORS_SAVE_PALETTE, async () => {
    const pal = ed.image?.doc.palette;
    if (!pal) return;
    const t = await pickSaveFile(ed.image!.name, "Palette", ".pal", "text/plain");
    if (t) await writeTarget(t, new TextEncoder().encode(writePal(pal)), "text/plain");
  }, { enabled: paletted });

  // ---- Channels ----
  const splitTo = (labels: string[], f: (r: number, g: number, b: number) => number[]) => () => {
    const image = ed.image;
    if (!image) return;
    const src = image.composite, n = src.width * src.height;
    const outs = labels.map(() => createRaster(src.width, src.height));
    for (let p = 0; p < n; p++) {
      const v = f(src.data[p * 4], src.data[p * 4 + 1], src.data[p * 4 + 2]);
      outs.forEach((o, k) => o.data.set([v[k], v[k], v[k], 255], p * 4));
    }
    outs.forEach((o, k) => {
      const d = newImage(src.width, src.height, image.doc.dpi, [0, 0, 0, 255], 8, true);
      d.layers = [rasterLayer("Background", o)];
      ws.show(new ImageDocument(d, `${labels[k]}${ws.nextName().replace("Image", "")}`));
    });
  };
  const hsl = [0, 0, 0];
  registry.bind(CMD.COLORS_CHANNEL_SPLITTING_SPLIT_TO_RGB, splitTo(["Red", "Green", "Blue"], (r, g, b) => [r, g, b]), { enabled: has });
  registry.bind(CMD.COLORS_CHANNEL_SPLITTING_SPLIT_TO_HSL, splitTo(["Hue", "Saturation", "Lightness"], (r, g, b) => pspRgbToHsl(r, g, b, hsl).slice()), { enabled: has });
  registry.bind(CMD.COLORS_CHANNEL_SPLITTING_SPLIT_TO_CMYK, splitTo(["Cyan", "Magenta", "Yellow", "Black"], (r, g, b) => rgbToCmyk(r, g, b)), { enabled: has });

  const combine = (title: string, labels: string[], f: (v: number[]) => number[]) => async () => {
    const images = ws.images;
    const selects = labels.map((l, k) => el("select", {}, ...images.map((im, i) => el("option", { value: i, selected: im.name.startsWith(l) || i === Math.min(k, images.length - 1) }, im.name))));
    const v = await openDialog({ title, buttons: OK_CANCEL, body: el("div", { class: "layer-props" }, ...labels.map((l, k) => el("label", { class: "form-row" }, el("span", {}, `${l} channel source:`), selects[k]))) });
    if (v !== "ok") return;
    const srcs = selects.map((s) => images[Number(s.value)].composite);
    const w = srcs[0].width, h = srcs[0].height;
    if (srcs.some((s) => s.width !== w || s.height !== h)) { await alertDialog("JSPaintShop", "All the source images must be the same size."); return; }
    const out = createRaster(w, h);
    for (let p = 0; p < w * h; p++) out.data.set([...f(srcs.map((s) => s.data[p * 4])), 255], p * 4);
    const d = newImage(w, h, 72, [0, 0, 0, 255]);
    d.layers = [rasterLayer("Background", out)];
    ws.show(new ImageDocument(d, ws.nextName()));
  };
  const multi = () => ws.images.length > 0;
  registry.bind(CMD.COLORS_CHANNEL_COMBINING_COMBINE_FROM_RGB, combine("Combine RGB", ["Red", "Green", "Blue"], (v) => v), { enabled: multi });
  registry.bind(CMD.COLORS_CHANNEL_COMBINING_COMBINE_FROM_HSL, combine("Combine HSL", ["Hue", "Saturation", "Lightness"], (v) => pspHslToRgb(v[0], v[1], v[2], [0, 0, 0])), { enabled: multi });
  registry.bind(CMD.COLORS_CHANNEL_COMBINING_COMBINE_FROM_CMYK, combine("Combine CMYK", ["Cyan", "Magenta", "Yellow", "Black"], (v) => cmykToRgb(v[0], v[1], v[2], v[3])), { enabled: multi });

  // Image > Arithmetic: two open images into a new one.
  registry.bind(CMD.IMAGE_ARITHMETIC, async () => {
    const images = ws.images;
    const pick = (k: number) => el("select", {}, ...images.map((im, i) => el("option", { value: i, selected: i === Math.min(k, images.length - 1) }, im.name)));
    const one = pick(0), two = pick(1);
    const fn = radios("fn", [...ARITHMETIC], 0);
    const all = el("input", { type: "checkbox", checked: true });
    const c1 = el("select", {}, ...["Red", "Green", "Blue"].map((c) => el("option", {}, c))), c2 = el("select", {}, ...["Red", "Green", "Blue"].map((c) => el("option", {}, c)));
    const divisor = el("input", { type: "number", class: "spin", min: 1, max: 255, value: 1 }), bias = el("input", { type: "number", class: "spin", min: -255, max: 255, value: 0 });
    const clip = el("input", { type: "checkbox", checked: true });
    const row = (l: string, ...c: Node[]) => el("label", { class: "form-row" }, el("span", {}, l), ...c);
    const v = await openDialog({ title: "Image Arithmetic", buttons: OK_CANCEL, body: el("div", { class: "layer-props" },
      row("Image #1:", one), row("Image #2:", two),
      el("fieldset", { class: "opt-group" }, el("legend", {}, "Function"), el("div", { class: "arith-fns" }, ...fn.rows)),
      el("fieldset", { class: "opt-group" }, el("legend", {}, "Channel"), el("label", { class: "opt-check" }, all, "All channels"), row("Image #1", c1), row("Image #2", c2)),
      el("fieldset", { class: "opt-group" }, el("legend", {}, "Modifiers"), row("Divisor:", divisor), row("Bias:", bias), el("label", { class: "opt-check" }, clip, "Clip color values"))) });
    if (v !== "ok") return;
    const a = images[Number(one.value)].composite, b = images[Number(two.value)].composite;
    const out = arithmetic(a, b, ARITHMETIC[fn.value()], Number(divisor.value) || 1, Number(bias.value) || 0, clip.checked, all.checked ? null : [c1.selectedIndex, c2.selectedIndex]);
    const d = newImage(out.width, out.height, 72, [0, 0, 0, 255], all.checked ? 24 : 8, !all.checked);
    d.layers = [rasterLayer("Background", out)];
    ws.show(new ImageDocument(d, ws.nextName()));
  }, { enabled: () => ws.images.length > 0 });
}
