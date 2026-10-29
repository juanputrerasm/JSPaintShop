/*
  Editing the active image: every command runs through here, so each is one undo step with a
  name for Edit > Command History.

    run(label, fn)     a whole-image step (snapshot.ts): layer commands, filters, resizes
    push(change)       a step recorded some other way (a brush stroke's pixel patch)
    undo, redo, undoTo for the Edit menu and the Command History dialog

  Edit > Undo and Redo work on the active image, each image keeping its own history as in
  PSP 6.
*/
import type { AppState } from "./state.ts";
import type { Workspace } from "./workspace.ts";
import type { ImageDocument } from "./image-document.ts";
import { transact } from "../core/edit/snapshot.ts";
import type { Change, Touch } from "../core/edit/history.ts";
import type { ImageDoc } from "../core/doc/image-doc.ts";
import { alertDialog } from "../ui/shell/dialog.ts";

export class Editor {
  private app: AppState;
  readonly ws: Workspace;

  constructor(app: AppState, ws: Workspace) {
    this.app = app;
    this.ws = ws;
  }

  get image(): ImageDocument | null {
    return this.ws.active;
  }

  /** Run `fn` on the active image as one undo step. Errors are reported, the image left as it was. */
  run(label: string, fn: (doc: ImageDoc) => Touch | void, image: ImageDocument | null = this.image): boolean {
    if (!image) return false;
    let change: Change | null;
    try {
      change = transact(image.doc, label, fn);
    } catch (err) {
      void alertDialog("JSPaintShop", err instanceof Error ? err.message : String(err));
      return false;
    }
    if (!change) return false;
    this.push(change, image, true);
    return true;
  }

  /** Add a step made elsewhere (already applied) and refresh the image. */
  push(change: Change, image: ImageDocument | null = this.image, applied = true): void {
    if (!image) return;
    change.time ??= Date.now();
    image.history.push(change);
    if (applied) image.changed(change.touch);
    this.app.emit("commands", undefined);
  }

  undo(image = this.image): void {
    const c = image?.history.undo();
    if (c && image) { image.changed({ ...c.touch, layers: true }); this.app.emit("commands", undefined); }
  }

  redo(image = this.image): void {
    const c = image?.history.redo();
    if (c && image) { image.changed({ ...c.touch, layers: true }); this.app.emit("commands", undefined); }
  }

  /** Undo until `count` steps remain (Command History). */
  undoTo(count: number, image = this.image): void {
    if (!image) return;
    while (image.history.undoLabels.length > count && image.history.canUndo) image.history.undo();
    image.changed({ image: true });
    this.app.emit("commands", undefined);
  }

  /** Redo `count` steps (Command History). */
  redoSteps(count: number, image = this.image): void {
    if (!image) return;
    for (let i = 0; i < count && image.history.canRedo; i++) image.history.redo();
    image.changed({ image: true });
    this.app.emit("commands", undefined);
  }

  /** Make a layer active (not an undo step, as in PSP). */
  setActiveLayer(index: number, image = this.image): void {
    if (!image || index === image.doc.active || index < 0 || index >= image.doc.layers.length) return;
    image.doc.active = index;
    image.changed({ layers: true });
  }
}
