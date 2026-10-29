/*
  Opening and saving files, in the worker: the bytes in, an image out, and back.

  BMP, GIF and PSP are decoded here in core/formats. PNG and JPEG go through the browser's own
  decoder and encoder (createImageBitmap, OffscreenCanvas), with no color conversion, and their
  headers are read for the color depth and resolution the browser does not report.
*/
import { transfer } from "../shared/worker-host.ts";
import { decodeBmp, encodeBmp, type DecodedImage } from "../core/formats/bmp.ts";
import { decodeGif, encodeGif } from "../core/formats/gif.ts";
import { readPsp } from "../core/formats/psp.ts";
import { inflate, deflate } from "../core/formats/zlib.ts";
import { decodeTiff, encodeTiff } from "../core/formats/tiff.ts";
import { readPsd, writePsd } from "../core/formats/psd.ts";
import { decodePict, decodeQuickTimeRaw, pictEmbedded } from "../core/formats/pict.ts";
import { decodeClp, decodeCut, decodeGemImg, decodeIco, decodeIff, decodeMacPaint, decodeMsp, decodeWpg } from "../core/formats/legacy.ts";
import { writePsp } from "../core/formats/psp-write.ts";
import { decodeRaw, encodeRaw, rawSizeGuesses, RAW_READ_DEFAULTS, RAW_WRITE_DEFAULTS, type RawReadOptions, type RawWriteOptions } from "../core/formats/raw.ts";
import { decodeSct, encodeSct } from "../core/formats/scitex.ts";
import { decodePcPaint, encodePcPaint } from "../core/formats/pcpaint.ts";
import { decodeDcx, decodePcx, decodePnm, decodeRas, decodeTga, encodePcx, encodePnm, encodeTga } from "../core/formats/more.ts";
import { jpegInfo, pngInfo, setJpegDpi, setPngDpi } from "../core/formats/info.ts";
import { detectFormat, formatById, type FormatId } from "../core/formats/formats.ts";
import { emptyCreator, imageBuffers, rasterLayer, type ImageDoc } from "../core/doc/image-doc.ts";
import { composite } from "../core/layers/composite.ts";
import { medianCut, toPalette } from "../core/color/quantize.ts";
import type { Raster } from "../core/image/raster.ts";
import { encodeClp, encodeCut, encodeGemImg, encodeIff, encodeMacPaint, encodeMsp, encodePict, encodeRas, encodeWpg, SaveError } from "../core/formats/legacy-write.ts";

export interface ReadResult { doc: ImageDoc; format: FormatId; warnings: string[] }

function fromDecoded(img: DecodedImage): ImageDoc {
  // PSP keeps a paletted image opaque and marks the transparent entry instead (Set Palette Transparency).
  const t = img.transparent;
  if (t !== undefined && img.palette && img.depth <= 8) {
    const d = img.raster.data, p = img.palette;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 0) { d[i] = p[t * 3]; d[i + 1] = p[t * 3 + 1]; d[i + 2] = p[t * 3 + 2]; d[i + 3] = 255; }
  }
  const transparent = img.raster.data.some((v, i) => (i & 3) === 3 && v !== 255);
  return {
    ...(t !== undefined && img.depth <= 8 ? { transparentIndex: t } : {}),
    ...(img.indices && img.depth <= 8 ? { indices: img.indices } : {}),
    width: img.raster.width, height: img.raster.height, dpi: img.dpi || 72,
    depth: img.depth, greyscale: img.greyscale, palette: img.depth <= 8 ? img.palette : null,
    layers: [rasterLayer(transparent ? "Layer1" : "Background", img.raster)], active: 0, creator: emptyCreator(), selection: null, alphas: [],
  };
}

async function browserDecode(bytes: Uint8Array, mime: string): Promise<Raster> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = canvas.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(bitmap, 0, 0);
    return { width: bitmap.width, height: bitmap.height, data: g.getImageData(0, 0, bitmap.width, bitmap.height).data };
  } finally {
    bitmap.close();
  }
}

/** How to read a RAW file; without it, the first size guess as greys. */
export interface ReadOptions {
  raw?: RawReadOptions;
  /** RAW without options (thumbnails, batch): the palette for the guessed single-channel size. */
  rawPalette?: Uint8Array;
  /** A Dr. Halo .CUT's colors, from the .PAL beside it. */
  palette?: Uint8Array;
}

export function defaultRawOptions(byteLength: number): RawReadOptions {
  const g = rawSizeGuesses(byteLength)[0];
  return g ? { ...RAW_READ_DEFAULTS, width: g.width, height: g.height, channels: g.channels } : { ...RAW_READ_DEFAULTS };
}

