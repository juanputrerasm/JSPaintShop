/*
  The open images and their windows. Each image has one or more windows (Window > New
  Window), each window its own view and zoom. The active window decides what the menus act
  on, the title bar and the status bar.

  A new window opens at the largest zoom that shows the whole image in the work area, never
  above 1:1, and sized to the image. Closing an image's last window closes the image, asking
  to save it first when it has changes.

  Pointer input on a view goes to the active tool. This phase has the Zoom tool (left-click
  zooms in, right-click out, at the pointer) and the Arrow (drag scrolls the image); the
  status bar follows the pointer with the position and the color under it.
*/
import type { AppState } from "./state.ts";
import { ImageDocument } from "./image-document.ts";
import { ImageView } from "../render/image-view.ts";
import type { AppShell } from "../ui/shell/app-shell.ts";
import type { ImageWindow } from "../ui/shell/mdi.ts";
import { askSaveChanges } from "../ui/shell/dialog.ts";
import { CMD, CURSORS } from "../ui/shell/commands.ts";
import { zoomLabel } from "../core/view/zoom.ts";
import { describeImage } from "../core/doc/image-doc.ts";
import { pixelAt } from "../core/image/raster.ts";

interface Pane { win: ImageWindow; view: ImageView; image: ImageDocument; off: (() => void)[] }

export class Workspace {
  private app: AppState;
  private shell: AppShell;
  private panes: Pane[] = [];
  private untitled = 0;
  /** Saves an image (File > Save); true when it was saved. Set by the file commands. */
  saver: (image: ImageDocument) => Promise<boolean> = async () => false;

  constructor(app: AppState, shell: AppShell) {
    this.app = app;
    this.shell = shell;
    shell.mdi.on("changed", () => this.activeChanged());
    app.on("settings", () => {
      for (const p of this.panes) p.view.applySettings();
      for (const i of this.images) this.applyUndo(i);
      for (const p of this.panes) this.applyCursor(p.view);
    });
    app.on("tool", () => { for (const p of this.panes) this.applyCursor(p.view); });
  }

  /** The next "Image<n>" name for a new, pasted or duplicated image. */
  nextName(): string {
    return `Image${++this.untitled}`;
  }

  get activePane(): Pane | null {
    const win = this.shell.mdi.active;
    return this.panes.find((p) => p.win === win) ?? null;
  }

  get active(): ImageDocument | null {
    return this.activePane?.image ?? null;
  }

  get activeView(): ImageView | null {
    return this.activePane?.view ?? null;
  }

  get images(): ImageDocument[] {
    return [...new Set(this.panes.map((p) => p.image))];
  }

  get hasImage(): boolean {
    return this.panes.length > 0;
  }

  /** PSP keeps at most 30 windows open. */
  get full(): boolean {
    return this.shell.mdi.full;
  }

  /** File > Close: the active window (and with its last window, the image). */
  async activeWindowClose(): Promise<void> {
    await this.activePane?.win.close();
  }

  /*
    Preferences > Undo: off keeps no steps; "Limit undo/redo to" caps them. The disk limit has no
    counterpart (steps live in memory and share unchanged rasters), so without a step limit
    JSPaintShop keeps 200.
  */
  private applyUndo(image: ImageDocument): void {
    const u = this.app.settings.prefs.undo;
    image.history.limit = !u.enabled ? 0 : u.limitSteps ? u.steps : 200;
    image.history.redoEnabled = u.enabled && u.redo;
  }

  /** Open a window on `image`. */
  show(image: ImageDocument): ImageWindow {
    this.applyUndo(image);
    const view = new ImageView(image, () => this.app.settings);
    const area = this.shell.mdi.area.getBoundingClientRect();
    // Room for the window's title bar, borders and the cascade offset; Preferences > Viewing
    // "Auto size" off opens at 1:1.
    view.zoom = this.app.settings.prefs.viewing.autoSizeNew ? view.fitZoom(Math.max(64, area.width - 60), Math.max(64, area.height - 90)) : 1;
    const content = view.contentSize();
    const win = this.shell.mdi.open({
      title: image.name, body: view.element, width: content.w + 4, height: content.h + 30,
      beforeClose: () => this.beforeClose(pane),
      onClose: () => this.closed(pane),
    });
    const pane: Pane = { win, view, image, off: [] };
    this.panes.push(pane);
    win.fitBody(content.w + 2, content.h + 2);
    pane.off.push(image.on("title", () => this.retitle(image)));
    pane.off.push(image.on("changed", () => { if (this.active === image) { this.indicators(); this.app.emit("image", undefined); this.app.emit("commands", undefined); } }));
    this.attachInput(pane);
    this.onView?.(view, image);
    this.applyCursor(view);
    this.retitle(image);
    this.activeChanged();
    return win;
  }

  /** Window > New Window: another window on the active image. */
  newWindow(): void {
    const p = this.activePane;
    if (!p) return;
    const win = this.show(p.image);
    const view = this.panes.find((q) => q.win === win)!.view;
    view.setZoom(p.view.zoom);
  }

