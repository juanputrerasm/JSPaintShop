/*
  The File menu's image commands, Edit > Paste > As New Image, and files dropped on the work
  area.

    New            DIALOG 706, then a window on the new image
    Open           one window per file; PSP reports what it could not read
    Close, Revert  Revert reads the file again after asking
    Save           back to the image's file when the browser can, else as Save As
    Save As        a new file and type; the image takes its name
    Save Copy As   a new file; the image keeps its name, file and changes
    Recent File    the last four files opened or saved (File System Access browsers only)

  A layered image saved to a format without layers is merged in the file, as PSP warns.
*/
import type { AppState } from "./state.ts";
import type { Workspace } from "./workspace.ts";
import { ImageDocument } from "./image-document.ts";
import type { WorkerClient } from "../shared/worker-client.ts";
import { CMD, type CommandRegistry } from "../ui/shell/commands.ts";
import type { SlotItem } from "../ui/shell/menu.ts";
import { showNewImage } from "../ui/dialogs/new-image.ts";
import { alertDialog, confirmDialog } from "../ui/shell/dialog.ts";
import { pickOpenFiles, pickSaveFile, pickSaveTarget, writeTarget, type SaveTarget } from "../ui/shell/file-dialogs.ts";
import { encodeHaloPalette } from "../core/formats/legacy-write.ts";
import { canRead, recallHandle, rememberHandle } from "../shared/handle-store.ts";
import { pasteImage } from "../shared/system-clipboard.ts";
import { newImage, rasterLayer, emptyCreator, type ImageDoc } from "../core/doc/image-doc.ts";
import { formatById, formatByName } from "../core/formats/formats.ts";
import { readPaletteFile, showRawOpen, showRawSave, type RawPalette } from "../ui/dialogs/raw-options.ts";
import { nearest } from "../core/color/quantize.ts";
import { RECENT_MAX } from "../core/settings.ts";
import type { ReadOptions, ReadResult } from "../worker/file-handlers.ts";
import type { Rgba } from "../core/image/raster.ts";
import { renderVectorLayer } from "./vector/render-vector.ts";

export interface FileCommands {
  recent(): SlotItem[];
  /** `siblings` finds a file next to the ones opened (the Browse window's folder), for RAW palettes. */
  openFiles(files: { file: File; handle: FileSystemFileHandle | null }[], siblings?: (name: string) => Promise<File | null>): Promise<void>;
}

