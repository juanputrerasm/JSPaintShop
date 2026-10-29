/*
  The painting side of the app: the brush types menu (MENU 290, on the Brush Tip tab), the
  Custom Brush dialog (DIALOG 372), the Flood Fill's gradient Edit button, and the lists the
  Tool Options fill at run time (gradients, patterns, paper textures, custom brushes).
*/
import type { AppState } from "./state.ts";
import type { Editor } from "./editor.ts";
import type { Workspace } from "./workspace.ts";
import type { Colors } from "./colors.ts";
import type { Resources } from "./resources.ts";
import { CMD, MENUS, type CommandRegistry } from "../ui/shell/commands.ts";
import { showContextMenu } from "../ui/shell/context-menu.ts";
import { toolActions } from "../ui/panels/tool-options.ts";
import { dynamicChoices, previewSources, setToolOption, toolOptions } from "./tools/options.ts";
import { BRUSH_TYPES } from "../core/paint/brush.ts";
import { showGradientEditor } from "../ui/dialogs/gradient-editor.ts";
import { textDialog } from "../ui/dialogs/prompts.ts";
import { openDialog } from "../ui/shell/dialog.ts";
import { el } from "../shared/dom.ts";
import { activeLayer } from "../core/doc/image-doc.ts";
import { luminance } from "../core/color/color-space.ts";
import { selectionBounds } from "../core/select/floating.ts";
import { extract } from "../core/image/geometry.ts";
import { resample } from "../core/image/resample.ts";

const BRUSH_TOOLS: number[] = [CMD.TOOL_PAINT_BRUSH, CMD.TOOL_AIRBRUSH, CMD.TOOL_ERASER, CMD.TOOL_CLONE_BRUSH, CMD.TOOL_COLOR_REPLACER, CMD.TOOL_RETOUCH];

export function bindPaintCommands(app: AppState, registry: CommandRegistry, ed: Editor, ws: Workspace, colors: Colors, res: Resources, refreshOptions: () => void): void {
  dynamicChoices.gradient = () => res.gradients.map((g) => g.name);
  dynamicChoices.pattern = () => [...ws.images.map((i) => i.name), ...res.patterns.map((p) => p.name)];
  dynamicChoices.paper = () => res.textures.map((t) => t.name);
  dynamicChoices.shape = () => res.brushes.map((b) => `Custom: ${b.name}`);
  previewSources.customBrush = (shape) => res.brushes.find((b) => `Custom: ${b.name}` === shape);
  res.on("changed", refreshOptions);
  app.on("image", () => { if (app.tool === CMD.TOOL_FLOOD_FILL) refreshOptions(); });

  // Brush types: each preset sets the active brush tool's tip options.
  const types: [number, string][] = [[CMD.BRUSH_NORMAL, "Normal"], [CMD.BRUSH_PAINTBRUSH, "Paintbrush"], [CMD.BRUSH_PEN, "Pen"], [CMD.BRUSH_PENCIL, "Pencil"], [CMD.BRUSH_MARKER, "Marker"], [CMD.BRUSH_CRAYON, "Crayon"], [CMD.BRUSH_CHALK, "Chalk"], [CMD.BRUSH_CHARCOAL, "Charcoal"]];
  for (const [id, name] of types) registry.bind(id, () => {
    const t = BRUSH_TYPES[name];
    for (const [k, v] of Object.entries(t)) setToolOption(app, app.tool, k, v);
    setToolOption(app, app.tool, "type", name);
    refreshOptions();
  }, { enabled: () => BRUSH_TOOLS.includes(app.tool), checked: () => toolOptions(app, app.tool).type === name });
  for (const tool of BRUSH_TOOLS) {
    toolActions[tool] = { ...toolActions[tool], brushType: () => {
      const b = document.querySelector<HTMLElement>(".tool-button-wide");
      const r = b?.getBoundingClientRect();
      showContextMenu(r?.left ?? 200, r?.bottom ?? 200, MENUS[290], registry, app);
    } };
  }

  // Custom Brush: create a tip from the selection (dark paints, light does not), pick or delete one.
  registry.bind(CMD.BRUSH_CUSTOM, async () => {
    let picked = -1;
    const list = el("select", { size: 8, class: "list-select" });
    const fill = () => list.replaceChildren(...res.brushes.map((b, i) => el("option", { value: i, selected: i === picked }, `${b.name} (${b.size} x ${b.size})`)));
    fill();
    const create = el("button", { type: "button", class: "mini", disabled: !ed.image, onclick: async () => {
      const image = ed.image;
      if (!image) return;
      const name = await textDialog("Create Brush", "Name:", `Brush ${res.brushes.length + 1}`);
      if (!name) return;
      const b = selectionBounds(image.doc);
      let tip = extract(activeLayer(image.doc).raster, b, image.doc.selection);
      const side = Math.min(255, Math.max(tip.width, tip.height));
      tip = resample(tip, side, side, "smart");
      const data = new Uint8Array(side * side);
      for (let i = 0; i < data.length; i++) data[i] = Math.round(((255 - luminance(tip.data[i * 4], tip.data[i * 4 + 1], tip.data[i * 4 + 2])) * tip.data[i * 4 + 3]) / 255);
      res.brushes.push({ name, size: side, data });
      await res.saveBrushes();
      picked = res.brushes.length - 1;
      fill();
    } }, "Create");
    const del = el("button", { type: "button", class: "mini", onclick: async () => {
      const i = Number(list.value);
      if (!Number.isFinite(i) || !res.brushes[i]) return;
      res.brushes.splice(i, 1);
      await res.saveBrushes();
      fill();
    } }, "Delete");
    const v = await openDialog({
      title: "Custom Brush", body: el("div", { class: "gradient-types" }, list, el("div", { class: "gradient-buttons" }, create, del)),
      buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    });
    const i = Number(list.value);
    if (v === "ok" && res.brushes[i]) {
      setToolOption(app, app.tool, "shape", `Custom: ${res.brushes[i].name}`);
      setToolOption(app, app.tool, "size", res.brushes[i].size);
      refreshOptions();
    }
  }, { enabled: () => BRUSH_TOOLS.includes(app.tool) });

  toolActions[CMD.TOOL_FLOOD_FILL] = {
    editGradient: async () => {
      const name = await showGradientEditor(app, res, colors, String(toolOptions(app, CMD.TOOL_FLOOD_FILL).gradient));
      if (name) { setToolOption(app, CMD.TOOL_FLOOD_FILL, "gradient", name); refreshOptions(); }
    },
  };
}
