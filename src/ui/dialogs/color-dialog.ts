/*
  PSP 6's Color dialog (DIALOG 425): Basic Colors, the color picker (hue across, saturation
  down, with a lightness bar), Custom Colors with Add Custom, the current color as Red, Green,
  Blue, Hue, Sat and Light (all 0..255, as PSP shows them) and as an HTML code, and the old
  color beside the new. Also Recent Colors (DIALOG 508): the last ten colors used.
*/
import { el } from "../../shared/dom.ts";
import { openDialog } from "../shell/dialog.ts";
import type { AppState } from "../../app/state.ts";
import { fromHex, hslToRgb, rgbToHsl, toHex } from "../../core/color/color-space.ts";
import type { Rgba } from "../../core/image/raster.ts";

/* The Windows color dialog's 48 basic colors, which PSP's dialog shows too. */
const BASIC = [
  "#ff8080", "#ffff80", "#80ff80", "#00ff80", "#80ffff", "#0080ff", "#ff80c0", "#ff80ff",
  "#ff0000", "#ffff00", "#80ff00", "#00ff40", "#00ffff", "#0080c0", "#8080c0", "#ff00ff",
  "#804040", "#ff8040", "#00ff00", "#008080", "#004080", "#8080ff", "#800040", "#ff0080",
  "#800000", "#ff8000", "#008000", "#008040", "#0000ff", "#0000a0", "#800080", "#8000ff",
  "#400000", "#804000", "#004000", "#004040", "#000080", "#000040", "#400040", "#400080",
  "#000000", "#808000", "#808040", "#808080", "#408080", "#c0c0c0", "#400040", "#ffffff",
];

