/*
  The MDI work area: image windows inside the main window, as PSP 6 opens each image (and
  each Window > New Window view of one) in its own child window.

  A window has a title bar (drag to move, double-click to maximize), minimize, maximize and
  close buttons, and a resize grip. Clicking a window activates it. Window > Cascade, Tile
  Horizontally and Tile Vertically arrange the ones not minimized, as Windows MDI does: tiled
  horizontally stacks them top to bottom, tiled vertically puts them side by side.
*/
import { el } from "../../shared/dom.ts";
import { Emitter } from "../../shared/emitter.ts";

/** Most images PSP 6 keeps open at once. */
export const MAX_WINDOWS = 30;
const CASCADE_STEP = 22;
const MIN_W = 120, MIN_H = 80, MINIMIZED_W = 160;

export interface ImageWindowOptions {
  title: string;
  body: HTMLElement;
  width: number;
  height: number;
  /** Asked before closing; return false to keep the window (an unsaved image). */
  beforeClose?: () => boolean | Promise<boolean>;
  onClose?: () => void;
  /** "browser" for File > Browse's window: the frame shows the Browser menu (MENU 130) while it is active. */
  kind?: "image" | "browser" | "help";
}

export class ImageWindow {
  readonly element: HTMLElement;
  readonly body: HTMLElement;
  private titleText: HTMLElement;
  private mdi: Mdi;
  readonly options: ImageWindowOptions;
  state: "normal" | "minimized" | "maximized" = "normal";
  /** The place to go back to from minimized or maximized. */
  private restoreRect: { x: number; y: number; w: number; h: number } | null = null;

  constructor(mdi: Mdi, options: ImageWindowOptions) {
    this.mdi = mdi;
    this.options = options;
    this.titleText = el("span", { class: "mdi-title-text" }, options.title);
    const button = (cls: string, label: string, text: string, run: () => void) =>
      el("button", { class: `mdi-button ${cls}`, title: label, "aria-label": label, onclick: (e: MouseEvent) => { e.stopPropagation(); run(); } }, text);
    const titleBar = el("div", { class: "mdi-title", ondblclick: () => this.toggleMaximize() },
      el("img", { class: "mdi-icon", src: `${import.meta.env.BASE_URL}jspaintshop.svg`, alt: "", width: 16, height: 16 }),
      this.titleText,
      button("mdi-min", "Minimize", "–", () => this.minimize()),
      button("mdi-max", "Maximize", "□", () => this.toggleMaximize()),
      button("mdi-close", "Close", "×", () => { void this.close(); }));
    this.body = el("div", { class: "mdi-body" }, options.body);
    const grip = el("div", { class: "panel-grip", "aria-hidden": "true" });
    this.element = el("section", { class: "mdi-window", role: "dialog", "aria-label": options.title }, titleBar, this.body, grip);
    this.element.addEventListener("pointerdown", () => this.mdi.activate(this));
    this.drag(titleBar, (dx, dy, s) => { if (this.state === "normal") this.place(s.x + dx, s.y + dy, s.w, s.h); });
    this.drag(grip, (dx, dy, s) => { if (this.state === "normal") this.place(s.x, s.y, s.w + dx, s.h + dy); });
  }

  get title(): string {
    return this.titleText.textContent ?? "";
  }

  setTitle(title: string): void {
    this.titleText.textContent = title;
    this.element.setAttribute("aria-label", title);
    this.mdi.changed();
  }

  rect(): { x: number; y: number; w: number; h: number } {
    const s = this.element.style;
    return { x: parseFloat(s.left) || 0, y: parseFloat(s.top) || 0, w: parseFloat(s.width) || this.options.width, h: parseFloat(s.height) || this.options.height };
  }

  place(x: number, y: number, w: number, h: number): void {
    const a = this.mdi.area.getBoundingClientRect();
    w = Math.max(MIN_W, w);
    h = Math.max(MIN_H, h);
    x = Math.max(-w + 60, Math.min(x, a.width - 60));
    y = Math.max(0, Math.min(y, a.height - 24));
    Object.assign(this.element.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  }

  /** Size the window so its body is `w` x `h` (Window > Fit to Image), kept inside the work area. */
  fitBody(w: number, h: number): void {
    if (this.state !== "normal") this.restore();
    const r = this.rect();
    const chromeW = this.element.offsetWidth - this.body.clientWidth, chromeH = this.element.offsetHeight - this.body.clientHeight;
    const a = this.mdi.area.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.x, a.width - (w + chromeW)));
    const y = Math.max(0, Math.min(r.y, a.height - (h + chromeH)));
    this.place(x, y, Math.min(w + chromeW, a.width - x), Math.min(h + chromeH, a.height - y));
  }

  minimize(): void {
    if (this.state === "minimized") return;
    if (this.state === "normal") this.restoreRect = this.rect();
    this.state = "minimized";
    this.element.classList.add("minimized");
    this.element.classList.remove("maximized");
    this.mdi.arrangeIcons();
    this.mdi.activateNext(this);
  }

  toggleMaximize(): void {
    if (this.state === "maximized") { this.restore(); return; }
    if (this.state === "normal") this.restoreRect = this.rect();
    this.state = "maximized";
    this.element.classList.add("maximized");
    this.element.classList.remove("minimized");
    Object.assign(this.element.style, { left: "0px", top: "0px", width: "100%", height: "100%" });
    this.mdi.activate(this);
    this.mdi.arrangeIcons();
  }

  restore(): void {
    const r = this.restoreRect ?? this.rect();
    this.state = "normal";
    this.element.classList.remove("minimized", "maximized");
    this.place(r.x, r.y, r.w, r.h);
    this.mdi.arrangeIcons();
  }

  async close(): Promise<boolean> {
    if (this.options.beforeClose && !(await this.options.beforeClose())) return false;
    this.mdi.remove(this);
    this.options.onClose?.();
    return true;
  }

  private drag(handle: HTMLElement, move: (dx: number, dy: number, start: { x: number; y: number; w: number; h: number }) => void): void {
    handle.addEventListener("pointerdown", (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("button") || e.button !== 0) return;
      e.preventDefault();
      const start = this.rect();
      const ox = e.clientX, oy = e.clientY;
      handle.setPointerCapture(e.pointerId);
      const onMove = (m: PointerEvent) => move(m.clientX - ox, m.clientY - oy, start);
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  }
}

