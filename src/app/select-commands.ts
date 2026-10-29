/*
  The Edit menu's clipboard commands, the Selections menu, the Masks menu, and Image > Crop
  to Selection.

  The clipboard is the system's: Copy puts the copied pixels there as PNG, so other programs
  can paste them. JSPaintShop also keeps the copy itself, with the place it came from, so a
  paste back into an image can land where the copy was taken; a picture copied elsewhere is
  pasted in the middle of the window.
*/
import type { AppState } from "./state.ts";
import type { Editor } from "./editor.ts";
import type { Workspace } from "./workspace.ts";
import type { Colors } from "./colors.ts";
import type { WorkerClient } from "../shared/worker-client.ts";
import { ImageDocument } from "./image-document.ts";
import { CMD, type CommandRegistry } from "../ui/shell/commands.ts";
import { toolOptions, MATCH_LABELS } from "./tools/options.ts";
import { numberDialog, listDialog, textDialog, colorToleranceDialog } from "../ui/dialogs/prompts.ts";
import { alertDialog, askYesNoCancel, openDialog } from "../ui/shell/dialog.ts";
import { pickOpenFile, pickSaveFile, writeTarget } from "../ui/shell/file-dialogs.ts";
import { copyImage, pasteImage } from "../shared/system-clipboard.ts";
import { el } from "../shared/dom.ts";
import { createMask, type Mask, type Raster } from "../core/image/raster.ts";
import { activeLayer, newImage, rasterLayer, type ImageDoc } from "../core/doc/image-doc.ts";
import { feather, growSelection, invert, maskFromRaster, MATCH_MODES, morph, nonEmpty, removeColor, selectSimilar } from "../core/select/selection.ts";
import { clearMasked, copyRegion, defloat, float, floatingIndex, pasteAsLayer, pasteFloating, pasteInto, promote, selectionBounds } from "../core/select/floating.ts";
import { crop, placeRaster } from "../core/image/geometry.ts";
import { seamless } from "../core/select/seamless.ts";
import { defringe, removeMatte, newMask } from "../core/layers/layer-ops.ts";
import { mergeLayers } from "../core/layers/composite.ts";
import { luminance } from "../core/color/color-space.ts";
import type { ReadResult } from "../worker/file-handlers.ts";

interface Clip { raster: Raster; x: number; y: number }

