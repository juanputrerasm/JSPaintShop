/*
  The preferences JSPaintShop keeps between runs, in jspaintshop/settings.json (PSP 6 keeps
  them in the registry). Plain data only, so workers and tests can use it.

  `mergeSettings` takes whatever was stored and returns valid settings: unknown keys are
  dropped, wrong types and out-of-range values fall back to the defaults.
*/
import { RAW_WRITE_DEFAULTS, type RawChannels, type RawWriteOptions } from "./formats/raw.ts";

export type Theme = "system" | "light" | "dark";

/** A floating palette's place and size in the work area, and whether it is shown. */
export interface PanelRect { x: number; y: number; w: number; h: number; open: boolean; /** Lock Window Open: never rolls up. */ locked?: boolean }

/*
  The docked bars View > Toolbars and the toggle keys show and hide (PSP 6 keys: T toolbar,
  P tool palette, C color palette). The floating palettes (O tool options, L layer palette,
  H histogram) keep their open state in `panels`; FLOATING_DEFAULTS says which start open.
*/
export interface Bars {
  toolbar: boolean;
  statusbar: boolean;
  tools: boolean;
  colors: boolean;
}

export const FLOATING_DEFAULTS: Record<string, boolean> = { toolOptions: true, layers: true, histogram: false };

/*
  File > New's fields (DIALOG 706), remembered between uses as PSP does. Sizes are kept in
  pixels and the resolution in pixels per inch; the units only change how they are shown.
*/
export interface NewImageSettings {
  width: number;
  height: number;
  /** 0 Pixels, 1 Inches, 2 Centimeters (the dialog's list). */
  units: 0 | 1 | 2;
  dpi: number;
  /** 0 Pixels / inch, 1 Pixels / cm. */
  dpiUnit: 0 | 1;
  /** Index into the Background color list: Foreground, Background, White, Black, Red, Green, Blue, Transparent. */
  background: number;
  /** Index into the Image type list: 2 colors, 16 colors, Greyscale, 256 colors, 16.7 million. */
  type: number;
}

/*
  File > Preferences > General Program Preferences (DIALOGS 27080-27089), with PSP 6's
  defaults from its registry loader 0x6547f0 / 0x6e3160 (docs/PSP_EXE_ANALYSIS.md section 16).
*/
export interface Preferences {
  undo: { enabled: boolean; redo: boolean; limitMemory: boolean; memoryMB: number; limitSteps: boolean; steps: number; compress: boolean };
  viewing: { fitZoomIn: boolean; fitZoomOut: boolean; autoSizeNew: boolean; fitAfterResize: boolean; autoSizeAfterResize: boolean };
  dialogs: { stdColorPicker: boolean; flatToolbars: boolean; noConfirm: boolean; rememberSaveType: boolean; autoRollUps: boolean; hsl: boolean; hex: boolean };
  browser: { thumbSize: 60 | 80 | 100 | 120; selectionColor: string; saveFiles: boolean; autoUpdate: boolean };
  misc: { recentCount: number; pasteTolerance: number; noAskCloseAll: boolean; noAskEmptyClipboard: boolean; forceRedraw: boolean; splash: boolean; psdWarning: boolean; puckPressure: boolean };
  /** Units: 0 pixels, 1 inches, 2 centimeters. */
  rulers: { units: 0 | 1 | 2; toolbarColors: boolean; defaultDpi: number; dpiUnit: 0 | 1; gridUnits: 0 | 1 | 2; gridX: number; gridY: number; gridColor: string };
  cursors: { precise: boolean; brushOutline: boolean };
  /** Grid size 0 tiny, 1 small, 2 medium, 3 large; scheme index into TRANSPARENCY_SCHEMES. */
  transparency: { size: 0 | 1 | 2 | 3; scheme: number; color1: string; color2: string };
}

export const CHECKER_SIZES = [4, 8, 16, 32];
/* The schemes JSPaintShop offers; the last is Custom (the two colors below it). */
export const TRANSPARENCY_SCHEMES: [string, string, string][] = [
  ["None", "#ffffff", "#ffffff"], ["Light", "#ffffff", "#c0c0c0"], ["Medium", "#c0c0c0", "#808080"], ["Dark", "#808080", "#404040"],
  ["Red", "#ffffff", "#ffc0c0"], ["Green", "#ffffff", "#c0ffc0"], ["Blue", "#ffffff", "#c0c0ff"], ["Custom", "#ffffff", "#c0c0c0"],
];