export async function readFile(bytes: Uint8Array, name: string, options: ReadOptions = {}): Promise<ReadResult> {
  const format = detectFormat(bytes, name);
  if (!format) throw new Error(`"${name}" is not in a format JSPaintShop can open yet.`);
  let doc: ImageDoc, warnings: string[] = [];
  switch (format.id) {
    case "psp": ({ doc, warnings } = await readPsp(bytes, inflate)); break;
    case "bmp": doc = fromDecoded(decodeBmp(bytes)); break;
    case "gif": doc = fromDecoded(decodeGif(bytes)); break;
    case "tga": doc = fromDecoded(decodeTga(bytes)); break;
    case "pcx": doc = fromDecoded(decodePcx(bytes)); break;
    case "dcx": doc = fromDecoded(decodeDcx(bytes)); break;
    case "pnm": doc = fromDecoded(decodePnm(bytes)); break;
    case "ras": doc = fromDecoded(decodeRas(bytes)); break;
    case "tiff": doc = fromDecoded(await decodeTiff(bytes, inflate)); break;
    case "psd": ({ doc, warnings } = await readPsd(bytes, inflate)); break;
    case "iff": doc = fromDecoded(decodeIff(bytes)); break;
    case "mac": doc = fromDecoded(decodeMacPaint(bytes)); break;
    case "msp": doc = fromDecoded(decodeMsp(bytes)); break;
    case "img": doc = fromDecoded(decodeGemImg(bytes)); break;
    case "cut":
      doc = fromDecoded(decodeCut(bytes, options.palette));
      if (!options.palette) warnings = ["Dr. Halo keeps the palette in a separate .PAL file; the image opens in greys. Choose the .pal together with the .cut to open it in color."];
      break;
    case "clp": doc = fromDecoded(decodeClp(bytes)); break;
    case "ico": doc = fromDecoded(decodeIco(bytes)); break;
    case "wpg": doc = fromDecoded(decodeWpg(bytes)); break;
    case "sct": doc = fromDecoded(decodeSct(bytes)); break;
    case "pic": doc = fromDecoded(decodePcPaint(bytes)); break;
    case "raw": doc = fromDecoded(decodeRaw(bytes, options.raw ?? { ...defaultRawOptions(bytes.length), palette: options.rawPalette ?? null })); break;
    case "pict": {
      // A QuickTime-compressed picture is a JPEG, PNG or TIFF inside: open that.
      const inner = pictEmbedded(bytes);
      if (inner?.type === "raw") doc = fromDecoded(decodeQuickTimeRaw(inner));
      else if (inner) { const r = await readFile(inner.bytes.slice(), `embedded.${inner.type === "jpeg" ? "jpg" : inner.type}`); doc = r.doc; warnings = r.warnings; }
      else doc = fromDecoded(decodePict(bytes));
      break;
    }
    case "png":
    case "jpeg": {
      const info = format.id === "png" ? pngInfo(bytes) : jpegInfo(bytes);
      const raster = await browserDecode(bytes, format.mime);
      doc = fromDecoded({ raster, depth: info.depth, greyscale: info.greyscale, palette: null, dpi: info.dpi });
      // The browser hands back colors, not indexes: a paletted PNG keeps its colors as its palette.
      if (info.depth <= 8) doc.palette = medianCut(raster, 1 << info.depth, false).palette;
      break;
    }
  }
  return { doc, format: format.id, warnings };
}

export interface WriteOptions {
  doc: ImageDoc;
  format: FormatId;
  /** JPEG quality, 1..100. */
  quality?: number;
  /** RAW: the RAW save options (DIALOG 468). */
  raw?: RawWriteOptions;
  /** The file's name (Scitex CT keeps it in its header). */
  name?: string;
}

/** Over a background color, for formats with no transparency. */
function flatten(r: Raster, bg: [number, number, number]): Raster {
  const d = new Uint8ClampedArray(r.data);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    d[i] = d[i] * a + bg[0] * (1 - a); d[i + 1] = d[i + 1] * a + bg[1] * (1 - a); d[i + 2] = d[i + 2] * a + bg[2] * (1 - a); d[i + 3] = 255;
  }
  return { width: r.width, height: r.height, data: d };
}

async function browserEncode(r: Raster, mime: string, quality?: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(r.width, r.height);
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
  const blob = await canvas.convertToBlob({ type: mime, quality: quality === undefined ? undefined : quality / 100 });
  return new Uint8Array(await blob.arrayBuffer());
}

