/*
  File > Export > Transparent GIF (the Transparent GIF Wizard, "GifWiz.cpp"): the merged image
  made ready for GIF from the wizard's answers.

  transparency  "none": every pixel opaque; "color": pixels matching the color become
                transparent; "existing": pixels under 50% opacity stay transparent
  background    what partly transparent pixels are blended with (page 3004, the web page's
                background)
  webSafe       restrict the colors to the 216-color web-safe palette (page 150)
  colors        the color count, from the quality slider's table (page 27020, 0x922b9c:
                256, 181, 128, 91, 64, 45, 32, 23, 16 for positions 0..8)
*/
import type { Raster, Rgba } from "../image/raster.ts";
import { medianCut, toPalette, type Indexed } from "../color/quantize.ts";
import { webSafePalette } from "../color/reduce.ts";

export const GIF_WIZARD_COLORS = [256, 181, 128, 91, 64, 45, 32, 23, 16];

export interface GifExportOptions {
  transparency: "none" | "color" | "existing";
  color: Rgba;
  background: Rgba;
  webSafe: boolean;
  colors: number;
}

/** The pixels as the GIF will show them (transparent ones clear) and their indexes. */
export function prepareGif(src: Raster, o: GifExportOptions): { raster: Raster; indexed: Indexed } {
  const n = src.width * src.height, s = src.data;
  const out: Raster = { width: src.width, height: src.height, data: new Uint8ClampedArray(n * 4) };
  const d = out.data, bg = o.background;
  for (let i = 0; i < n * 4; i += 4) {
    const a = s[i + 3];
    let clear = false;
    if (o.transparency === "existing" && a < 128) clear = true;
    // Blend what is partly covered over the page background.
    d[i] = Math.round((s[i] * a + bg[0] * (255 - a)) / 255);
    d[i + 1] = Math.round((s[i + 1] * a + bg[1] * (255 - a)) / 255);
    d[i + 2] = Math.round((s[i + 2] * a + bg[2] * (255 - a)) / 255);
    if (o.transparency === "color" && s[i] === o.color[0] && s[i + 1] === o.color[1] && s[i + 2] === o.color[2] && a > 0) clear = true;
    d[i + 3] = clear ? 0 : 255;
  }
  const hasClear = o.transparency !== "none" && d.some((v, i) => (i & 3) === 3 && v === 0);
  let indexed: Indexed;
  if (o.webSafe) {
    const pal = webSafePalette();
    const opaque = { ...out, data: new Uint8ClampedArray(d) };
    for (let i = 3; i < opaque.data.length; i += 4) opaque.data[i] = 255;
    const mapped = toPalette(opaque, pal);
    if (hasClear) {
      // One more entry for the transparent pixels.
      const palette = new Uint8Array(pal.length + 3);
      palette.set(pal);
      const clearIndex = pal.length / 3;
      for (let p = 0; p < n; p++) if (d[p * 4 + 3] === 0) mapped.indices[p] = clearIndex;
      indexed = { indices: mapped.indices, palette, bits: 8, transparent: clearIndex };
    } else indexed = mapped;
  } else indexed = medianCut(out, Math.max(2, Math.min(256, o.colors)), hasClear);
  // What the GIF will look like: every opaque pixel on its palette color.
  for (let p = 0; p < n; p++) {
    if (d[p * 4 + 3] === 0) continue;
    const k = indexed.indices[p];
    d[p * 4] = indexed.palette[k * 3]; d[p * 4 + 1] = indexed.palette[k * 3 + 1]; d[p * 4 + 2] = indexed.palette[k * 3 + 2];
  }
  return { raster: out, indexed };
}
