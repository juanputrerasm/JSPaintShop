/*
  File > Browse (Ctrl+B): PSP 6's thumbnail browser in its own window, with the Browser menu
  (MENU 130) while it is active. A folder chosen with the browser's folder picker is listed
  on the left (its subfolders, and the way back up) and its images as thumbnails on the right,
  at Preferences > Browser's thumbnail size and selection color.

  Click selects, Ctrl+click adds, Shift+click selects a range, double-click or Enter opens. The
  File, Edit, Find and Image File menus act on the selection: Select by name pattern, Sort,
  Update Thumbnails, Select All/None/Invert, Find, Copy To, Move To, Delete, Rename,
  Information, Open. Without the folder picker (Firefox, Safari) a folder can still be listed
  read-only, and the commands that change files are greyed.
*/
import type { AppState } from "./state.ts";
import type { WorkerClient } from "../shared/worker-client.ts";
import type { AppShell } from "../ui/shell/app-shell.ts";
import type { ImageWindow } from "../ui/shell/mdi.ts";
import { CMD, type CommandRegistry } from "../ui/shell/commands.ts";
import { el } from "../shared/dom.ts";
import { openDialog, alertDialog, confirmDialog } from "../ui/shell/dialog.ts";
import { detectFormat, formatByName } from "../core/formats/formats.ts";
import { mergeLayers } from "../core/layers/composite.ts";
import type { ReadResult } from "../worker/file-handlers.ts";
import { readPaletteFile } from "../ui/dialogs/raw-options.ts";

interface Entry { name: string; file: File; handle: FileSystemFileHandle | null; thumb: HTMLCanvasElement | null; info: string; width: number; height: number; node: HTMLElement }

type DirLike = FileSystemDirectoryHandle;

const OK_CANCEL = [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }];