export async function writeFile({ doc, format, quality, raw, name }: WriteOptions): Promise<Uint8Array> {
  const flat = composite(doc);
  const indexed = (r: Raster) => toPalette(r, doc.palette!, doc.indices);
  switch (format) {
    case "bmp": {
      const opaque = flatten(flat, [255, 255, 255]);
      if (doc.depth <= 8 && doc.palette) return encodeBmp(opaque, doc.dpi, indexed(opaque));
      return encodeBmp(opaque, doc.dpi);
    }
    case "gif": {
      if (doc.depth <= 8 && doc.palette) {
        return encodeGif(flat, indexed(flatten(flat, [255, 255, 255])), doc.transparentIndex ?? -1);
      }
      const reduced = medianCut(flat, 256, true);
      return encodeGif(flat, reduced, reduced.transparent);
    }
    case "psp": return writePsp(doc, deflate);
    case "tiff": return encodeTiff(flat, doc.dpi);
    case "psd": return writePsd(doc, flat);
    case "tga": return encodeTga(flat, flat.data.some((v, i) => (i & 3) === 3 && v < 255));
    case "pcx": {
      const opaque = flatten(flat, [255, 255, 255]);
      return doc.depth <= 8 && doc.palette ? encodePcx(opaque, doc.dpi, indexed(opaque)) : encodePcx(opaque, doc.dpi);
    }
    case "raw": {
      // PSP: 8-bit images as a palette index a pixel, the others as 24-bit.
      const opaque = flatten(flat, [255, 255, 255]);
      return encodeRaw(opaque, raw ?? RAW_WRITE_DEFAULTS, doc.depth <= 8 && doc.palette ? indexed(opaque).indices : null);
    }
    case "pic": {
      if (doc.depth > 8 || !doc.palette) throw new Error("PC Paint saves images of 256 colors or fewer. Use Colors > Decrease Color Depth first.");
      const opaque = flatten(flat, [255, 255, 255]);
      const depth = doc.depth === 1 ? 1 : doc.depth === 4 ? 4 : 8;
      return encodePcPaint(indexed(opaque).indices, opaque.width, opaque.height, doc.palette, depth);
    }
    case "mac": case "msp": case "img": case "cut": case "wpg": {
      // Paletted formats: each pixel's palette index.
      const opaque = flatten(flat, [255, 255, 255]);
      const fmtName = formatById(format).name;
      if (doc.depth > 8 || !doc.palette) throw new SaveError(`${fmtName} saves images of 256 colors or fewer. Use Colors > Decrease Color Depth first.`);
      const p = { ...indexed(opaque), bits: (doc.depth === 1 ? 1 : doc.depth === 4 ? 4 : 8) as 1 | 4 | 8 }, w = opaque.width, h = opaque.height;
      if (format === "mac") return encodeMacPaint(p, w, h);
      if (format === "msp") return encodeMsp(p, w, h);
      if (format === "img") return encodeGemImg(p, w, h);
      if (format === "cut") return encodeCut(p, w, h);
      return encodeWpg(p, w, h, doc.dpi);
    }
    case "ras": case "clp": case "iff": case "pict": {
      const opaque = flatten(flat, [255, 255, 255]);
      const p = doc.depth <= 8 && doc.palette ? { ...indexed(opaque), bits: (doc.depth === 1 ? 1 : doc.depth === 4 ? 4 : 8) as 1 | 4 | 8 } : null;
      if (format === "ras") return encodeRas(opaque, p);
      if (format === "clp") return encodeClp(opaque, p, doc.dpi);
      if (format === "iff") return encodeIff(opaque, p);
      return encodePict(opaque, p);
    }
    case "sct": return encodeSct(flatten(flat, [255, 255, 255]), doc.dpi, (name ?? "").replace(/\.[^.]*$/, ""));
    case "pnm": return encodePnm(flatten(flat, [255, 255, 255]), doc.greyscale);
    case "png": {
      // A paletted image's transparent entry is saved clear.
      const t = doc.transparentIndex, p = doc.palette;
      if (t !== undefined && p && doc.depth <= 8) for (let i = 0; i < flat.data.length; i += 4) if (flat.data[i] === p[t * 3] && flat.data[i + 1] === p[t * 3 + 1] && flat.data[i + 2] === p[t * 3 + 2]) flat.data[i + 3] = 0;
      return setPngDpi(await browserEncode(flat, "image/png"), doc.dpi);
    }
    case "jpeg": return setJpegDpi(await browserEncode(flatten(flat, [255, 255, 255]), "image/jpeg", quality ?? 85), doc.dpi);
    default: throw new Error(`${formatById(format).name} files cannot be saved yet.`);
  }
}

export const fileHandlers = {
  "file.read": async ({ bytes, name, options }: { bytes: Uint8Array; name: string; options?: ReadOptions }) => {
    const result = await readFile(bytes, name, options);
    return transfer(result, imageBuffers(result.doc));
  },
  "file.write": async (options: WriteOptions) => {
    const bytes = await writeFile(options);
    return transfer(bytes, [bytes.buffer as ArrayBuffer]);
  },
};
