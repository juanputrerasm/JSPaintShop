/*
  JSPaintShop entry point: loads the settings, starts the image worker, builds the main
  window and binds the commands that work so far. Everything else in the menus stays listed
  and greyed out until it is ported (docs/PARITY.md).
*/
import "./styles.css";
import { AppState } from "./app/state.ts";
import { imageWorker } from "./app/workers.ts";
import { loadSettings } from "./shared/settings-store.ts";
import { CommandRegistry, CMD, TOOLBARS, acceleratorFor, keyName } from "./ui/shell/commands.ts";
import { AppShell, type PaletteId } from "./ui/shell/app-shell.ts";
import { showAbout } from "./ui/dialogs/about.ts";
import { showToolbars } from "./ui/dialogs/toolbars.ts";
import { alertDialog } from "./ui/shell/dialog.ts";
import { attachProgress } from "./ui/shell/progress.ts";
import { JSPAINTSHOP_VERSION } from "./core/version.ts";
import type { Bars } from "./core/settings.ts";
import { Colors } from "./app/colors.ts";
import { bindSelectCommands } from "./app/select-commands.ts";
import { toolOptionsPalette } from "./ui/panels/tool-options.ts";
import { attachTools } from "./app/tools/dispatch.ts";
import { arrowTool, zoomTool, selectionTool, freehandTool, magicWandTool, moverTool, cropTool } from "./app/tools/select-tools.ts";
import { marqueeOverlay, startMarquee } from "./app/tools/marquee.ts";
import { toolOptions } from "./app/tools/options.ts";
import type { ToolContext } from "./app/tools/tool.ts";
import { Resources } from "./app/resources.ts";
import { bindPaintCommands } from "./app/paint-commands.ts";
import { colorPalette } from "./ui/panels/color-palette.ts";
import { bindColorCommands } from "./app/color-commands.ts";
import { bindImageCommands } from "./app/image-commands.ts";
import { bindPaletteCommands } from "./app/palette-commands.ts";
import { bindFilterCommands } from "./app/filter-commands.ts";
import { bindEffectCommands } from "./app/effect-commands.ts";
import { bindDeformCommands } from "./app/deform-commands.ts";
import { bindBrowseCommands } from "./app/browse-commands.ts";
import { bindUserFilterCommands } from "./app/userfilter-commands.ts";
import { bindExportTube, bindFrameCommands } from "./app/frame-commands.ts";
import { bindAdjustmentLayerCommands } from "./app/adjustment-layer-commands.ts";
import { bindVectorCommands } from "./app/vector-commands.ts";
import { bindPreferenceCommands } from "./app/pref-commands.ts";
import { bindExportCommands } from "./app/export-commands.ts";
import { bindPrintCommands } from "./app/print-commands.ts";
import { bindBatchCommands } from "./app/batch-commands.ts";
import { bindBrowser } from "./app/browser-window.ts";
import { IMPORTS, importResources } from "./app/import-resources.ts";
import { tubeTool } from "./app/tools/tube-tool.ts";
import { deformTool } from "./app/tools/deform-tool.ts";
import { drawTool, objectSelectorTool, presetShapesTool, textTool } from "./app/tools/vector-tools.ts";
import { histogramPanel } from "./ui/panels/histogram.ts";
import { paintBrushTool, airbrushTool, eraserTool, cloneTool, colorReplacerTool, retouchTool, dropperTool, floodFillTool } from "./app/tools/paint-tools.ts";
import type { SlotItem } from "./ui/shell/menu.ts";
import { Workspace } from "./app/workspace.ts";
import { bindFileCommands, type FileCommands } from "./app/file-commands.ts";
import { bindViewCommands } from "./app/view-commands.ts";
import { Editor } from "./app/editor.ts";
import { bindLayerCommands } from "./app/layer-commands.ts";
import { layerPalette } from "./ui/panels/layer-palette.ts";

