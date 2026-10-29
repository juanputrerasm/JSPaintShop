/*
  Image > Effects: Drop Shadow (DIALOG 199), Cutout (27009), Buttonize (27010), Chisel (219),
  Blinds (27029), Weave (447), Chrome (27027), Feedback (27030), Black and Colored Pencil,
  Charcoal, Colored Chalk, Glowing Edges, Neon Glow, Kaleidoscope (537), Pattern
  (27038) and Mosaic - Antique and Glass (27039, 27044),
  Inner and Outer Bevel (477, 496), Texture (480) and Sculpture (479),
  from core/effects (docs/PSP_EXE_ANALYSIS.md section 8). Defaults are the ones each command's
  constructor sets in Psp.exe.

  Drop Shadow, Cutout and Chisel take their shape from the selection (or the layer's
  transparency) and paint outside it, so they are not clipped to it. Buttonize works on the
  selection's bounding box when there is one.
*/
import type { Editor } from "./editor.ts";
import type { Colors } from "./colors.ts";
import { CMD, type CommandRegistry } from "../ui/shell/commands.ts";
import { runPreviewed } from "./color-commands.ts";
import type { ControlDef } from "../ui/dialogs/preview-dialog.ts";
import { targetLayer, type PixelOp } from "../core/edit/apply-filter.ts";
import { isBackground } from "../core/image/geometry.ts";
import { cloneRaster, maskBounds, type Raster } from "../core/image/raster.ts";
import { fromHex, toHex } from "../core/color/color-space.ts";
import { dropShadow, DROP_SHADOW_DEFAULTS } from "../core/effects/drop-shadow.ts";
import { cutout, CUTOUT_DEFAULTS } from "../core/effects/cutout.ts";
import { buttonize, BUTTONIZE_DEFAULTS } from "../core/effects/buttonize.ts";
import { chisel, CHISEL_DEFAULTS } from "../core/effects/chisel.ts";
import { blinds, BLINDS_DEFAULTS } from "../core/effects/blinds.ts";
import { weave, WEAVE_DEFAULTS } from "../core/effects/weave.ts";
import { chrome, CHROME_DEFAULTS } from "../core/effects/chrome.ts";
import { feedback, FEEDBACK_DEFAULTS } from "../core/effects/feedback.ts";
import { coloredChalk, pencil, PENCIL_DEFAULTS } from "../core/effects/pencil.ts";
import { glowingEdges, GLOWING_EDGES_DEFAULTS, neonGlow, NEON_GLOW_DEFAULTS } from "../core/effects/glow.ts";
import { kaleidoscope, KALEIDOSCOPE_DEFAULTS, pattern, PATTERN_DEFAULTS } from "../core/effects/kaleidoscope.ts";
import { mosaicTiles, MOSAIC_DEFAULTS } from "../core/effects/mosaics.ts";
import { BEVEL_DEFAULTS, BEVEL_SHAPES, innerBevel, outerBevel, type BevelParams } from "../core/effects/bevel.ts";
import { sculpture, SCULPTURE_COLOR, SCULPTURE_DEFAULTS, texture, TEXTURE_DEFAULTS, type SurfaceParams } from "../core/effects/texture.ts";
import type { Resources } from "./resources.ts";
import { tiles, TILES_DEFAULTS, TILE_SHAPES } from "../core/effects/tiles.ts";

const range = (key: string, label: string, min: number, max: number, group?: string, step = 1): ControlDef => ({ key, label, type: "range", min, max, group, step });
const color = (key: string, label: string, group?: string): ControlDef => ({ key, label, type: "color", group });
const rgb = (v: unknown): [number, number, number] => fromHex(String(v)) ?? [0, 0, 0];
const hex = (c: readonly number[]) => toHex(c[0], c[1], c[2]);

/* Run `fn` on the part of `r` inside `rect`, leaving the rest. */
function inRect(r: Raster, rect: { minX: number; minY: number; maxX: number; maxY: number }, fn: (part: Raster) => Raster): Raster {
  const w = rect.maxX - rect.minX + 1, h = rect.maxY - rect.minY + 1;
  const part: Raster = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  for (let y = 0; y < h; y++) part.data.set(r.data.subarray(((rect.minY + y) * r.width + rect.minX) * 4, ((rect.minY + y) * r.width + rect.maxX + 1) * 4), y * w * 4);
  const done = fn(part), out = cloneRaster(r);
  for (let y = 0; y < h; y++) out.data.set(done.data.subarray(y * w * 4, (y + 1) * w * 4), ((rect.minY + y) * r.width + rect.minX) * 4);
  return out;
}

