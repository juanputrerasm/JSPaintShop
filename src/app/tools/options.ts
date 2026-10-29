/*
  The Tool Options palette's contents, tool by tool, from PSP 6's option dialogs and their
  DLGINIT lists. Values are kept in settings.toolOptions and remembered between runs.

  An option is a slider (with its number), a list, a checkbox, a button that runs a command,
  or a preview picture; `when` hides it while it does not apply.

  Previews: PSP's Brush Tip and Picture Tube pages have a 30 x 30 picture (control 1227, an
  SS_BITMAP static, DIALOGs 702/703 and 829/830) showing the tip and the tube; the line Cap and
  Join buttons (DIALOGs 837-840) carry bitmaps 956-961. The Preset Shapes preview is an
  addition (DIALOG 817 has no picture).
*/
import type { AppState } from "../state.ts";
import { CMD } from "../../ui/shell/commands.ts";
import { SHAPES } from "../../core/select/selection.ts";
import { BLEND_MODES } from "../../core/doc/image-doc.ts";

export type OptionValue = number | boolean | string;

export interface OptionDef {
  key: string;
  label: string;
  type: "range" | "select" | "check" | "button" | "preview";
  def?: OptionValue;
  min?: number;
  max?: number;
  choices?: readonly string[];
  /** A button's command. */
  command?: number;
  when?: (o: Record<string, OptionValue>) => boolean;
  /** The tab the option sits on, when the tool has several (PSP's tabbed Tool Options). */
  tab?: string;
  /** A preview's picture. */
  preview?: "brush" | "shape" | "tube";
  /** A list shown as picture buttons: one BITMAP resource id (public/ui/bmp) per choice. */
  icons?: readonly number[];
}

/** Data the previews draw from, set by the tools that own it. */
export const previewSources: {
  tube?: (name: string) => Promise<import("../../core/image/raster.ts").Raster | null>;
  customBrush?: (shape: string) => { size: number; data: Uint8Array } | undefined;
} = {};

import { RETOUCH_MODES } from "../../core/paint/retouch-modes.ts";
export { RETOUCH_MODES };
export const BRUSH_SHAPES = ["Round", "Square", "Left Slash", "Right Slash", "Horizontal", "Vertical"] as const;
export const MATCH_LABELS = ["RGB Value", "Hue", "Brightness", "All Pixels"] as const;
export const FILL_STYLES = ["Solid Color", "Pattern", "Linear Gradient", "Rectangular Gradient", "Sunburst Gradient", "Radial Gradient"] as const;
export const ZOOM_CHOICES = ["32:1", "16:1", "8:1", "4:1", "2:1", "1:1", "1:2", "1:4", "1:8", "1:16", "1:24"] as const;

/* The Brush Tip tab, shared by the brush tools. */
const brush = (extra: OptionDef[] = [], opacity = 100): OptionDef[] => [
  { key: "tipPreview", label: "Brush tip", type: "preview", preview: "brush", tab: "Brush Tip" },
  { key: "shape", label: "Shape", type: "select", choices: BRUSH_SHAPES, def: "Round", tab: "Brush Tip" },
  { key: "size", label: "Size", type: "range", min: 1, max: 255, def: 10, tab: "Brush Tip" },
  { key: "hardness", label: "Hardness", type: "range", min: 0, max: 100, def: 50, tab: "Brush Tip" },
  { key: "opacity", label: "Opacity", type: "range", min: 1, max: 100, def: opacity, tab: "Brush Tip" },
  { key: "step", label: "Step", type: "range", min: 1, max: 100, def: 25, tab: "Brush Tip" },
  { key: "density", label: "Density", type: "range", min: 1, max: 100, def: 100, tab: "Brush Tip" },
  ...extra,
  ...tipExtras(),
];

const paper = (tab = "Paper"): OptionDef[] => [
  { key: "paper", label: "Paper texture", type: "select", choices: ["None"], def: "None", tab },
  { key: "buildUp", label: "Build up brush", type: "check", def: false, tab },
];

