/*
  A toolbar drawn from PSP 6's own button strips (public/ui/*.png, made by
  scripts/psp-resources.mjs): one image per button, side by side, in the order of the
  TOOLBAR resource. 0 in a button list is a separator.

  Strips: 128 main toolbar (16 x 15) and 264 its large version (23 x 22); 547 the extra
  buttons Customize Toolbar can add (small only); 161 the tool palette and 260 its large version.

  The bars have no button face of their own: the buttons sit on the frame. In the dark theme
  the art comes from the script's recolored copies (*-dark.png), and the bars redraw when the
  theme changes.
*/
import { el, clear } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";
import { TOOLBARS, type CommandRegistry } from "./commands.ts";
import { isDark, onThemeChange } from "../../shared/theme.ts";

export interface ButtonArt { url: string; index: number; width: number; height: number }

const base = import.meta.env.BASE_URL;

function artIn(toolbar: number, file: string, id: number): ButtonArt | null {
  const tb = TOOLBARS[toolbar];
  const index = tb.ids.indexOf(id);
  if (index < 0) return null;
  return { url: `${base}ui/${isDark() ? file.replace(".png", "-dark.png") : file}`, index, width: tb.width, height: tb.height };
}

/** The art for a main toolbar button, large where PSP has a large version. */
export function mainButtonArt(id: number, large: boolean): ButtonArt | null {
  return (large ? artIn(264, "toolbar-main-large.png", id) : null) ?? artIn(128, "toolbar-main.png", id) ?? artIn(547, "toolbar-extra.png", id);
}

export function toolButtonArt(id: number, large: boolean): ButtonArt | null {
  return large ? artIn(260, "tools-large.png", id) : artIn(161, "tools.png", id);
}

export class Toolbar {
  readonly element: HTMLElement;
  private buttons: { id: number; node: HTMLButtonElement }[] = [];
  private layout: { ids: number[]; art: (id: number) => ButtonArt | null } | null = null;
  private registry: CommandRegistry;
  private app: AppState;

  constructor(registry: CommandRegistry, app: AppState, label: string, vertical = false) {
    this.registry = registry;
    this.app = app;
    this.element = el("div", { class: `toolbar${vertical ? " vertical" : ""}`, role: "toolbar", "aria-label": label, "aria-orientation": vertical ? "vertical" : null });
    onThemeChange(() => { if (this.layout) this.setButtons(this.layout.ids, this.layout.art); });
  }

  /** Lay out these buttons (0 = separator), with the art `art` gives each. */
  setButtons(ids: number[], art: (id: number) => ButtonArt | null): void {
    this.layout = { ids, art };
    clear(this.element);
    this.buttons = [];
    for (const id of ids) {
      if (id === 0) { this.element.append(el("span", { class: "tb-sep" })); continue; }
      const c = this.registry.get(id);
      const a = art(id);
      if (!c || !a) continue;
      const node = el("button", {
        class: "tb-button", title: c.tip || c.label, "aria-label": c.tip || c.label,
        style: { width: `${a.width + 10}px`, height: `${a.height + 10}px` },
        onclick: () => this.registry.exec(id),
        onmouseenter: () => this.app.status(c.prompt ?? ""),
        onmouseleave: () => this.app.status(""),
      }, el("span", {
        class: "tb-icon",
        style: { width: `${a.width}px`, height: `${a.height}px`, backgroundImage: `url(${a.url})`, backgroundPosition: `${-a.index * a.width}px 0` },
      }));
      this.buttons.push({ id, node });
      this.element.append(node);
    }
    this.refresh();
  }

  refresh(): void {
    for (const { id, node } of this.buttons) {
      node.disabled = !this.registry.isEnabled(id);
      const on = this.registry.isChecked(id);
      node.classList.toggle("checked", on);
      node.setAttribute("aria-pressed", String(on));
    }
  }
}