export function bindEffectCommands(registry: CommandRegistry, ed: Editor, colors: Colors, res: Resources): void {
  const remembered = new Map<string, import("../ui/dialogs/preview-dialog.ts").Values>();
  const trueColor = () => { const d = ed.image?.doc; return Boolean(d && (d.depth === 24 || d.greyscale)); };
  const hasShape = () => {
    const d = ed.image?.doc;
    if (!d || !(d.depth === 24 || d.greyscale)) return false;
    return Boolean(d.selection) || !isBackground(d, targetLayer(d));
  };
  const context = () => {
    const doc = ed.image!.doc, layer = targetLayer(doc);
    return { doc, layer, opaque: isBackground(doc, layer) };
  };
  const bg = (): [number, number, number] => [colors.bg[0], colors.bg[1], colors.bg[2]];

  registry.bind(CMD.IMAGE_EFFECTS_DROP_SHADOW, () => {
    const { doc, layer, opaque } = context();
    const D = DROP_SHADOW_DEFAULTS;
    return runPreviewed(ed, {
      title: "Drop Shadow", unclipped: true,
      controls: [color("color", "Color", "Attributes"), range("opacity", "Opacity", 1, 100, "Attributes"), range("blur", "Blur", 0, 100, "Attributes", 0.1),
        range("vertical", "Vertical", -100, 100, "Offset"), range("horizontal", "Horizontal", -100, 100, "Offset")],
      defaults: { color: hex(D.color), opacity: D.opacity, blur: D.blur, vertical: D.vertical, horizontal: D.horizontal },
      op: (v): PixelOp => (r) => dropShadow(r, doc.selection, opaque, { color: rgb(v.color), opacity: Number(v.opacity), blur: Number(v.blur), horizontal: Number(v.horizontal), vertical: Number(v.vertical) }, layer.lockTransparency),
    }, remembered);
  }, { enabled: hasShape });

  registry.bind(CMD.IMAGE_EFFECTS_CUTOUT, () => {
    const { doc } = context();
    const D = CUTOUT_DEFAULTS;
    return runPreviewed(ed, {
      title: "Cutout", unclipped: true,
      controls: [{ key: "fill", label: "Fill interior with color", type: "check", group: "Attributes" }, color("interior", "Interior color", "Attributes"), color("shadow", "Shadow color", "Attributes"),
        range("opacity", "Opacity", 1, 100, "Attributes"), range("blur", "Blur", 0, 100, "Attributes", 0.1),
        range("vertical", "Vertical", -100, 100, "Offset"), range("horizontal", "Horizontal", -100, 100, "Offset")],
      defaults: { fill: D.fill, interior: hex(D.interior), shadow: hex(D.shadow), opacity: D.opacity, blur: D.blur, vertical: D.vertical, horizontal: D.horizontal },
      op: (v): PixelOp => (r) => cutout(r, doc.selection!, { fill: Boolean(v.fill), interior: rgb(v.interior), shadow: rgb(v.shadow), opacity: Number(v.opacity), blur: Number(v.blur), horizontal: Number(v.horizontal), vertical: Number(v.vertical) }),
    }, remembered);
  }, { enabled: () => trueColor() && Boolean(ed.image?.doc.selection) });

  registry.bind(CMD.IMAGE_EFFECTS_BUTTONIZE, () => {
    const { doc } = context();
    const D = BUTTONIZE_DEFAULTS;
    const rect = doc.selection ? maskBounds(doc.selection) : null;
    return runPreviewed(ed, {
      title: "Buttonize",
      controls: [range("height", "Height", 1, 100), range("width", "Width", 1, 100), range("opacity", "Opacity", 1, 100),
        { key: "edge", label: "Edge", type: "radio", choices: ["Solid Edge", "Transparent Edge"] }],
      defaults: { height: D.height, width: D.width, opacity: D.opacity, edge: D.solid ? "Solid Edge" : "Transparent Edge" },
      op: (v): PixelOp => (r) => {
        const p = { height: Number(v.height), width: Number(v.width), opacity: Number(v.opacity), solid: v.edge === "Solid Edge" };
        return rect ? inRect(r, rect, (part) => buttonize(part, bg(), p)) : buttonize(r, bg(), p);
      },
    }, remembered);
  }, { enabled: trueColor });

  registry.bind(CMD.IMAGE_EFFECTS_CHISEL, () => {
    const { doc } = context();
    return runPreviewed(ed, {
      title: "Chisel", unclipped: true,
      controls: [range("size", "Size", 1, 100), { key: "mode", label: "", type: "radio", choices: ["Transparent", "Background Color"] }],
      defaults: { size: CHISEL_DEFAULTS.size, mode: CHISEL_DEFAULTS.transparent ? "Transparent" : "Background Color" },
      op: (v): PixelOp => (r) => chisel(r, doc.selection, bg(), { size: Number(v.size), transparent: v.mode === "Transparent" }),
    }, remembered);
  }, { enabled: hasShape });

  registry.bind(CMD.IMAGE_EFFECTS_BLINDS, () => {
    const D = BLINDS_DEFAULTS;
    return runPreviewed(ed, {
      title: "Blinds",
      controls: [range("width", "Width", 2, 100), range("opacity", "Opacity", 1, 100), color("color", "Color"),
        { key: "horizontal", label: "Horizontal", type: "check" }, { key: "light", label: "Light from left/top", type: "check" }],
      defaults: { width: D.width, opacity: D.opacity, color: hex(D.color), horizontal: D.horizontal, light: D.lightFromLeftTop },
      op: (v): PixelOp => (r) => blinds(r, { width: Number(v.width), opacity: Number(v.opacity), color: rgb(v.color), horizontal: Boolean(v.horizontal), lightFromLeftTop: Boolean(v.light) }),
    }, remembered);
  }, { enabled: trueColor });

  registry.bind(CMD.IMAGE_EFFECTS_WEAVE, () => {
    const D = WEAVE_DEFAULTS;
    return runPreviewed(ed, {
      title: "Weave",
      controls: [range("gap", "Gap size", 0, 100), range("width", "Width", 1, 100), range("opacity", "Opacity", 1, 100),
        color("weaveColor", "Weave color"), color("gapColor", "Gap color"), { key: "fill", label: "Fill gaps", type: "check" }],
      defaults: { gap: D.gap, width: D.width, opacity: D.opacity, weaveColor: hex(D.weaveColor), gapColor: hex(D.gapColor), fill: D.fillGaps },
      op: (v): PixelOp => (r) => weave(r, { gap: Number(v.gap), width: Number(v.width), opacity: Number(v.opacity), weaveColor: rgb(v.weaveColor), gapColor: rgb(v.gapColor), fillGaps: Boolean(v.fill) }),
    }, remembered);
  }, { enabled: trueColor });

  registry.bind(CMD.IMAGE_EFFECTS_CHROME, () => {
    const D = CHROME_DEFAULTS;
    return runPreviewed(ed, {
      title: "Chrome",
      controls: [range("flaws", "Flaws", 1, 8), range("brightness", "Brightness", 0, 100), { key: "orig", label: "Use original color", type: "check" }, color("color", "Color")],
      defaults: { flaws: D.flaws, brightness: D.brightness, orig: D.useOriginal, color: hex(D.color) },
      op: (v): PixelOp => (r) => chrome(r, { flaws: Number(v.flaws), brightness: Number(v.brightness), useOriginal: Boolean(v.orig), color: rgb(v.color) }),
    }, remembered);
  }, { enabled: trueColor });

  registry.bind(CMD.IMAGE_EFFECTS_FEEDBACK, () => {
    const D = FEEDBACK_DEFAULTS;
    return runPreviewed(ed, {
      title: "Feedback",
      controls: [range("opacity", "Opacity", 1, 100), range("intensity", "Intensity", 1, 100), range("horizontal", "Horizontal center", 0, 100), range("vertical", "Vertical center", 0, 100),
        { key: "elliptical", label: "Elliptical", type: "check" }],
      defaults: { opacity: D.opacity, intensity: D.intensity, horizontal: D.horizontal, vertical: D.vertical, elliptical: D.elliptical },
      op: (v): PixelOp => (r) => feedback(r, { opacity: Number(v.opacity), intensity: Number(v.intensity), horizontal: Number(v.horizontal), vertical: Number(v.vertical), elliptical: Boolean(v.elliptical) }),
    }, remembered);
  }, { enabled: trueColor });

  const twoSliders = (id: number, title: string, a: [string, string, number], b: [string, string, number], run: (r: Raster, x: number, y: number) => Raster) =>
    registry.bind(id, () => runPreviewed(ed, {
      title, controls: [range(a[0], a[1], 1, 100), range(b[0], b[1], 1, 100)], defaults: { [a[0]]: a[2], [b[0]]: b[2] },
      op: (v): PixelOp => (r) => run(r, Number(v[a[0]]), Number(v[b[0]])),
    }, remembered), { enabled: trueColor });
  twoSliders(CMD.IMAGE_EFFECTS_BLACK_PENCIL, "Black Pencil", ["detail", "Detail", PENCIL_DEFAULTS.detail], ["opacity", "Opacity", PENCIL_DEFAULTS.opacity], (r, detail, opacity) => pencil(r, { detail, opacity }, false));
  twoSliders(CMD.IMAGE_EFFECTS_COLORED_PENCIL, "Colored Pencil", ["detail", "Detail", PENCIL_DEFAULTS.detail], ["opacity", "Opacity", PENCIL_DEFAULTS.opacity], (r, detail, opacity) => pencil(r, { detail, opacity }, true));
  twoSliders(CMD.IMAGE_EFFECTS_GLOWING_EDGES, "Glowing Edges", ["intensity", "Intensity", GLOWING_EDGES_DEFAULTS.intensity], ["sharpness", "Sharpness", GLOWING_EDGES_DEFAULTS.sharpness], (r, intensity, sharpness) => glowingEdges(r, { intensity, sharpness }));
  twoSliders(CMD.IMAGE_EFFECTS_NEON_GLOW, "Neon Glow", ["intensity", "Intensity", NEON_GLOW_DEFAULTS.intensity], ["opacity", "Opacity", NEON_GLOW_DEFAULTS.opacity], (r, intensity, opacity) => neonGlow(r, { intensity, opacity }));
  twoSliders(CMD.IMAGE_EFFECTS_CHARCOAL, "Charcoal", ["detail", "Detail", PENCIL_DEFAULTS.detail], ["opacity", "Opacity", PENCIL_DEFAULTS.opacity], (r, detail, opacity) => pencil(r, { detail, opacity }, false, 2));
  twoSliders(CMD.IMAGE_EFFECTS_COLORED_CHALK, "Colored Chalk", ["detail", "Detail", PENCIL_DEFAULTS.detail], ["opacity", "Opacity", PENCIL_DEFAULTS.opacity], (r, detail, opacity) => coloredChalk(r, { detail, opacity }));

  const numbers = (keys: [string, string, number, number][]): ControlDef[] => keys.map(([key, label, min, max]) => range(key, label, min, max));
  registry.bind(CMD.IMAGE_EFFECTS_KALEIDOSCOPE, () => runPreviewed(ed, {
    title: "Kaleidoscope",
    controls: numbers([["horizontal", "Horizontal Offset (%)", -100, 100], ["vertical", "Vertical Offset (%)", -100, 100], ["rotation", "Rotation Angle", -360, 360], ["scale", "Scale Factor", -100, 100],
      ["petals", "Number of Petals", 1, 100], ["orbits", "Number of Orbits", 0, 100], ["suction", "Radial Suction", 0, 100]]),
    defaults: { ...KALEIDOSCOPE_DEFAULTS },
    op: (v): PixelOp => (r) => kaleidoscope(r, { horizontal: Number(v.horizontal), vertical: Number(v.vertical), rotation: Number(v.rotation), scale: Number(v.scale), petals: Number(v.petals), orbits: Number(v.orbits), suction: Number(v.suction) }),
  }, remembered), { enabled: trueColor });
  registry.bind(CMD.IMAGE_EFFECTS_PATTERN, () => runPreviewed(ed, {
    title: "Pattern",
    controls: numbers([["horizontal", "Horizontal Offset (%)", -100, 100], ["vertical", "Vertical Offset (%)", -100, 100], ["rotation", "Rotation Angle", -360, 360], ["scale", "Scale Factor", -100, 100],
      ["columns", "Number of Columns", 1, 100], ["rows", "Number of Rows", 1, 100], ["hShift", "Horizontal Shift", -100, 100], ["vShift", "Vertical Shift", -100, 100]]),
    defaults: { ...PATTERN_DEFAULTS },
    op: (v): PixelOp => (r) => pattern(r, { horizontal: Number(v.horizontal), vertical: Number(v.vertical), rotation: Number(v.rotation), scale: Number(v.scale), columns: Number(v.columns), rows: Number(v.rows), hShift: Number(v.hShift), vShift: Number(v.vShift) }),
  }, remembered), { enabled: trueColor });

  for (const glass of [false, true]) {
    const D = MOSAIC_DEFAULTS;
    registry.bind(glass ? CMD.IMAGE_EFFECTS_MOSAIC_GLASS : CMD.IMAGE_EFFECTS_MOSAIC_ANTIQUE, () => runPreviewed(ed, {
      title: glass ? "Mosaic - Glass" : "Mosaic - Antique",
      controls: [range("columns", "Number of Columns", 25, 100, "Grid Settings"), range("rows", "Number of Rows", 25, 100, "Grid Settings"), { key: "symmetric", label: "Symmetric", type: "check", group: "Grid Settings" },
        ...(glass ? [range("tile", "Glass Curvature", 0, 100, "Mosaic Settings"), range("edge", "Edge Curvature", 0, 100, "Mosaic Settings")] : [range("tile", "Tile Opacity", 0, 100, "Mosaic Settings")]),
        range("groutWidth", "Grout Width", 0, 10, "Mosaic Settings"), range("groutOpacity", "Grout Opacity", 0, 100, "Mosaic Settings")],
      defaults: { columns: D.columns, rows: D.rows, symmetric: D.symmetric, tile: D.tile, edge: D.edge, groutWidth: D.groutWidth, groutOpacity: D.groutOpacity },
      op: (v): PixelOp => (r) => mosaicTiles(r, { columns: Number(v.columns), rows: Number(v.rows), symmetric: Boolean(v.symmetric), tile: Number(v.tile), edge: Number(v.edge), groutWidth: Number(v.groutWidth), groutOpacity: Number(v.groutOpacity) }, glass),
    }, remembered), { enabled: trueColor });
  }

  const lightControls: ControlDef[] = [
    range("smoothness", "Smoothness", 0, 100, "Image"), range("depth", "Depth", 1, 100, "Image"), range("ambience", "Ambience", -100, 100, "Image"), range("shininess", "Shininess", 0, 100, "Image"),
    color("color", "Color", "Light"), range("angle", "Angle", 0, 359, "Light"), range("intensity", "Intensity", 0, 100, "Light"), range("elevation", "Elevation", 0, 90, "Light"),
  ];
  const bevelValues = (v: import("../ui/dialogs/preview-dialog.ts").Values): BevelParams => ({
    bevel: Number(String(v.bevel).replace("Bevel ", "")) - 1, width: Number(v.width), smoothness: Number(v.smoothness), depth: Number(v.depth), ambience: Number(v.ambience),
    shininess: Number(v.shininess), color: rgb(v.color), angle: Number(v.angle), intensity: Number(v.intensity), elevation: Number(v.elevation),
  });
  const bevelDefaults = () => { const D = BEVEL_DEFAULTS; return { bevel: `Bevel ${D.bevel + 1}`, width: D.width, smoothness: D.smoothness, depth: D.depth, ambience: D.ambience, shininess: D.shininess, color: hex(D.color), angle: D.angle, intensity: D.intensity, elevation: D.elevation }; };
  // The Bevel list draws each shape's profile, black under the curve on white, in a square
  // 60% of the cell (0x5d72b0).
  const bevelPicture = (i: number, g: CanvasRenderingContext2D, size: number) => {
    const inset = Math.trunc((size * 2) / 10), n = size - 2 * inset, f = BEVEL_SHAPES[i];
    g.fillStyle = "#fff"; g.fillRect(0, 0, size, size);
    g.fillStyle = "#000";
    for (let k = 0; k < n; k++) { const h = Math.trunc(f(n > 1 ? k / (n - 1) : 0, n - 1)); g.fillRect(inset + k, inset + n - 1 - h, 1, h + 1); }
  };
  const bevelControls = [{ key: "bevel", label: "Bevel", type: "select" as const, choices: Array.from({ length: 12 }, (_, i) => `Bevel ${i + 1}`), group: "Bevel", pictures: bevelPicture }, range("width", "Width", 1, 100, "Bevel"), ...lightControls];
  const shapeOf = (doc: import("../core/doc/image-doc.ts").ImageDoc, r: Raster) => doc.selection ?? { width: r.width, height: r.height, data: Uint8Array.from({ length: r.width * r.height }, (_, i) => r.data[i * 4 + 3]) };
  registry.bind(CMD.IMAGE_EFFECTS_INNER_BEVEL, () => {
    const { doc } = context();
    return runPreviewed(ed, {
      title: "Inner Bevel", unclipped: true, controls: bevelControls, defaults: bevelDefaults(),
      op: (v): PixelOp => (r) => innerBevel(r, shapeOf(doc, r), doc.selection, bevelValues(v)),
    }, remembered);
  }, { enabled: hasShape });
  registry.bind(CMD.IMAGE_EFFECTS_OUTER_BEVEL, () => {
    const { doc } = context();
    return runPreviewed(ed, {
      title: "Outer Bevel", unclipped: true, controls: bevelControls, defaults: bevelDefaults(),
      op: (v): PixelOp => (r) => outerBevel(r, shapeOf(doc, r), bevelValues(v)),
    }, remembered);
  }, { enabled: hasShape });

  const surfaceValues = (v: import("../ui/dialogs/preview-dialog.ts").Values): SurfaceParams => ({
    size: Number(v.size), smoothness: Number(v.smoothness), depth: Number(v.depth), ambience: Number(v.ambience), shininess: Number(v.shininess),
    color: rgb(v.color), angle: Number(v.angle), intensity: Number(v.intensity), elevation: Number(v.elevation),
  });
  const surfaceDefaults = (D: SurfaceParams) => ({ size: D.size, smoothness: D.smoothness, depth: D.depth, ambience: D.ambience, shininess: D.shininess, color: hex(D.color), angle: D.angle, intensity: D.intensity, elevation: D.elevation });
  registry.bind(CMD.IMAGE_EFFECTS_TEXTURE, () => {
    const { doc } = context();
    const names = res.textures.map((t) => t.name);
    return runPreviewed(ed, {
      title: "Texture",
      controls: [{ key: "texture", label: "Texture", type: "select", choices: names.length ? names : ["(import PSP 6 resources)"], group: "Texture" }, range("size", "Size (%)", 10, 500, "Texture"), ...lightControls],
      defaults: { texture: names.find((n) => /asphalt/i.test(n)) ?? names[0] ?? "", ...surfaceDefaults(TEXTURE_DEFAULTS) },
      op: (v): PixelOp => (r) => {
        const t = res.texture(String(v.texture));
        if (!t) return r;
        const tex: Raster = { width: t.width, height: t.height, data: new Uint8ClampedArray(t.width * t.height * 4) };
        for (let i = 0; i < t.data.length; i++) tex.data.set([t.data[i], t.data[i], t.data[i], 255], i * 4);
        return texture(r, tex, surfaceValues(v), doc.selection ? doc.selection.data : null);
      },
    }, remembered);
  }, { enabled: trueColor });
  // Tiles (DIALOG 503): the tile shape, angularity, size, border size and border color, then the lighting.
  registry.bind(CMD.IMAGE_EFFECTS_TILES, () => {
    const { doc } = context();
    const D = TILES_DEFAULTS;
    return runPreviewed(ed, {
      title: "Tiles",
      controls: [{ key: "shape", label: "Tile shape", type: "select", choices: TILE_SHAPES, group: "Tile" }, range("angularity", "Tile angularity", 0, 100, "Tile"),
        range("size", "Tile size", 8, 32, "Tile"), range("border", "Border size", 1, 10, "Tile"), color("borderColor", "Border color", "Tile"), ...lightControls],
      defaults: { shape: TILE_SHAPES[D.shape], angularity: D.angularity, border: D.border, borderColor: hex(D.borderColor), ...surfaceDefaults({ ...D }) },
      op: (v): PixelOp => (r) => tiles(r, {
        ...surfaceValues(v), shape: Math.max(0, TILE_SHAPES.indexOf(String(v.shape))) as 0 | 1 | 2,
        angularity: Number(v.angularity), size: Number(v.size), border: Number(v.border), borderColor: rgb(v.borderColor),
      }, doc.selection ? doc.selection.data : null, doc.greyscale),
    }, remembered);
  }, { enabled: trueColor });
  registry.bind(CMD.IMAGE_EFFECTS_SCULPTURE, () => {
    const { doc } = context();
    const names = res.patterns.map((t) => t.name);
    return runPreviewed(ed, {
      title: "Sculpture",
      controls: [{ key: "pattern", label: "Pattern", type: "select", choices: ["Solid color", ...names], group: "Pattern" }, color("solid", "Color", "Pattern"), range("size", "Size (%)", 10, 500, "Pattern"), ...lightControls],
      defaults: { pattern: "Solid color", solid: hex(SCULPTURE_COLOR), ...surfaceDefaults(SCULPTURE_DEFAULTS) },
      op: (v): PixelOp => (r) => {
        const pat = res.patterns.find((x) => x.name === v.pattern)?.raster ?? rgb(v.solid);
        return sculpture(r, pat, surfaceValues(v), doc.selection ? doc.selection.data : null);
      },
    }, remembered);
  }, { enabled: trueColor });
}