export function defaultPreferences(): Preferences {
  return {
    undo: { enabled: true, redo: true, limitMemory: true, memoryMB: 20, limitSteps: false, steps: 3, compress: false },
    viewing: { fitZoomIn: true, fitZoomOut: true, autoSizeNew: true, fitAfterResize: true, autoSizeAfterResize: true },
    dialogs: { stdColorPicker: false, flatToolbars: true, noConfirm: false, rememberSaveType: false, autoRollUps: true, hsl: false, hex: false },
    browser: { thumbSize: 100, selectionColor: "#000080", saveFiles: true, autoUpdate: true },
    misc: { recentCount: 4, pasteTolerance: 10, noAskCloseAll: false, noAskEmptyClipboard: false, forceRedraw: false, splash: true, psdWarning: true, puckPressure: true },
    rulers: { units: 0, toolbarColors: true, defaultDpi: 72, dpiUnit: 0, gridUnits: 0, gridX: 10, gridY: 10, gridColor: "#c0c0c0" },
    cursors: { precise: false, brushOutline: true },
    transparency: { size: 2, scheme: 1, color1: "#ffffff", color2: "#c0c0c0" },
  };
}

/* Stored preferences over the defaults: same shape and types only, numbers clamped. */
function mergePreferences(stored: unknown): Preferences {
  const p = defaultPreferences();
  if (!isObject(stored)) return p;
  const ranges: Record<string, [number, number]> = {
    memoryMB: [1, 9999], steps: [1, 999], recentCount: [1, 9], pasteTolerance: [0, 100], defaultDpi: [1, 9999], gridX: [1, 9999], gridY: [1, 9999],
    units: [0, 2], dpiUnit: [0, 1], gridUnits: [0, 2], size: [0, 3], scheme: [0, TRANSPARENCY_SCHEMES.length - 1],
  };
  for (const group of Object.keys(p) as (keyof Preferences)[]) {
    const src = stored[group], dst = p[group] as unknown as Record<string, unknown>;
    if (!isObject(src)) continue;
    for (const [k, def] of Object.entries(dst)) {
      const v = src[k];
      if (typeof def === "boolean" && typeof v === "boolean") dst[k] = v;
      else if (typeof def === "string" && typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) dst[k] = v;
      else if (typeof def === "number" && num(v)) {
        if (k === "thumbSize") { if ([60, 80, 100, 120].includes(v)) dst[k] = v; continue; }
        const [lo, hi] = ranges[k] ?? [-Infinity, Infinity];
        dst[k] = Math.max(lo, Math.min(hi, Math.round(v)));
      }
    }
  }
  return p;
}

export interface PspSettings {
  theme: Theme;
  bars: Bars;
  /** View > Toolbars "Display large text and icons on palettes": the 23 x 22 button art. */
  largeIcons: boolean;
  /** View > Toolbars "Enable Automatic Roll-Ups" (registry General\EnableAutoRollUps, on by default). */
  autoRollUps: boolean;
  /** The active tool, by its command id (10001 Arrow .. 10021 Vector Object Selection). */
  tool: number;
  /** Main toolbar buttons by command id, 0 for a separator (File > Preferences > Customize Toolbar). */
  toolbarButtons: number[];
  panels: Record<string, PanelRect>;
  /** Recently opened files, newest first (File > Recent File). */
  recent: string[];
  /** View > Grid and View > Rulers. */
  grid: boolean;
  rulers: boolean;
  /** JPEG quality, 1..100 (PSP's compression factor is 100 minus this). */
  jpegQuality: number;
  newImage: NewImageSettings;
  /** Each tool's options (Tool Options palette), by tool id then option key, remembered as PSP does. */
  toolOptions: Record<string, Record<string, number | boolean | string>>;
  /** The Color dialog's 16 custom colors and the 10 recent colors, as "#rrggbb". */
  customColors: string[];
  recentColors: string[];
  prefs: Preferences;
  /** The RAW Options (open) and RAW (save) dialogs' last choices; the size is guessed per file. */
  raw: { channels: RawChannels; header: number; planar: boolean; bgr: boolean; flipped: boolean; save: RawWriteOptions };
}

export const MAX_IMAGE_SIDE = 32767;

export const FIRST_TOOL = 10001;
export const LAST_TOOL = 10021;
export const RECENT_MAX = 9;

/*
  The default main toolbar. PSP 6's own default set is chosen in code, not in a resource, so
  this is the leading group of the toolbar resource (128): file, edit, view and palette buttons.
*/
// PSP 6 sets these in code (0x65a0d0, CToolBar::SetButtons with 21 slots).
export const DEFAULT_TOOLBAR = [57600, 57601, 57603, 57607, 0, 57643, 57644, 57635, 57634, 33208, 0, 33258, 32771, 0, 33129, 33130, 33131, 32842, 33614];