export function bindSelectCommands(app: AppState, registry: CommandRegistry, ed: Editor, ws: Workspace, colors: Colors, worker: WorkerClient): void {
  const doc = () => ed.image?.doc ?? null;
  const has = () => doc() !== null;
  const hasSel = () => Boolean(doc()?.selection);
  const floating = () => { const d = doc(); return Boolean(d && floatingIndex(d) >= 0); };
  const hasMask = () => { const d = doc(); return Boolean(d && activeLayer(d).mask); };
  const wand = () => {
    const o = toolOptions(app, CMD.TOOL_MAGIC_WAND);
    return { match: MATCH_MODES[Math.max(0, MATCH_LABELS.indexOf(String(o.match) as typeof MATCH_LABELS[number]))], tolerance: Number(o.tolerance) };
  };

  // ---- Clipboard ----
  let clip: Clip | null = null;

  const copyFrom = async (source: Raster, d: ImageDoc) => {
    clip = copyRegion(source, d);
    try { await copyImage(clip.raster.data, clip.raster.width, clip.raster.height); } catch { /* the system clipboard refused: our own copy still pastes */ }
    app.emit("commands", undefined);
  };
  /** What to paste: our own copy when the system clipboard holds the same picture (or cannot be read), else the system's picture. */
  const clipboard = async (): Promise<Clip | null> => {
    let sys: { width: number; height: number; rgba: Uint8ClampedArray } | null = null;
    try { sys = await pasteImage(); } catch { sys = null; }
    if (sys && !(clip && clip.raster.width === sys.width && clip.raster.height === sys.height)) {
      return { raster: { width: sys.width, height: sys.height, data: new Uint8ClampedArray(sys.rgba) }, x: -1, y: -1 };
    }
    return clip;
  };
  /* Where a clip lands: where it was copied from, or centred on the image. */
  const place = (c: Clip, d: ImageDoc) => (c.x >= 0 ? [c.x, c.y] : [Math.round((d.width - c.raster.width) / 2), Math.round((d.height - c.raster.height) / 2)]);

  registry.bind(CMD.EDIT_COPY, async () => { const d = doc(); if (d) await copyFrom(activeLayer(d).raster, d); }, { enabled: has });
  registry.bind(CMD.EDIT_COPY_MERGED, async () => { const d = doc(); if (d) await copyFrom(mergeLayers(d, d.layers.filter((l) => l.visible)), d); }, { enabled: has });
  registry.bind(CMD.EDIT_CUT, async () => {
    const d = doc();
    if (!d) return;
    await copyFrom(activeLayer(d).raster, d);
    ed.run("Cut", (x) => {
      if (floatingIndex(x) === x.active) { x.layers.splice(x.active, 1); x.active = Math.max(0, x.active - 1); x.selection = null; }
      else clearMasked(x, activeLayer(x), x.selection, colors.bg);
    });
  }, { enabled: has });
  registry.bind(CMD.EDIT_CLEAR, () => ed.run("Clear", (x) => {
    if (floatingIndex(x) === x.active) { x.layers.splice(x.active, 1); x.active = Math.max(0, x.active - 1); x.selection = null; return; }
    clearMasked(x, activeLayer(x), x.selection, colors.bg);
  }), { enabled: has });
  registry.bind(CMD.EDIT_EMPTY_CLIPBOARD, () => { clip = null; void navigator.clipboard?.writeText?.("").catch(() => {}); app.emit("commands", undefined); });

  const paste = (label: string, fn: (d: ImageDoc, c: Clip) => void) => async () => {
    const c = await clipboard();
    if (!c) { app.status("There is nothing on the clipboard to paste."); return; }
    ed.run(label, (d) => fn(d, c));
  };
  registry.bind(CMD.EDIT_PASTE_AS_NEW_LAYER, paste("Paste As New Layer", (d, c) => { const [x, y] = place(c, d); pasteAsLayer(d, c.raster, x, y); }), { enabled: has });
  registry.bind(CMD.EDIT_PASTE_AS_NEW_SELECTION, paste("Paste As New Selection", (d, c) => { const [x, y] = place(c, d); pasteFloating(d, c.raster, x, y); }), { enabled: has });
  registry.bind(CMD.EDIT_PASTE_AS_TRANSPARENT_SELECTION, paste("Paste As Transparent Selection", (d, c) => { const [x, y] = place(c, d); pasteFloating(d, c.raster, x, y, colors.bg, app.settings.prefs.misc.pasteTolerance); }), { enabled: has });
  registry.bind(CMD.EDIT_PASTE_INTO_SELECTION, paste("Paste Into Selection", (d, c) => pasteInto(d, c.raster)), { enabled: hasSel });

  // ---- Selections ----
  const sel = (label: string, fn: (d: ImageDoc) => Mask | null, enabled = has) =>
    (id: number) => registry.bind(id, () => ed.run(label, (d) => { d.selection = nonEmpty(fn(d)); return { selection: true }; }), { enabled });
  sel("Select All", (d) => createMask(d.width, d.height, 255))(CMD.SELECTIONS_SELECT_ALL);
  registry.bind(CMD.SELECTIONS_SELECT_NONE, () => ed.run("Select None", (d) => { defloat(d); d.selection = null; return { selection: true, layers: true }; }), { enabled: hasSel });
  sel("Invert Selection", (d) => invert(d.selection, d.width, d.height))(CMD.SELECTIONS_INVERT);
  sel("Selection From Mask", (d) => (activeLayer(d).mask ? { ...activeLayer(d).mask!, data: new Uint8Array(activeLayer(d).mask!.data) } : d.selection), hasMask)(CMD.SELECTIONS_FROM_MASK);

  const modify = (id: number, title: string, label: string, max: number, apply: (m: Mask, n: number) => Mask) => registry.bind(id, async () => {
    const n = await numberDialog(title, label, 1, max, 1);
    if (n !== null) ed.run(title, (d) => { if (d.selection) d.selection = nonEmpty(apply(d.selection, n)); return { selection: true }; });
  }, { enabled: hasSel });
  modify(CMD.SELECTIONS_MODIFY_CONTRACT, "Contract Selection", "Number of pixels:", 100, (m, n) => morph(m, -n));
  modify(CMD.SELECTIONS_MODIFY_EXPAND, "Expand Selection", "Number of pixels:", 100, (m, n) => morph(m, n));
  modify(CMD.SELECTIONS_MODIFY_FEATHER, "Feather Selection", "Number of pixels:", 200, (m, n) => feather(m, n));
  registry.bind(CMD.SELECTIONS_MODIFY_GROW_SELECTION, () => ed.run("Grow Selection", (d) => {
    const w = wand();
    if (d.selection) d.selection = growSelection(activeLayer(d).raster, d.selection, w.match, w.tolerance);
    return { selection: true };
  }), { enabled: hasSel });
  registry.bind(CMD.SELECTIONS_MODIFY_SELECT_SIMILAR, () => ed.run("Select Similar", (d) => {
    const w = wand();
    if (d.selection) d.selection = selectSimilar(activeLayer(d).raster, d.selection, w.match, w.tolerance);
    return { selection: true };
  }), { enabled: hasSel });
  registry.bind(CMD.SELECTIONS_MODIFY_TRANSPARENT_COLOR, async () => {
    const r = await colorToleranceDialog("Select Transparent Color", [colors.bg[0], colors.bg[1], colors.bg[2]]);
    if (r) ed.run("Transparent Color", (d) => { d.selection = nonEmpty(removeColor(activeLayer(d).raster, d.selection ?? createMask(d.width, d.height, 255), r.color, r.tolerance)); return { selection: true }; });
  }, { enabled: has });
  registry.bind(CMD.SELECTIONS_HIDE_MARQUEE, () => { const i = ed.image; if (i) { i.hideMarquee = !i.hideMarquee; for (const v of ws.views) v.request(); app.emit("commands", undefined); } }, { enabled: has, checked: () => Boolean(ed.image?.hideMarquee) });
  registry.bind(CMD.SELECTIONS_FLOAT, () => ed.run("Float", (d) => float(d, colors.bg)), { enabled: () => hasSel() && !floating() });
  registry.bind(CMD.SELECTIONS_DEFLOAT, () => ed.run("Defloat", defloat), { enabled: floating });
  registry.bind(CMD.SELECTIONS_PROMOTE_TO_LAYER, () => ed.run("Promote To Layer", promote), { enabled: hasSel });

  // Matting on the floating selection (or the active layer).
  const matteTarget = (d: ImageDoc) => { const f = floatingIndex(d); if (f >= 0) d.active = f; };
  registry.bind(CMD.SELECTIONS_MATTING_REMOVE_BLACK_MATTE, () => ed.run("Remove Black Matte", (d) => { matteTarget(d); removeMatte(d, 0); }), { enabled: hasSel });
  registry.bind(CMD.SELECTIONS_MATTING_REMOVE_WHITE_MATTE, () => ed.run("Remove White Matte", (d) => { matteTarget(d); removeMatte(d, 255); }), { enabled: hasSel });
  registry.bind(CMD.SELECTIONS_MATTING_DEFRINGE, async () => {
    const n = await numberDialog("Defringe", "Width:", 1, 10, 1);
    if (n) ed.run("Defringe", (d) => { matteTarget(d); defringe(d, n); });
  }, { enabled: hasSel });

  registry.bind(CMD.SELECTIONS_CONVERT_TO_SEAMLESS_PATTERN, () => {
    const i = ed.image;
    if (!i?.doc.selection) return;
    const tile = seamless(activeLayer(i.doc).raster, selectionBounds(i.doc));
    const d = newImage(tile.width, tile.height, i.doc.dpi, [0, 0, 0, 0]);
    d.layers = [rasterLayer("Background", tile)];
    ws.show(new ImageDocument(d, ws.nextName()));
  }, { enabled: hasSel });

  registry.bind(CMD.IMAGE_CROP_TO_SELECTION, () => ed.run("Crop to Selection", (d) => crop(d, selectionBounds(d), colors.bg)), { enabled: hasSel });

  // ---- Alpha channels and files ----
  const maskToGrey = (m: Mask): ImageDoc => {
    const d = newImage(m.width, m.height, 72, [0, 0, 0, 255], 8, true);
    const r = d.layers[0].raster.data;
    for (let i = 0; i < m.data.length; i++) { r[i * 4] = r[i * 4 + 1] = r[i * 4 + 2] = m.data[i]; }
    return d;
  };
  const greyToMask = (d: ImageDoc, w: number, h: number): Mask => {
    const merged = mergeLayers(d, d.layers);
    const m = createMask(w, h);
    for (let y = 0; y < Math.min(h, merged.height); y++) for (let x = 0; x < Math.min(w, merged.width); x++) {
      const i = (y * merged.width + x) * 4;
      m.data[y * w + x] = luminance(merged.data[i], merged.data[i + 1], merged.data[i + 2]);
    }
    return m;
  };
  const saveMaskFile = async (m: Mask, description: string, ext: string) => {
    const target = await pickSaveFile(ed.image?.name ?? "selection", description, ext);
    if (!target) return;
    const bytes = await worker.call<Uint8Array>("file.write", { doc: maskToGrey(m), format: "psp" });
    await writeTarget(target, bytes, "application/octet-stream");
  };
  const loadMaskFile = async (description: string, ext: string): Promise<Mask | null> => {
    const picked = await pickOpenFile(description, [ext, ".psp", ".bmp", ".png"]);
    const d = doc();
    if (!picked || !d) return null;
    try {
      const result = await worker.call<ReadResult>("file.read", { bytes: new Uint8Array(await picked.file.arrayBuffer()), name: picked.file.name });
      return greyToMask(result.doc, d.width, d.height);
    } catch (err) {
      await alertDialog("JSPaintShop", err instanceof Error ? err.message : String(err));
      return null;
    }
  };
  registry.bind(CMD.SELECTIONS_SAVE_TO_DISK, async () => { const s = doc()?.selection; if (s) await saveMaskFile(s, "Selection", ".sel"); }, { enabled: hasSel });
  registry.bind(CMD.SELECTIONS_LOAD_FROM_DISK, async () => { const m = await loadMaskFile("Selection", ".sel"); if (m) ed.run("Load Selection", (d) => { defloat(d); d.selection = nonEmpty(m); return { selection: true, layers: true }; }); }, { enabled: has });
  registry.bind(CMD.MASKS_SAVE_TO_DISK, async () => { const d = doc(); const m = d && activeLayer(d).mask; if (m) await saveMaskFile(m, "Mask", ".msk"); }, { enabled: hasMask });
  registry.bind(CMD.MASKS_LOAD_FROM_DISK, async () => { const m = await loadMaskFile("Mask", ".msk"); if (m) ed.run("Load Mask", (d) => { const l = activeLayer(d); l.mask = m; l.maskEnabled = true; return { layers: true }; }); }, { enabled: has });

  const saveAlpha = async (m: Mask, base: string) => {
    const d = doc();
    if (!d) return;
    const names = d.alphas.map((a) => a.name);
    const pick = await listDialog("Save To Alpha", "Available alphas:", names, "New Channel");
    if (pick === null) return;
    let name = names[pick];
    if (pick === names.length) {
      const n = await textDialog("New Channel", "Name:", `${base} #${d.alphas.length + 1}`);
      if (!n) return;
      name = n;
    }
    ed.run("Save To Alpha", (x) => {
      const copy = { ...m, data: new Uint8Array(m.data) };
      const at = x.alphas.findIndex((a) => a.name === name);
      x.alphas = at >= 0 ? x.alphas.map((a, i) => (i === at ? { name, mask: copy } : a)) : [...x.alphas, { name, mask: copy }];
    });
  };
  const loadAlpha = async (): Promise<Mask | null> => {
    const d = doc();
    if (!d?.alphas.length) { app.status("This image has no alpha channels."); return null; }
    const pick = await listDialog("Load From Alpha", "Available alphas:", d.alphas.map((a) => a.name));
    return pick === null ? null : d.alphas[pick].mask;
  };
  registry.bind(CMD.SELECTIONS_SAVE_TO_ALPHA_CHANNEL, async () => { const s = doc()?.selection; if (s) await saveAlpha(s, "Selection"); }, { enabled: hasSel });
  registry.bind(CMD.SELECTIONS_LOAD_FROM_ALPHA_CHANNEL, async () => { const m = await loadAlpha(); if (m) ed.run("Load Selection", (d) => { defloat(d); d.selection = nonEmpty({ ...m, data: new Uint8Array(m.data) }); return { selection: true, layers: true }; }); }, { enabled: () => Boolean(doc()?.alphas.length) });
  registry.bind(CMD.MASKS_SAVE_TO_ALPHA_CHANNEL, async () => { const d = doc(); const m = d && activeLayer(d).mask; if (m) await saveAlpha(m, "Mask"); }, { enabled: hasMask });
  registry.bind(CMD.MASKS_LOAD_FROM_ALPHA_CHANNEL, async () => { const m = await loadAlpha(); if (m) ed.run("Load Mask", (d) => { const l = activeLayer(d); l.mask = { ...m, data: new Uint8Array(m.data) }; l.maskEnabled = true; return { layers: true }; }); }, { enabled: () => Boolean(doc()?.alphas.length) });

  // ---- Masks ----
  const rasterOnly = () => { const d = doc(); return Boolean(d && activeLayer(d).kind !== "floating"); };
  registry.bind(CMD.MASKS_NEW_HIDE_ALL, () => ed.run("New Mask", (d) => newMask(d, 0)), { enabled: rasterOnly });
  registry.bind(CMD.MASKS_NEW_SHOW_ALL, () => ed.run("New Mask", (d) => newMask(d, 255)), { enabled: rasterOnly });
  registry.bind(CMD.MASKS_NEW_SHOW_SELECTION, () => ed.run("New Mask", (d) => { const l = activeLayer(d); l.mask = { ...d.selection!, data: new Uint8Array(d.selection!.data) }; l.maskEnabled = true; }), { enabled: () => rasterOnly() && hasSel() });
  registry.bind(CMD.MASKS_NEW_HIDE_SELECTION, () => ed.run("New Mask", (d) => { const l = activeLayer(d); l.mask = invert(d.selection, d.width, d.height); l.maskEnabled = true; }), { enabled: () => rasterOnly() && hasSel() });
  registry.bind(CMD.MASKS_NEW_FROM_IMAGE, async () => {
    const d = doc();
    if (!d) return;
    const images = ws.images;
    const source = el("select", {}, ...images.map((im, i) => el("option", { value: i, selected: im === ed.image }, im.name)));
    const from = el("select", {}, el("option", { value: "luminance" }, "Source luminance"), el("option", { value: "nonzero" }, "Any non-zero value"), el("option", { value: "opacity" }, "Source opacity"));
    const inv = el("input", { type: "checkbox" });
    const v = await openDialog({
      title: "Add Mask From Image",
      body: el("div", { class: "layer-props" }, el("label", { class: "form-row" }, el("span", {}, "Source window:"), source), el("label", { class: "form-row" }, el("span", {}, "Create mask from:"), from), el("label", { class: "opt-check" }, inv, "Invert mask data")),
      buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    });
    if (v !== "ok") return;
    const src = images[Number(source.value)];
    const merged = src.composite;
    const fitted = merged.width === d.width && merged.height === d.height ? merged : placeRaster(merged, d.width, d.height, 0, 0);
    const m = maskFromRaster(fitted, from.value as "luminance" | "opacity" | "nonzero", inv.checked);
    ed.run("New Mask", (x) => { const l = activeLayer(x); l.mask = m; l.maskEnabled = true; });
  }, { enabled: rasterOnly });
  registry.bind(CMD.MASKS_DELETE, async () => {
    const i = ed.image;
    if (!i) return;
    // PSP asks whether to merge the mask into the layer first.
    const answer = await askYesNoCancel("Delete Mask", "Merge the mask into the current layer?");
    if (answer === null) return;
    ed.run("Delete Mask", (d) => {
      const l = activeLayer(d);
      if (answer === "yes" && l.mask && l.maskEnabled) {
        const r = { ...l.raster, data: new Uint8ClampedArray(l.raster.data) };
        for (let p = 0; p < l.mask.data.length; p++) r.data[p * 4 + 3] = r.data[p * 4 + 3] * (l.mask.data[p] / 255);
        l.raster = r;
      }
      l.mask = null;
    });
    i.editMask = false;
  }, { enabled: hasMask });
  registry.bind(CMD.MASKS_INVERT, () => ed.run("Invert Mask", (d) => { const l = activeLayer(d); if (l.mask) l.mask = invert(l.mask, d.width, d.height); }), { enabled: hasMask });
  registry.bind(CMD.MASKS_EDIT, () => { const i = ed.image; if (i) { i.editMask = !i.editMask; i.emit("title", undefined); app.emit("commands", undefined); } }, { enabled: hasMask, checked: () => Boolean(ed.image?.editMask) });
  registry.bind(CMD.MASKS_VIEW_MASK, () => { const i = ed.image; if (i) { i.viewMask = !i.viewMask; for (const v of ws.views) v.request(); app.emit("commands", undefined); } }, { enabled: hasMask, checked: () => Boolean(ed.image?.viewMask) });
}
