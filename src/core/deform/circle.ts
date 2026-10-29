/*
  Image > Deformations > Circle (Psp.exe 0x63e800, "LayerImageFunctions.cpp";
  docs/PSP_EXE_ANALYSIS.md section 9). Each row is squeezed into the circle's chord at that
  row and each column into its chord, by an area average in whole percents of a source pixel;
  outside the circle the background color. Radius min(W, H) / 2, chords
  2·trunc(sqrt(r² − min(d², r²))) (at least 1), worked on PSP's bottom-up rows.
*/
import { cloneRaster, type Raster } from "../image/raster.ts";

export function circle(src: Raster, bg: readonly [number, number, number]): Raster {
  const { width: W, height: H, data: s } = src;
  const out = cloneRaster(src), d = out.data;
  const r = Math.trunc(Math.min(W, H) / 2), r2 = r * r;
  const chord = (dd: number) => Math.max(1, 2 * Math.trunc(Math.sqrt(r2 - Math.min(dd * dd, r2))));
  const colChord: number[] = [], colD2: number[] = [];
  for (let i = 0, dx = Math.trunc(W / 2); i < W; i++, dx--) { colChord.push(chord(dx)); colD2.push(dx * dx); }
  const rowChord: number[] = [], rowD2: number[] = [];
  for (let j = 0, dy = Math.trunc(H / 2); j < H; j++, dy--) { rowChord.push(chord(dy)); rowD2.push(dy * dy); }
  const px = (x: number, yb: number, c: number) => s[((H - 1 - yb) * W + x) * 4 + c];
  for (let j = 0; j < H; j++) {
    const cw = rowChord[j], pctX = Math.max(1, Math.trunc((cw * 100) / W));
    const yImg = H - 1 - j;
    for (let i = 0; i < W; i++) {
      const o = (yImg * W + i) * 4;
      if (r2 < colD2[i] + rowD2[j]) { d[o] = bg[0]; d[o + 1] = bg[1]; d[o + 2] = bg[2]; continue; }
      const nx = W * (i - Math.trunc((W - cw) / 2));
      let sx = Math.trunc(nx / cw);
      let fx = Math.trunc(((100 - Math.trunc(((nx % cw) * 100) / cw)) * pctX) / 100);
      const ch = colChord[i], pctY = Math.max(1, Math.trunc((ch * 100) / H));
      const ny = H * (j - Math.trunc((H - ch) / 2));
      const sy = Math.trunc(ny / ch);
      const fy = Math.trunc(((100 - Math.trunc(((ny % ch) * 100) / ch)) * pctY) / 100);
      const acc = [0, 0, 0];
      let remX = 100;
      do {
        const wx = fx >= 1 ? fx : Math.min(remX, pctX);
        fx = 0;
        const xx = sx < 0 ? 0 : sx >= W - 1 ? W - 1 : sx;
        let remY = 100, usedFirst = false, y = sy;
        do {
          let wy: number;
          if (fy < 1 || usedFirst) wy = Math.min(remY, pctY);
          else { usedFirst = true; wy = fy; }
          const yy = y < 0 ? 0 : y > H - 1 ? H - 1 : y;
          remY -= wy;
          for (let c = 0; c < 3; c++) acc[c] += px(xx, yy, c) * wy * wx;
          y++;
        } while (remY > 0);
        remX -= wx;
        sx++;
      } while (remX > 0);
      for (let c = 0; c < 3; c++) d[o + c] = Math.trunc(acc[c] / 10000);
    }
  }
  return out;
}
