/*
  The small controls the palettes and dialogs are made of: a spin box (edit + up-down), a slider
  with a caption, a checkbox, and the 3-state checkbox.
*/
import { el } from "../../shared/dom.ts";

export interface Control<T> { element: HTMLElement; set(value: T): void; enable(on: boolean): void }

export function spin(label: string, value: number, min: number, max: number, onChange: (v: number) => void, title?: string): Control<number> {
  const input = el("input", { type: "number", min, max, step: 1, value, class: "spin", "aria-label": label, title });
  const commit = () => {
    let v = Math.round(Number(input.value));
    if (!Number.isFinite(v)) v = min;
    v = Math.min(max, Math.max(min, v));
    input.value = String(v);
    onChange(v);
  };
  input.addEventListener("change", commit);
  // Keys typed in a spin box belong to it, not to the 3D view.
  input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { commit(); input.blur(); } if (e.key === "Escape") input.blur(); });
  const element = el("label", { class: "bar-row" }, el("span", { class: "bar-label" }, label), input);
  return {
    element,
    set: (v) => { input.value = String(v); },
    enable: (on) => { input.disabled = !on; element.classList.toggle("disabled", !on); },
  };
}

export function slider(caption: (v: number) => string, value: number, min: number, max: number, onChange: (v: number) => void): Control<number> {
  const text = el("span", { class: "bar-label" }, caption(value));
  const input = el("input", { type: "range", min, max, step: 1, value, "aria-label": caption(value) });
  input.addEventListener("input", () => {
    const v = Number(input.value);
    text.textContent = caption(v);
    input.setAttribute("aria-label", caption(v));
    onChange(v);
  });
  input.addEventListener("keydown", (e) => e.stopPropagation());
  const element = el("label", { class: "bar-row" }, text, input);
  return {
    element,
    set: (v) => { input.value = String(v); text.textContent = caption(v); },
    enable: (on) => { input.disabled = !on; element.classList.toggle("disabled", !on); },
  };
}

export function check(label: string, value: boolean, onChange: (v: boolean) => void, title?: string): Control<boolean> {
  const input = el("input", { type: "checkbox", checked: value, title });
  input.addEventListener("change", () => onChange(input.checked));
  const element = el("label", { class: "bar-check", title }, input, label);
  return {
    element,
    set: (v) => { input.checked = v; },
    enable: (on) => { input.disabled = !on; element.classList.toggle("disabled", !on); },
  };
}

/*
  BS_AUTO3STATE: clicking cycles unchecked, checked, indeterminate. Values follow
  BM_GETCHECK: 0 unchecked, 1 checked, 2 indeterminate.
*/
export function triCheck(label: string, value: 0 | 1 | 2, onChange: (v: 0 | 1 | 2) => void): Control<0 | 1 | 2> {
  const input = el("input", { type: "checkbox" });
  let state = value;
  const show = () => { input.checked = state === 1; input.indeterminate = state === 2; };
  input.addEventListener("click", (e) => {
    e.preventDefault();
    state = ((state + 1) % 3) as 0 | 1 | 2;
    // preventDefault on click restores the old checked state after the handler, so redraw later.
    setTimeout(show);
    onChange(state);
  });
  show();
  return {
    element: el("label", { class: "bar-check" }, input, label),
    set: (v) => { state = v; show(); },
    enable: (on) => { input.disabled = !on; },
  };
}

export function radioGroup(name: string, labels: string[], value: number, onChange: (v: number) => void): Control<number> {
  const inputs = labels.map((_, i) => el("input", { type: "radio", name, value: i, checked: i === value }));
  inputs.forEach((input, i) => input.addEventListener("change", () => { if (input.checked) onChange(i); }));
  return {
    element: el("div", { class: "bar-radios", role: "radiogroup" }, ...labels.map((l, i) => el("label", { class: "bar-check" }, inputs[i], l))),
    set: (v) => inputs.forEach((input, i) => { input.checked = i === v; }),
    enable: (on) => inputs.forEach((input) => { input.disabled = !on; }),
  };
}

export function bar(title: string, ...children: (Node | null)[]): HTMLElement {
  return el("section", { class: "control-bar", "aria-label": title }, el("header", { class: "bar-title" }, title), el("div", { class: "bar-body" }, ...children));
}
