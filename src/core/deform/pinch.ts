/*
  Image > Deformations > Pinch, Punch, Cylinder - Horizontal and Cylinder - Vertical: one
  routine (Psp.exe 0x809f30; docs/PSP_EXE_ANALYSIS.md section 9) with an amount per axis
  (100 leaves that axis alone). A built-in table T (201 entries) gives each axis a slope:
  source column c is worth trunc(c·T[px] / (W/2)) + px percent of a target pixel, mirrored past
  the middle, and rows likewise with py. Target pixels take 100 percent each way from
  consecutive source pixels (an area average divided by 10000); the vertical walk of a row
  starts where the previous row's furthest pixel ended.
    Pinch      px = py = 100 + amount
    Punch      px = py = 100 − amount
    Cylinder - Horizontal  py = 100 − trunc(amount·0.95)
    Cylinder - Vertical    px = 100 − trunc(amount·0.95) (assumed the mirror of Horizontal)
*/
import { cloneRaster, type Raster } from "../image/raster.ts";

/* The table PSP builds on the stack (0x809f30). */
export const PINCH_TABLE = [0, 680, 560, 480, 440, 415, 402, 390, 378, 365, 355, 348, 338, 328, 318, 308, 298, 290, 280, 270, 260, 250, 242, 236, 230, 226, 222, 217, 213, 209, 205, 198, 194, 190, 186, 182, 178, 174, 170, 166, 162, 158, 154, 150, 146, 142, 139, 136, 133, 129, 126, 123, 120, 117, 114, 110, 107, 104, 101, 98, 95, 92, 90, 87, 84, 81, 79, 76, 73, 71, 68, 65, 63, 60, 58, 55, 54, 51, 48, 46, 43, 41, 38, 37, 34, 32, 30, 27, 25, 23, 21, 19, 17, 14, 12, 10, 8, 6, 4, 2, 0, -2, -4, -6, -8, -10, -12, -14, -16, -17, -19, -21, -23, -25, -27, -29, -31, -32, -34, -36, -38, -40, -42, -43, -45, -47, -48, -50, -52, -53, -55, -56, -58, -60, -62, -64, -65, -66, -68, -70, -71, -73, -75, -76, -78, -80, -81, -82, -84, -86, -87, -89, -90, -92, -94, -95, -97, -98, -100, -101, -102, -104, -106, -107, -108, -110, -111, -113, -115, -116, -117, -119, -120, -122, -123, -125, -127, -129, -130, -132, -133, -134, -135, -136, -138, -139, -141, -142, -143, -145, -146, -147, -149, -150, -152, -153, -154, -156, -157, -158, -160];

export function pinchCore(src: Raster, px: number, py: number): Raster {
  const { width: W, height: H, data: s } = src;
  const out = cloneRaster(src), d = out.data;
  px = Math.max(0, Math.min(200, Math.trunc(px))); py = Math.max(0, Math.min(200, Math.trunc(py)));
  const hw = Math.trunc(W / 2), hh = Math.trunc(H / 2);
  const tx = PINCH_TABLE[px], ty = PINCH_TABLE[py];
  const sx = Math.fround(tx / Math.max(1, hw)), sy = Math.fround(ty / Math.max(1, hh));
  const colW = (c: number) => { const v = Math.trunc(c * sx) + px; return c < hw ? v : 2 * (tx + px) - v; };
  const rowW = (r: number) => { const v = Math.trunc(r * sy) + py; return r < hh ? v : 2 * (ty + py) - v; };
  // Rows in PSP's order: r = 0 is the bitmap's bottom row.
  const at = (x: number, r: number) => ((H - 1 - r) * W + x) * 4;
  let rowStart = 0, capCarry = py;
  const acc = [0, 0, 0];
  for (let r = 0; r < H; r++) {
    const rw = rowW(r);
    let x = 0, capX = px, furthest = rowStart, capEnd = capCarry;
    for (let c = 0; c < W; c++) {
      const cw = colW(c);
      acc[0] = acc[1] = acc[2] = 0;
      let needX = 100;
      do {
        const wx = Math.min(needX, capX);
        let needY = 100, capY = capCarry, y = rowStart;
        do {
          const p = at(x, y);
          let wy: number;
          if (capY < needY) { wy = capY; needY -= capY; capY = rw; y = Math.min(H - 1, y + 1); }
          else { wy = needY; capY -= needY; needY = 0; }
          const w = wx * wy;
          acc[0] += s[p] * w; acc[1] += s[p + 1] * w; acc[2] += s[p + 2] * w;
        } while (needY > 0);
        if (y > furthest) furthest = y;
        capEnd = capY;
        needX -= wx; capX -= wx;
        if (capX < 1) { x = Math.min(W - 1, x + 1); capX = cw; }
      } while (needX > 0);
      const o = at(c, r);
      d[o] = Math.trunc(acc[0] / 10000); d[o + 1] = Math.trunc(acc[1] / 10000); d[o + 2] = Math.trunc(acc[2] / 10000);
    }
    rowStart = furthest; capCarry = capEnd;
  }
  return out;
}

export const pinch = (src: Raster, amount: number) => pinchCore(src, 100 + Math.trunc(amount), 100 + Math.trunc(amount));
export const punch = (src: Raster, amount: number) => pinchCore(src, 100 - Math.trunc(amount), 100 - Math.trunc(amount));
export const cylinderHorizontal = (src: Raster, amount: number) => pinchCore(src, 100, 100 - Math.trunc(amount * 0.95));
export const cylinderVertical = (src: Raster, amount: number) => pinchCore(src, 100 - Math.trunc(amount * 0.95), 100);
