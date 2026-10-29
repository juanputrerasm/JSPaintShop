/*
  The file formats JSPaintShop opens and saves, as the Open and Save As dialogs list them,
  and how a file is recognised: by its first bytes, then by its extension.

  PSP 6 reads and writes some 40 formats (jff.dll). This list grows as they are ported; see
  docs/PARITY.md for the rest.
*/
import { isBmp } from "./bmp.ts";
import { isGif } from "./gif.ts";
import { isJpeg, isPng } from "./info.ts";
import { isPsp } from "./psp.ts";
import { isTiff } from "./tiff.ts";
import { isPsd } from "./psd.ts";
import { isClp, isIco, isIff, isMsp, isWpg } from "./legacy.ts";
import { isPict } from "./pict.ts";
import { isDcx, isPcx, isPnm, isRas, looksLikeTga } from "./more.ts";
import { isSct } from "./scitex.ts";
import { isPcPaint } from "./pcpaint.ts";

export type FormatId = "psp" | "png" | "jpeg" | "gif" | "bmp" | "tga" | "pcx" | "dcx" | "pnm" | "ras" | "tiff" | "psd" | "iff" | "mac" | "msp" | "img" | "cut" | "clp" | "ico" | "pict" | "wpg" | "sct" | "pic" | "raw";

export interface FileFormat {
  id: FormatId;
  /** As the file type list names it. */
  name: string;
  extensions: string[];
  mime: string;
  read: boolean;
  write: boolean;
  /** Keeps layers when saved. */
  layers: boolean;
}

export const FORMATS: FileFormat[] = [
  { id: "psp", name: "JSPaintShop Image", extensions: [".psp", ".tub", ".pfr"], mime: "application/x-paintshoppro", read: true, write: true, layers: true },
  { id: "bmp", name: "Windows or OS/2 Bitmap", extensions: [".bmp", ".dib", ".rle"], mime: "image/bmp", read: true, write: true, layers: false },
  { id: "gif", name: "CompuServe Graphics Interchange", extensions: [".gif"], mime: "image/gif", read: true, write: true, layers: false },
  { id: "jpeg", name: "JPEG - JFIF Compliant", extensions: [".jpg", ".jpeg", ".jif", ".jpe"], mime: "image/jpeg", read: true, write: true, layers: false },
  { id: "png", name: "Portable Network Graphics", extensions: [".png"], mime: "image/png", read: true, write: true, layers: false },
  { id: "psd", name: "Photoshop", extensions: [".psd"], mime: "image/vnd.adobe.photoshop", read: true, write: true, layers: true },
  { id: "iff", name: "Amiga IFF / Deluxe Paint LBM", extensions: [".iff", ".lbm"], mime: "image/x-iff", read: true, write: true, layers: false },
  { id: "mac", name: "MacPaint", extensions: [".mac"], mime: "image/x-macpaint", read: true, write: true, layers: false },
  { id: "msp", name: "Microsoft Paint", extensions: [".msp"], mime: "image/x-msp", read: true, write: true, layers: false },
  { id: "img", name: "GEM Paint", extensions: [".img"], mime: "image/x-gem", read: true, write: true, layers: false },
  { id: "cut", name: "Dr. Halo", extensions: [".cut"], mime: "image/x-halo-cut", read: true, write: true, layers: false },
  { id: "clp", name: "Windows Clipboard", extensions: [".clp"], mime: "application/x-clipboard", read: true, write: true, layers: false },
  { id: "pict", name: "Macintosh PICT", extensions: [".pct", ".pict"], mime: "image/x-pict", read: true, write: true, layers: false },
  { id: "pic", name: "PC Paint", extensions: [".pic"], mime: "image/x-pcpaint", read: true, write: true, layers: false },
  { id: "sct", name: "Scitex Continuous Tone", extensions: [".sct", ".ct"], mime: "image/x-scitex", read: true, write: true, layers: false },
  { id: "raw", name: "Raw File Format", extensions: [".raw"], mime: "application/x-raw-image", read: true, write: true, layers: false },
  { id: "wpg", name: "WordPerfect Bitmap", extensions: [".wpg"], mime: "image/x-wpg", read: true, write: true, layers: false },
  { id: "ico", name: "Windows Icon / Cursor", extensions: [".ico", ".cur"], mime: "image/x-icon", read: true, write: false, layers: false },
  { id: "tiff", name: "Tagged Image File Format", extensions: [".tif", ".tiff"], mime: "image/tiff", read: true, write: true, layers: false },
  { id: "tga", name: "Truevision Targa", extensions: [".tga"], mime: "image/x-tga", read: true, write: true, layers: false },
  { id: "pcx", name: "Zsoft Paintbrush", extensions: [".pcx"], mime: "image/x-pcx", read: true, write: true, layers: false },
  { id: "dcx", name: "Zsoft Multipage Paintbrush", extensions: [".dcx"], mime: "image/x-dcx", read: true, write: false, layers: false },
  { id: "pnm", name: "Portable Bitmap / Greymap / Pixelmap", extensions: [".ppm", ".pgm", ".pbm", ".pnm"], mime: "image/x-portable-anymap", read: true, write: true, layers: false },
  { id: "ras", name: "Sun Raster Image", extensions: [".ras", ".sun"], mime: "image/x-sun-raster", read: true, write: true, layers: false },
];

export function formatById(id: FormatId): FileFormat {
  return FORMATS.find((f) => f.id === id)!;
}

export function formatByName(name: string): FileFormat | null {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
  return FORMATS.find((f) => f.extensions.includes(ext)) ?? null;
}

/** The format of a file from its first bytes; Targa, which has no signature, by its name. */
export function detectFormat(bytes: Uint8Array, name = ""): FileFormat | null {
  if (isPsp(bytes)) return formatById("psp");
  if (isPng(bytes)) return formatById("png");
  if (isJpeg(bytes)) return formatById("jpeg");
  if (isGif(bytes)) return formatById("gif");
  if (isBmp(bytes)) return formatById("bmp");
  if (isTiff(bytes)) return formatById("tiff");
  if (isPsd(bytes)) return formatById("psd");
  if (isIff(bytes)) return formatById("iff");
  if (isMsp(bytes)) return formatById("msp");
  if (isClp(bytes)) return formatById("clp");
  if (isWpg(bytes)) return formatById("wpg");
  if (isSct(bytes)) return formatById("sct");
  // RAW has no signature: by its extension only, before any guess from the bytes.
  if (/\.raw$/i.test(name)) return formatById("raw");
  if (/\.pic$/i.test(name) && isPcPaint(bytes)) return formatById("pic");
  if (/\.(pct|pict|pic)$/i.test(name) && isPict(bytes)) return formatById("pict");
  if (isIco(bytes) && /\.(ico|cur)$/i.test(name)) return formatById("ico");
  // No signature: by extension.
  const byExt = formatByName(name);
  if (byExt && ["mac", "img", "cut"].includes(byExt.id)) return byExt;
  if (isDcx(bytes)) return formatById("dcx");
  if (isRas(bytes)) return formatById("ras");
  if (isPnm(bytes)) return formatById("pnm");
  if (isPcx(bytes)) return formatById("pcx");
  if (looksLikeTga(bytes, name)) return formatById("tga");
  return null;
}
