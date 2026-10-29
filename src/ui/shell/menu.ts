/*
  The menu bar, from JSTraxx's. Behaves like a Windows menu: click a title to open it, move
  across titles to switch while one is open, submenus open on hover or the right arrow,
  Escape or a click elsewhere closes it, Alt+letter opens the menu with that mnemonic, and
  the arrow keys walk the items.

  PSP 6 has two menu bars: menu 128 while no image is open, 129 once one is. `setMenu`
  switches between them. Slots ("@recent", "@layers", "@import") are filled by the caller.
*/
import { el, clear } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";
import type { CommandRegistry, MenuNode } from "./commands.ts";

/** "&File" -> label nodes with the mnemonic underlined, and the mnemonic letter. */
export function mnemonic(label: string): { nodes: (string | HTMLElement)[]; key: string | null } {
  const i = label.indexOf("&");
  if (i < 0 || i === label.length - 1) return { nodes: [label], key: null };
  return {
    nodes: [label.slice(0, i), el("u", {}, label[i + 1]), label.slice(i + 2)],
    key: label[i + 1].toUpperCase(),
  };
}

export interface SlotItem { label: string; enabled?: boolean; checked?: boolean; run: () => void }

export interface MenuBarOptions {
  /** Items for a "@name" slot; an empty list shows the slot's placeholder, greyed. */
  slot(name: string): SlotItem[];
}

const SLOT_PLACEHOLDER: Record<string, string> = { recent: "Recent File", layers: "Layer1" };

type TopMenu = { label: string; items: MenuNode[] };

export class MenuBar {
  readonly element: HTMLElement;
  private menus: TopMenu[] = [];
  private source: MenuNode[] | null = null;
  private open: number | null = null;
  /** The open dropdown, then any open submenus. */
  private levels: HTMLElement[] = [];
  private titles: HTMLElement[] = [];
  private registry: CommandRegistry;
  private app: AppState;
  private options: MenuBarOptions;

  constructor(registry: CommandRegistry, app: AppState, options: MenuBarOptions) {
    this.registry = registry;
    this.app = app;
    this.options = options;
    this.element = el("nav", { class: "menubar", role: "menubar" });
    document.addEventListener("mousedown", (e) => {
      if (this.open !== null && !this.element.contains(e.target as Node) && !this.levels.some((l) => l.contains(e.target as Node))) this.close();
    });
    window.addEventListener("blur", () => this.close());
    document.addEventListener("keydown", (e) => this.onKey(e), true);
  }

  get isOpen(): boolean {
    return this.open !== null;
  }

  /** Show this menu bar (the top-level popups of a MENU resource). */
  setMenu(nodes: MenuNode[]): void {
    if (nodes === this.source) return;
    this.source = nodes;
    const menus = nodes.filter((n): n is TopMenu => typeof n === "object" && "items" in n);
    this.close();
    this.menus = menus;
    clear(this.element);
    this.titles = menus.map((menu, i) => el("button", {
      class: "menu-title", role: "menuitem", "aria-haspopup": "true",
      onmousedown: (e: MouseEvent) => { e.preventDefault(); this.open === i ? this.close() : this.show(i); },
      onmouseenter: () => { if (this.open !== null && this.open !== i) this.show(i); },
    }, ...mnemonic(menu.label).nodes));
    this.element.append(...this.titles);
  }

  close(): void {
    for (const l of this.levels) l.remove();
    this.levels = [];
    if (this.open !== null) this.titles[this.open]?.classList.remove("open");
    this.open = null;
    this.app.status("");
  }

  private show(index: number): void {
    this.close();
    this.open = index;
    const title = this.titles[index];
    title.classList.add("open");
    const dropdown = this.build(this.menus[index].items, 0);
    this.levels = [dropdown];
    document.body.append(dropdown);
    const r = title.getBoundingClientRect();
    place(dropdown, r.left, r.bottom);
  }

