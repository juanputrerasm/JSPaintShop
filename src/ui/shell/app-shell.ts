/*
  The main window, laid out as PSP 6's frame:

    menu bar          menu 128 with no image open, 129 once one is
    toolbar           the main toolbar (File > Preferences > Customize Toolbar picks its buttons)
    work row          tool palette docked left | MDI image windows | color palette docked right
    status bar        help line | cursor position | color | image size and depth

  Tool Options, the Layer palette and the Histogram float over the work area. Right-clicking
  a toolbar or palette shows PSP's toolbar menu (MENU 436).
*/
import { el } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";
import { FLOATING_DEFAULTS } from "../../core/settings.ts";
import { MENUS, TOOLBARS, type CommandRegistry, type MenuNode } from "./commands.ts";
import { MenuBar, type SlotItem } from "./menu.ts";
import { Toolbar, mainButtonArt, toolButtonArt } from "./toolbar.ts";
import { StatusBar } from "./statusbar.ts";
import { FloatingPanel } from "./panel.ts";
import { Mdi } from "./mdi.ts";
import { showContextMenu } from "./context-menu.ts";

export type PaletteId = "toolOptions" | "layers" | "histogram";

/* MFC appends the open windows to the Window menu: the "@windows" slot. */
/* File > Import (JSPaintShop's own, in place of PSP's TWAIN and camera menu) goes before Export: the "@import" slot. */
const withHelp = (menu: MenuNode[]): MenuNode[] => menu.map((m) => {
  if (typeof m !== "object" || !("items" in m) || m.label !== "&File") return m;
  const at = m.items.findIndex((i) => typeof i === "object" && "items" in i && i.label === "Expor&t");
  const items = [...m.items];
  items.splice(at < 0 ? items.length : at, 0, { label: "&Import", items: ["@import"] });
  return { label: m.label, items };
});
const IMAGE_MENU: MenuNode[] = withHelp(MENUS[129]).map((m) =>
  typeof m === "object" && "items" in m && m.label === "&Window" ? { label: m.label, items: [...m.items, "-", "@windows"] } : m);
const NO_IMAGE_MENU = withHelp(MENUS[128]);
const BROWSER_MENU = withHelp(MENUS[130]);

export class AppShell {
  readonly element: HTMLElement;
  readonly workArea: HTMLElement;
  readonly mdi: Mdi;
  readonly menu: MenuBar;
  readonly mainToolbar: Toolbar;
  readonly toolPalette: Toolbar;
  readonly colorDock: HTMLElement;
  readonly statusBar: StatusBar;
  readonly panels: Record<PaletteId, FloatingPanel>;
  private app: AppState;
  private registry: CommandRegistry;

  constructor(app: AppState, registry: CommandRegistry, slot: (name: string) => SlotItem[]) {
    this.app = app;
    this.registry = registry;
    this.menu = new MenuBar(registry, app, { slot: (name) => (name === "windows" ? this.windowList() : slot(name)) });
    this.mainToolbar = new Toolbar(registry, app, "Toolbar");
    this.toolPalette = new Toolbar(registry, app, "Tool Palette", true);
    this.colorDock = el("aside", { class: "color-dock", "aria-label": "Color" },
      el("header", { class: "bar-title" }, "Color"),
      el("p", { class: "panel-empty" }, "The color palette comes with the painting tools."));

    const mdiArea = el("div", { class: "mdi-area" });
    this.mdi = new Mdi(mdiArea);
    this.workArea = el("main", { class: "work-area" }, mdiArea);
    this.statusBar = new StatusBar(app);
    const toolbarRow = el("div", { class: "toolbar-row" }, this.mainToolbar.element);
    this.element = el("div", { class: "app" },
      this.menu.element,
      toolbarRow,
      el("div", { class: "work-row" }, el("div", { class: "tool-dock" }, this.toolPalette.element), this.workArea, this.colorDock),
      this.statusBar.element);

    const panel = (id: PaletteId, title: string, width: number, height: number, empty: string) => {
      const p = new FloatingPanel(app, this.workArea, { id, title, width, height, minWidth: 140, minHeight: 80 });
      p.body.append(el("p", { class: "panel-empty" }, empty));
      if (!app.settings.panels[id] && FLOATING_DEFAULTS[id]) queueMicrotask(() => p.show());
      return p;
    };
    this.panels = {
      toolOptions: panel("toolOptions", "Tool Options", 230, 170, "Each tool's options appear here as the tools are ported."),
      layers: panel("layers", "Layer Palette", 440, 200, "Open an image to see its layers."),
      histogram: panel("histogram", "Histogram", 260, 200, "Open an image to see its histogram."),
    };

    // PSP's toolbar menu (MENU 436), on the bars and palettes.
    for (const target of [toolbarRow, this.toolPalette.element, this.colorDock]) {
      target.addEventListener("contextmenu", (e) => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, MENUS[436], registry, app); });
    }

    app.on("commands", () => this.refresh());
    app.on("settings", () => this.applyBars());
    this.mdi.on("changed", () => {
      const browser = this.mdi.active?.options.kind === "browser";
      this.menu.setMenu(browser ? BROWSER_MENU : this.mdi.windows.some((w) => (w.options.kind ?? "image") === "image") ? IMAGE_MENU : NO_IMAGE_MENU);
      app.emit("commands", undefined);
    });
    this.menu.setMenu(NO_IMAGE_MENU);
    this.applyBars();
  }

  private windowList(): SlotItem[] {
    return this.mdi.windows.map((w, i) => ({ label: `${i < 9 ? `&${i + 1} ` : ""}${w.title}`, checked: w === this.mdi.active, run: () => this.mdi.activate(w) }));
  }

  refresh(): void {
    this.mainToolbar.refresh();
    this.toolPalette.refresh();
    this.menu.refresh();
  }

  private applyBars(): void {
    const s = this.app.settings;
    const layoutKey = `${s.largeIcons}|${s.toolbarButtons.join(",")}`;
    if (layoutKey !== this.layoutKey) {
      this.layoutKey = layoutKey;
      this.mainToolbar.setButtons(s.toolbarButtons, (id) => mainButtonArt(id, s.largeIcons));
      this.toolPalette.setButtons(TOOLBARS[161].ids, (id) => toolButtonArt(id, s.largeIcons));
    }
    this.mainToolbar.element.parentElement!.hidden = !s.bars.toolbar;
    this.statusBar.element.hidden = !s.bars.statusbar;
    this.toolPalette.element.parentElement!.hidden = !s.bars.tools;
    this.colorDock.hidden = !s.bars.colors;
  }

  private layoutKey = "";

  /*
    Tab hides every palette and toolbar, and shows the same ones again (Tips.txt: "Press the
    TAB key to hide or display all palettes").
  */
  private hiddenByTab: { bars: (keyof AppState["settings"]["bars"])[]; panels: PaletteId[] } | null = null;

  toggleAllPalettes(): void {
    if (this.hiddenByTab) {
      const { bars, panels } = this.hiddenByTab;
      this.hiddenByTab = null;
      this.app.updateSettings((s) => { for (const b of bars) s.bars[b] = true; });
      for (const p of panels) this.panels[p].show();
      return;
    }
    const bars = (["toolbar", "tools", "colors"] as const).filter((b) => this.app.settings.bars[b]);
    const panels = (Object.keys(this.panels) as PaletteId[]).filter((p) => this.panels[p].visible);
    if (!bars.length && !panels.length) return;
    this.hiddenByTab = { bars: [...bars], panels };
    this.app.updateSettings((s) => { for (const b of bars) s.bars[b] = false; });
    for (const p of panels) this.panels[p].hide();
  }
}
