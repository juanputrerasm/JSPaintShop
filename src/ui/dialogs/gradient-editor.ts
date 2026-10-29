/*
  PSP 6's Gradient Editor (DIALOG 145): the gradient list with New, Copy, Rename, Delete,
  Import and Export (.jgd); the Gradient bar with its color stops (each Foreground,
  Background or a Custom color, at a Location); the Transparency bar with its opacity stops;
  and the Result.

  Click under a bar to add a stop, drag a stop to move it, drag it off the bar to remove it.
  The built-in gradients cannot be changed or deleted; Copy makes an editable one.
*/
import { el } from "../../shared/dom.ts";
import { openDialog, alertDialog } from "../shell/dialog.ts";
import { textDialog } from "./prompts.ts";
import type { AppState } from "../../app/state.ts";
import type { Resources } from "../../app/resources.ts";
import { BUILTIN_GRADIENTS, gradientTable, readJgd, writeJgd, type Gradient } from "../../core/paint/gradient.ts";
import type { Rgba } from "../../core/image/raster.ts";
import { showColorDialog } from "./color-dialog.ts";
import { pickOpenFile, pickSaveFile, writeTarget } from "../shell/file-dialogs.ts";
import { toHex } from "../../core/color/color-space.ts";

export async function showGradientEditor(app: AppState, res: Resources, colors: { fg: Rgba; bg: Rgba }, current: string): Promise<string | null> {
  let list = res.gradients.map((g) => structuredClone(g));
  let sel = Math.max(0, list.findIndex((g) => g.name === current));
  let stopSel: { bar: "colors" | "opacities"; i: number } | null = null;
  const builtin = (g: Gradient) => BUILTIN_GRADIENTS.some((b) => b.name === g.name);
  const changed = new Set<string>();
  const removed = new Set<string>();

  const names = el("select", { size: 7, class: "gradient-list" });
  const colorBar = el("canvas", { class: "gradient-bar", width: 300, height: 18 });
  const colorStops = el("div", { class: "stop-track" });
  const alphaBar = el("canvas", { class: "gradient-bar", width: 300, height: 18 });
  const alphaStops = el("div", { class: "stop-track" });
  const result = el("canvas", { class: "gradient-bar", width: 300, height: 18 });
  const kind = el("select", {}, el("option", { value: "fg" }, "Fore"), el("option", { value: "bg" }, "Back"), el("option", { value: "color" }, "Custom"));
  const custom = el("button", { type: "button", class: "color-swatch big" });
  const loc = el("input", { type: "number", class: "spin", min: 0, max: 100 });
  const opacity = el("input", { type: "number", class: "spin", min: 0, max: 100 });
  const g = () => list[sel];

  const paint = (c: HTMLCanvasElement, table: Uint8ClampedArray, alphaOnly: boolean) => {
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(c.width, c.height);
    for (let x = 0; x < c.width; x++) {
      const i = Math.round((x / (c.width - 1)) * 255) * 4;
      for (let y = 0; y < c.height; y++) {
        const check = ((x >> 3) + (y >> 3)) % 2 ? 255 : 204;
        const a = table[i + 3] / 255;
        const px = alphaOnly ? [255 - table[i + 3], 255 - table[i + 3], 255 - table[i + 3]] : [table[i] * a + check * (1 - a), table[i + 1] * a + check * (1 - a), table[i + 2] * a + check * (1 - a)];
        img.data.set([px[0], px[1], px[2], 255], (y * c.width + x) * 4);
      }
    }
    ctx.putImageData(img, 0, 0);
  };
  const draw = () => {
    names.replaceChildren(...list.map((x, i) => el("option", { value: i, selected: i === sel }, x.name)));
    const t = gradientTable(g(), colors.fg, colors.bg);
    paint(colorBar, gradientTable({ ...g(), opacities: [] }, colors.fg, colors.bg), false);
    paint(alphaBar, t, true);
    paint(result, t, false);
    const marks = (bar: "colors" | "opacities", host: HTMLElement) => host.replaceChildren(...g()[bar].map((s, i) => {
      const m = el("span", { class: `stop${stopSel?.bar === bar && stopSel.i === i ? " on" : ""}`, style: { left: `${s.at}%` }, title: `${Math.round(s.at)}%` }, "▲");
      m.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        stopSel = { bar, i };
        m.setPointerCapture(e.pointerId);
        const r = host.getBoundingClientRect();
        const move = (ev: PointerEvent) => { if (builtin(g())) return; s.at = Math.max(0, Math.min(100, ((ev.clientX - r.left) / r.width) * 100)); changed.add(g().name); draw(); };
        const up = (ev: PointerEvent) => {
          m.removeEventListener("pointermove", move);
          m.removeEventListener("pointerup", up);
          // Dragged well off the bar: the stop goes (a gradient keeps at least two).
          if (!builtin(g()) && Math.abs(ev.clientY - r.top) > 40 && g()[bar].length > 2) { g()[bar].splice(i, 1); stopSel = null; changed.add(g().name); }
          draw();
        };
        m.addEventListener("pointermove", move);
        m.addEventListener("pointerup", up);
        draw();
      });
      return m;
    }));
    marks("colors", colorStops);
    marks("opacities", alphaStops);
    const s = stopSel && g()[stopSel.bar][stopSel.i];
    loc.value = s ? String(Math.round(s.at)) : "";
    kind.disabled = custom.disabled = !(s && stopSel?.bar === "colors");
    opacity.disabled = !(s && stopSel?.bar === "opacities");
    if (s && "kind" in s) { kind.value = s.kind; custom.style.background = toHex(s.color[0], s.color[1], s.color[2]); }
    if (s && "opacity" in s) opacity.value = String(Math.round((s.opacity / 255) * 100));
  };
  const edit = (f: () => void) => { if (builtin(g())) { void alertDialog("Gradient Editor", "The built-in gradients cannot be changed. Use Copy to make one you can edit."); return; } f(); changed.add(g().name); draw(); };
  const addStop = (bar: "colors" | "opacities", host: HTMLElement) => host.addEventListener("pointerdown", (e) => edit(() => {
    const r = host.getBoundingClientRect(), at = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
    if (bar === "colors") g().colors.push({ at, mid: 50, kind: "fg", color: [0, 0, 0] });
    else g().opacities.push({ at, mid: 50, opacity: 255 });
    stopSel = { bar, i: g()[bar].length - 1 };
  }));
  addStop("colors", colorStops);
  addStop("opacities", alphaStops);
  names.addEventListener("change", () => { sel = Number(names.value); stopSel = null; draw(); });
  loc.addEventListener("change", () => edit(() => { const s = stopSel && g()[stopSel.bar][stopSel.i]; if (s) s.at = Math.max(0, Math.min(100, Number(loc.value))); }));
  opacity.addEventListener("change", () => edit(() => { const s = stopSel && g().opacities[stopSel.i]; if (s) s.opacity = Math.round((Math.max(0, Math.min(100, Number(opacity.value))) * 255) / 100); }));
  kind.addEventListener("change", () => edit(() => { const s = stopSel && g().colors[stopSel.i]; if (s) s.kind = kind.value as "fg" | "bg" | "color"; }));
  custom.addEventListener("click", async () => {
    const s = stopSel && stopSel.bar === "colors" ? g().colors[stopSel.i] : null;
    if (!s || builtin(g())) return;
    const c = await showColorDialog(app, [...s.color, 255] as Rgba);
    if (c) edit(() => { s.color = [c[0], c[1], c[2]]; s.kind = "color"; });
  });
  const unique = (base: string) => { let n = base, k = 2; while (list.some((x) => x.name === n)) n = `${base} ${k++}`; return n; };
  const button = (label: string, run: () => void | Promise<void>) => el("button", { type: "button", class: "mini", onclick: run }, label);
  const buttons = el("div", { class: "gradient-buttons" },
    button("New...", async () => { const n = await textDialog("New Gradient", "Name:", unique("New Gradient")); if (!n) return; list.push({ name: unique(n), colors: [{ at: 0, mid: 50, kind: "fg", color: [0, 0, 0] }, { at: 100, mid: 50, kind: "bg", color: [255, 255, 255] }], opacities: [{ at: 0, mid: 50, opacity: 255 }, { at: 100, mid: 50, opacity: 255 }] }); sel = list.length - 1; changed.add(list[sel].name); draw(); }),
    button("Copy...", async () => { const n = await textDialog("Copy Gradient", "Name:", unique(`Copy of ${g().name}`)); if (!n) return; list.push({ ...structuredClone(g()), name: unique(n) }); sel = list.length - 1; changed.add(list[sel].name); draw(); }),
    button("Rename...", async () => { if (builtin(g())) return; const n = await textDialog("Rename Gradient", "Name:", g().name); if (!n || n === g().name) return; removed.add(g().name); g().name = unique(n); changed.add(g().name); draw(); }),
    button("Delete", () => { if (builtin(g()) || list.length <= 1) return; removed.add(g().name); list.splice(sel, 1); sel = Math.max(0, sel - 1); draw(); }),
    button("Import...", async () => {
      const f = await pickOpenFile("Gradients", [".jgd", ".grd"]);
      if (!f) return;
      try { for (const x of readJgd(new Uint8Array(await f.file.arrayBuffer()))) { x.name = unique(x.name); list.push(x); changed.add(x.name); } sel = list.length - 1; draw(); }
      catch (err) { await alertDialog("Gradient Editor", err instanceof Error ? err.message : String(err)); }
    }),
    button("Export...", async () => { const t = await pickSaveFile(g().name, "Gradient", ".jgd"); if (t) await writeTarget(t, writeJgd([g()]), "application/octet-stream"); }));
  draw();
  const body = el("div", { class: "gradient-editor" },
    el("fieldset", { class: "opt-group" }, el("legend", {}, "Types"), el("div", { class: "gradient-types" }, names, buttons)),
    el("fieldset", { class: "opt-group" }, el("legend", {}, "Gradient"), colorBar, colorStops,
      el("div", { class: "gradient-row" }, el("label", { class: "color-field" }, el("span", {}, "Color:"), kind), custom, el("label", { class: "color-field" }, el("span", {}, "Location:"), loc, "%"))),
    el("fieldset", { class: "opt-group" }, el("legend", {}, "Transparency"), alphaBar, alphaStops,
      el("div", { class: "gradient-row" }, el("label", { class: "color-field" }, el("span", {}, "Opacity:"), opacity, "%"))),
    el("fieldset", { class: "opt-group" }, el("legend", {}, "Result"), result));
  const v = await openDialog({ title: "Gradient Editor", body, className: "gradient-dialog", buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }] });
  if (v !== "ok") return null;
  for (const n of removed) if (!list.some((x) => x.name === n)) await res.deleteGradient(n);
  for (const x of list) if (changed.has(x.name) && !builtin(x)) await res.saveGradient(x);
  list = [];
  return g()?.name ?? current;
}
