/*
  Layer dialogs:
    Layer Properties  (Layers > Properties, New Raster Layer): the General page with name,
                      blend mode, opacity, group, visibility, lock transparency and the mask's
                      enable. The Blend Ranges page (DIALOG 27057) is not ported yet.
    Command History   (DIALOG 273): the steps with their number, time since and name; picking
                      one undoes it and every later one, picking undone ones redoes them.
    Defringe          (DIALOG 343): the width, 1 to 10.
*/
import { el } from "../../shared/dom.ts";
import { openDialog } from "../shell/dialog.ts";
import { BLEND_MODES, type Layer } from "../../core/doc/image-doc.ts";
import type { Change } from "../../core/edit/history.ts";

export type LayerProps = Pick<Layer, "name" | "blend" | "opacity" | "group" | "visible" | "lockTransparency" | "maskEnabled">;

export async function showLayerProperties(title: string, props: LayerProps, hasMask: boolean): Promise<LayerProps | null> {
  const p = { ...props };
  const name = el("input", { class: "text-field", value: p.name, maxlength: 255 });
  const blend = el("select", {}, ...BLEND_MODES.map((m, i) => el("option", { value: i, selected: i === p.blend }, m)));
  const opacity = el("input", { type: "range", min: 0, max: 100, value: Math.round((p.opacity * 100) / 255) });
  const opacityText = el("output", {}, `${opacity.value}%`);
  opacity.addEventListener("input", () => { opacityText.textContent = `${opacity.value}%`; });
  const group = el("select", {}, el("option", { value: 0, selected: p.group === 0 }, "None"), ...Array.from({ length: 9 }, (_, i) => el("option", { value: i + 1, selected: p.group === i + 1 }, String(i + 1))));
  const check = (label: string, on: boolean, disabled = false) => {
    const input = el("input", { type: "checkbox", checked: on, disabled });
    return { input, row: el("label", { class: `opt-check${disabled ? " disabled" : ""}` }, input, label) };
  };
  const visible = check("Layer is visible", p.visible), lock = check("Lock transparency", p.lockTransparency), mask = check("Mask enabled", p.maskEnabled, !hasMask);
  const row = (label: string, ...c: Node[]) => el("label", { class: "form-row" }, el("span", {}, label), ...c);
  const body = el("div", { class: "layer-props" },
    row("Name:", name), row("Blend mode:", blend), row("Opacity:", opacity, opacityText), row("Group:", group),
    visible.row, lock.row, mask.row);
  const v = await openDialog({ title, body, buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }] });
  if (v !== "ok") return null;
  return {
    name: name.value.trim() || p.name, blend: Number(blend.value), opacity: Math.round((Number(opacity.value) * 255) / 100),
    group: Number(group.value), visible: visible.input.checked, lockTransparency: lock.input.checked, maskEnabled: mask.input.checked,
  };
}

function since(t: number | undefined): string {
  if (!t) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s} sec` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} hr`;
}

export type HistoryChoice = { undoTo: number } | { redo: number } | null;

export async function showCommandHistory(done: readonly Change[], undone: readonly Change[]): Promise<HistoryChoice> {
  // The pick runs from a step to the end of the done list (undo) or from the first undone step to it (redo).
  let pick: { kind: "undo" | "redo"; index: number } | null = done.length ? { kind: "undo", index: done.length - 1 } : undone.length ? { kind: "redo", index: 0 } : null;
  const list = el("div", { class: "history-list", role: "listbox" });
  const rows = [
    ...done.map((c, i) => ({ kind: "undo" as const, index: i, c, n: i + 1 })),
    ...undone.map((c, i) => ({ kind: "redo" as const, index: i, c, n: done.length + i + 1 })),
  ];
  let ok: HTMLButtonElement | null = null;
  const draw = () => {
    list.replaceChildren(...rows.map((r) => {
      const on = Boolean(pick && pick.kind === r.kind && (r.kind === "undo" ? r.index >= pick.index : r.index <= pick.index));
      return el("div", {
        class: `history-row${r.kind === "redo" ? " undone" : ""}${on ? " selected" : ""}`, role: "option", "aria-selected": String(on),
        onclick: () => { pick = { kind: r.kind, index: r.index }; draw(); },
      }, el("span", {}, String(r.n)), el("span", {}, since(r.c.time)), el("span", {}, r.c.label));
    }));
    if (ok) { ok.textContent = pick?.kind === "redo" ? "Redo" : "Undo"; ok.disabled = !pick; }
  };
  const body = el("div", { class: "history" },
    el("p", { class: "opt-hint" }, "Select command(s) to undo or redo:"),
    el("div", { class: "history-row history-head" }, el("span", {}, "Number"), el("span", {}, "Time Since"), el("span", {}, "Command")),
    list);
  const result = openDialog({ title: "Command History", body, className: "history-dialog", buttons: [{ label: "Undo", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }] });
  ok = body.closest("form")?.querySelector<HTMLButtonElement>('button[value="ok"]') ?? null;
  draw();
  if ((await result) !== "ok" || !pick) return null;
  return pick.kind === "undo" ? { undoTo: pick.index } : { redo: pick.index + 1 };
}

export async function showDefringe(): Promise<number | null> {
  const width = el("input", { type: "number", class: "spin", min: 1, max: 10, value: 1 });
  const v = await openDialog({ title: "Defringe", body: el("label", { class: "form-row" }, el("span", {}, "Width:"), width), buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }] });
  return v === "ok" ? Math.max(1, Math.min(10, Math.round(Number(width.value) || 1))) : null;
}
