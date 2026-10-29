/*
  Image > Deformations, from core/deform (docs/PSP_EXE_ANALYSIS.md section 9). Each runs on
  the floating selection or the active layer, inside the selection, as one undo step; the
  ones that leave corners use the background color as PSP does.
*/
import type { Editor } from "./editor.ts";
import type { Colors } from "./colors.ts";
import { CMD, type CommandRegistry } from "../ui/shell/commands.ts";
import { filterLayer } from "../core/edit/apply-filter.ts";
import { circle } from "../core/deform/circle.ts";
import { pentagon } from "../core/deform/pentagon.ts";
import { wind, WIND_DEFAULTS } from "../core/deform/wind.ts";
import { perspectiveHorizontal, perspectiveVertical } from "../core/deform/perspective.ts";
import { skew, SKEW_DEFAULTS } from "../core/deform/skew.ts";
import { wave, WAVE_DEFAULTS } from "../core/deform/wave.ts";
import { ripple, RIPPLE_DEFAULTS } from "../core/deform/ripple.ts";
import { twirl } from "../core/deform/twirl.ts";
import { cylinderHorizontal, cylinderVertical, pinch, punch } from "../core/deform/pinch.ts";
import { CURLY_DEFAULTS, curlyQs, HALO_DEFAULTS, rotatingMirror, spikyHalo, warp, WARP_DEFAULTS } from "../core/deform/mirror.ts";
import { runPreviewed } from "./color-commands.ts";
import type { PixelOp } from "../core/edit/apply-filter.ts";

