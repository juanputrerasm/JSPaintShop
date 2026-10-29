/*
  Image > Picture Frame: PSP's three-page wizard as one dialog: the frame (from the imported
  Frames folder), inside or outside the image, and the color for transparent areas outside the
  frame's edge. The frame lands on a new layer at the top (core/effects/frame.ts).
*/
import type { Editor } from "./editor.ts";
import type { Colors } from "./colors.ts";
import type { Resources } from "./resources.ts";
import { CMD, type CommandRegistry } from "../ui/shell/commands.ts";
import { el } from "../shared/dom.ts";
import { alertDialog, openDialog } from "../ui/shell/dialog.ts";
import { readPsp } from "../core/formats/psp.ts";
import { deflate, inflate } from "../core/formats/zlib.ts";
import { writePsp } from "../core/formats/psp-write.ts";
import { composite } from "../core/layers/composite.ts";
import { placeFrame } from "../core/effects/frame.ts";
import { isBackground, resizeCanvas } from "../core/image/geometry.ts";
import { addRasterLayer } from "../core/layers/layer-ops.ts";

export function bindFrameCommands(registry: CommandRegistry, ed: Editor, colors: Colors, res: Resources): void {
  registry.bind(CMD.IMAGE_PICTURE_FRAME, async () => {
    const image = ed.image;
    if (!image) return;
    const names = (await res.files("frames")).filter((f) => /\.pfr$/i.test(f)).sort();
    if (!names.length) { await alertDialog("Picture Frame Wizard", "No picture frames yet: use File > Import > Picture Frames to bring in .pfr files, such as those in PSP 6's Frames folder."); return; }
    const frame = el("select", {}, ...names.map((n) => el("option", { value: n }, n.replace(/\.pfr$/i, ""))));
    const inside = el("input", { type: "radio", name: "where", checked: true }), outside = el("input", { type: "radio", name: "where" });
    const edge = el("select", {}, ...["Transparent", "Foreground color", "Background color"].map((t) => el("option", {}, t)));
    const v = await openDialog({
      title: "Picture Frame Wizard",
      body: el("div", { class: "layer-props" },
        el("label", { class: "form-row" }, el("span", {}, "Frame:"), frame),
        el("fieldset", { class: "opt-group" }, el("legend", {}, "Place the frame"), el("label", { class: "opt-check" }, inside, "Inside of the image"), el("label", { class: "opt-check" }, outside, "Outside of the image")),
        el("label", { class: "form-row" }, el("span", {}, "Transparent areas outside the frame:"), edge)),
      buttons: [{ label: "Finish", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    });
    if (v !== "ok") return;
    const { doc: fdoc } = await readPsp(await res.read("frames", frame.value), inflate);
    const art = composite(fdoc);
    const fill = edge.selectedIndex === 1 ? colors.fg : edge.selectedIndex === 2 ? colors.bg : null;
    const shape = fdoc.alphas.length ? fdoc.alphas[fdoc.alphas.length - 1].mask : null;
    const p = placeFrame(art, image.doc.width, image.doc.height, outside.checked, fill ? [fill[0], fill[1], fill[2]] : null, shape);
    ed.run("Picture Frame", (d) => {
      if (p.width !== d.width || p.height !== d.height) resizeCanvas(d, p.width, p.height, p.dx, p.dy, colors.bg);
      d.active = d.layers.length - 1;
      const layer = addRasterLayer(d, { name: frame.value.replace(/\.pfr$/i, "") });
      layer.raster = p.frame;
      return { image: true };
    }, image);
  }, { enabled: () => ed.image !== null });
}

/*
  File > Export > Picture Tube: the image (24-bit, one layer with transparency, as PSP
  requires) saved as a .tub into the tubes library, with the cell layout, step and modes.
*/
export function bindExportTube(registry: CommandRegistry, ed: Editor, res: Resources): void {
  registry.bind(CMD.FILE_EXPORT_PICTURE_TUBE, async () => {
    const image = ed.image;
    if (!image) return;
    const doc = image.doc;
    if (doc.depth !== 24 || doc.layers.length !== 1 || isBackground(doc, doc.layers[0])) {
      await alertDialog("Export Picture Tube", "To save the image as a Picture Tube, the image must be 24 bit and have only one layer with a transparency.");
      return;
    }
    const num = (v: number, min: number, max: number) => el("input", { type: "number", class: "spin", value: v, min, max });
    const across = num(1, 1, 100), down = num(1, 1, 100), total = num(1, 1, 10000), step = num(Math.max(1, doc.width), 1, 500);
    const placement = el("select", {}, el("option", {}, "Random"), el("option", { selected: true }, "Continuous"));
    const selection = el("select", {}, ...["Random", "Incremental", "Angular", "Pressure", "Velocity"].map((t) => el("option", {}, t)));
    const name = el("input", { type: "text", value: image.name.replace(/\.[^.]+$/, "") });
    const row = (label: string, c: Node) => el("label", { class: "form-row" }, el("span", {}, label), c);
    const v = await openDialog({
      title: "Export Picture Tube",
      body: el("div", { class: "layer-props" }, row("Cells across:", across), row("Cells down:", down), row("Total cells:", total), row("Placement mode:", placement), row("Step size:", step), row("Selection mode:", selection), row("Tube name:", name)),
      buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    });
    if (v !== "ok") return;
    if (!name.value.trim()) { await alertDialog("Export Picture Tube", "You must give the Picture Tube a valid name."); return; }
    const bytes = await writePsp(doc, deflate, undefined, {
      name: name.value.trim(), step: Number(step.value) || 1, across: Number(across.value) || 1, down: Number(down.value) || 1,
      count: Number(total.value) || 1, placement: placement.selectedIndex, selection: selection.selectedIndex,
    });
    await res.write("tubes", `${name.value.trim()}.tub`, bytes);
    res.emit("changed", "tubes");
  }, { enabled: () => ed.image !== null });
}