  private build(items: MenuNode[], depth: number): HTMLElement {
    const list = el("div", { class: "menu-dropdown", role: "menu" });
    for (const item of items) {
      if (item === "-") { list.append(el("div", { class: "menu-sep", role: "separator" })); continue; }
      if (typeof item === "string") {
        const name = item.slice(1);
        const slot = this.options.slot(name);
        if (slot.length === 0) list.append(this.row(SLOT_PLACEHOLDER[name] ?? name, "", false, false, () => {}));
        slot.forEach((s) => list.append(this.row(s.label, "", s.enabled ?? true, s.checked ?? false, s.run)));
        continue;
      }
      if (typeof item === "object" && "items" in item) {
        const row = this.row(item.label, "", true, false, () => {}, true);
        const open = () => this.openSub(row, item.items, depth + 1);
        row.addEventListener("mouseenter", open);
        row.addEventListener("keydown", (e) => { if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); open(); this.focusItem(depth + 1, 0); } });
        list.append(row);
        continue;
      }
      const id = typeof item === "number" ? item : item.id;
      const c = this.registry.get(id);
      if (!c) continue;
      const label = typeof item === "number" ? c.label : item.label;
      const row = this.row(label, c.shortcut ?? "", this.registry.isEnabled(id), this.registry.isChecked(id), () => this.registry.exec(id));
      row.addEventListener("mouseenter", () => { this.app.status(c.prompt ?? ""); this.closeFrom(depth + 1); });
      list.append(row);
    }
    return list;
  }

  private openSub(row: HTMLElement, items: MenuNode[], depth: number): void {
    if (this.levels[depth]?.dataset.parent === row.dataset.key) return;
    this.closeFrom(depth);
    const sub = this.build(items, depth);
    sub.dataset.parent = row.dataset.key;
    this.levels[depth] = sub;
    document.body.append(sub);
    const r = row.getBoundingClientRect();
    place(sub, r.right - 2, r.top - 4, r.left);
  }

  private closeFrom(depth: number): void {
    for (const l of this.levels.splice(depth)) l.remove();
  }

  private keyCounter = 0;

  private row(label: string, key: string, enabled: boolean, checked: boolean, run: () => void, submenu = false): HTMLElement {
    return el("div", {
      class: `menu-item${enabled ? "" : " disabled"}${submenu ? " submenu" : ""}`, role: "menuitem", tabindex: "-1",
      "aria-disabled": enabled ? null : "true", "aria-haspopup": submenu ? "true" : null, "data-key": String(++this.keyCounter),
      onmouseup: () => { if (!enabled || submenu) return; this.close(); run(); },
      onmouseenter: (e: MouseEvent) => (e.currentTarget as HTMLElement).focus(),
    },
    el("span", { class: "check" }, checked ? "✓" : ""),
    el("span", { class: "label" }, ...mnemonic(label).nodes),
    el("span", { class: "key" }, submenu ? "▸" : key));
  }

  private onKey(e: KeyboardEvent): void {
    // Alt+letter opens a menu, as Windows does.
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code.startsWith("Key")) {
      const letter = e.code.slice(3);
      const index = this.menus.findIndex((m) => mnemonic(m.label).key === letter);
      if (index >= 0) { e.preventDefault(); e.stopPropagation(); this.show(index); this.focusItem(0, 0); }
      return;
    }
    if (this.open === null || this.levels.length === 0) return;
    const depth = Math.max(0, this.levels.findIndex((l) => l.contains(document.activeElement)));
    const level = this.levels[depth];
    const items = [...level.querySelectorAll<HTMLElement>(":scope > .menu-item:not(.disabled)")];
    const at = items.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case "Escape":
        if (depth > 0) this.backTo(depth); else this.close();
        break;
      case "ArrowDown": this.focusItem(depth, at + 1); break;
      case "ArrowUp": this.focusItem(depth, at <= 0 ? items.length - 1 : at - 1); break;
      case "ArrowRight":
        if (at >= 0 && items[at].classList.contains("submenu")) return; // the row's own handler opens it
        this.show((this.open + 1) % this.menus.length); this.focusItem(0, 0);
        break;
      case "ArrowLeft":
        if (depth > 0) { this.backTo(depth); break; }
        this.show((this.open + this.menus.length - 1) % this.menus.length); this.focusItem(0, 0);
        break;
      case "Enter": if (at >= 0) items[at].dispatchEvent(new MouseEvent("mouseup")); break;
      default: {
        // A letter picks the item with that mnemonic.
        if (e.key.length !== 1) return;
        const hit = items.find((it) => it.querySelector(".label u")?.textContent?.toUpperCase() === e.key.toUpperCase());
        if (!hit) return;
        if (hit.classList.contains("submenu")) hit.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
        else hit.dispatchEvent(new MouseEvent("mouseup"));
      }
    }
    e.preventDefault();
    e.stopPropagation();
  }

  /** Close the submenu at `depth` and put the focus back on the row that opened it. */
  private backTo(depth: number): void {
    const parent = this.levels[depth].dataset.parent;
    this.closeFrom(depth);
    this.levels[depth - 1]?.querySelector<HTMLElement>(`.menu-item[data-key="${parent}"]`)?.focus();
  }

  private focusItem(depth: number, index: number): void {
    const items = [...(this.levels[depth]?.querySelectorAll<HTMLElement>(":scope > .menu-item:not(.disabled)") ?? [])];
    if (items.length) items[((index % items.length) + items.length) % items.length].focus();
  }

  /** Rebuild the open menus, so enabled and checked states follow the app. */
  refresh(): void {
    if (this.open === null || this.levels.length === 0) return;
    const fresh = this.build(this.menus[this.open].items, 0);
    this.closeFrom(1);
    clear(this.levels[0]);
    this.levels[0].append(...fresh.childNodes);
  }
}

/** Keep a popup inside the window; a submenu that would run off the right opens to the left of `flipX`. */
export function place(menu: HTMLElement, x: number, y: number, flipX?: number): void {
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const r = menu.getBoundingClientRect();
  if (r.right > window.innerWidth) menu.style.left = `${Math.max(0, (flipX ?? window.innerWidth) - r.width - (flipX === undefined ? 4 : 0))}px`;
  if (r.bottom > window.innerHeight) menu.style.top = `${Math.max(0, window.innerHeight - r.height - 4)}px`;
}
