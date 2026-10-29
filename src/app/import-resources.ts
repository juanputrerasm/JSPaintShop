/*
  File > Import (added: PSP has no such command; it replaces PSP's TWAIN and camera Import
  menu). One entry per library JSPaintShop reads, each copying the chosen files, typically from
  the user's own PSP 6 folders, into JSPaintShop's storage (OPFS). Nothing is uploaded anywhere.

    Picture Tubes          .tub    the Picture Tube tool
    Picture Frames         .pfr    Image > Picture Frame
    Gradients              .jgd    the gradient lists and the Gradient Editor
    Patterns               .pat    pattern fills (BMP files; other images work too)
    Textures               .tex    paper textures, Texture and Sculpture (greyscale BMP)
    User Defined Filters   .flt    Image > User Defined Filter (stored as pspud.flt)
*/
import type { Resources, ResourceKind } from "./resources.ts";
import { alertDialog } from "../ui/shell/dialog.ts";
import { pickFilesOf } from "../ui/shell/file-dialogs.ts";
import { readFlt } from "../core/formats/flt.ts";

const IMAGES = [".bmp", ".png", ".jpg", ".jpeg", ".gif", ".tga", ".pcx", ".tif", ".tiff", ".psp"];

export interface ImportKind { label: string; kind: ResourceKind; what: string; exts: string[] }

export const IMPORTS: ImportKind[] = [
  { label: "Picture Tubes...", kind: "tubes", what: "picture tubes", exts: [".tub"] },
  { label: "Picture Frames...", kind: "frames", what: "picture frames", exts: [".pfr"] },
  { label: "Gradients...", kind: "gradients", what: "gradients", exts: [".jgd"] },
  { label: "Patterns...", kind: "patterns", what: "patterns", exts: [".pat", ...IMAGES] },
  { label: "Textures...", kind: "textures", what: "textures", exts: [".tex", ...IMAGES] },
  { label: "User Defined Filters...", kind: "filters", what: "user defined filters", exts: [".flt"] },
];

export async function importResources(res: Resources, k: ImportKind): Promise<void> {
  const files = await pickFilesOf(`${k.what[0].toUpperCase()}${k.what.slice(1)} (${k.exts.slice(0, 2).map((e) => `*${e}`).join(";")})`, k.exts);
  if (!files.length) return;
  let count = 0;
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (k.kind === "filters") {
      // One filter file, as PSP keeps pspud.flt; check it reads before it replaces the current one.
      try { readFlt(bytes); } catch { await alertDialog("Import", `${file.name} is not a user defined filter file.`); continue; }
      await res.write("filters", "pspud.flt", bytes);
    } else {
      await res.write(k.kind, file.name, bytes);
    }
    count++;
  }
  await res.load();
  res.emit("changed", k.kind);
  if (count) await alertDialog("Import", `Imported ${count} ${count === 1 ? k.what.replace(/s$/, "") : k.what}.`);
}