async function start(): Promise<void> {
  const app = new AppState(await loadSettings());
  const registry = new CommandRegistry(app);
  let files: FileCommands | null = null;
  let layerList: (() => SlotItem[]) | null = null;
  let resources: Resources | null = null;
  const shell = new AppShell(app, registry, (slot) => (slot === "recent" ? files?.recent() ?? [] : slot === "layers" ? layerList?.() ?? [] : slot === "import" ? IMPORTS.map((k) => ({ label: k.label, run: () => { if (resources) void importResources(resources, k); } })) : []));
  document.body.append(shell.element);
  applyTheme(app);
  const worker = imageWorker();
  attachProgress(worker, shell.workArea);

  bindBars(app, registry, shell);
  bindTools(app, registry);
  bindWindows(registry, shell);
  const ws = new Workspace(app, shell);
  const colors = new Colors();
  files = bindFileCommands(app, registry, ws, worker, () => colors);
  bindViewCommands(app, registry, ws);
  const editor = new Editor(app, ws);
  layerList = bindLayerCommands(app, registry, editor, () => colors).layers;
  layerPalette(app, registry, editor, shell.panels.layers);
  bindSelectCommands(app, registry, editor, ws, colors, worker);
  const options = toolOptionsPalette(app, registry, shell.panels.toolOptions);
  const res = new Resources(worker);
  resources = res;
  bindPaintCommands(app, registry, editor, ws, colors, res, options.refresh);
  colorPalette(app, colors, editor, shell.colorDock);
  bindColorCommands(app, registry, editor);
  bindImageCommands(registry, editor, colors);
  bindPaletteCommands(app, registry, editor, ws, colors);
  bindFilterCommands(registry, editor, colors);
  bindEffectCommands(registry, editor, colors, res);
  bindDeformCommands(registry, editor, colors);
  bindBrowseCommands(registry, editor, colors);
  bindUserFilterCommands(registry, editor, res);
  bindFrameCommands(registry, editor, colors, res);
  bindExportTube(registry, editor, res);
  bindAdjustmentLayerCommands(registry, editor, () => colors.fg);
  bindVectorCommands(registry, editor, app);
  bindPreferenceCommands(registry, app, res);
  bindExportCommands(registry, editor, app, colors, worker);
  bindPrintCommands(registry, editor, ws);
  bindBatchCommands(registry, app, worker);
  bindBrowser(registry, app, shell, worker, (list, siblings) => files?.openFiles(list, siblings) ?? Promise.resolve());
  // The Layer palette's right-click menu (MENU 292) has its own ids for the Layers menu commands.
  for (const [id, target] of [
    [CMD.LAYER_DUPLICATE, CMD.LAYERS_DUPLICATE], [CMD.LAYER_DELETE, CMD.LAYERS_DELETE], [CMD.LAYER_PROPERTIES, CMD.LAYERS_PROPERTIES],
    [CMD.LAYER_MERGE_MERGE_VISIBLE, CMD.LAYERS_MERGE_MERGE_VISIBLE], [CMD.LAYER_MERGE_MERGE_ALL_FLATTEN, CMD.LAYERS_MERGE_MERGE_ALL_FLATTEN],
    [CMD.LAYER_VIEW_CURRENT_ONLY, CMD.LAYERS_VIEW_CURRENT_ONLY], [CMD.LAYER_VIEW_ALL, CMD.LAYERS_VIEW_ALL],
    [CMD.LAYER_PROMOTE_TO_LAYER, CMD.SELECTIONS_PROMOTE_TO_LAYER], [CMD.LAYER_DEFLOAT, CMD.SELECTIONS_DEFLOAT],
    [CMD.LAYER_CONVERT_TO_RASTER, CMD.LAYERS_CONVERT_TO_RASTER],
  ]) registry.alias(id, target);
  histogramPanel(app, editor, shell.panels.histogram);
  const ctx: ToolContext = { app, ed: editor, ws, colors, options: () => toolOptions(app, app.tool) };
  attachTools(app, ws, {
    [CMD.TOOL_ARROW]: arrowTool(), [CMD.TOOL_ZOOM]: zoomTool(ctx), [CMD.TOOL_SELECTION]: selectionTool(ctx), [CMD.TOOL_FREEHAND]: freehandTool(ctx),
    [CMD.TOOL_MAGIC_WAND]: magicWandTool(ctx), [CMD.TOOL_MOVER]: moverTool(ctx), [CMD.TOOL_CROP]: cropTool(ctx),
    [CMD.TOOL_PAINT_BRUSH]: paintBrushTool(ctx, res), [CMD.TOOL_AIRBRUSH]: airbrushTool(ctx, res), [CMD.TOOL_ERASER]: eraserTool(ctx, res),
    [CMD.TOOL_CLONE_BRUSH]: cloneTool(ctx, res), [CMD.TOOL_COLOR_REPLACER]: colorReplacerTool(ctx, res), [CMD.TOOL_RETOUCH]: retouchTool(ctx, res),
    [CMD.TOOL_DROPPER]: dropperTool(ctx), [CMD.TOOL_FLOOD_FILL]: floodFillTool(ctx, res), [CMD.TOOL_PICTURE_TUBE]: tubeTool(ctx, res), [CMD.TOOL_DEFORMATION]: deformTool(ctx),
    [CMD.TOOL_DRAW]: drawTool(ctx), [CMD.TOOL_PRESET_SHAPES]: presetShapesTool(ctx), [CMD.TOOL_TEXT]: textTool(ctx), [CMD.TOOL_VECTOR_OBJECT_SELECTION]: objectSelectorTool(ctx),
  }, [marqueeOverlay]);
  startMarquee(ws);
  registry.bind(CMD.HELP_ABOUT_JSPAINTSHOP, () => showAbout(JSPAINTSHOP_VERSION));

  // The title follows the active image, as PSP's "<program> - [Image1]".
  const title = () => { document.title = shell.mdi.active ? `JSPaintShop - [${shell.mdi.active.title}]` : "JSPaintShop"; };
  shell.mdi.on("changed", title);
  title();

  // Accelerators, unless a field, a dialog or an open menu has the keys.
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || shell.menu.isOpen) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select, dialog, [contenteditable]")) return;
    const id = acceleratorFor(keyName(e), shell.mdi.windows.length > 0, shell.mdi.active?.options.kind === "browser");
    if (id === undefined) return;
    e.preventDefault();
    void registry.exec(id);
  });

  try {
    await worker.whenReady();
    await res.load();
  } catch (err) {
    await alertDialog("JSPaintShop", err instanceof Error ? err.message : String(err));
  }
}

