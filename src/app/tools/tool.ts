/*
  What a tool is: handlers for the pointer on an image window, an optional overlay drawn over
  the image (rubber bands, crop frames, brush outlines), and its options.
*/
import type { AppState } from "../state.ts";
import type { Editor } from "../editor.ts";
import type { Workspace } from "../workspace.ts";
import type { Colors } from "../colors.ts";
import type { ImageDocument } from "../image-document.ts";
import type { ImageView, ViewTransform } from "../../render/image-view.ts";
import type { OptionValue } from "./options.ts";

export interface ToolEvent {
  /** Image coordinates, fractional. */
  x: number;
  y: number;
  /** The pixel under the pointer. */
  px: number;
  py: number;
  button: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  /** Pen pressure 0..1 (0.5 for a mouse, as the browser reports). */
  pressure: number;
  clientX: number;
  clientY: number;
  image: ImageDocument;
  view: ImageView;
}

export interface Tool {
  down?(e: ToolEvent): void;
  /** `dragging` while a button is held. */
  move?(e: ToolEvent, dragging: boolean): void;
  up?(e: ToolEvent): void;
  dblclick?(e: ToolEvent): void;
  overlay?(g: CanvasRenderingContext2D, t: ViewTransform, image: ImageDocument): void;
  /** Another tool was chosen. */
  deactivate?(): void;
}

export interface ToolContext {
  app: AppState;
  ed: Editor;
  ws: Workspace;
  colors: Colors;
  options(): Record<string, OptionValue>;
}
