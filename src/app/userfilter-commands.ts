/*
  Image > User Defined Filters: the filters kept in pspud.flt (core/formats/flt.ts), listed
  with New, Edit, Delete and Apply; the editor takes a name, the 7 x 7 matrix, the division
  factor and the bias. The file lives in the imported resources' filters folder, in PSP 6's
  own format. Applying runs the kernel as PSP's convolution does (core/filters/convolve.ts).
*/
import type { Editor } from "./editor.ts";
import type { Resources } from "./resources.ts";
import { CMD, type CommandRegistry } from "../ui/shell/commands.ts";
import { el } from "../shared/dom.ts";
import { alertDialog, openDialog } from "../ui/shell/dialog.ts";
import { filterLayer } from "../core/edit/apply-filter.ts";
import { userFilter } from "../core/filters/convolve.ts";
import { readFlt, writeFlt, type UserFilter } from "../core/formats/flt.ts";

const FILE = "pspud.flt";

async function load(res: Resources): Promise<UserFilter[]> {
  try { return readFlt(await res.read("filters", FILE)); } catch { return []; }
}

async function editFilter(f: UserFilter): Promise<UserFilter | null> {
  const name = el("input", { type: "text", value: f.name, maxlength: 27 });
  const cells = f.matrix.map((x) => el("input", { type: "number", class: "spin flt-cell", value: x, min: -999, max: 999 }));
  const grid = el("div", { class: "flt-grid" }, ...cells);
  const div = el("input", { type: "number", class: "spin", value: f.div, min: -999, max: 999 });
  const bias = el("input", { type: "number", class: "spin", value: f.bias, min: -255, max: 255 });
  const v = await openDialog({
    title: "Filter Editor",
    body: el("div", { class: "layer-props" }, el("label", { class: "form-row" }, el("span", {}, "Filter name:"), name), el("fieldset", { class: "opt-group" }, el("legend", {}, "Filter matrix"), grid),
      el("label", { class: "form-row" }, el("span", {}, "Division factor:"), div), el("label", { class: "form-row" }, el("span", {}, "Bias:"), bias)),
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
  });
  if (v !== "ok") return null;
  return { name: name.value.trim() || "Untitled", div: Number(div.value) || 1, bias: Number(bias.value) || 0, matrix: cells.map((c) => Math.trunc(Number(c.value) || 0)) };
}

export function bindUserFilterCommands(registry: CommandRegistry, ed: Editor, res: Resources): void {
  registry.bind(CMD.IMAGE_USER_DEFINED_FILTERS, async () => {
    let filters = await load(res);
    const list = el("select", { size: 10, class: "browser-list" });
    const refill = () => { list.replaceChildren(...filters.map((f, i) => el("option", { value: String(i) }, f.name))); if (filters.length) list.value = list.value || "0"; };
    refill();
    const save = async () => { await res.write("filters", FILE, writeFlt(filters)); };
    const current = () => filters[Number(list.value)];
    const button = (label: string, run: () => unknown) => el("button", { type: "button", class: "mini", onclick: run }, label);
    const body = el("div", { class: "browser-body" }, list, el("div", { class: "opt-col" },
      button("New...", async () => { const f = await editFilter({ name: "Untitled", div: 1, bias: 0, matrix: Array.from({ length: 49 }, (_, i) => (i === 24 ? 1 : 0)) }); if (f) { filters.push(f); await save(); refill(); list.value = String(filters.length - 1); } }),
      button("Edit...", async () => { const c = current(); if (!c) return; const f = await editFilter(c); if (f) { filters[Number(list.value)] = f; await save(); refill(); } }),
      button("Delete", async () => { if (!current()) return; filters = filters.filter((_, i) => i !== Number(list.value)); await save(); refill(); })));
    const v = await openDialog({ title: "User Defined Filter", body, buttons: [{ label: "Apply", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }] });
    if (v !== "ok") return;
    const f = current();
    if (!f) { await alertDialog("User Defined Filter", "There are no user defined filters yet: use New to make one."); return; }
    ed.run(f.name, (d) => filterLayer(d, (r) => userFilter(r, f.matrix, f.div, f.bias)));
  }, { enabled: () => { const d = ed.image?.doc; return Boolean(d && (d.depth === 24 || d.greyscale)); } });
}