export function bindBrowser(registry: CommandRegistry, app: AppState, shell: AppShell, worker: WorkerClient, open: (files: { file: File; handle: FileSystemFileHandle | null }[], siblings?: (name: string) => Promise<File | null>) => Promise<void>): void {
  let win: ImageWindow | null = null;
  // Every file in the folder by its lower-case name: RAW images find their .ACT or .PAL here.
  let folder = new Map<string, File>();
  const sibling = async (name: string) => folder.get(name.toLowerCase()) ?? null;
  const rawPalette = async (name: string) => {
    if (formatByName(name)?.id !== "raw") return undefined;
    const base = name.replace(/\.[^.]*$/, "");
    const f = (await sibling(`${base}.act`)) ?? (await sibling(`${base}.pal`));
    return f ? readPaletteFile(f.name, new Uint8Array(await f.arrayBuffer())) ?? undefined : undefined;
  };
  let path: DirLike[] = [];
  let readOnly: File[] | null = null;
  let entries: Entry[] = [];
  let selected = new Set<number>();
  let anchor = -1;
  let autoScroll = true;
  let lastFind = "";
  let sortKey: "name" | "size" | "date" | "type" = "name", sortDesc = false;
  const tree = el("div", { class: "brw-tree" }), grid = el("div", { class: "brw-grid", tabindex: "0" });
  const body = el("div", { class: "brw" }, tree, grid);
  const active = () => win !== null && shell.mdi.active === win;
  const writable = () => active() && path.length > 0;
  const current = () => (anchor >= 0 && entries[anchor] ? entries[anchor] : entries[[...selected][0]] ?? null);

  const thumbOf = async (e: Entry) => {
    const size = app.settings.prefs.browser.thumbSize;
    try {
      const r = await worker.call<ReadResult>("file.read", { bytes: new Uint8Array(await e.file.arrayBuffer()), name: e.name, options: { rawPalette: await rawPalette(e.name) } });
      const flat = mergeLayers(r.doc, r.doc.layers);
      e.width = flat.width; e.height = flat.height;
      const s = Math.min(1, size / flat.width, size / flat.height);
      const c = el("canvas", { width: Math.max(1, Math.round(flat.width * s)), height: Math.max(1, Math.round(flat.height * s)) }) as HTMLCanvasElement;
      const src = new OffscreenCanvas(flat.width, flat.height);
      src.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(flat.data), flat.width, flat.height), 0, 0);
      c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
      e.thumb = c;
      e.info = `${flat.width} x ${flat.height} x ${r.doc.depth <= 8 ? 1 << r.doc.depth : r.doc.depth === 24 ? "16 Million" : r.doc.depth === 16 ? "64K" : "32K"}`;
    } catch {
      e.thumb = null;
      e.info = "Unreadable";
    }
  };

  const paint = () => {
    const size = app.settings.prefs.browser.thumbSize, color = app.settings.prefs.browser.selectionColor;
    grid.style.setProperty("--thumb", `${size}px`);
    grid.style.setProperty("--brw-sel", color);
    entries.forEach((e, i) => e.node.classList.toggle("selected", selected.has(i)));
    app.status(selected.size ? `${selected.size} selected` : `${entries.length} file${entries.length === 1 ? "" : "s"}`);
    app.emit("commands", undefined);
  };

  const sortEntries = () => {
    const key = (e: Entry): string | number => sortKey === "size" ? e.file.size : sortKey === "date" ? e.file.lastModified : sortKey === "type" ? e.name.split(".").pop()!.toLowerCase() + e.name : e.name.toLowerCase();
    const keep = new Set([...selected].map((i) => entries[i]));
    entries.sort((a, b) => { const ka = key(a), kb = key(b); return (ka < kb ? -1 : ka > kb ? 1 : 0) * (sortDesc ? -1 : 1); });
    selected = new Set(entries.map((e, i) => (keep.has(e) ? i : -1)).filter((i) => i >= 0));
    grid.replaceChildren(...entries.map((e) => e.node));
    paint();
  };

  const makeNode = (e: Entry) => {
    const box = el("div", { class: "brw-cell", title: e.name });
    const pic = el("div", { class: "brw-pic" });
    box.append(pic, el("div", { class: "brw-name" }, e.name));
    box.addEventListener("click", (ev) => {
      const i = entries.indexOf(e);
      if (ev.shiftKey && anchor >= 0) { const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)]; if (!ev.ctrlKey && !ev.metaKey) selected.clear(); for (let k = a; k <= b; k++) selected.add(k); }
      else if (ev.ctrlKey || ev.metaKey) { if (selected.has(i)) selected.delete(i); else selected.add(i); anchor = i; }
      else { selected = new Set([i]); anchor = i; }
      paint();
    });
    box.addEventListener("dblclick", () => void open([{ file: e.file, handle: e.handle }], sibling));
    return { box, pic };
  };

  const load = async () => {
    const files: { file: File; handle: FileSystemFileHandle | null }[] = [];
    const dirs: [string, DirLike][] = [];
    if (readOnly) for (const f of readOnly) files.push({ file: f, handle: null });
    else if (path.length) {
      for await (const [name, h] of path[path.length - 1] as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        if (h.kind === "directory") dirs.push([name, h as DirLike]);
        else files.push({ file: await (h as FileSystemFileHandle).getFile(), handle: h as FileSystemFileHandle });
      }
    }
    // The tree pane: up a level, then the subfolders.
    const where = readOnly ? "(read-only folder)" : path.map((d) => d.name).join(" / ");
    tree.replaceChildren(el("div", { class: "brw-path" }, where || "No folder"),
      ...(path.length > 1 ? [el("button", { type: "button", class: "brw-dir", onclick: () => { path.pop(); void load(); } }, "..")] : []),
      ...dirs.sort((a, b) => a[0].localeCompare(b[0])).map(([name, d]) => el("button", { type: "button", class: "brw-dir", onclick: () => { path.push(d); void load(); } }, name)));
    folder = new Map(files.map(({ file }) => [file.name.toLowerCase(), file]));
    const images = files.filter(({ file }) => formatByName(file.name)?.read);
    entries = images.map(({ file, handle }) => {
      const e: Entry = { name: file.name, file, handle, thumb: null, info: "", width: 0, height: 0, node: el("div") };
      const { box, pic } = makeNode(e);
      e.node = box;
      (e as Entry & { pic: HTMLElement }).pic = pic;
      return e;
    });
    selected = new Set();
    anchor = -1;
    sortEntries();
    if (win) win.setTitle(`Browse - ${where}`);
    for (const e of entries) {
      if (!win) return;
      await thumbOf(e);
      const pic = (e as Entry & { pic: HTMLElement }).pic;
      pic.replaceChildren(e.thumb ?? el("span", { class: "brw-bad" }, "?"));
      if (autoScroll && win) e.node.scrollIntoView({ block: "nearest" });
    }
  };

  const chooseFolder = async (): Promise<boolean> => {
    const w = window as unknown as { showDirectoryPicker?: (o?: unknown) => Promise<FileSystemDirectoryHandle> };
    if (w.showDirectoryPicker) {
      try { path = [await w.showDirectoryPicker({ mode: "readwrite" })]; readOnly = null; return true; } catch { return false; }
    }
    return new Promise((resolve) => {
      const input = el("input", { type: "file" }) as HTMLInputElement;
      (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
      input.addEventListener("change", () => {
        readOnly = [...(input.files ?? [])].filter((f) => (f as File & { webkitRelativePath: string }).webkitRelativePath.split("/").length === 2);
        path = [];
        resolve(readOnly.length > 0);
      });
      input.click();
    });
  };

  const browse = async () => {
    if (!(await chooseFolder())) return;
    if (!win) {
      win = shell.mdi.open({ title: "Browse", body, width: 620, height: 420, kind: "browser", onClose: () => { win = null; entries = []; app.status(""); } });
      grid.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); void registry.exec(CMD.IMAGEFILE_OPEN); }
      });
    } else shell.mdi.activate(win);
    await load();
  };

  registry.bind(CMD.FILE_BROWSE, browse);
  registry.bind(CMD.FILE_BROWSE_NEW_FOLDER, browse);
  registry.bind(CMD.FILE_CLOSE_33301, () => { if (win) void win.close(); }, { enabled: active });
  registry.bind(CMD.FILE_UPDATE_THUMBNAILS, () => load(), { enabled: active });
  registry.bind(CMD.VIEW_REFRESH_TREE, () => load(), { enabled: active });
  registry.bind(CMD.VIEW_AUTO_SCROLL, () => { autoScroll = !autoScroll; app.emit("commands", undefined); }, { enabled: active, checked: () => autoScroll });
  registry.bind(CMD.EDIT_SELECT_ALL, () => { selected = new Set(entries.map((_, i) => i)); paint(); }, { enabled: active });
  registry.bind(CMD.EDIT_SELECT_NONE, () => { selected = new Set(); paint(); }, { enabled: active });
  registry.bind(CMD.EDIT_INVERT_SELECTION, () => { selected = new Set(entries.map((_, i) => i).filter((i) => !selected.has(i))); paint(); }, { enabled: active });
  registry.bind(CMD.WINDOW_FIT_TO_THUMBNAILS, () => {
    if (!win) return;
    const size = app.settings.prefs.browser.thumbSize + 24, cols = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(entries.length))));
    win.fitBody(160 + cols * size + 24, Math.min(600, Math.ceil(entries.length / cols) * (size + 22) + 16));
  }, { enabled: active });

  // Select by a name pattern (* and ?), as PSP's Select dialog does by name.
  registry.bind(CMD.FILE_SELECT, async () => {
    const pat = el("input", { type: "text", class: "text-field", value: "*.*" });
    const v = await openDialog({ title: "Select", body: el("label", { class: "form-row" }, el("span", {}, "File name:"), pat), buttons: OK_CANCEL });
    if (v !== "ok") return;
    const re = new RegExp(`^${pat.value.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
    selected = new Set(entries.map((e, i) => (re.test(e.name) ? i : -1)).filter((i) => i >= 0));
    paint();
  }, { enabled: active });
  registry.bind(CMD.FILE_SORT, async () => {
    const by = el("select", {}, ...["File name", "File size", "File date", "File type"].map((l, i) => el("option", { value: ["name", "size", "date", "type"][i], selected: ["name", "size", "date", "type"][i] === sortKey }, l)));
    const desc = el("input", { type: "checkbox", checked: sortDesc });
    const v = await openDialog({ title: "Sort", body: el("div", { class: "layer-props" }, el("label", { class: "form-row" }, el("span", {}, "Sort by:"), by), el("label", { class: "opt-check" }, desc, "Descending")), buttons: OK_CANCEL });
    if (v !== "ok") return;
    sortKey = by.value as typeof sortKey; sortDesc = desc.checked;
    sortEntries();
  }, { enabled: active });

  const find = (from: number) => {
    if (!lastFind) return;
    const n = entries.length;
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n;
      if (entries[i].name.toLowerCase().includes(lastFind.toLowerCase())) { selected = new Set([i]); anchor = i; entries[i].node.scrollIntoView({ block: "nearest" }); paint(); return; }
    }
    void alertDialog("Find", `"${lastFind}" was not found.`);
  };
  registry.bind(CMD.FIND_FILE_NAME, async () => {
    const t = el("input", { type: "text", class: "text-field", value: lastFind });
    const v = await openDialog({ title: "Find", body: el("label", { class: "form-row" }, el("span", {}, "File name:"), t), buttons: OK_CANCEL });
    if (v !== "ok") return;
    lastFind = t.value;
    find(anchor);
  }, { enabled: active });
  registry.bind(CMD.FIND_REPEAT_FIND, () => find(anchor), { enabled: () => active() && lastFind !== "" });

  const some = () => active() && selected.size > 0;
  const chosen = () => [...selected].sort((a, b) => a - b).map((i) => entries[i]);
  registry.bind(CMD.IMAGEFILE_OPEN, () => open(chosen().map((e) => ({ file: e.file, handle: e.handle })), sibling), { enabled: some });
  registry.bind(CMD.IMAGEFILE_INFORMATION, async () => {
    const e = current();
    if (!e) return;
    const fmt = detectFormat(new Uint8Array(await e.file.slice(0, 64).arrayBuffer()), e.name);
    const row = (k: string, v: string) => el("div", { class: "form-row" }, el("span", {}, k), el("strong", {}, v));
    await openDialog({ title: "Information", body: el("div", { class: "layer-props" },
      row("File name:", e.name), row("Format:", fmt?.name ?? "Unknown"), row("Image:", e.info || "Not read yet"),
      row("File size:", `${e.file.size.toLocaleString()} bytes`), row("File date:", new Date(e.file.lastModified).toLocaleString())) });
  }, { enabled: () => active() && current() !== null });

  const pickTarget = async (): Promise<DirLike | null> => {
    const w = window as unknown as { showDirectoryPicker?: (o?: unknown) => Promise<FileSystemDirectoryHandle> };
    try { return (await w.showDirectoryPicker?.({ mode: "readwrite" })) ?? null; } catch { return null; }
  };
  const copyTo = async (move: boolean) => {
    const dest = await pickTarget();
    if (!dest) return;
    for (const e of chosen()) {
      const h = await dest.getFileHandle(e.name, { create: true });
      const wr = await h.createWritable();
      await wr.write(await e.file.arrayBuffer());
      await wr.close();
      if (move) await path[path.length - 1].removeEntry(e.name);
    }
    if (move) await load();
  };
  registry.bind(CMD.IMAGEFILE_COPY_TO, () => copyTo(false), { enabled: () => some() && writable() });
  registry.bind(CMD.IMAGEFILE_MOVE_TO, () => copyTo(true), { enabled: () => some() && writable() });
  registry.bind(CMD.IMAGEFILE_DELETE, async () => {
    const list = chosen();
    if (!(await confirmDialog("Delete", `Delete ${list.length === 1 ? list[0].name : `these ${list.length} files`}? This cannot be undone.`, "Delete"))) return;
    for (const e of list) await path[path.length - 1].removeEntry(e.name);
    await load();
  }, { enabled: () => some() && writable() });
  registry.bind(CMD.IMAGEFILE_RENAME, async () => {
    const e = current();
    if (!e?.handle) return;
    const t = el("input", { type: "text", class: "text-field", value: e.name });
    const v = await openDialog({ title: "Rename", body: el("label", { class: "form-row" }, el("span", {}, "New name:"), t), buttons: OK_CANCEL });
    const name = t.value.trim();
    if (v !== "ok" || !name || name === e.name) return;
    const dir = path[path.length - 1];
    const h = e.handle as FileSystemFileHandle & { move?: (name: string) => Promise<void> };
    if (h.move) await h.move(name);
    else {
      // Copy, then remove the old file.
      const n = await dir.getFileHandle(name, { create: true }), wr = await n.createWritable();
      await wr.write(await e.file.arrayBuffer());
      await wr.close();
      await dir.removeEntry(e.name);
    }
    await load();
  }, { enabled: () => writable() && current() !== null });
}
