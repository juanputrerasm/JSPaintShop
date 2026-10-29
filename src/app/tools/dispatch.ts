/*
  Routing pointer input on the image windows to the active tool, and drawing the tools'
  overlays and the marching ants on every view.
*/
import type { AppState } from "../state.ts";
import type { Workspace } from "../workspace.ts";
import type { Tool, ToolEvent } from "./tool.ts";
import type { ImageDocument } from "../image-document.ts";
import type { ImageView } from "../../render/image-view.ts";

export function attachTools(app: AppState, ws: Workspace, tools: Record<number, Tool>, extraOverlays: ((view: ImageView, image: ImageDocument) => void)[]): void {
  let dragging = false;
  let current = tools[app.tool];
  app.on("tool", () => { current?.deactivate?.(); current = tools[app.tool]; for (const v of ws.views) v.request(); });

  const event = (pane: { image: ImageDocument; view: ImageView }, e: PointerEvent): ToolEvent => {
    const p = pane.view.toImage(e.clientX, e.clientY);
    return {
      x: p.x, y: p.y, px: Math.floor(p.x), py: Math.floor(p.y), button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey,
      pressure: e.pointerType === "mouse" ? 1 : e.pressure || 0.5, clientX: e.clientX, clientY: e.clientY, image: pane.image, view: pane.view,
    };
  };

  ws.input = (kind, pane, e) => {
    const tool = current;
    if (!tool) return;
    if (kind === "down") {
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      pane.view.scroller.setPointerCapture(e.pointerId);
      pane.view.scroller.focus({ preventScroll: true });
      dragging = true;
      tool.down?.(event(pane, e));
    } else if (kind === "move") {
      tool.move?.(event(pane, e), dragging);
    } else if (kind === "up") {
      if (!dragging) return;
      dragging = false;
      tool.up?.(event(pane, e));
    } else tool.dblclick?.(event(pane, e));
    pane.view.request();
  };

  ws.onView = (view, image) => {
    view.overlays.push((g, t) => current?.overlay?.(g, t, image));
    for (const f of extraOverlays) f(view, image);
  };
}
