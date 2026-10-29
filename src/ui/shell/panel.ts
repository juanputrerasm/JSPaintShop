/*
  Floating palettes, as PSP's Tool Options, Layer and Histogram windows: a title
  bar to drag, a close button, a resize grip, and the last position and size remembered in
  settings.panels. They float over the work area and are kept inside it.

  Automatic roll-ups (Psp.exe 0x60d370, timer 11 every 250 ms): with View > Toolbars "Enable
  Automatic Roll-Ups" on, a palette shrinks to its title bar once neither the pointer nor the
  keyboard focus is in it, and opens again when the pointer rests on it. The title bar's pin
  button is "Lock Window Open" (and, when locked, "Allow Auto Roll-Up"), strings 23927/23926:
  a locked palette stays open. The lock is kept with the palette's place in settings.panels.
*/
import { el } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";

export interface PanelOptions {
  id: string;
  title: string;
  /** Default size and position (from the top right of the work area) when none is stored. */
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  /** Optional toolbar row under the title. */
  toolbar?: HTMLElement;
  onShow?: () => void;
  onHide?: () => void;
}

let topZ = 10;

/* The pin: upright and pushed in when the palette is locked open, tilted when it may roll up. */
const PIN_IN = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M5 2h6l-1 1v4l2 2v1H4V9l2-2V3z M7.5 10h1v4.5l-.5.5-.5-.5z" fill="currentColor"/></svg>';
const PIN_OUT = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><g transform="rotate(45 8 8)"><path d="M5 2h6l-1 1v4l2 2v1H4V9l2-2V3z M7.5 10h1v4.5l-.5.5-.5-.5z" fill="none" stroke="currentColor" stroke-width="1"/></g></svg>';

export class FloatingPanel {
  readonly element: HTMLElement;
  readonly body: HTMLElement;
  private app: AppState;
  private options: PanelOptions;
  private area: HTMLElement;
  private pin: HTMLButtonElement;
  private hovered = false;
  private dragging = false;
  private rolled = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(app: AppState, area: HTMLElement, options: PanelOptions) {
    this.app = app;
    this.area = area;
    this.options = options;
    this.pin = el("button", { class: "panel-pin", onclick: () => this.setLocked(!this.locked) }) as HTMLButtonElement;
    const titleBar = el("div", { class: "panel-title" },
      el("span", {}, options.title),
      this.pin,
      el("button", { class: "panel-close", title: "Close", "aria-label": `Close ${options.title}`, onclick: () => this.hide() }, "×"));
    this.body = el("div", { class: "panel-body" });
    const grip = el("div", { class: "panel-grip", "aria-hidden": "true" });
    this.element = el("section", { class: "floating-panel", role: "dialog", "aria-label": options.title, hidden: true },
      titleBar, options.toolbar ?? null, this.body, grip);
    this.element.addEventListener("pointerdown", () => this.raise());
    this.element.addEventListener("pointerenter", () => {
      this.hovered = true;
      // Rest on a rolled-up palette for a moment to open it.
      if (this.rolled) setTimeout(() => { if (this.hovered) this.rollDown(); }, 250);
    });
    this.element.addEventListener("pointerleave", () => { this.hovered = false; });
    this.updatePin();
    this.drag(titleBar, (dx, dy, start) => this.place(start.x + dx, start.y + dy, start.w, start.h));
    this.drag(grip, (dx, dy, start) => this.place(start.x, start.y, start.w + dx, start.h + dy));
    area.append(this.element);
    const stored = app.settings.panels[options.id];
    if (stored?.open) queueMicrotask(() => this.show());
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  toggle(): void {
    this.visible ? this.hide() : this.show();
  }

  show(): void {
    const stored = this.app.settings.panels[this.options.id];
    const a = this.area.getBoundingClientRect();
    const r = stored ?? { x: Math.max(0, a.width - this.options.width - 12), y: 12, w: this.options.width, h: this.options.height };
    this.element.hidden = false;
    this.place(r.x, r.y, r.w, r.h);
    this.raise();
    this.remember();
    this.timer ??= setInterval(() => this.tick(), 250);
    this.options.onShow?.();
    this.app.emit("commands", undefined);
  }

  hide(): void {
    if (this.element.hidden) return;
    this.element.hidden = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.rollDown();
    this.remember();
    this.options.onHide?.();
    this.app.emit("commands", undefined);
  }

  private get locked(): boolean {
    return Boolean(this.app.settings.panels[this.options.id]?.locked);
  }

  private setLocked(locked: boolean): void {
    this.remember();
    this.app.updateSettings((st) => { const p = st.panels[this.options.id]; if (p) p.locked = locked; });
    this.updatePin();
    if (locked) this.rollDown();
  }

  private updatePin(): void {
    const locked = this.locked, label = locked ? "Allow Auto Roll-Up" : "Lock Window Open";
    this.pin.title = label;
    this.pin.setAttribute("aria-label", label);
    this.pin.setAttribute("aria-pressed", String(locked));
    this.pin.hidden = !this.app.settings.autoRollUps;
    if (this.pin.dataset.locked !== String(locked)) {
      this.pin.dataset.locked = String(locked);
      this.pin.innerHTML = locked ? PIN_IN : PIN_OUT;
    }
  }

  /* Every 250 ms: roll up when the pointer and the focus are both elsewhere. */
  private tick(): void {
    this.updatePin();
    if (this.rolled || this.hovered || this.dragging || this.element.hidden) return;
    if (!this.app.settings.autoRollUps || this.locked) return;
    if (this.element.contains(document.activeElement)) return;
    this.rolled = true;
    this.element.classList.add("rolled-up");
  }

  private rollDown(): void {
    if (!this.rolled) return;
    this.rolled = false;
    this.element.classList.remove("rolled-up");
  }

  private raise(): void {
    this.element.style.zIndex = String(++topZ);
  }

  private place(x: number, y: number, w: number, h: number): void {
    const a = this.area.getBoundingClientRect();
    w = Math.max(this.options.minWidth ?? 160, Math.min(w, a.width));
    h = Math.max(this.options.minHeight ?? 100, Math.min(h, a.height));
    x = Math.max(0, Math.min(x, a.width - Math.min(w, 80)));
    y = Math.max(0, Math.min(y, a.height - 24));
    Object.assign(this.element.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  }

  private remember(): void {
    const s = this.element.style;
    const rect = { x: parseFloat(s.left) || 0, y: parseFloat(s.top) || 0, w: parseFloat(s.width) || this.options.width, h: parseFloat(s.height) || this.options.height, open: this.visible };
    // Keep the lock: it belongs to the palette, not to this move.
    this.app.updateSettings((st) => { st.panels[this.options.id] = { ...rect, locked: Boolean(st.panels[this.options.id]?.locked) }; });
  }

  private drag(handle: HTMLElement, move: (dx: number, dy: number, start: { x: number; y: number; w: number; h: number }) => void): void {
    handle.addEventListener("pointerdown", (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("button") || e.button !== 0) return;
      e.preventDefault();
      const s = this.element.style;
      const start = { x: parseFloat(s.left), y: parseFloat(s.top), w: this.element.offsetWidth, h: this.element.offsetHeight };
      const ox = e.clientX, oy = e.clientY;
      handle.setPointerCapture(e.pointerId);
      this.dragging = true;
      const onMove = (m: PointerEvent) => move(m.clientX - ox, m.clientY - oy, start);
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        this.dragging = false;
        this.remember();
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  }
}
