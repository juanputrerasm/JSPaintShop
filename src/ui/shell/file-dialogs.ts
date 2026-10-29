/*
  The Open and Save As dialogs, through the browser. Where it has the File System Access API
  (Chromium), files open and save in place, like PSP's own dialogs, and Save writes back to
  the same file. Elsewhere Open takes a file from the browser's chooser and Save As downloads
  the image, after asking its name and type in a dialog of our own.
*/
import { el } from "../../shared/dom.ts";
import { openDialog } from "./dialog.ts";
import { FORMATS, formatByName, type FileFormat, type FormatId } from "../../core/formats/formats.ts";

interface PickerType { description: string; accept: Record<string, string[]> }
type Win = Window & {
  showOpenFilePicker?: (o: { multiple?: boolean; types?: PickerType[]; excludeAcceptAllOption?: boolean; id?: string }) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (o: { suggestedName?: string; types?: PickerType[]; id?: string }) => Promise<FileSystemFileHandle>;
};

export const hasFileAccess = () => typeof (window as Win).showSaveFilePicker === "function";

export interface PickedFile { file: File; handle: FileSystemFileHandle | null }

function pickerType(f: FileFormat): PickerType {
  return { description: `${f.name} (${f.extensions.map((e) => `*${e}`).join(";")})`, accept: { [f.mime]: f.extensions } };
}

const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

/** File > Open: the files chosen, possibly none. */
export async function pickOpenFiles(): Promise<PickedFile[]> {
  const readable = FORMATS.filter((f) => f.read);
  const w = window as Win;
  if (w.showOpenFilePicker) {
    try {
      // RAW palettes (.act, .pal) can be chosen with a .raw file.
      const palettes: PickerType = { description: "RAW palettes (*.act;*.pal)", accept: { "application/x-palette": [".act", ".pal"] } };
      const all: PickerType = { description: "All supported images", accept: Object.assign({}, ...readable.map((f) => ({ [f.mime]: f.extensions })), palettes.accept) };
      const handles = await w.showOpenFilePicker({ multiple: true, id: "open", types: [all, ...readable.map(pickerType), palettes] });
      return Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })));
    } catch (err) {
      if (isAbort(err)) return [];
      throw err;
    }
  }
  return new Promise((resolve) => {
    const input = el("input", { type: "file", multiple: true, accept: [...readable.flatMap((f) => f.extensions), ".act", ".pal"].join(",") });
    input.addEventListener("change", () => resolve([...(input.files ?? [])].map((file) => ({ file, handle: null }))));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

export interface SaveTarget { name: string; format: FormatId; handle: FileSystemFileHandle | null }

/** File > Save As: where and as what, or null when cancelled. `current` is listed first. */
export async function pickSaveTarget(suggested: string, current: FormatId): Promise<SaveTarget | null> {
  const writable = FORMATS.filter((f) => f.write);
  const first = writable.find((f) => f.id === current) ?? writable.find((f) => f.id === "png")!;
  const ordered = [first, ...writable.filter((f) => f !== first)];
  const base = suggested.replace(/\.[^.]*$/, "");
  const w = window as Win;
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: `${base}${first.extensions[0]}`, id: "save", types: ordered.map(pickerType) });
      const format = formatByName(handle.name);
      if (!format || !format.write) throw new Error(`"${handle.name}" does not end in the extension of a format JSPaintShop can save.`);
      return { name: handle.name, format: format.id, handle };
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }
  const name = el("input", { class: "text-field", value: base });
  const type = el("select", {}, ...ordered.map((f) => el("option", { value: f.id }, `${f.name} (*${f.extensions[0]})`)));
  const v = await openDialog({
    title: "Save As", body: el("div", { class: "save-as" },
      el("label", { class: "form-row" }, el("span", {}, "File name:"), name),
      el("label", { class: "form-row" }, el("span", {}, "Save as type:"), type),
      el("p", { class: "opt-hint" }, "The image is downloaded by the browser.")),
    buttons: [{ label: "Save", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
  });
  if (v !== "ok") return null;
  const format = FORMATS.find((f) => f.id === type.value)!;
  const stem = (name.value.trim() || base).replace(/\.[^.]*$/, "");
  return { name: `${stem}${format.extensions[0]}`, format: format.id, handle: null };
}

/** Write to a handle, or hand the bytes to the browser as a download. */
export async function writeTarget(target: { name: string; handle: FileSystemFileHandle | null }, bytes: Uint8Array, mime: string): Promise<void> {
  if (target.handle) {
    const writable = await target.handle.createWritable();
    await writable.write(bytes as FileSystemWriteChunkType);
    await writable.close();
    return;
  }
  const a = el("a", { href: URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })), download: target.name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Save one file of a given kind (a selection, a mask, a palette...): its name and handle, or null. */
export async function pickSaveFile(suggested: string, description: string, ext: string, mime = "application/octet-stream"): Promise<{ name: string; handle: FileSystemFileHandle | null } | null> {
  const w = window as Win;
  const name = suggested.replace(/\.[^.]*$/, "") + ext;
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: name, types: [{ description, accept: { [mime]: [ext] } }] });
      return { name: handle.name, handle };
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }
  return { name, handle: null };
}

/** Open one file of the given extensions, or null. */
export async function pickOpenFile(description: string, exts: string[]): Promise<PickedFile | null> {
  const w = window as Win;
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({ types: [{ description, accept: { "application/octet-stream": exts } }] });
      return { file: await handle.getFile(), handle };
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }
  return new Promise((resolve) => {
    const input = el("input", { type: "file", accept: exts.join(",") });
    input.addEventListener("change", () => resolve(input.files?.[0] ? { file: input.files[0], handle: null } : null));
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

/** Several files of one kind (File > Import): the files chosen, possibly none. */
export async function pickFilesOf(description: string, exts: string[]): Promise<File[]> {
  const w = window as Win;
  if (w.showOpenFilePicker) {
    try {
      const handles = await w.showOpenFilePicker({ multiple: true, id: `import-${exts[0].slice(1)}`, types: [{ description, accept: { "application/octet-stream": exts } }] });
      return Promise.all(handles.map((h) => h.getFile()));
    } catch (err) {
      if (isAbort(err)) return [];
      throw err;
    }
  }
  return new Promise((resolve) => {
    const input = el("input", { type: "file", multiple: true, accept: exts.join(",") });
    input.addEventListener("change", () => resolve([...(input.files ?? [])]));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}
