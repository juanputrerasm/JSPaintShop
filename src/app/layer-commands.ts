/*
  Edit > Undo, Redo, Command History and Empty > Command History, and the Layers menu:
  New Raster Layer, Duplicate, Delete, Properties, Matting, Arrange, View, Merge, and the
  layer list at the bottom of the menu (the "@layers" slot).
*/
import type { AppState } from "./state.ts";
import type { Editor } from "./editor.ts";
import { editAdjustment } from "./adjustment-layer-commands.ts";
import { convertToRaster } from "./tools/vector-tools.ts";
import { CMD, type CommandRegistry } from "../ui/shell/commands.ts";
import type { SlotItem } from "../ui/shell/menu.ts";
import { showLayerProperties, showCommandHistory, showDefringe, type LayerProps } from "../ui/dialogs/layer-dialogs.ts";
import { addRasterLayer, arrangeLayer, deleteLayer, duplicateLayer, flatten, mergeVisible, removeMatte, defringe, nextLayerName } from "../core/layers/layer-ops.ts";
import { activeLayer } from "../core/doc/image-doc.ts";
import type { Rgba } from "../core/image/raster.ts";

export function bindLayerCommands(app: AppState, registry: CommandRegistry, ed: Editor, colors: () => { fg: Rgba; bg: Rgba }): { layers(): SlotItem[] } {
  const doc = () => ed.image?.doc ?? null;
  const has = () => doc() !== null;
  const raster = () => { const d = doc(); return Boolean(d && activeLayer(d).kind === "raster"); };

  registry.bind(CMD.EDIT_UNDO, () => ed.undo(), { enabled: () => Boolean(ed.image?.history.canUndo) });
  registry.bind(CMD.EDIT_REDO, () => ed.redo(), { enabled: () => Boolean(ed.image?.history.canRedo) });
  registry.bind(CMD.EDIT_COMMAND_HISTORY, async () => {
    const image = ed.image;
    if (!image) return;
    const choice = await showCommandHistory(image.history.undoSteps, image.history.redoSteps);
    if (!choice) return;
    if ("undoTo" in choice) ed.undoTo(choice.undoTo, image);
    else ed.redoSteps(choice.redo, image);
  }, { enabled: () => Boolean(ed.image && (ed.image.history.canUndo || ed.image.history.canRedo)) });
  registry.bind(CMD.EDIT_EMPTY_COMMAND_HISTORY, () => { ed.image?.emptyHistory(); app.emit("commands", undefined); }, { enabled: () => Boolean(ed.image?.history.canUndo || ed.image?.history.canRedo) });

  const props = (d: NonNullable<ReturnType<typeof doc>>): LayerProps => {
    const l = activeLayer(d);
    return { name: l.name, blend: l.blend, opacity: l.opacity, group: l.group, visible: l.visible, lockTransparency: l.lockTransparency, maskEnabled: l.maskEnabled };
  };

  // New Raster Layer shows Layer Properties first; Shift skips it (Tips.txt).
  registry.bind(CMD.LAYERS_NEW_RASTER_LAYER, async () => {
    const d = doc();
    if (!d) return;
    const start: LayerProps = { name: nextLayerName(d), blend: 0, opacity: 255, group: 0, visible: true, lockTransparency: false, maskEnabled: true };
    const p = shiftHeld ? start : await showLayerProperties("New Raster Layer", start, false);
    if (p) ed.run("New Raster Layer", (doc) => { addRasterLayer(doc, p); });
  }, { enabled: has });
  registry.bind(CMD.LAYERS_NEW_VECTOR_LAYER, async () => {
    const d = doc();
    if (!d) return;
    const start: LayerProps = { name: nextLayerName(d, "Vector"), blend: 0, opacity: 255, group: 0, visible: true, lockTransparency: false, maskEnabled: true };
    const p = shiftHeld ? start : await showLayerProperties("New Vector Layer", start, false);
    if (p) ed.run("New Vector Layer", (doc) => { const l = addRasterLayer(doc, p); l.kind = "vector"; l.objects = []; return { layers: true }; });
  }, { enabled: has });
  registry.bind(CMD.LAYERS_CONVERT_TO_RASTER, () => ed.run("Convert to Raster", (d) => { convertToRaster(d); return { layers: true }; }), { enabled: () => doc() !== null && activeLayer(doc()!).kind === "vector" });
  registry.bind(CMD.LAYERS_DUPLICATE, () => ed.run("Duplicate Layer", duplicateLayer), { enabled: has });
  registry.bind(CMD.LAYERS_DELETE, () => ed.run("Delete Layer", deleteLayer), { enabled: () => (doc()?.layers.length ?? 0) > 1 });
  registry.bind(CMD.LAYERS_PROPERTIES, async () => {
    const d = doc();
    if (!d) return;
    const layer = activeLayer(d);
    // An adjustment layer's settings come first, as PSP's Adjustment tab does.
    if (layer.kind === "adjustment" && layer.adjustment) await editAdjustment(ed, d, layer, "Adjustment Layer Properties");
    const p = await showLayerProperties("Layer Properties", props(d), Boolean(layer.mask));
    if (p) ed.run("Layer Properties", (doc) => { Object.assign(doc.layers[doc.active], p); return { layers: true }; });
  }, { enabled: has });

  registry.bind(CMD.LAYERS_MATTING_REMOVE_BLACK_MATTE, () => ed.run("Remove Black Matte", (d) => removeMatte(d, 0)), { enabled: raster });
  registry.bind(CMD.LAYERS_MATTING_REMOVE_WHITE_MATTE, () => ed.run("Remove White Matte", (d) => removeMatte(d, 255)), { enabled: raster });
  registry.bind(CMD.LAYERS_MATTING_DEFRINGE, async () => {
    const n = await showDefringe();
    if (n) ed.run("Defringe", (d) => defringe(d, n));
  }, { enabled: raster });

  const at = (f: (i: number, n: number) => boolean) => () => { const d = doc(); return Boolean(d && f(d.active, d.layers.length)); };
  registry.bind(CMD.LAYERS_ARRANGE_BRING_TO_TOP, () => ed.run("Bring to Top", (d) => arrangeLayer(d, "top")), { enabled: at((i, n) => i < n - 1) });
  registry.bind(CMD.LAYERS_ARRANGE_MOVE_UP, () => ed.run("Move Layer Up", (d) => arrangeLayer(d, "up")), { enabled: at((i, n) => i < n - 1) });
  registry.bind(CMD.LAYERS_ARRANGE_MOVE_DOWN, () => ed.run("Move Layer Down", (d) => arrangeLayer(d, "down")), { enabled: at((i) => i > 0) });
  registry.bind(CMD.LAYERS_ARRANGE_SEND_TO_BOTTOM, () => ed.run("Send to Bottom", (d) => arrangeLayer(d, "bottom")), { enabled: at((i) => i > 0) });

  registry.bind(CMD.LAYERS_VIEW_CURRENT_ONLY, () => { const i = ed.image; if (i) { i.viewCurrentOnly = true; i.changed({ layers: true }); } }, { enabled: has, checked: () => Boolean(ed.image?.viewCurrentOnly) });
  registry.bind(CMD.LAYERS_VIEW_ALL, () => { const i = ed.image; if (i) { i.viewCurrentOnly = false; i.changed({ layers: true }); } }, { enabled: has, checked: () => Boolean(ed.image && !ed.image.viewCurrentOnly) });

  registry.bind(CMD.LAYERS_MERGE_MERGE_ALL_FLATTEN, () => ed.run("Merge All", (d) => flatten(d, colors().bg)), { enabled: has });
  registry.bind(CMD.LAYERS_MERGE_MERGE_VISIBLE, () => ed.run("Merge Visible", mergeVisible), { enabled: () => (doc()?.layers.filter((l) => l.visible).length ?? 0) > 1 });

  // Shift held while choosing a command (New Raster Layer with no dialog).
  let shiftHeld = false;
  const track = (e: KeyboardEvent | MouseEvent) => { shiftHeld = e.shiftKey; };
  document.addEventListener("keydown", track, true);
  document.addEventListener("keyup", track, true);
  document.addEventListener("pointerdown", track as (e: PointerEvent) => void, true);

  // The layer list closing the Layers menu: top layer first, the active one checked.
  const layers = (): SlotItem[] => {
    const d = doc();
    if (!d) return [];
    return d.layers.map((l, i) => ({ layer: l, i })).reverse().map(({ layer, i }) => ({ label: layer.name, checked: i === d.active, run: () => ed.setActiveLayer(i) }));
  };
  return { layers };
}