/* The Brush Tip tab's brush type button (MENU 290) and the tablet options. */
const tipExtras = (tab = "Brush Tip"): OptionDef[] => [
  { key: "brushType", label: "Brush Types...", type: "button", command: -1, tab },
  { key: "pressureOpacity", label: "Vary opacity with pressure", type: "check", def: true, tab: "Tablet" },
  { key: "pressureSize", label: "Vary width with pressure", type: "check", def: false, tab: "Tablet" },
];

export const TOOL_OPTIONS: Record<number, OptionDef[]> = {
  [CMD.TOOL_ZOOM]: [{ key: "zoom", label: "Zoom (mag.)", type: "select", choices: ZOOM_CHOICES, def: "1:1" }],
  [CMD.TOOL_DEFORMATION]: [
    { key: "apply", label: "Apply", type: "button", command: -1 },
    { key: "cancel", label: "Cancel", type: "button", command: -2 },
  ],
  [CMD.TOOL_CROP]: [{ key: "crop", label: "Crop Image", type: "button", command: -1 }],
  [CMD.TOOL_SELECTION]: [
    { key: "type", label: "Selection type", type: "select", choices: SHAPES, def: "Rectangle" },
    { key: "feather", label: "Feather", type: "range", min: 0, max: 200, def: 0 },
    { key: "antialias", label: "Antialias", type: "check", def: false },
  ],
  [CMD.TOOL_FREEHAND]: [
    { key: "mode", label: "Selection type", type: "select", choices: ["Freehand", "Point to Point", "Smart Edge"], def: "Freehand" },
    { key: "feather", label: "Feather", type: "range", min: 0, max: 200, def: 0 },
    { key: "antialias", label: "Antialias", type: "check", def: false },
    { key: "merged", label: "Sample merged", type: "check", def: false },
  ],
  [CMD.TOOL_MAGIC_WAND]: [
    { key: "match", label: "Match mode", type: "select", choices: MATCH_LABELS, def: "RGB Value" },
    { key: "tolerance", label: "Tolerance", type: "range", min: 0, max: 200, def: 10 },
    { key: "feather", label: "Feather", type: "range", min: 0, max: 200, def: 0 },
    { key: "merged", label: "Sample merged", type: "check", def: false },
  ],
  [CMD.TOOL_DROPPER]: [{ key: "merged", label: "Sample merged", type: "check", def: false }],
  [CMD.TOOL_PAINT_BRUSH]: brush(paper()),
  [CMD.TOOL_AIRBRUSH]: brush(paper(), 50),
  [CMD.TOOL_ERASER]: brush(paper()),
  [CMD.TOOL_CLONE_BRUSH]: brush([
    { key: "aligned", label: "Clone mode", type: "select", choices: ["Aligned", "Non-aligned"], def: "Aligned", tab: "Clone" },
    { key: "merged", label: "Sample merged", type: "check", def: false, tab: "Clone" },
  ]),
  [CMD.TOOL_COLOR_REPLACER]: brush([{ key: "tolerance", label: "Tolerance", type: "range", min: 0, max: 200, def: 30, tab: "Brush Tip" }]),
  [CMD.TOOL_RETOUCH]: brush([
    { key: "mode", label: "Retouch mode", type: "select", choices: RETOUCH_MODES, def: "Lighten RGB", tab: "Brush Tip" },
  ], 50),
  [CMD.TOOL_FLOOD_FILL]: [
    { key: "style", label: "Fill style", type: "select", choices: FILL_STYLES, def: "Solid Color" },
    { key: "blend", label: "Blend mode", type: "select", choices: BLEND_MODES, def: "Normal" },
    { key: "paper", label: "Paper texture", type: "select", choices: ["None"], def: "None" },
    { key: "match", label: "Match mode", type: "select", choices: [...MATCH_LABELS.slice(0, 3), "None"], def: "RGB Value" },
    { key: "tolerance", label: "Tolerance", type: "range", min: 0, max: 200, def: 10 },
    { key: "opacity", label: "Opacity", type: "range", min: 1, max: 100, def: 100 },
    { key: "merged", label: "Sample merged", type: "check", def: false },
    { key: "gradient", label: "Gradient", type: "select", choices: [], def: "Foreground-Background", tab: "Gradient" },
    { key: "editGradient", label: "Edit...", type: "button", command: -1, tab: "Gradient" },
    { key: "angle", label: "Angle", type: "range", min: 0, max: 359, def: 0, tab: "Gradient" },
    { key: "repeats", label: "Repeats", type: "range", min: 0, max: 999, def: 0, tab: "Gradient" },
    { key: "cx", label: "Center H", type: "range", min: 0, max: 100, def: 50, tab: "Gradient" },
    { key: "cy", label: "Center V", type: "range", min: 0, max: 100, def: 50, tab: "Gradient" },
    { key: "invert", label: "Invert gradient", type: "check", def: false, tab: "Gradient" },
    { key: "pattern", label: "New pattern source", type: "select", choices: [], def: "", tab: "Pattern" },
  ],
  [CMD.TOOL_PICTURE_TUBE]: [
    { key: "tubePreview", label: "Tube", type: "preview", preview: "tube" },
    { key: "tube", label: "Tube", type: "select", choices: ["(none)"], def: "(none)" },
    { key: "scale", label: "Scale", type: "range", min: 10, max: 250, def: 100 },
    { key: "step", label: "Step", type: "range", min: 1, max: 500, def: 100 },
    { key: "placement", label: "Placement mode", type: "select", choices: ["Random", "Continuous"], def: "Continuous" },
    { key: "selectionMode", label: "Selection mode", type: "select", choices: ["Random", "Incremental", "Angular", "Pressure", "Velocity"], def: "Random" },
  ],
  [CMD.TOOL_DRAW]: [
    { key: "kind", label: "Type", type: "select", choices: ["Single Line", "Bezier Curve", "Freehand Line", "Point to Point Line"], def: "Single Line" },
    { key: "width", label: "Width", type: "range", min: 1, max: 255, def: 1 },
    { key: "style", label: "Style", type: "select", choices: ["Stroked", "Filled", "Stroked & Filled"], def: "Stroked" },
    { key: "antialias", label: "Antialias", type: "check", def: true },
    { key: "vector", label: "Create as vector", type: "check", def: true },
    { key: "close", label: "Close path", type: "check", def: false },
    { key: "tracking", label: "Curve tracking", type: "range", min: 1, max: 100, def: 15, tab: "Line" },
    { key: "cap", label: "Cap", type: "select", choices: ["Flat", "Round", "Square"], icons: [956, 957, 958], def: "Round", tab: "Line" },
    { key: "join", label: "Join", type: "select", choices: ["Miter", "Round", "Bevel"], icons: [959, 960, 961], def: "Round", tab: "Line" },
    { key: "miter", label: "Miter limit", type: "range", min: 1, max: 30, def: 10, tab: "Line" },
  ],
  [CMD.TOOL_PRESET_SHAPES]: [
    { key: "shapePreview", label: "Shape", type: "preview", preview: "shape" },
    { key: "shape", label: "Shape", type: "select", choices: SHAPES, def: "Rectangle" },
    { key: "style", label: "Style", type: "select", choices: ["Stroked", "Filled", "Stroked & Filled"], def: "Filled" },
    { key: "width", label: "Line width", type: "range", min: 1, max: 255, def: 1 },
    { key: "antialias", label: "Antialias", type: "check", def: true },
    { key: "vector", label: "Create as vector", type: "check", def: true },
  ],
  [CMD.TOOL_VECTOR_OBJECT_SELECTION]: [{ key: "node", label: "Node Edit", type: "button", command: -1 }],
};

/** A tool's options with the defaults filled in. */
export function toolOptions(app: AppState, tool: number): Record<string, OptionValue> {
  const out: Record<string, OptionValue> = {};
  for (const d of TOOL_OPTIONS[tool] ?? []) if (d.def !== undefined) out[d.key] = d.def;
  return Object.assign(out, app.settings.toolOptions[tool] ?? {});
}

export function setToolOption(app: AppState, tool: number, key: string, value: OptionValue): void {
  app.updateSettings((s) => { s.toolOptions[tool] = { ...(s.toolOptions[tool] ?? {}), [key]: value }; });
}

/** Choices filled at run time (tubes, paper textures). */
export const dynamicChoices: Record<string, () => string[]> = {};
