/*
  File > Preferences > General Program Preferences: the tabs Undo (DIALOG 27080), Viewing
  (27082), Dialogs and Palettes (27083), Browser (27084), Miscellaneous (27085), Rulers and Units
  (27086), Cursors (27087) and Transparency (27089), with their labels. The values live in
  settings.prefs (core/settings.ts, PSP 6's defaults); OK keeps them, Cancel drops them.
*/
import type { AppState } from "../../app/state.ts";
import { el } from "../../shared/dom.ts";
import { openDialog } from "../shell/dialog.ts";
import { CHECKER_SIZES, TRANSPARENCY_SCHEMES, type Preferences } from "../../core/settings.ts";

type Group = Record<string, unknown>;

const check = (o: Group, k: string, label: string) => {
  const c = el("input", { type: "checkbox", checked: Boolean(o[k]) });
  c.addEventListener("change", () => { o[k] = c.checked; });
  return el("label", { class: "opt-check" }, c, label);
};
const number = (o: Group, k: string, min: number, max: number, step = 1) => {
  const n = el("input", { type: "number", class: "spin", min, max, step, value: o[k] as number });
  n.addEventListener("change", () => { o[k] = Math.max(min, Math.min(max, Number(n.value) || min)); n.value = String(o[k]); });
  return n;
};
const color = (o: Group, k: string) => {
  const c = el("input", { type: "color", value: o[k] as string });
  c.addEventListener("input", () => { o[k] = c.value; });
  return c;
};
const select = (o: Group, k: string, labels: string[], values?: number[]) => {
  const vals = values ?? labels.map((_, i) => i);
  const s = el("select", {}, ...labels.map((l, i) => el("option", { value: String(vals[i]), selected: vals[i] === o[k] }, l)));
  s.addEventListener("change", () => { o[k] = Number(s.value); });
  return s;
};
/* Radio buttons that set o[k] to the chosen value. */
const radio = (o: Group, k: string, name: string, items: [string, unknown][]) => items.map(([label, value]) => {
  const r = el("input", { type: "radio", name, checked: o[k] === value });
  r.addEventListener("change", () => { if (r.checked) o[k] = value; });
  return el("label", { class: "opt-check" }, r, label);
});
const group = (legend: string, ...children: (Node | null)[]) => el("fieldset", { class: "opt-group" }, el("legend", {}, legend), ...children);
const row = (label: string, ...c: Node[]) => el("label", { class: "form-row" }, el("span", {}, label), ...c);
const line = (...c: (Node | string)[]) => el("div", { class: "form-row" }, ...c);