export interface MdiEvents extends Record<string, unknown> {
  /** A window opened, closed, was activated or renamed. */
  changed: void;
}

export class Mdi extends Emitter<MdiEvents> {
  readonly area: HTMLElement;
  readonly windows: ImageWindow[] = [];
  active: ImageWindow | null = null;
  private z = 1;

  constructor(area: HTMLElement) {
    super();
    this.area = area;
  }

  get full(): boolean {
    return this.windows.length >= MAX_WINDOWS;
  }

  open(options: ImageWindowOptions): ImageWindow {
    if (this.full) throw new Error(`No more than ${MAX_WINDOWS} images can be open at once.`);
    const win = new ImageWindow(this, options);
    const n = this.windows.filter((w) => w.state !== "minimized").length;
    this.windows.push(win);
    this.area.append(win.element);
    const a = this.area.getBoundingClientRect();
    const step = (n * CASCADE_STEP) % Math.max(CASCADE_STEP, Math.min(a.width, a.height) / 2);
    win.place(step, step, Math.min(options.width, a.width - step - 4), Math.min(options.height, a.height - step - 4));
    this.activate(win);
    return win;
  }

  activate(win: ImageWindow): void {
    if (win.state === "minimized") win.restore();
    win.element.style.zIndex = String(++this.z);
    if (this.active === win) return;
    this.active?.element.classList.remove("active");
    this.active = win;
    win.element.classList.add("active");
    this.changed();
  }

  /** After `win` is minimized or closed, the topmost other window that is not minimized. */
  activateNext(win: ImageWindow): void {
    const next = this.windows
      .filter((w) => w !== win && w.state !== "minimized")
      .sort((a, b) => Number(b.element.style.zIndex) - Number(a.element.style.zIndex))[0];
    if (next) this.activate(next);
    else if (this.active === win) { win.element.classList.remove("active"); this.active = null; this.changed(); }
  }

  remove(win: ImageWindow): void {
    const i = this.windows.indexOf(win);
    if (i < 0) return;
    this.windows.splice(i, 1);
    win.element.remove();
    if (this.active === win) { this.active = null; this.activateNext(win); }
    this.arrangeIcons();
    this.changed();
  }

  /** Close every window; stops at the first one that refuses (an unsaved image kept open). */
  async closeAll(): Promise<boolean> {
    for (const w of [...this.windows]) if (!(await w.close())) return false;
    return true;
  }

  private arrangeable(): ImageWindow[] {
    return this.windows.filter((w) => w.state !== "minimized");
  }

  cascade(): void {
    const a = this.area.getBoundingClientRect();
    const list = this.arrangeable();
    const w = Math.max(MIN_W, a.width * 0.75), h = Math.max(MIN_H, a.height * 0.75);
    list.forEach((win, i) => {
      const step = (i * CASCADE_STEP) % Math.max(CASCADE_STEP, a.height - h);
      win.restore();
      win.place(step, step, w, h);
      win.element.style.zIndex = String(++this.z);
    });
    if (list.length) this.activate(list[list.length - 1]);
  }

  /** Tile Horizontally (`horizontal`): rows, top to bottom. Tile Vertically: columns, left to right. */
  tile(horizontal: boolean): void {
    const list = this.arrangeable();
    if (!list.length) return;
    const a = this.area.getBoundingClientRect();
    const iconRow = this.windows.length > list.length ? 28 : 0;
    const height = a.height - iconRow;
    // Windows grid: as square as possible, the long side following the tiling direction.
    const along = Math.ceil(Math.sqrt(list.length));
    const across = Math.ceil(list.length / along);
    const [cols, rows] = horizontal ? [across, along] : [along, across];
    list.forEach((win, i) => {
      const col = horizontal ? Math.floor(i / rows) : i % cols;
      const row = horizontal ? i % rows : Math.floor(i / cols);
      win.restore();
      win.place(Math.floor((col * a.width) / cols), Math.floor((row * height) / rows), Math.floor(a.width / cols), Math.floor(height / rows));
    });
  }

  /** Minimized windows line up along the bottom of the work area. */
  arrangeIcons(): void {
    const a = this.area.getBoundingClientRect();
    this.windows.filter((w) => w.state === "minimized").forEach((w, i) => {
      Object.assign(w.element.style, { left: `${i * (MINIMIZED_W + 2)}px`, top: `${a.height - 26}px`, width: `${MINIMIZED_W}px`, height: "24px" });
    });
  }

  changed(): void {
    this.emit("changed", undefined);
  }
}
