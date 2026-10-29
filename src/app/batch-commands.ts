/*
  File > Batch Conversion (DIALOG 201, the file list with Output settings and Output folder)
  and its Batch Progress window (DIALOG 218): every chosen file is opened and saved in the
  output type, the log lists each step, Abort stops after the current file and Save Log keeps
  the log as a text file.

  The output folder comes from the browser's folder picker; where there is none, each converted
  file is downloaded instead.
*/
import type { AppState } from "./state.ts";
import type { WorkerClient } from "../shared/worker-client.ts";
import { CMD, type CommandRegistry } from "../ui/shell/commands.ts";
import { el } from "../shared/dom.ts";
import { openDialog } from "../ui/shell/dialog.ts";
import { pickSaveFile, writeTarget } from "../ui/shell/file-dialogs.ts";
import { FORMATS, formatById, type FormatId } from "../core/formats/formats.ts";
import type { ReadResult } from "../worker/file-handlers.ts";

/* Several files from the open picker, or an <input multiple> where there is none. */
async function pickFiles(): Promise<File[]> {
  const w = window as unknown as { showOpenFilePicker?: (o: unknown) => Promise<FileSystemFileHandle[]> };
  if (w.showOpenFilePicker) {
    try { return await Promise.all((await w.showOpenFilePicker({ multiple: true })).map((h) => h.getFile())); } catch { return []; }
  }
  return new Promise((resolve) => {
    const input = el("input", { type: "file", multiple: true }) as HTMLInputElement;
    input.addEventListener("change", () => resolve([...(input.files ?? [])]));
    input.click();
  });
}

async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  const w = window as unknown as { showDirectoryPicker?: (o?: unknown) => Promise<FileSystemDirectoryHandle> };
  if (!w.showDirectoryPicker) return null;
  try { return await w.showDirectoryPicker({ mode: "readwrite" }); } catch { return null; }
}

export function bindBatchCommands(registry: CommandRegistry, app: AppState, worker: WorkerClient): void {
  registry.bind(CMD.FILE_BATCH_CONVERSION, async () => {
    let files: File[] = [];
    let folder: FileSystemDirectoryHandle | null = null;
    const list = el("select", { size: 10, multiple: true, class: "batch-list" }) as HTMLSelectElement;
    const showFiles = () => list.replaceChildren(...files.map((f, i) => el("option", { value: String(i) }, f.name)));
    const add = el("button", { type: "button", onclick: async () => { files = [...files, ...(await pickFiles())]; showFiles(); } }, "Add Files...");
    const selectAll = el("button", { type: "button", onclick: () => { for (const o of list.options) o.selected = true; } }, "Select All");
    const removeSel = el("button", { type: "button", onclick: () => { const keep = files.filter((_, i) => !list.options[i]?.selected); files = keep; showFiles(); } }, "Remove");
    const writable = FORMATS.filter((f) => f.write && f.id !== "psp").concat(FORMATS.filter((f) => f.id === "psp"));
    const type = el("select", {}, ...writable.map((f) => el("option", { value: f.id }, `${f.name} (${f.extensions[0]})`)));
    let quality = app.settings.jpegQuality;
    const options = el("button", { type: "button", onclick: async () => {
      if (type.value !== "jpeg") { await openDialog({ title: "Save Options", body: el("p", { class: "modal-text" }, "This file type has no options.") }); return; }
      const n = el("input", { type: "number", class: "spin", min: 1, max: 99, value: 100 - quality });
      const v = await openDialog({ title: "Save Options", body: el("label", { class: "form-row" }, el("span", {}, "Compression factor:"), n), buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }] });
      if (v === "ok") quality = Math.max(1, 100 - (Number(n.value) || 15));
    } }, "Options...");
    const stop = el("input", { type: "checkbox", checked: true });
    const where = el("input", { type: "text", class: "text-field", readonly: true, value: "(each file is downloaded)" });
    const browse = el("button", { type: "button", onclick: async () => { folder = await pickFolder(); where.value = folder ? folder.name : "(each file is downloaded)"; } }, "Browse");
    const v = await openDialog({
      title: "Batch Conversion", className: "batch-dialog",
      buttons: [{ label: "Start", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
      beforeClose: (value) => value !== "ok" || files.length > 0,
      body: el("div", { class: "layer-props" },
        el("div", { class: "batch-files" }, list, el("div", { class: "batch-side" }, add, selectAll, removeSel)),
        el("fieldset", { class: "opt-group" }, el("legend", {}, "Output settings"),
          el("label", { class: "form-row" }, el("span", {}, "Type:"), type, options),
          el("label", { class: "opt-check" }, stop, "Stop on error")),
        el("fieldset", { class: "opt-group" }, el("legend", {}, "Output folder"), el("div", { class: "form-row" }, where, browse))),
    });
    if (v !== "ok" || !files.length) return;

    // Batch Progress.
    const target = type.value as FormatId, format = formatById(target);
    const log: string[] = [];
    const logBox = el("select", { size: 10, class: "batch-log" }) as HTMLSelectElement;
    const job = el("progress", { max: files.length, value: 0 }), current = el("progress", { max: 2, value: 0 });
    const say = (line: string) => { log.push(line); logBox.append(el("option", {}, line)); logBox.selectedIndex = log.length - 1; };
    let aborted = false, done = false;
    const abort = el("button", { type: "button", onclick: () => { aborted = true; } }, "Abort");
    const saveLog = el("button", { type: "button", onclick: async () => {
      const t = await pickSaveFile("Batch Conversion Log", "Text", ".txt", "text/plain");
      if (t) await writeTarget(t, new TextEncoder().encode(log.join("\r\n")), "text/plain");
    } }, "Save Log...");
    const progress = openDialog({
      title: "Batch Progress", className: "batch-dialog",
      buttons: [{ label: "OK", value: "ok", primary: true }],
      beforeClose: () => done,
      body: el("div", { class: "layer-props" },
        el("fieldset", { class: "opt-group" }, el("legend", {}, "Current Step"), logBox),
        el("label", { class: "form-row" }, el("span", {}, "Job Progress"), job),
        el("label", { class: "form-row" }, el("span", {}, "Current File Progress"), current),
        el("div", { class: "form-row" }, abort, saveLog)),
    });
    let ok = 0;
    const dir = folder as FileSystemDirectoryHandle | null;
    for (let i = 0; i < files.length && !aborted; i++) {
      const f = files[i], outName = f.name.replace(/\.[^.]*$/, "") + format.extensions[0];
      current.value = 0;
      say(`Loading ${f.name}`);
      try {
        const r = await worker.call<ReadResult>("file.read", { bytes: new Uint8Array(await f.arrayBuffer()), name: f.name });
        current.value = 1;
        say(`Saving ${outName}`);
        const bytes = await worker.call<Uint8Array>("file.write", { doc: r.doc, format: target, quality, raw: app.settings.raw.save, name: f.name });
        if (dir) {
          const h = await dir.getFileHandle(outName, { create: true });
          await writeTarget({ name: outName, handle: h }, bytes, format.mime);
        } else await writeTarget({ name: outName, handle: null }, bytes, format.mime);
        current.value = 2;
        say(`Converted ${f.name}`);
        ok++;
      } catch (err) {
        say(`Error on ${f.name}: ${err instanceof Error ? err.message : String(err)}`);
        if (stop.checked) { say("Stopped on error."); break; }
      }
      job.value = i + 1;
    }
    if (aborted) say("Aborted.");
    say(`Batch complete: ${ok} of ${files.length} file${files.length > 1 ? "s" : ""} converted.`);
    abort.disabled = true;
    done = true;
    await progress;
  });
}