function applyTheme(app: AppState): void {
  const apply = () => {
    if (app.settings.theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = app.settings.theme;
  };
  app.on("settings", apply);
  apply();
}

/* View > Toolbars, the toolbar menu (MENU 436) and the toggle keys: T, P, C, O, L, H and Tab. */
function bindBars(app: AppState, registry: CommandRegistry, shell: AppShell): void {
  const bar = (id: number, key: keyof Bars) =>
    registry.bind(id, () => app.updateSettings((s) => { s.bars[key] = !s.bars[key]; }), { checked: () => app.settings.bars[key] });
  bar(CMD.TOOLBAR_TOOL_BAR, "toolbar");
  bar(CMD.TOOLBAR_STATUS_BAR, "statusbar");
  bar(CMD.TOOLBAR_TOOL_PALETTE, "tools");
  bar(CMD.TOOLBAR_COLOR_PALETTE, "colors");
  const palette = (id: number, p: PaletteId) => registry.bind(id, () => shell.panels[p].toggle(), { checked: () => shell.panels[p].visible });
  palette(CMD.TOOLBAR_TOOL_OPTIONS, "toolOptions");
  palette(CMD.TOOLBAR_LAYER_PALETTE, "layers");
  palette(CMD.TOOLBAR_HISTOGRAM_WINDOW, "histogram");
  registry.bind(CMD.PALETTES_TOGGLE_ALL, () => shell.toggleAllPalettes());
  registry.bind(CMD.VIEW_TOOLBARS, () => showToolbars(app, registry));
}

/* The tool palette: one tool at a time, remembered between runs. */
function bindTools(app: AppState, registry: CommandRegistry): void {
  for (const id of TOOLBARS[161].ids) registry.bind(id, () => app.setTool(id), { checked: () => app.tool === id });
}

/* Window menu: arranging and closing the image windows. */
function bindWindows(registry: CommandRegistry, shell: AppShell): void {
  const any = () => shell.mdi.windows.length > 0;
  registry.bind(CMD.WINDOW_CASCADE, () => shell.mdi.cascade(), { enabled: any });
  registry.bind(CMD.WINDOW_TILE_HORIZONTALLY, () => shell.mdi.tile(true), { enabled: any });
  registry.bind(CMD.WINDOW_TILE_VERTICALLY, () => shell.mdi.tile(false), { enabled: any });
  registry.bind(CMD.WINDOW_CLOSE_ALL, () => shell.mdi.closeAll(), { enabled: any });
}

start().catch((err) => {
  console.error(err);
  document.body.textContent = `JSPaintShop could not start: ${err instanceof Error ? err.message : err}`;
});