export function bindFileCommands(app: AppState, registry: CommandRegistry, ws: Workspace, worker: WorkerClient, colors: () => { fg: Rgba; bg: Rgba }): FileCommands {
  const hasImage = () => ws.active !== null;

  const addRecent = (name: string, handle: FileSystemFileHandle | null) => {
    if (!handle) return;
    void rememberHandle(name, handle);
    app.updateSettings((s) => { s.recent = [name, ...s.recent.filter((r) => r !== name)].slice(0, s.prefs.misc.recentCount); });
    app.emit("commands", undefined);
  };

  const read = async (bytes: Uint8Array, name: string, options?: ReadOptions): Promise<ReadResult> =>
    worker.call<ReadResult>("file.read", { bytes, name, options }, [bytes.buffer as ArrayBuffer]);

  const stem = (name: string) => name.replace(/\.[^.]*$/, "").toUpperCase();
  const isPaletteFile = (name: string) => /\.(act|pal)$/i.test(name);

  const openFiles = async (picked: { file: File; handle: FileSystemFileHandle | null }[], siblings?: (name: string) => Promise<File | null>) => {
    // Palettes chosen with RAW files go with the RAW of the same name (FOO.ACT with FOO.RAW).
    const palettes = picked.filter((p) => isPaletteFile(p.file.name));
    const files = picked.filter((p) => !isPaletteFile(p.file.name));
    if (!files.length && palettes.length) await alertDialog("JSPaintShop", "A palette file (.act, .pal) opens with a RAW or Dr. Halo image: choose it together with the .raw or .cut file, or load it in the RAW Options dialog.");
    const pairedPalette = async (name: string): Promise<RawPalette | null> => {
      let f = palettes.find((p) => stem(p.file.name) === stem(name))?.file ?? null;
      if (!f && siblings) f = (await siblings(`${name.replace(/\.[^.]*$/, "")}.act`)) ?? (await siblings(`${name.replace(/\.[^.]*$/, "")}.pal`));
      if (!f && palettes.length === 1 && files.length === 1) f = palettes[0].file;
      if (!f) return null;
      const colors = readPaletteFile(f.name, new Uint8Array(await f.arrayBuffer()));
      return colors ? { name: f.name, colors } : null;
    };
    for (const { file, handle } of files) {
      try {
        let options: ReadOptions | undefined;
        if (formatByName(file.name)?.id === "raw") {
          const raw = await showRawOpen(app, file.name, file.size, await pairedPalette(file.name));
          if (!raw) continue;
          options = { raw };
        } else if (formatByName(file.name)?.id === "cut") {
          // Dr. Halo's colors are in the .PAL of the same name.
          const pal = await pairedPalette(file.name);
          if (pal) options = { palette: pal.colors };
        }
        app.status(`Opening ${file.name}...`);
        const result = await read(new Uint8Array(await file.arrayBuffer()), file.name, options);
        // Vector layers are drawn from their objects (a PSP 6 file may store them empty).
        for (const l of result.doc.layers) if (l.kind === "vector" && l.objects) { l.x = l.y = 0; renderVectorLayer(l, result.doc.width, result.doc.height); }
        const image = new ImageDocument(result.doc, file.name, handle, result.format);
        image.fileSize = file.size;
        ws.show(image);
        addRecent(file.name, handle);
        if (result.warnings.length) await alertDialog("JSPaintShop", `${file.name}:\n\n${result.warnings.join("\n")}`);
      } catch (err) {
        await alertDialog("JSPaintShop", err instanceof Error ? err.message : String(err));
      } finally {
        app.status("");
      }
    }
  };

  /* Write `image` to `target`; `copy` leaves the image's own name and file alone. */
  const writeImage = async (image: ImageDocument, target: SaveTarget, copy: boolean, ask = true): Promise<boolean> => {
    const format = formatById(target.format);
    // RAW asks its save options (DIALOG 468) on Save As; Save uses the last ones.
    let raw = app.settings.raw.save;
    if (target.format === "raw" && ask) {
      const o = await showRawSave(app, image.doc.depth <= 8 && image.doc.palette !== null);
      if (!o) return false;
      raw = o;
    }
    if (image.doc.layers.length > 1 && !format.layers) {
      const ok = await confirmDialog("JSPaintShop", `The ${format.name} format does not keep layers. The image will be merged into one layer in the saved file; the open image keeps its layers.`);
      if (!ok) return false;
    }
    app.status(`Saving ${target.name}...`);
    try {
      const bytes = await worker.call<Uint8Array>("file.write", { doc: image.doc, format: target.format, quality: app.settings.jpegQuality, raw, name: target.name });
      await writeTarget(target, bytes, format.mime);
      // Dr. Halo: the palette goes to a .PAL of the same name (EncodeCUT); the browser saves it as a second file.
      if (target.format === "cut" && image.doc.palette) {
        const pal = await pickSaveFile(target.name, "Dr. Halo palette", ".pal");
        if (pal) await writeTarget(pal, encodeHaloPalette(image.doc.palette), "application/octet-stream");
      }
      image.fileSize = copy ? image.fileSize : bytes.length;
      if (!copy) image.saved(target.name, target.handle, target.format);
      addRecent(target.name, target.handle);
      return true;
    } catch (err) {
      await alertDialog("JSPaintShop", err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      app.status("");
    }
  };

  const saveAs = async (image: ImageDocument, copy = false): Promise<boolean> => {
    try {
      const target = await pickSaveTarget(image.name, image.format ?? "png");
      return target ? writeImage(image, target, copy) : false;
    } catch (err) {
      await alertDialog("JSPaintShop", err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const save = async (image: ImageDocument): Promise<boolean> => {
    if (image.handle && image.format && formatById(image.format).write) return writeImage(image, { name: image.name, format: image.format, handle: image.handle }, false, false);
    return saveAs(image);
  };
  ws.saver = save;

  const addImage = (doc: ImageDoc) => ws.show(new ImageDocument(doc, ws.nextName()));

  registry.bind(CMD.FILE_NEW, async () => {
    const { fg, bg } = colors();
    const choice = await showNewImage(app, fg, bg);
    if (!choice) return;
    const doc = newImage(choice.width, choice.height, choice.dpi, choice.fill, choice.depth, choice.greyscale, Math.floor(Date.now() / 1000));
    // A paletted image's background is the palette's nearest color.
    if (doc.palette && choice.fill[3]) {
      const p = doc.palette, k = nearest(p, p.length / 3, choice.fill[0], choice.fill[1], choice.fill[2]);
      const d = doc.layers[0].raster.data;
      for (let i = 0; i < d.length; i += 4) { d[i] = p[k * 3]; d[i + 1] = p[k * 3 + 1]; d[i + 2] = p[k * 3 + 2]; }
    }
    addImage(doc);
  }, { enabled: () => !ws.full });
  registry.bind(CMD.FILE_OPEN, async () => openFiles(await pickOpenFiles()), { enabled: () => !ws.full });
  registry.bind(CMD.FILE_CLOSE, () => { void ws.activeWindowClose(); }, { enabled: hasImage });
  registry.bind(CMD.FILE_SAVE, async () => { if (ws.active) await save(ws.active); }, { enabled: hasImage });
  registry.bind(CMD.FILE_SAVE_AS, async () => { if (ws.active) await saveAs(ws.active); }, { enabled: hasImage });
  registry.bind(CMD.FILE_SAVE_COPY_AS, async () => { if (ws.active) await saveAs(ws.active, true); }, { enabled: hasImage });
  // File > Send: the browser's share sheet with the image as a PNG (PSP 6 hands it to the MAPI mail client).
  const canShare = () => typeof navigator.share === "function" && typeof navigator.canShare === "function";
  registry.bind(CMD.FILE_SEND, async () => {
    const image = ws.active;
    if (!image) return;
    try {
      const bytes = await worker.call<Uint8Array>("file.write", { doc: image.doc, format: "png" });
      const file = new File([bytes as BlobPart], image.name.replace(/\.[^.]*$/, "") + ".png", { type: "image/png" });
      if (!navigator.canShare({ files: [file] })) { await alertDialog("Send", "This browser cannot share image files."); return; }
      await navigator.share({ files: [file], title: image.name });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      await alertDialog("Send", err instanceof Error ? err.message : String(err));
    }
  }, { enabled: () => hasImage() && canShare() });
  // File > Delete: removes the image's file from the disk and closes it (browsers with FileSystemHandle.remove).
  registry.bind(CMD.FILE_DELETE, async () => {
    const image = ws.active;
    const handle = image?.handle as (FileSystemFileHandle & { remove?: () => Promise<void> }) | null | undefined;
    if (!image || !handle?.remove) return;
    if (!(await confirmDialog("Delete", `Delete ${image.name} from the disk? This cannot be undone.`, "Delete"))) return;
    try {
      await handle.remove();
      image.handle = null;
      await ws.closeImage(image);
    } catch (err) {
      await alertDialog("Delete", err instanceof Error ? err.message : String(err));
    }
  }, { enabled: () => Boolean((ws.active?.handle as { remove?: unknown } | null | undefined)?.remove) });
  // File > Exit: closes every window, asking about unsaved images; a page cannot close its own tab.
  registry.bind(CMD.FILE_EXIT, async () => { for (const i of [...ws.images]) if (!(await ws.closeImage(i))) return; });
  registry.bind(CMD.FILE_REVERT, async () => {
    const image = ws.active;
    if (!image?.handle) return;
    if (!(await confirmDialog("JSPaintShop", `Revert to the saved version of ${image.name}? Changes since it was saved will be lost.`, "Revert"))) return;
    try {
      const file = await image.handle.getFile();
      const result = await read(new Uint8Array(await file.arrayBuffer()), file.name);
      image.fileSize = file.size;
      image.replace(result.doc);
    } catch (err) {
      await alertDialog("JSPaintShop", err instanceof Error ? err.message : String(err));
    }
  }, { enabled: () => Boolean(ws.active?.handle) });

  // Edit > Paste > As New Image (Ctrl+V): the clipboard's picture as a new image.
  registry.bind(CMD.EDIT_PASTE_AS_NEW_IMAGE, async () => {
    const img = await pasteImage();
    if (!img) { app.status("There is no picture on the clipboard."); return; }
    const raster = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.rgba) };
    const doc: ImageDoc = {
      width: img.width, height: img.height, dpi: 72, depth: 24, greyscale: false, palette: null,
      layers: [rasterLayer("Background", raster)], active: 0, creator: emptyCreator(Math.floor(Date.now() / 1000)), selection: null, alphas: [],
    };
    addImage(doc);
  }, { enabled: () => !ws.full });

  // Files dropped on the work area open, as dropped from Explorer onto PSP.
  const area = document.querySelector<HTMLElement>(".work-area");
  area?.addEventListener("dragover", (e) => { if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
  area?.addEventListener("drop", async (e) => {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    const items = [...e.dataTransfer.items].filter((i) => i.kind === "file");
    const withHandles = await Promise.all(items.map(async (item) => {
      const file = item.getAsFile()!;
      const h = await (item as DataTransferItem & { getAsFileSystemHandle?(): Promise<FileSystemHandle | null> }).getAsFileSystemHandle?.().catch(() => null);
      return { file, handle: h && h.kind === "file" ? (h as FileSystemFileHandle) : null };
    }));
    await openFiles(withHandles);
  });

  // Leaving the page with unsaved images asks first.
  window.addEventListener("beforeunload", (e) => { if (ws.images.some((i) => i.modified)) e.preventDefault(); });

  const recent = (): SlotItem[] => app.settings.recent.map((name, i) => ({
    label: `&${i + 1} ${name}`,
    run: async () => {
      const handle = await recallHandle(name);
      if (!handle || !(await canRead(handle))) { await alertDialog("JSPaintShop", `${name} can no longer be opened from here. Use File > Open.`); return; }
      try { await openFiles([{ file: await handle.getFile(), handle }]); } catch (err) { await alertDialog("JSPaintShop", err instanceof Error ? err.message : String(err)); }
    },
  }));

  return { recent, openFiles };
}
