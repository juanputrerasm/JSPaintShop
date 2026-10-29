/*
  The status bar, as PSP 6's: the message line ("Ready", or a command's prompt while it is hovered), then
  the cursor position, the color under the cursor, and the active image's size and color depth.
*/
import { el } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";

export class StatusBar {
  readonly element: HTMLElement;

  constructor(app: AppState) {
    const ready = "Ready";
    const message = el("span", { class: "sb-message", "aria-live": "polite" }, ready);
    const panes = {
      position: el("span", { class: "sb-pane sb-position", title: "Cursor position" }),
      color: el("span", { class: "sb-pane sb-color", title: "Color under the cursor" }),
      image: el("span", { class: "sb-pane sb-image", title: "Image size and color depth" }),
    };
    this.element = el("footer", { class: "statusbar" }, message, panes.position, panes.color, panes.image);
    app.on("status", (text) => { message.textContent = text || ready; });
    app.on("indicators", (ind) => {
      panes.position.textContent = ind.position;
      panes.color.textContent = ind.color;
      panes.image.textContent = ind.image;
    });
  }
}