function pages(p: Preferences): [string, HTMLElement][] {
  const u = p.undo as unknown as Group, v = p.viewing as unknown as Group, d = p.dialogs as unknown as Group, b = p.browser as unknown as Group;
  const m = p.misc as unknown as Group, r = p.rulers as unknown as Group, c = p.cursors as unknown as Group, t = p.transparency as unknown as Group;
  const units = ["Pixels", "Inches", "Centimeters"];

  // Transparency: a live preview of the checkerboard.
  const preview = el("canvas", { width: 96, height: 64, class: "pref-checker" }) as HTMLCanvasElement;
  const drawPreview = () => {
    const g = preview.getContext("2d")!, s = CHECKER_SIZES[p.transparency.size];
    const custom = p.transparency.scheme === TRANSPARENCY_SCHEMES.length - 1, sc = TRANSPARENCY_SCHEMES[p.transparency.scheme];
    for (let y = 0; y < 64; y += s) for (let x = 0; x < 96; x += s) {
      g.fillStyle = ((x / s + y / s) & 1) ? (custom ? p.transparency.color2 : sc[2]) : (custom ? p.transparency.color1 : sc[1]);
      g.fillRect(x, y, s, s);
    }
  };
  const tPage = el("div", {},
    row("Grid Size:", select(t, "size", ["Tiny", "Small", "Medium", "Large"])),
    group("Grid Colors", row("Scheme:", select(t, "scheme", TRANSPARENCY_SCHEMES.map((s) => s[0]))), row("Color 1", color(t, "color1")), row("Color 2", color(t, "color2"))),
    group("Preview", preview));
  tPage.addEventListener("input", drawPreview);
  tPage.addEventListener("change", drawPreview);
  drawPreview();

  return [
    ["Undo", el("div", {},
      check(u, "enabled", "Enable the undo system"),
      line(check(u, "limitMemory", "Limit undo/redo disk usage to"), number(u, "memoryMB", 1, 9999), "MBytes of storage per open image"),
      line(check(u, "limitSteps", "Limit undo/redo to"), number(u, "steps", 1, 999), "steps per open image"),
      check(u, "compress", "Compress undo/redo information (slower / saves disk space)"),
      check(u, "redo", "Enable the redo system"))],
    ["Viewing", el("div", {},
      group("Zooming", check(v, "fitZoomIn", "Fit window to image when zooming in - The window will resize to fit the image"), check(v, "fitZoomOut", "Fit window to image when zooming out - The window will resize to fit the image")),
      group("New images", check(v, "autoSizeNew", "Auto size - Automatically set the zoom factor when loading large images")),
      group("After changing size", check(v, "fitAfterResize", "Fit window to image - The window will resize to fit the image if the image size changes"), check(v, "autoSizeAfterResize", "Auto size - Automatically set the zoom factor when the image size increases")))],
    ["Dialogs and Palettes", el("div", {},
      check(d, "stdColorPicker", "Use standard Windows color picker"),
      check(d, "flatToolbars", "Display flat style toolbars"),
      check(d, "noConfirm", "Do not display confirmation dialogs during save or image processing operations"),
      check(d, "rememberSaveType", "Remember last type used in file save-as dialog"),
      check(d, "autoRollUps", "Enable Automatic Roll-Ups"),
      group("Color palette", ...radio(d, "hsl", "pref-hsl", [["Display colors in RGB format", false], ["Display colors in HSL format", true]]),
        ...radio(d, "hex", "pref-hex", [["Decimal display", false], ["Hexadecimal display", true]])))],
    ["Browser", el("div", {},
      group("Thumbnail size", ...radio(b, "thumbSize", "pref-thumb", [["60 x 60", 60], ["80 x 80", 80], ["100 x 100", 100], ["120 x 120", 120]])),
      group("Selection color", color(b, "selectionColor")),
      check(b, "saveFiles", "Save Browser files to disk"),
      check(b, "autoUpdate", "Automatically update the thumbnails"))],
    ["Miscellaneous", el("div", {},
      line("Recently used file list contains", number(m, "recentCount", 1, 9), "file names"),
      line("Use", number(m, "pasteTolerance", 0, 100), "% tolerance to background color when pasting a transparent selection"),
      check(m, "noAskCloseAll", "Do not ask to save changes on Window Close All"),
      check(m, "noAskEmptyClipboard", "Do not ask to empty the clipboard on Exit"),
      check(m, "forceRedraw", "Force full window redraw when positioning image elements"),
      check(m, "splash", "Show splash screen when application starts"),
      check(m, "psdWarning", "Show warning when reading PSD files containing unsupported attributes"),
      check(m, "puckPressure", "Disable pressure support for puck-type pointing devices"))],
    ["Rulers and Units", el("div", {},
      group("Rulers", row("Display Units:", select(r, "units", units)), ...radio(r, "toolbarColors", "pref-ruler", [["Black on White", false], ["Toolbar Colors", true]])),
      group("Default Resolution", line(number(r, "defaultDpi", 1, 9999), select(r, "dpiUnit", ["Pixels / inch", "Pixels / cm"]))),
      group("Grid", row("Units:", select(r, "gridUnits", units)), row("Horizontal Spacing:", number(r, "gridX", 1, 9999)), row("Vertical Spacing:", number(r, "gridY", 1, 9999)), row("Line Color:", color(r, "gridColor"))))],
    ["Cursors", el("div", {},
      check(c, "precise", "Use precise cursor for tools instead of standard cursors"),
      check(c, "brushOutline", "Show brush shape outline for brushes"))],
    ["Transparency", tPage],
  ];
}

export async function showPreferences(app: AppState, first = 0): Promise<void> {
  const working = structuredClone(app.settings.prefs);
  const list = pages(working);
  const tabs = list.map(([title], i) => el("button", {
    type: "button", role: "tab", "aria-selected": String(i === first),
    onclick: () => { list.forEach(([, page], k) => { page.hidden = k !== i; }); tabs.forEach((t, k) => t.setAttribute("aria-selected", String(k === i))); },
  }, title));
  list.forEach(([, page], k) => { page.hidden = k !== first; });
  const v = await openDialog({
    title: "JSPaintShop Preferences", className: "prefs-dialog",
    body: [el("div", { class: "tabs", role: "tablist" }, ...tabs), el("div", { class: "opt-body" }, ...list.map(([, page]) => page))],
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
  });
  if (v !== "ok") return;
  app.updateSettings((s) => {
    s.prefs = working;
    s.recent = s.recent.slice(0, working.misc.recentCount);
  });
}
