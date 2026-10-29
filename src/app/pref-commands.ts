/*
  File > Preferences > General Program Preferences and Customize Toolbar.

  Customize Toolbar is the Windows toolbar Customize dialog PSP 6 opens (CToolBarCtrl): the
  buttons not on the toolbar, the ones on it, Add, Remove, Move Up, Move Down and Reset. The
  buttons come from the main toolbar strip (128) and the extra strip (547).
*/
import type { AppState } from "./state.ts";
import type { Resources } from "./resources.ts";
import { CMD, TOOLBARS, plainLabel, type CommandRegistry } from "../ui/shell/commands.ts";
import { el } from "../shared/dom.ts";
import { openDialog } from "../ui/shell/dialog.ts";
import { showPreferences } from "../ui/dialogs/preferences.ts";
import { mainButtonArt } from "../ui/shell/toolbar.ts";
import { DEFAULT_TOOLBAR } from "../core/settings.ts";

async function customizeToolbar(app: AppState, registry: CommandRegistry): Promise<void> {
  let current = [...app.settings.toolbarButtons];
  const all = [...new Set([...TOOLBARS[128].ids, ...TOOLBARS[547].ids])].filter((id) => registry.get(id));
  const label = (id: number) => (id === 0 ? "Separator" : plainLabel(registry.get(id)?.tip || registry.get(id)?.label || String(id)));
  const icon = (id: number) => {
    const a = id ? mainButtonArt(id, false) : null;
    return el("span", { class: "tb-icon", style: a ? { width: `${a.width}px`, height: `${a.height}px`, backgroundImage: `url(${a.url})`, backgroundPosition: `${-a.index * a.width}px 0` } : { width: "16px", height: "15px" } });
  };
  const availList = el("select", { size: 14, class: "cust-list" }) as HTMLSelectElement;
  const currList = el("select", { size: 14, class: "cust-list" }) as HTMLSelectElement;
  const preview = el("div", { class: "cust-preview" });
  const fill = (keepAvail = availList.selectedIndex, keepCurr = currList.selectedIndex) => {
    const avail = [0, ...all.filter((id) => !current.includes(id))];
    availList.replaceChildren(...avail.map((id) => el("option", { value: String(id) }, label(id))));
    currList.replaceChildren(...current.map((id, i) => el("option", { value: String(i) }, label(id))));
    availList.selectedIndex = Math.min(keepAvail, avail.length - 1);
    currList.selectedIndex = Math.min(keepCurr, current.length - 1);
    preview.replaceChildren(...current.slice(0, 40).map(icon));
  };
  const add = () => {
    const id = Number(availList.value);
    if (Number.isNaN(id)) return;
    const at = currList.selectedIndex < 0 ? current.length : currList.selectedIndex + 1;
    current.splice(at, 0, id);
    fill(availList.selectedIndex, at);
  };
  const remove = () => { const i = currList.selectedIndex; if (i < 0) return; current.splice(i, 1); fill(availList.selectedIndex, i); };
  const move = (d: number) => {
    const i = currList.selectedIndex, j = i + d;
    if (i < 0 || j < 0 || j >= current.length) return;
    [current[i], current[j]] = [current[j], current[i]];
    fill(availList.selectedIndex, j);
  };
  availList.addEventListener("dblclick", add);
  currList.addEventListener("dblclick", remove);
  fill(0, 0);
  const v = await openDialog({
    title: "Customize Toolbar", className: "cust-dialog",
    body: el("div", {},
      el("div", { class: "cust-grid" },
        el("label", {}, "Available toolbar buttons:", availList),
        el("div", { class: "cust-mid" }, el("button", { type: "button", onclick: add }, "Add ->"), el("button", { type: "button", onclick: remove }, "<- Remove")),
        el("label", {}, "Toolbar buttons:", currList),
        el("div", { class: "cust-side" },
          el("button", { type: "button", onclick: () => { current = [...DEFAULT_TOOLBAR]; fill(0, 0); } }, "Reset"),
          el("button", { type: "button", onclick: () => move(-1) }, "Move Up"),
          el("button", { type: "button", onclick: () => move(1) }, "Move Down"))),
      preview),
    buttons: [{ label: "Close", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
  });
  if (v === "ok") app.updateSettings((s) => { s.toolbarButtons = current; });
}

export function bindPreferenceCommands(registry: CommandRegistry, app: AppState, res: Resources): void {
  registry.bind(CMD.FILE_PREFERENCES_GENERAL_PROGRAM_PREFERENCES, () => showPreferences(app));
  registry.bind(CMD.FILE_PREFERENCES_CUSTOMIZE_TOOLBAR, () => customizeToolbar(app, registry));
}
