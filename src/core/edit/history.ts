/*
  Undo and redo, from JSTraxx core/edit/history.ts. PSP 6 keeps many levels (Preferences >
  Undo sets the limit) and lists them in Edit > Command History; the labels here are what that
  list shows.

  A change is recorded after it is made: it knows how to put the image back (undo) and how to
  do it again (redo), and what it touched, so the view recomposites only that. A drag or a
  multi-step operation is one change (a group). The save point lets an undo back to the saved
  state clear the "modified" mark.
*/

export interface Rect { minX: number; minY: number; maxX: number; maxY: number }

/** What a change touched, for the view and the palettes. */
export interface Touch {
  /** Pixels changed in this rectangle of the image (inclusive). */
  pixels?: Rect;
  /** The layer list or a layer's properties (name, opacity, blend mode, visibility). */
  layers?: boolean;
  selection?: boolean;
  palette?: boolean;
  /** The image as a whole: size, color depth, resolution. */
  image?: boolean;
}

export interface Change {
  label: string;
  /** When it was made (ms), for Command History's "Time Since". */
  time?: number;
  undo(): void;
  redo(): void;
  touch: Touch;
}

export function unionRect(x?: Rect, y?: Rect): Rect | undefined {
  if (!x) return y;
  if (!y) return x;
  return { minX: Math.min(x.minX, y.minX), minY: Math.min(x.minY, y.minY), maxX: Math.max(x.maxX, y.maxX), maxY: Math.max(x.maxY, y.maxY) };
}

export function mergeTouch(a: Touch, b: Touch): Touch {
  const out: Touch = {};
  const pixels = unionRect(a.pixels, b.pixels);
  if (pixels) out.pixels = pixels;
  for (const k of ["layers", "selection", "palette", "image"] as const) if (a[k] || b[k]) out[k] = true;
  return out;
}

/** Several changes as one: undone last first. */
export function group(label: string, changes: Change[]): Change {
  const touch = changes.reduce<Touch>((t, c) => mergeTouch(t, c.touch), {});
  return {
    label,
    touch,
    undo: () => { for (let i = changes.length - 1; i >= 0; i--) changes[i].undo(); },
    redo: () => { for (const c of changes) c.redo(); },
  };
}

export class History {
  private undoStack: Change[] = [];
  private redoStack: Change[] = [];
  /** How many changes deep the saved state is, or -1 when it can no longer be reached. */
  private savedAt = 0;
  limit: number;
  /** Preferences > Undo "Enable the redo system": off, an undone step cannot come back. */
  redoEnabled = true;

  constructor(limit = 200) {
    this.limit = limit;
  }

  push(change: Change): void {
    this.undoStack.push(change);
    if (this.savedAt > this.undoStack.length - 1) this.savedAt = -1;
    this.redoStack = [];
    while (this.undoStack.length > this.limit) {
      this.undoStack.shift();
      if (this.savedAt >= 0) this.savedAt--;
    }
  }

  undo(): Change | null {
    const c = this.undoStack.pop();
    if (!c) return null;
    c.undo();
    if (this.redoEnabled) this.redoStack.push(c);
    return c;
  }

  redo(): Change | null {
    const c = this.redoStack.pop();
    if (!c) return null;
    c.redo();
    this.undoStack.push(c);
    return c;
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get undoLabel(): string | null { return this.undoStack[this.undoStack.length - 1]?.label ?? null; }
  get redoLabel(): string | null { return this.redoStack[this.redoStack.length - 1]?.label ?? null; }
  /** Oldest first, for the Command History dialog. */
  get undoLabels(): string[] { return this.undoStack.map((c) => c.label); }
  get undoSteps(): readonly Change[] { return this.undoStack; }
  /** Next to redo first. */
  get redoSteps(): readonly Change[] { return [...this.redoStack].reverse(); }
  get redoLabels(): string[] { return this.redoStack.map((c) => c.label).reverse(); }

  /** The image was saved: this is the clean state. */
  markSaved(): void { this.savedAt = this.undoStack.length; }
  get atSavePoint(): boolean { return this.savedAt === this.undoStack.length; }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.savedAt = 0;
  }
}