export async function showColorDialog(app: AppState, start: Rgba, title = "Color"): Promise<Rgba | null> {
  let rgb = [start[0], start[1], start[2]];
  const hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  let lightness = hsl[2];
  const field = (label: string, max: number) => {
    const input = el("input", { type: "number", class: "spin", min: 0, max });
    return { input, row: el("label", { class: "color-field" }, el("span", {}, label), input) };
  };
  const R = field("Red:", 255), G = field("Green:", 255), B = field("Blue:", 255);
  const H = field("Hue:", 255), S = field("Sat:", 255), L = field("Light:", 255);
  const html = el("input", { class: "text-field color-html" });
  const now = el("div", { class: "color-swatch big" }), old = el("div", { class: "color-swatch big", style: { background: toHex(start[0], start[1], start[2]) } });
  const picker = el("canvas", { class: "color-picker", width: 180, height: 140 });
  const bar = el("canvas", { class: "color-bar", width: 16, height: 140 });
  const custom = el("div", { class: "color-grid custom" });

  const drawPicker = () => {
    const g = picker.getContext("2d")!;
    const img = g.createImageData(picker.width, picker.height);
    const c = [0, 0, 0];
    for (let y = 0; y < picker.height; y++) for (let x = 0; x < picker.width; x++) {
      hslToRgb((x / picker.width) * 360, 1 - y / picker.height, 0.5, c);
      img.data.set([c[0], c[1], c[2], 255], (y * picker.width + x) * 4);
    }
    g.putImageData(img, 0, 0);
    const cur = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    g.strokeStyle = "#000";
    g.strokeRect((cur[0] / 360) * picker.width - 3, (1 - cur[1]) * picker.height - 3, 6, 6);
    const b = bar.getContext("2d")!;
    for (let y = 0; y < bar.height; y++) {
      hslToRgb(cur[0], cur[1], 1 - y / bar.height, c);
      b.fillStyle = `rgb(${c[0]} ${c[1]} ${c[2]})`;
      b.fillRect(0, y, bar.width, 1);
    }
    b.fillStyle = "#000";
    b.fillRect(0, (1 - lightness) * bar.height - 1, bar.width, 2);
  };
  const show = (skip?: HTMLInputElement) => {
    const h = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    const vals: [HTMLInputElement, number][] = [[R.input, rgb[0]], [G.input, rgb[1]], [B.input, rgb[2]], [H.input, Math.round((h[0] / 360) * 255)], [S.input, Math.round(h[1] * 255)], [L.input, Math.round(h[2] * 255)]];
    for (const [i, v] of vals) if (i !== skip) i.value = String(v);
    if (skip !== html) html.value = toHex(rgb[0], rgb[1], rgb[2]);
    now.style.background = toHex(rgb[0], rgb[1], rgb[2]);
    drawPicker();
  };
  const setRgb = (c: number[], skip?: HTMLInputElement) => { rgb = c.map((v) => Math.max(0, Math.min(255, Math.round(v)))); lightness = rgbToHsl(rgb[0], rgb[1], rgb[2])[2]; show(skip); };
  for (const f of [R, G, B]) f.input.addEventListener("input", () => setRgb([Number(R.input.value), Number(G.input.value), Number(B.input.value)], f.input));
  for (const f of [H, S, L]) f.input.addEventListener("input", () => setRgb(hslToRgb((Number(H.input.value) / 255) * 360, Number(S.input.value) / 255, Number(L.input.value) / 255), f.input));
  html.addEventListener("input", () => { const c = fromHex(html.value); if (c) setRgb(c, html); });
  const drag = (canvas: HTMLCanvasElement, at: (x: number, y: number) => void) => {
    const go = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); at(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))); };
    canvas.addEventListener("pointerdown", (e) => { canvas.setPointerCapture(e.pointerId); go(e); });
    canvas.addEventListener("pointermove", (e) => { if (e.buttons) go(e); });
  };
  drag(picker, (x, y) => { setRgb(hslToRgb(x * 360, 1 - y, lightness || 0.5)); });
  drag(bar, (_x, y) => { const h = rgbToHsl(rgb[0], rgb[1], rgb[2]); lightness = 1 - y; setRgb(hslToRgb(h[0], h[1], lightness)); });
  const swatch = (hex: string) => el("button", { type: "button", class: "color-swatch", title: hex, style: { background: hex }, onclick: () => { const c = fromHex(hex); if (c) setRgb(c); } });
  const drawCustom = () => custom.replaceChildren(...Array.from({ length: 16 }, (_, i) => app.settings.customColors[i] ? swatch(app.settings.customColors[i]) : el("span", { class: "color-swatch empty" })));
  drawCustom();
  const add = el("button", { type: "button", class: "mini", onclick: () => {
    const hex = toHex(rgb[0], rgb[1], rgb[2]);
    app.updateSettings((s) => { s.customColors = [hex, ...s.customColors.filter((c) => c !== hex)].slice(0, 16); });
    drawCustom();
  } }, "Add Custom");
  show();
  const body = el("div", { class: "color-dialog" },
    el("div", { class: "color-left" },
      el("div", { class: "opt-hint" }, "Basic Colors"), el("div", { class: "color-grid" }, ...BASIC.map(swatch)),
      el("div", { class: "opt-hint" }, "Custom Colors"), custom, add),
    el("div", { class: "color-right" },
      el("div", { class: "color-picker-row" }, picker, bar),
      el("fieldset", { class: "opt-group" }, el("legend", {}, "Current Color"),
        el("div", { class: "color-fields" }, R.row, H.row, G.row, S.row, B.row, L.row),
        el("label", { class: "color-field" }, el("span", {}, "HTML Code:"), html),
        el("div", { class: "color-compare" }, el("div", {}, now, "New"), el("div", {}, old, "Old Color")))));
  const v = await openDialog({ title, body, className: "color-dialog-wrap", buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }] });
  return v === "ok" ? [rgb[0], rgb[1], rgb[2], 255] : null;
}

/** Recent Colors (DIALOG 508): pick one of the last ten colors, or Other... for the Color dialog. */
export async function showRecentColors(app: AppState, start: Rgba): Promise<Rgba | null> {
  let picked: Rgba | null = null;
  const body = el("div", { class: "recent-colors" },
    el("div", { class: "color-grid" }, ...Array.from({ length: 10 }, (_, i) => {
      const hex = app.settings.recentColors[i];
      return hex ? el("button", { type: "submit", class: "color-swatch", style: { background: hex }, title: hex, value: "ok", onclick: () => { const c = fromHex(hex); if (c) picked = [c[0], c[1], c[2], 255]; } }) : el("span", { class: "color-swatch empty" });
    })));
  const v = await openDialog({ title: "Recent Colors", body, buttons: [{ label: "Other...", value: "other" }, { label: "Cancel", value: "cancel" }],
    beforeClose: () => true });
  if (v === "other") return showColorDialog(app, start);
  return picked;
}
