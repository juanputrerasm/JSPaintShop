/*
  View > Toolbars (33604), PSP 6's "Toolbars" dialog (DIALOG 302): a checklist of the bars and
  palettes, applied as they are ticked, and the display options under it.

  "Display flat style toolbars" is listed greyed: the bars are always flat here. "Enable
  Automatic Roll-Ups" lets floating palettes roll up (ui/shell/panel.ts). Customize opens
  Customize Toolbar.
*/
import { el } from "../../shared/dom.ts";
import { openDialog } from "../shell/dialog.ts";
import { plainLabel, type CommandRegistry } from "../shell/commands.ts";
import type { AppState } from "../../app/state.ts";

/* The list, in the order of PSP's toolbar menu (MENU 436). */
const ITEMS = [33131, 32842, 33614, 59393, 59392, 33130, 33129];

export async function showToolbars(app: AppState, registry: CommandRegistry): Promise<void> {
  const boxes = ITEMS.map((id) => {
    const input = el("input", { type: "checkbox", checked: registry.isChecked(id) });
    input.addEventListener("change", () => { void registry.exec(id); });
    return { id, input };
  });
  const sync = () => { for (const b of boxes) b.input.checked = registry.isChecked(b.id); };
  const off = app.on("commands", sync);
  const large = el("input", { type: "checkbox", checked: app.settings.largeIcons });
  large.addEventListener("change", () => app.updateSettings((s) => { s.largeIcons = large.checked; }));
  const rollUps = el("input", { type: "checkbox", checked: app.settings.autoRollUps });
  rollUps.addEventListener("change", () => app.updateSettings((s) => { s.autoRollUps = rollUps.checked; }));
  const customize = el("button", { type: "button", disabled: !registry.isEnabled(33250), onclick: () => registry.exec(33250) }, "Customize...");
  const body = el("div", { class: "toolbars-dialog" },
    el("div", { class: "toolbars-top" },
      el("div", { class: "check-list", role: "group", "aria-label": "Toolbars" },
        ...boxes.map(({ id, input }) => el("label", { class: "opt-check" }, input, plainLabel(registry.get(id)?.label ?? String(id))))),
      el("div", { class: "toolbars-side" }, customize)),
    el("label", { class: "opt-check" }, large, "Display large text and icons on palettes"),
    el("label", { class: "opt-check disabled" }, el("input", { type: "checkbox", checked: true, disabled: true }), "Display flat style toolbars"),
    el("label", { class: "opt-check" }, rollUps, "Enable Automatic Roll-Ups"));
  await openDialog({ title: "Toolbars", body, buttons: [{ label: "Close", value: "ok", primary: true }] });
  off();
}
