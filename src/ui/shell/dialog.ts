/*
  Modal dialogs, on the native <dialog> element: Escape cancels, focus stays inside, and the
  page behind is inert. `openDialog` resolves with the button value that closed it, or null.
*/
import { el } from "../../shared/dom.ts";

export interface DialogButton { label: string; value: string; primary?: boolean }

export interface DialogOptions {
  title: string;
  body: Node | Node[];
  buttons?: DialogButton[];
  /** Called before closing with a value; return false to keep the dialog open. */
  beforeClose?: (value: string) => boolean | Promise<boolean>;
  className?: string;
}

export function openDialog(options: DialogOptions): Promise<string | null> {
  const buttons = options.buttons ?? [{ label: "OK", value: "ok", primary: true }];
  const dialog = el("dialog", { class: `modal ${options.className ?? ""}`, "aria-label": options.title }) as HTMLDialogElement;
  const form = el("form", { method: "dialog" },
    el("header", { class: "modal-title" }, options.title),
    el("div", { class: "modal-body" }, ...(Array.isArray(options.body) ? options.body : [options.body])),
    el("footer", { class: "modal-buttons" }, ...buttons.map((b) =>
      el("button", { value: b.value, class: b.primary ? "primary" : null, autofocus: b.primary ? true : null }, b.label))));
  dialog.append(form);
  document.body.append(dialog);
  return new Promise((resolve) => {
    form.addEventListener("submit", async (e) => {
      const value = ((e as SubmitEvent).submitter as HTMLButtonElement | null)?.value ?? "ok";
      e.preventDefault();
      if (options.beforeClose && !(await options.beforeClose(value))) return;
      dialog.close(value);
    });
    dialog.addEventListener("close", () => {
      const value = dialog.returnValue || null;
      dialog.remove();
      resolve(value === "" ? null : value);
    });
    dialog.addEventListener("cancel", () => { dialog.returnValue = ""; });
    dialog.showModal();
  });
}

export function alertDialog(title: string, message: string): Promise<string | null> {
  return openDialog({ title, body: el("p", { class: "modal-text" }, message) });
}

export async function confirmDialog(title: string, message: string, ok = "OK"): Promise<boolean> {
  const v = await openDialog({ title, body: el("p", { class: "modal-text" }, message), buttons: [{ label: ok, value: "ok", primary: true }, { label: "Cancel", value: "cancel" }] });
  return v === "ok";
}

/** MFC's "Save changes to %1?" with Yes, No and Cancel: "yes", "no", or null for Cancel. */
export async function askSaveChanges(name: string): Promise<"yes" | "no" | null> {
  const v = await openDialog({
    title: "JSPaintShop", body: el("p", { class: "modal-text" }, `Save changes to ${name}?`),
    buttons: [{ label: "Yes", value: "yes", primary: true }, { label: "No", value: "no" }, { label: "Cancel", value: "cancel" }],
  });
  return v === "yes" || v === "no" ? v : null;
}

/** A question with Yes, No and Cancel: "yes", "no", or null for Cancel. */
export async function askYesNoCancel(title: string, message: string): Promise<"yes" | "no" | null> {
  const v = await openDialog({
    title, body: el("p", { class: "modal-text" }, message),
    buttons: [{ label: "Yes", value: "yes", primary: true }, { label: "No", value: "no" }, { label: "Cancel", value: "cancel" }],
  });
  return v === "yes" || v === "no" ? v : null;
}
