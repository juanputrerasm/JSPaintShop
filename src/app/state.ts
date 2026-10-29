/*
  The editor's state outside the images themselves: settings, the active tool, the status
  bar's text and panes. The shell and the palettes listen to it; nothing here touches the DOM.
*/
import { Emitter } from "../shared/emitter.ts";
import type { PspSettings } from "../core/settings.ts";
import { saveSettings } from "../shared/settings-store.ts";

/*
  PSP 6's status bar: the help line, then the cursor position, the color under the cursor and
  the active image's size and color depth.
*/
export interface Indicators { position: string; color: string; image: string }

export interface AppEvents extends Record<string, unknown> {
  settings: PspSettings;
  tool: number;
  status: string;
  indicators: Indicators;
  /** Something changed that menus and toolbar buttons may show (enabled, checked). */
  commands: void;
  /** The active image changed, or its layers, selection or pixels did (the palettes redraw). */
  image: void;
}

export class AppState extends Emitter<AppEvents> {
  settings: PspSettings;
  indicators: Indicators = { position: "", color: "", image: "" };
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(settings: PspSettings) {
    super();
    this.settings = settings;
  }

  get tool(): number {
    return this.settings.tool;
  }

  setTool(id: number): void {
    if (id === this.settings.tool) return;
    this.updateSettings((s) => { s.tool = id; });
    this.emit("tool", id);
    this.emit("commands", undefined);
  }

  /** Change settings in place, tell listeners, and save a moment later. */
  updateSettings(change: (s: PspSettings) => void): void {
    change(this.settings);
    this.emit("settings", this.settings);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      saveSettings(this.settings).catch((err) => console.warn("Settings not saved:", err));
    }, 400);
  }

  status(message: string): void {
    this.emit("status", message);
  }

  setIndicators(change: Partial<Indicators>): void {
    Object.assign(this.indicators, change);
    this.emit("indicators", this.indicators);
  }
}
