/*
  Small dialogs many commands share: one number (Contract, Expand, Feather...), a choice from
  a list (Load From Alpha Channel), a name.
*/
import { el } from "../../shared/dom.ts";
import { openDialog } from "../shell/dialog.ts";

const OK_CANCEL = [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }];

export async function numberDialog(title: string, label: string, min: number, max: number, value: number): Promise<number | null> {
  const input = el("input", { type: "number", class: "spin", min, max, value });
  const v = await openDialog({ title, body: el("label", { class: "form-row" }, el("span", {}, label), input), buttons: OK_CANCEL });
  if (v !== "ok") return null;
  const n = Math.round(Number(input.value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null;
}

export async function listDialog(title: string, label: string, items: string[], extra?: string): Promise<number | null> {
  const select = el("select", { size: Math.min(8, Math.max(3, items.length + (extra ? 1 : 0))), class: "list-select" },
    ...items.map((t, i) => el("option", { value: i, selected: i === 0 }, t)),
    extra ? el("option", { value: items.length, selected: items.length === 0 }, extra) : null);
  const v = await openDialog({ title, body: el("div", { class: "list-dialog" }, el("p", { class: "opt-hint" }, label), select), buttons: OK_CANCEL });
  return v === "ok" && select.value !== "" ? Number(select.value) : null;
}

export async function textDialog(title: string, label: string, value: string): Promise<string | null> {
  const input = el("input", { class: "text-field", value });
  const v = await openDialog({ title, body: el("label", { class: "form-row" }, el("span", {}, label), input), buttons: OK_CANCEL });
  return v === "ok" ? input.value : null;
}

/** Selections > Modify > Transparent Color: a color and a tolerance. */
export async function colorToleranceDialog(title: string, color: [number, number, number]): Promise<{ color: [number, number, number]; tolerance: number } | null> {
  const hex = el("input", { type: "color", value: `#${color.map((c) => c.toString(16).padStart(2, "0")).join("")}` });
  const tol = el("input", { type: "number", class: "spin", min: 0, max: 200, value: 0 });
  const v = await openDialog({ title, body: el("div", { class: "layer-props" }, el("label", { class: "form-row" }, el("span", {}, "Color:"), hex), el("label", { class: "form-row" }, el("span", {}, "Tolerance:"), tol)), buttons: OK_CANCEL });
  if (v !== "ok") return null;
  const h = hex.value.slice(1);
  return { color: [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)], tolerance: Math.max(0, Math.min(200, Number(tol.value) || 0)) };
}
