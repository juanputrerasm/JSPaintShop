/*
  The Tool Options palette (O): the active tool's options, on tabs when the tool has several
  (Brush Tip, Paper, Clone...). Sliders show their number beside them, as PSP's spin bars do.
  Changes apply at once and are remembered. Pictures (the brush tip, the tube, the preset
  shape) follow the values as they change (tool-previews.ts).
*/
import { el, clear } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";
import type { CommandRegistry } from "../shell/commands.ts";
import { TOOL_OPTIONS, dynamicChoices, setToolOption, toolOptions, type OptionDef } from "../../app/tools/options.ts";
import type { FloatingPanel } from "../shell/panel.ts";
import { iconChoices, previewCanvas } from "./tool-previews.ts";

/** Tool buttons that are not menu commands (Crop Image, Apply...): tool id, then key. */
export const toolActions: Record<number, Record<string, () => void>> = {};

export function toolOptionsPalette(app: AppState, registry: CommandRegistry, panel: FloatingPanel): { refresh(): void } {
  let tab = "";
  const draw = () => {
    clear(panel.body);
    const tool = app.tool;
    const defs = TOOL_OPTIONS[tool] ?? [];
    const values = toolOptions(app, tool);
    const title = registry.get(tool)?.label ?? "";
    const tabs = [...new Set(defs.map((d) => d.tab ?? "Options"))];
    if (!tabs.includes(tab)) tab = tabs[0] ?? "";
    const box = el("div", { class: "tool-options" }, el("div", { class: "tool-options-title" }, title));
    if (tabs.length > 1) box.append(el("div", { class: "tabs", role: "tablist" }, ...tabs.map((t) => el("button", { type: "button", role: "tab", "aria-selected": String(t === tab), onclick: () => { tab = t; draw(); } }, t))));
    if (!defs.length) box.append(el("p", { class: "panel-empty" }, "This tool has no options."));
    const previews: ((v: typeof values) => void)[] = [];
    for (const d of defs) {
      if ((d.tab ?? "Options") !== tab || (d.when && !d.when(values))) continue;
      if (d.type === "preview" && d.preview) {
        const p = previewCanvas(d.preview, d.label);
        previews.push(p.update);
        box.append(p.node);
        continue;
      }
      const set = (v: number | boolean | string) => {
        setToolOption(app, tool, d.key, v);
        values[d.key] = v;
        if (defs.some((x) => x.when)) { draw(); return; }
        for (const u of previews) u(values);
      };
      if (d.type === "select" && d.icons) { box.append(iconChoices(d.label, d.choices ?? [], d.icons, String(values[d.key]), set)); continue; }
      box.append(control(d, values[d.key], set, () => {
        if (d.command && d.command > 0) void registry.exec(d.command);
        else toolActions[tool]?.[d.key]?.();
      }));
    }
    panel.body.append(box);
    for (const u of previews) u(values);
  };
  app.on("tool", draw);
  draw();
  return { refresh: draw };
}

function control(d: OptionDef, value: unknown, set: (v: number | boolean | string) => void, press: () => void): HTMLElement {
  if (d.type === "button") return el("button", { type: "button", class: "mini tool-button-wide", onclick: press }, d.label);
  if (d.type === "check") {
    const input = el("input", { type: "checkbox", checked: Boolean(value) });
    input.addEventListener("change", () => set(input.checked));
    return el("label", { class: "opt-check" }, input, d.label);
  }
  if (d.type === "select") {
    const choices = [...(d.choices ?? []), ...(dynamicChoices[d.key]?.() ?? [])].filter((c, i, a) => a.indexOf(c) === i);
    const select = el("select", {}, ...choices.map((c) => el("option", { value: c, selected: c === value }, c)));
    select.addEventListener("change", () => set(select.value));
    return el("label", { class: "tool-row" }, el("span", {}, d.label), select);
  }
  const range = el("input", { type: "range", min: d.min ?? 0, max: d.max ?? 100, value: Number(value) });
  const num = el("input", { type: "number", class: "spin", min: d.min ?? 0, max: d.max ?? 100, value: Number(value) });
  range.addEventListener("input", () => { num.value = range.value; set(Number(range.value)); });
  num.addEventListener("change", () => {
    const v = Math.max(d.min ?? 0, Math.min(d.max ?? 100, Math.round(Number(num.value) || 0)));
    num.value = range.value = String(v);
    set(v);
  });
  return el("label", { class: "tool-row" }, el("span", {}, d.label), range, num);
}
