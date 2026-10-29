/*
  Zoom as PSP 6 steps it: whole ratios only, from 32:1 (each image pixel 32 screen pixels)
  down to 1:24. A zoom level is a number z: z >= 1 is z:1, z <= -2 is 1:-z. Zoom In By 1 and
  By 5 (View menu) and the Zoom tool move along this ladder: ..., 1:3, 1:2, 1:1, 2:1, 3:1, ...
*/

export const ZOOM_MAX = 32;
export const ZOOM_MIN = -24;

/** Screen pixels per image pixel. */
export function zoomScale(z: number): number {
  return z >= 1 ? z : 1 / -z;
}

/** "2:1", "1:1", "1:3", as the title bar shows it. */
export function zoomLabel(z: number): string {
  return z >= 1 ? `${z}:1` : `1:${-z}`;
}

/** The position of a level on the ladder, so stepping is plain addition. */
function rung(z: number): number {
  return z >= 1 ? z : z + 2;
}

function fromRung(n: number): number {
  return n >= 1 ? n : n - 2;
}

/** `steps` up the ladder (negative: down), clamped to 32:1 and 1:24. */
export function stepZoom(z: number, steps: number): number {
  const n = Math.max(rung(ZOOM_MIN), Math.min(rung(ZOOM_MAX), rung(z) + steps));
  return fromRung(n);
}

/** The largest level that shows the whole image in the given space, never above 1:1. */
export function fitZoom(width: number, height: number, spaceW: number, spaceH: number): number {
  if (width <= spaceW && height <= spaceH) return 1;
  for (let z = -2; z >= ZOOM_MIN; z--) if (width / -z <= spaceW && height / -z <= spaceH) return z;
  return ZOOM_MIN;
}
