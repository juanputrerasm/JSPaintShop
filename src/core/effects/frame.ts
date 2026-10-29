/*
  Image > Picture Frame (Psp.exe 0x6aa580, "PictureFrameWiz.cpp"; docs/PSP_EXE_ANALYSIS.md
  section 10). A frame is a PSP file (.pfr) whose middle is transparent. Inside the image, the
  frame is stretched over the whole canvas. Outside it, the frame is scaled by
  s = imageHeight / holeHeight, the canvas grows by its scaled borders (left trunc(l·s), right
  trunc(r·s), top trunc(t·s) − 1, bottom trunc(b·s) − 1, the width two pixels less), and the
  frame is stretched over the new canvas. The frame goes on a new layer at the top.

  The hole (Psp.exe 0x6aa580 with 0x81dfb0, 0x81c880 and 0x81c400): the frame's transparency is
  thresholded (above t opaque, else clear; t = 1, or 0 once an edge color has filled the outer
  parts), then two boxes are taken, right and bottom exclusive: the clear pixels' and the
  opaque pixels'. The hole is the clear box unless the opaque one is narrower or shorter, in
  which case the two swap; the other box is the frame's extent. The hole moves up one row
  before the borders are measured:
    left = hole.left, right = extent.right − hole.right,
    top = hole.top − 1, bottom = extent.bottom − hole.bottom + 1,
    s = imageHeight / holeHeight (32-bit floats).
  A frame with alpha channels (Round Wood) gives its shape in the last one (0x6aa580 reads the
  channel count and fetches channel count − 1): outside that shape the frame counts as opaque
  (0x818740 paints 255 there), and the threshold is 0. Without channels, t = 1.
  Before the frame is stretched, the color under every pixel that is not fully opaque becomes
  white (0x818740), so soft edges blend toward white as in PSP. The edge color the wizard
  offers fills the parts outside the shape.
*/
import { createRaster, type Mask, type Raster } from "../image/raster.ts";
import { resample } from "../image/resample.ts";

export interface Hole { minX: number; minY: number; maxX: number; maxY: number }
interface Box { left: number; top: number; right: number; bottom: number }

/* The box of the pixels `inside` picks, right and bottom exclusive; null when there are none. */
function box(frame: Raster, inside: (alpha: number) => boolean): Box | null {
  const { width: W, height: H, data: d } = frame;
  let left = W, top = H, right = -1, bottom = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inside(d[(y * W + x) * 4 + 3])) continue;
    if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
  }
  return right < 0 ? null : { left, top, right: right + 1, bottom: bottom + 1 };
}

/* PSP's hole and extent boxes for the threshold t. */
function holeBoxes(frame: Raster, t: number): { hole: Box; extent: Box } | null {
  const clear = box(frame, (a) => a <= t), opaque = box(frame, (a) => a > t);
  if (!clear) return null;
  const ext = opaque ?? { left: 0, top: 0, right: frame.width, bottom: frame.height };
  if (ext.right - ext.left < clear.right - clear.left || ext.bottom - ext.top < clear.bottom - clear.top) return { hole: ext, extent: clear };
  return { hole: clear, extent: ext };
}

/** The frame's hole (inclusive bounds), as PSP finds it with threshold `t`. */
export function frameHole(frame: Raster, t = 1): Hole | null {
  const b = holeBoxes(frame, t);
  return b && { minX: b.hole.left, minY: b.hole.top, maxX: b.hole.right - 1, maxY: b.hole.bottom - 1 };
}

/* The transparent area connected to the frame's center, used to keep the hole when an edge color fills the rest. */
function centerRegion(frame: Raster): Hole | null {

  const { width: W, height: H, data: d } = frame;
  const cx = W >> 1, cy = H >> 1;
  if (d[(cy * W + cx) * 4 + 3] !== 0) return null;
  const seen = new Uint8Array(W * H), stack = [cy * W + cx];
  seen[cy * W + cx] = 1;
  const h = { minX: cx, minY: cy, maxX: cx, maxY: cy };
  while (stack.length) {
    const i = stack.pop()!, x = i % W, y = (i - x) / W;
    if (x < h.minX) h.minX = x; if (x > h.maxX) h.maxX = x; if (y < h.minY) h.minY = y; if (y > h.maxY) h.maxY = y;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (!seen[j] && d[j * 4 + 3] === 0) { seen[j] = 1; stack.push(j); }
    }
  }
  return h;
}

export interface FramePlacement { width: number; height: number; dx: number; dy: number; frame: Raster }

/** Where the image and the stretched frame go. `shape` is the frame's last alpha channel, `edge` fills outside it. */
export function placeFrame(frame: Raster, imageW: number, imageH: number, outside: boolean, edge: readonly [number, number, number] | null, shape: Mask | null = null): FramePlacement {
  let width = imageW, height = imageH, dx = 0, dy = 0;
  const art = createRaster(frame.width, frame.height);
  art.data.set(frame.data);
  const d = art.data, W = art.width, n = W * art.height;
  // Without a shape channel, an edge color fills the transparent parts outside the center's hole.
  const center = !shape && edge ? centerRegion(frame) : null;
  const outsideShape = (i: number) => shape ? shape.data[i] === 0 : Boolean(edge) && !(center && inBox(center, i % W, Math.trunc(i / W)));
  // The mask the hole is measured on: opaque outside the shape.
  const measured = createRaster(W, art.height);
  for (let i = 0; i < n; i++) {
    const o = i * 4, a = d[o + 3], out = outsideShape(i);
    measured.data[o + 3] = out ? 255 : a;
    if (a === 255) continue;
    if (out && edge) {
      const k = a / 255;
      for (let c = 0; c < 3; c++) d[o + c] = Math.round(d[o + c] * k + edge[c] * (1 - k));
      d[o + 3] = 255;
      continue;
    }
    // 0x818740: white under every pixel that is not fully opaque.
    d[o] = d[o + 1] = d[o + 2] = 255;
  }
  const boxes = holeBoxes(measured, shape || edge ? 0 : 1);
  if (outside && boxes) {
    const { hole, extent } = boxes;
    const top = hole.top - 1, bottom = hole.bottom - 1;
    const s = Math.fround(Math.fround(imageH) / Math.fround(hole.bottom - hole.top));
    const l = Math.trunc(hole.left * s), r = Math.trunc((extent.right - hole.right) * s);
    const t = Math.trunc(top * s) - 1, b = Math.trunc((extent.bottom - bottom) * s) - 1;
    width = imageW + l + r - 2; height = imageH + t + b;
    dx = Math.max(0, l - 1); dy = Math.max(0, t);
  }
  width = Math.max(1, width); height = Math.max(1, height);
  return { width, height, dx, dy, frame: resample(art, width, height, "smart") };
}

function inBox(h: Hole, x: number, y: number): boolean {
  return x >= h.minX && x <= h.maxX && y >= h.minY && y <= h.maxY;
}
