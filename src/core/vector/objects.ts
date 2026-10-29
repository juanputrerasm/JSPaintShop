/*
  Vector objects, as PSP 6's vector layers hold them: paths of Bezier contours (lines,
  curves, preset shapes) and text, each with its own stroke and fill. A vector layer's raster
  is always drawn from its objects (core/vector/render.ts), never painted on.
*/
import type { Rgba } from "../image/raster.ts";

/* Node types of the node editor's Node Type menu (MENU 497). */
export type NodeType = "asymmetric" | "symmetric" | "cusp" | "smooth";

/** A point on a contour with its two control points (absolute coordinates). */
export interface PathNode { x: number; y: number; inX: number; inY: number; outX: number; outY: number; type: NodeType }

export interface Contour { nodes: PathNode[]; closed: boolean }

export type LineCap = "butt" | "round" | "square";
export type LineJoin = "miter" | "round" | "bevel";

/* Stroked, Filled, or Stroked & Filled (the Draw tool's Style), with the Draw tool's line options. */
export interface VectorStyle {
  stroke: Rgba | null;
  fill: Rgba | null;
  width: number;
  antialias: boolean;
  cap: LineCap;
  join: LineJoin;
  miter: number;
}

export interface TextData {
  text: string;
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeout: boolean;
  align: "left" | "center" | "right";
  /** Extra space between letters and lines, in thousandths of an em as PSP's Kerning and Leading. */
  kerning: number;
  leading: number;
  /** Where the text starts: its first line's baseline, at the alignment point. */
  x: number;
  y: number;
  /** Text on a path: the contour the baseline follows. */
  path?: Contour;
}

export interface VectorObject {
  name: string;
  visible: boolean;
  style: VectorStyle;
  /** Paths and shapes. */
  contours: Contour[];
  /** Text objects. */
  text?: TextData;
}

export function defaultStyle(stroke: Rgba | null, fill: Rgba | null, width = 1): VectorStyle {
  return { stroke, fill, width, antialias: true, cap: "round", join: "round", miter: 10 };
}