  /** Close every window of `image`, asking to save it first. */
  async closeImage(image: ImageDocument): Promise<boolean> {
    if (image.modified) {
      const answer = await askSaveChanges(image.name);
      if (answer === null) return false;
      if (answer === "yes" && !(await this.saver(image))) return false;
    }
    for (const p of this.panes.filter((q) => q.image === image)) { p.win.options.beforeClose = undefined; await p.win.close(); }
    return true;
  }

  private async beforeClose(pane: Pane): Promise<boolean> {
    const others = this.panes.some((p) => p !== pane && p.image === pane.image);
    if (others || !pane.image.modified) return true;
    const answer = await askSaveChanges(pane.image.name);
    if (answer === null) return false;
    if (answer === "yes") return this.saver(pane.image);
    return true;
  }

  private closed(pane: Pane): void {
    this.panes = this.panes.filter((p) => p !== pane);
    pane.view.dispose();
    for (const off of pane.off) off();
    this.retitle(pane.image);
    this.activeChanged();
  }

  /*
    Window titles: "Image1 [1:1]", "photo.png*" with changes, and ":2", ":3" on further
    windows of the same image (as MFC numbers them).
  */
  retitle(image: ImageDocument): void {
    const panes = this.panes.filter((p) => p.image === image);
    panes.forEach((p, i) => {
      const n = panes.length > 1 ? `:${i + 1}` : "";
      p.win.setTitle(`${image.name}${n}${image.modified ? "*" : ""} [${zoomLabel(p.view.zoom)}]${image.editMask ? " *MASK*" : ""}`);
    });
  }

  private lastActive: ImageDocument | null = null;

  private activeChanged(): void {
    this.indicators();
    if (this.active !== this.lastActive) { this.lastActive = this.active; this.app.emit("image", undefined); }
    this.app.emit("commands", undefined);
  }

  private indicators(): void {
    const image = this.active;
    this.app.setIndicators({ image: image ? describeImage(image.doc) : "", position: "", color: "" });
  }

  /* A tool's cursor from Psp.exe (cursor groups share the tool's id), else a plain one. */
  applyCursor(view: ImageView): void {
    const tool = this.app.tool;
    const hot = this.app.settings.prefs.cursors.precise ? undefined : CURSORS[tool];
    view.scroller.style.cursor = hot ? `url(${import.meta.env.BASE_URL}ui/cursors/${tool}.png) ${hot[0]} ${hot[1]}, crosshair` : tool === CMD.TOOL_ARROW ? "default" : "crosshair";
  }

  private attachInput(pane: Pane): void {
    const { view, image } = pane;
    const el = view.scroller;
    el.addEventListener("pointermove", (e) => {
      const p = view.toImage(e.clientX, e.clientY);
      const x = Math.floor(p.x), y = Math.floor(p.y);
      const c = pixelAt(image.composite, x, y);
      this.app.setIndicators({ position: c ? `(${x}, ${y})` : "", color: c ? `R:${c[0]} G:${c[1]} B:${c[2]} O:${c[3]}` : "" });
    });
    el.addEventListener("pointerleave", () => this.app.setIndicators({ position: "", color: "" }));
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    // Ctrl+wheel zooms at the pointer (an addition; PSP 6 has no wheel zoom).
    el.addEventListener("wheel", (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      view.stepZoom(e.deltaY < 0 ? 1 : -1, e);
      this.retitle(image);
    }, { passive: false });
    el.addEventListener("pointerdown", (e) => this.input?.("down", pane, e));
    el.addEventListener("pointermove", (e) => this.input?.("move", pane, e));
    el.addEventListener("pointerup", (e) => this.input?.("up", pane, e));
    el.addEventListener("pointercancel", (e) => this.input?.("up", pane, e));
    el.addEventListener("dblclick", (e) => this.input?.("dblclick", pane, e as PointerEvent));
  }

  /** Pointer input for the tools (app/tools/dispatch.ts). */
  input: ((kind: "down" | "move" | "up" | "dblclick", pane: { image: ImageDocument; view: ImageView }, e: PointerEvent) => void) | null = null;
  /** Called for each new view, so the tools and the marching ants can draw on it. */
  onView: ((view: ImageView, image: ImageDocument) => void) | null = null;

  /** Every view, for redraws (the marching ants' crawl). */
  get views(): ImageView[] {
    return this.panes.map((p) => p.view);
  }

  /** Retitle after a zoom from a tool. */
  zoomed(image: ImageDocument): void {
    this.retitle(image);
    this.app.emit("commands", undefined);
  }

  /** Zoom the active view (View menu) and retitle it. */
  zoomActive(change: (view: ImageView) => void): void {
    const p = this.activePane;
    if (!p) return;
    change(p.view);
    this.retitle(p.image);
    this.app.emit("commands", undefined);
  }

  /** Window > Fit to Image: the active window sized to show the image at its zoom. */
  fitActive(): void {
    const p = this.activePane;
    if (!p) return;
    const c = p.view.contentSize();
    p.win.fitBody(c.w + 2, c.h + 2);
  }
}