export function bindDeformCommands(registry: CommandRegistry, ed: Editor, colors: Colors): void {
  const remembered = new Map<string, import("../ui/dialogs/preview-dialog.ts").Values>();
  const trueColor = () => { const d = ed.image?.doc; return Boolean(d && (d.depth === 24 || d.greyscale)); };
  const bg = (): [number, number, number] => [colors.bg[0], colors.bg[1], colors.bg[2]];
  registry.bind(CMD.IMAGE_DEFORMATIONS_CIRCLE, () => ed.run("Circle Deformation", (d) => filterLayer(d, (r) => circle(r, bg()))), { enabled: trueColor });
  registry.bind(CMD.IMAGE_DEFORMATIONS_PENTAGON, () => ed.run("Pentagon Deformation", (d) => filterLayer(d, (r) => pentagon(r, bg()))), { enabled: trueColor });
  registry.bind(CMD.IMAGE_DEFORMATIONS_WIND, () => runPreviewed(ed, {
    title: "Wind",
    controls: [{ key: "direction", label: "Wind direction", type: "radio", choices: ["From left", "From right"] }, { key: "strength", label: "Wind strength", type: "range", min: 1, max: 20 }],
    defaults: { direction: WIND_DEFAULTS.fromRight ? "From right" : "From left", strength: WIND_DEFAULTS.strength },
    op: (v): PixelOp => (r) => wind(r, { strength: Number(v.strength), fromRight: v.direction === "From right" }),
  }, remembered), { enabled: trueColor });
  for (const vertical of [false, true]) registry.bind(vertical ? CMD.IMAGE_DEFORMATIONS_PERSPECTIVE_VERTICAL : CMD.IMAGE_DEFORMATIONS_PERSPECTIVE_HORIZONTAL, () => runPreviewed(ed, {
    title: vertical ? "Perspective - Vertical" : "Perspective - Horizontal",
    controls: [{ key: "amount", label: "Perspective", type: "range", min: -100, max: 100 }], defaults: { amount: 45 },
    op: (v): PixelOp => (r) => (vertical ? perspectiveVertical : perspectiveHorizontal)(r, Number(v.amount), bg()),
  }, remembered), { enabled: trueColor });
  registry.bind(CMD.IMAGE_DEFORMATIONS_SKEW, () => runPreviewed(ed, {
    title: "Skew",
    controls: [{ key: "horizontal", label: "Horizontal", type: "range", min: -45, max: 45 }, { key: "vertical", label: "Vertical", type: "range", min: -45, max: 45 }],
    defaults: { ...SKEW_DEFAULTS },
    op: (v): PixelOp => (r) => skew(r, { horizontal: Number(v.horizontal), vertical: Number(v.vertical) }, bg()),
  }, remembered), { enabled: trueColor });
  registry.bind(CMD.IMAGE_DEFORMATIONS_WAVE, () => runPreviewed(ed, {
    title: "Wave",
    controls: [
      { key: "ampX", label: "Amplitude", type: "range", min: 1, max: 100, group: "Horizontal displacement" }, { key: "lenX", label: "Wavelength", type: "range", min: 1, max: 100, group: "Horizontal displacement" },
      { key: "ampY", label: "Amplitude", type: "range", min: 1, max: 100, group: "Vertical displacement" }, { key: "lenY", label: "Wavelength", type: "range", min: 1, max: 100, group: "Vertical displacement" },
    ],
    defaults: { ...WAVE_DEFAULTS },
    op: (v): PixelOp => (r) => wave(r, { ampX: Number(v.ampX), lenX: Number(v.lenX), ampY: Number(v.ampY), lenY: Number(v.lenY) }),
  }, remembered), { enabled: trueColor });
  registry.bind(CMD.IMAGE_DEFORMATIONS_RIPPLE, () => runPreviewed(ed, {
    title: "Ripple",
    controls: [
      { key: "originX", label: "Horizontal center", type: "range", min: 0, max: 100 }, { key: "originY", label: "Vertical center", type: "range", min: 0, max: 100 },
      { key: "amplitude", label: "Amplitude", type: "range", min: 1, max: 100 }, { key: "wavelength", label: "Wavelength", type: "range", min: 1, max: 100 },
    ],
    defaults: { ...RIPPLE_DEFAULTS },
    op: (v): PixelOp => (r) => ripple(r, { originX: Number(v.originX), originY: Number(v.originY), amplitude: Number(v.amplitude), wavelength: Number(v.wavelength) }),
  }, remembered), { enabled: trueColor });
  registry.bind(CMD.IMAGE_DEFORMATIONS_TWIRL, () => runPreviewed(ed, {
    title: "Twirl", controls: [{ key: "degrees", label: "Degrees", type: "range", min: -720, max: 720 }], defaults: { degrees: 180 },
    op: (v): PixelOp => (r) => twirl(r, Number(v.degrees)),
  }, remembered), { enabled: trueColor });
  const oneSlider = (id: number, title: string, label: string, min: number, max: number, def: number, run: (r: import("../core/image/raster.ts").Raster, n: number) => import("../core/image/raster.ts").Raster) =>
    registry.bind(id, () => runPreviewed(ed, { title, controls: [{ key: "n", label, type: "range", min, max }], defaults: { n: def }, op: (v): PixelOp => (r) => run(r, Number(v.n)) }, remembered), { enabled: trueColor });
  oneSlider(CMD.IMAGE_DEFORMATIONS_PINCH, "Pinch", "Strength", 1, 100, 50, pinch);
  oneSlider(CMD.IMAGE_DEFORMATIONS_PUNCH, "Punch", "Strength", 1, 100, 50, punch);
  oneSlider(CMD.IMAGE_DEFORMATIONS_CYLINDER_HORIZONTAL, "Cylinder - Horizontal", "Strength", 1, 100, 50, cylinderHorizontal);
  oneSlider(CMD.IMAGE_DEFORMATIONS_CYLINDER_VERTICAL, "Cylinder - Vertical", "Strength", 1, 100, 50, cylinderVertical);
  const pct = (key: string, label: string, min = -100, max = 100) => ({ key, label, type: "range" as const, min, max });
  registry.bind(CMD.IMAGE_DEFORMATIONS_ROTATING_MIRROR, () => runPreviewed(ed, {
    title: "Rotating Mirror", controls: [pct("horizontal", "Horizontal Offset (%)"), pct("vertical", "Vertical Offset (%)"), pct("rotation", "Rotation Angle", 0, 360)],
    defaults: { horizontal: 0, vertical: 0, rotation: 0 },
    op: (v): PixelOp => (r) => rotatingMirror(r, { horizontal: Number(v.horizontal), vertical: Number(v.vertical), rotation: Number(v.rotation) }),
  }, remembered), { enabled: trueColor });
  registry.bind(CMD.IMAGE_DEFORMATIONS_WARP, () => runPreviewed(ed, {
    title: "Warp", controls: [pct("horizontal", "Horizontal Offset (%)"), pct("vertical", "Vertical Offset (%)"), pct("size", "Size", 0, 100), pct("strength", "Strength")],
    defaults: { ...WARP_DEFAULTS },
    op: (v): PixelOp => (r) => warp(r, { horizontal: Number(v.horizontal), vertical: Number(v.vertical), size: Number(v.size), strength: Number(v.strength) }),
  }, remembered), { enabled: trueColor });
  registry.bind(CMD.IMAGE_DEFORMATIONS_CURLYQS, () => runPreviewed(ed, {
    title: "CurlyQs",
    controls: [pct("columns", "Number of Columns", 1, 100), pct("rows", "Number of Rows", 1, 100), pct("horizontal", "Horizontal Offset (%)"), pct("vertical", "Vertical Offset (%)"),
      pct("strength", "Strength", 0, 100), pct("size", "Size", 0, 100), { key: "clockwise", label: "Clockwise", type: "check" }],
    defaults: { ...CURLY_DEFAULTS },
    op: (v): PixelOp => (r) => curlyQs(r, { columns: Number(v.columns), rows: Number(v.rows), horizontal: Number(v.horizontal), vertical: Number(v.vertical), strength: Number(v.strength), size: Number(v.size), clockwise: Boolean(v.clockwise) }),
  }, remembered), { enabled: trueColor });
  registry.bind(CMD.IMAGE_DEFORMATIONS_SPIKY_HALO, () => runPreviewed(ed, {
    title: "Spiky Halo",
    controls: [pct("horizontal", "Horizontal Offset (%)"), pct("vertical", "Vertical Offset (%)"), pct("compression", "Compression", 0, 100), pct("waves", "Number of Waves", 1, 100), pct("radius", "Radius", 0, 100)],
    defaults: { ...HALO_DEFAULTS },
    op: (v): PixelOp => (r) => spikyHalo(r, { horizontal: Number(v.horizontal), vertical: Number(v.vertical), compression: Number(v.compression), waves: Number(v.waves), radius: Number(v.radius) }),
  }, remembered), { enabled: trueColor });
}
