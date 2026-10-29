/*
  One open image: the image data, its name and file, its undo history, whether it has changes,
  and the composite the windows draw. Every window showing the image (Window > New Window
  opens more) listens to it.

  PSP 6 names new images Image1, Image2... in the order they are made; an opened file is named
  after the file.
*/
import { Emitter } from "../shared/emitter.ts";
import { History, type Touch } from "../core/edit/history.ts";
import { composite } from "../core/layers/composite.ts";
import type { Raster } from "../core/image/raster.ts";
import type { ImageDoc } from "../core/doc/image-doc.ts";
import type { FormatId } from "../core/formats/formats.ts";

export interface DocumentEvents extends Record<string, unknown> {
  /** Pixels or layers changed; the composite is already up to date. */
  changed: Touch;
  /** The name, file or modified mark changed (window titles). */
  title: void;
}

let nextId = 1;

export class ImageDocument extends Emitter<DocumentEvents> {
  readonly id = nextId++;
  doc: ImageDoc;
  name: string;
  /** The file it was opened from or saved to, when the browser gives handles (File System Access). */
  handle: FileSystemFileHandle | null;
  format: FormatId | null;
  /** Size on disk of the file it came from, for Image Information. */
  fileSize = 0;
  readonly history = new History();
  composite: Raster;
  /** Layers > View > Current Only: show the active layer alone. */
  viewCurrentOnly = false;
  /** Colors > View Palette Transparency. */
  viewPaletteTransparency = false;
  /** Selections > Hide Marquee. */
  hideMarquee = false;
  /** Masks > View Mask (red where the mask hides) and Masks > Edit (paint on the mask). */
  viewMask = false;
  editMask = false;
  private dirty = false;

  constructor(doc: ImageDoc, name: string, handle: FileSystemFileHandle | null = null, format: FormatId | null = null) {
    super();
    this.doc = doc;
    this.name = name;
    this.handle = handle;
    this.format = format;
    this.composite = composite(doc, undefined, undefined, this.compositeOptions());
  }

  private compositeOptions() {
    return this.viewCurrentOnly ? { only: this.doc.active } : {};
  }

  /** Changed since it was opened or last saved. */
  get modified(): boolean {
    return this.dirty || !this.history.atSavePoint;
  }

  /** Mark a change that is not in the undo history (Creator Information, for one). */
  touchModified(): void {
    this.dirty = true;
    this.emit("title", undefined);
  }

  /** After an edit: recomposite what it touched and tell the windows. */
  changed(touch: Touch): void {
    if (touch.image || touch.layers || !touch.pixels || this.composite.width !== this.doc.width || this.composite.height !== this.doc.height) this.composite = composite(this.doc, undefined, undefined, this.compositeOptions());
    else composite(this.doc, touch.pixels, this.composite, this.compositeOptions());
    this.emit("changed", touch);
    this.emit("title", undefined);
  }

  /** Saved to `name` (and `handle`, `format`): this is now the clean state. */
  saved(name: string, handle: FileSystemFileHandle | null, format: FormatId): void {
    this.name = name;
    this.handle = handle;
    this.format = format;
    this.dirty = false;
    this.history.markSaved();
    this.emit("title", undefined);
  }

  /** Edit > Empty > Command History: forget the steps, keeping whether the image has changes. */
  emptyHistory(): void {
    const modified = this.modified;
    this.history.clear();
    this.dirty = modified;
    this.emit("title", undefined);
  }

  /** File > Revert: the image read again from its file. */
  replace(doc: ImageDoc): void {
    this.doc = doc;
    this.history.clear();
    this.dirty = false;
    this.changed({ image: true });
  }
}