export function defaultSettings(): PspSettings {
  return {
    theme: "system",
    bars: { toolbar: true, statusbar: true, tools: true, colors: true },
    largeIcons: false,
    autoRollUps: true,
    tool: FIRST_TOOL,
    toolbarButtons: [...DEFAULT_TOOLBAR],
    panels: {},
    recent: [],
    grid: false,
    rulers: false,
    jpegQuality: 85,
    newImage: { width: 300, height: 300, units: 0, dpi: 72, dpiUnit: 0, background: 1, type: 4 },
    toolOptions: {},
    customColors: [],
    recentColors: [],
    prefs: defaultPreferences(),
    raw: { channels: "grey", header: 0, planar: false, bgr: false, flipped: false, save: { ...RAW_WRITE_DEFAULTS } },
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function mergeSettings(stored: unknown): PspSettings {
  const s = defaultSettings();
  if (!isObject(stored)) return s;
  if (stored.theme === "light" || stored.theme === "dark" || stored.theme === "system") s.theme = stored.theme;
  if (isObject(stored.bars)) {
    for (const k of Object.keys(s.bars) as (keyof Bars)[]) if (typeof stored.bars[k] === "boolean") s.bars[k] = stored.bars[k] as boolean;
  }
  if (typeof stored.largeIcons === "boolean") s.largeIcons = stored.largeIcons;
  if (typeof stored.autoRollUps === "boolean") s.autoRollUps = stored.autoRollUps;
  if (num(stored.tool) && stored.tool >= FIRST_TOOL && stored.tool <= LAST_TOOL) s.tool = Math.round(stored.tool);
  if (Array.isArray(stored.toolbarButtons) && stored.toolbarButtons.every((v) => num(v) && v >= 0 && v <= 0xffff)) s.toolbarButtons = stored.toolbarButtons as number[];
  if (isObject(stored.panels)) {
    for (const [id, p] of Object.entries(stored.panels)) {
      if (isObject(p) && num(p.x) && num(p.y) && num(p.w) && num(p.h) && p.w > 0 && p.h > 0) s.panels[id] = { x: p.x, y: p.y, w: p.w, h: p.h, open: Boolean(p.open), locked: Boolean(p.locked) };
    }
  }
  if (typeof stored.grid === "boolean") s.grid = stored.grid;
  if (typeof stored.rulers === "boolean") s.rulers = stored.rulers;
  const int = (v: unknown, lo: number, hi: number, fallback: number) => (num(v) && v >= lo && v <= hi ? Math.round(v) : fallback);
  s.prefs = mergePreferences(stored.prefs);
  // Before Preferences existed the grid spacing was one number.
  if (!isObject(stored.prefs) && num(stored.gridSpacing)) s.prefs.rulers.gridX = s.prefs.rulers.gridY = int(stored.gridSpacing, 1, 9999, 10);
  s.jpegQuality = int(stored.jpegQuality, 1, 100, s.jpegQuality);
  if (isObject(stored.raw)) {
    const r = stored.raw, sv = isObject(r.save) ? r.save : {};
    s.raw = {
      channels: (["grey", "rgb", "cmy", "cmyk"] as RawChannels[]).find((c) => c === r.channels) ?? "grey",
      header: int(r.header, 0, 0x7fff, 0), planar: r.planar === true, bgr: r.bgr === true, flipped: r.flipped === true,
      save: { header: int(sv.header, 0, 0x7fff, 0), planar: sv.planar === true, bgr: sv.bgr === true, flipped: sv.flipped === true },
    };
  }
  if (isObject(stored.newImage)) {
    const n = stored.newImage, d = s.newImage;
    s.newImage = {
      width: int(n.width, 1, MAX_IMAGE_SIDE, d.width), height: int(n.height, 1, MAX_IMAGE_SIDE, d.height),
      units: int(n.units, 0, 2, d.units) as 0 | 1 | 2, dpi: int(n.dpi, 1, 9999, d.dpi), dpiUnit: int(n.dpiUnit, 0, 1, d.dpiUnit) as 0 | 1,
      background: int(n.background, 0, 7, d.background), type: int(n.type, 0, 4, d.type),
    };
  }
  if (isObject(stored.toolOptions)) {
    for (const [tool, opts] of Object.entries(stored.toolOptions)) {
      if (!isObject(opts)) continue;
      const clean: Record<string, number | boolean | string> = {};
      for (const [k, v] of Object.entries(opts)) if (typeof v === "boolean" || typeof v === "string" || num(v)) clean[k] = v as number | boolean | string;
      s.toolOptions[tool] = clean;
    }
  }
  const hexes = (v: unknown, n: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x)).slice(0, n) : []);
  s.customColors = hexes(stored.customColors, 16);
  s.recentColors = hexes(stored.recentColors, 10);
  if (Array.isArray(stored.recent)) s.recent = stored.recent.filter((r): r is string => typeof r === "string" && r.length > 0).slice(0, s.prefs.misc.recentCount);
  return s;
}
