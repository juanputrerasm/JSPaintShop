/*
  The View menu and the image half of the Window menu.

    Full Screen Edit      the whole browser window for JSPaintShop (the Fullscreen API)
    Full Screen Preview   the active image alone on black, at 1:1 or smaller to fit; any key
                          or click ends it
    Normal Viewing (1:1), Zoom In/Out By 1 and By 5
    Image Information     DIALOG 173 and 174
    Grid, Rulers          for every window
    New Window, Duplicate (a copy as a new image), Fit to Image
*/
import type { AppState } from "./state.ts";
import type { Workspace } from "./workspace.ts";
import { ImageDocument } from "./image-document.ts";
import { CMD, type CommandRegistry } from "../ui/shell/commands.ts";
import { showImageInfo } from "../ui/dialogs/image-info.ts";
import { el } from "../shared/dom.ts";

export function bindViewCommands(app: AppState, registry: CommandRegistry, ws: Workspace): void {
  const hasImage = () => ws.active !== null;
  const zoom = (id: number, change: Parameters<Workspace["zoomActive"]>[0]) => registry.bind(id, () => ws.zoomActive(change), { enabled: hasImage });
  zoom(CMD.VIEW_NORMAL_VIEWING_1_1, (v) => v.setZoom(1));
  zoom(CMD.VIEW_ZOOM_IN_BY_1, (v) => v.stepZoom(1));
  zoom(CMD.VIEW_ZOOM_IN_BY_5, (v) => v.stepZoom(5));
  zoom(CMD.VIEW_ZOOM_OUT_BY_1, (v) => v.stepZoom(-1));
  zoom(CMD.VIEW_ZOOM_OUT_BY_5, (v) => v.stepZoom(-5));

  registry.bind(CMD.VIEW_IMAGE_INFORMATION, () => { const a = ws.active; if (a) return showImageInfo(a); }, { enabled: hasImage });
  registry.bind(CMD.VIEW_GRID, () => app.updateSettings((s) => { s.grid = !s.grid; }), { enabled: hasImage, checked: () => app.settings.grid });
  registry.bind(CMD.VIEW_RULERS, () => app.updateSettings((s) => { s.rulers = !s.rulers; }), { enabled: hasImage, checked: () => app.settings.rulers });

  registry.bind(CMD.VIEW_FULL_SCREEN_EDIT, async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }, { enabled: () => document.fullscreenEnabled, checked: () => document.fullscreenElement === document.documentElement });
  document.addEventListener("fullscreenchange", () => app.emit("commands", undefined));
  registry.bind(CMD.VIEW_FULL_SCREEN_PREVIEW, () => { const a = ws.active; if (a) preview(a); }, { enabled: hasImage });

  registry.bind(CMD.WINDOW_NEW_WINDOW, () => ws.newWindow(), { enabled: () => hasImage() && !ws.full });
  registry.bind(CMD.WINDOW_DUPLICATE, () => {
    const a = ws.active;
    if (a) ws.show(new ImageDocument(structuredClone(a.doc), ws.nextName()));
  }, { enabled: () => hasImage() && !ws.full });
  registry.bind(CMD.WINDOW_FIT_TO_IMAGE, () => ws.fitActive(), { enabled: hasImage });
}

/* The image on black, filling the screen; the first key or click ends it. */
function preview(image: ImageDocument): void {
  const c = image.composite;
  const canvas = el("canvas", { class: "preview-canvas", width: c.width, height: c.height });
  canvas.getContext("2d")!.putImageData(new ImageData(c.data, c.width, c.height), 0, 0);
  const layer = el("div", { class: "full-preview", tabindex: "0" }, canvas);
  document.body.append(layer);
  const end = () => {
    layer.remove();
    document.removeEventListener("keydown", key, true);
    if (document.fullscreenElement === layer) void document.exitFullscreen();
  };
  const key = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); end(); };
  layer.addEventListener("pointerdown", end);
  layer.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) end(); });
  document.addEventListener("keydown", key, true);
  layer.requestFullscreen?.().catch(() => { /* shown over the page instead */ });
  layer.focus();
}
