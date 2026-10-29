/*
  OPFS helpers, usable from the page and from workers. From JSTraxx (ported there from OpenMTM2
  src/shared/opfs.js), with directory listing and a synchronous-handle write for workers
  (the only write path Safari offers inside a worker).

  Everything JSPaintShop stores lives under one root folder, `jspaintshop/`:
    jspaintshop/settings.json     the preferences (PSP kept these in the registry)
    jspaintshop/resources/        gradients, patterns, textures, tubes, frames, presets, palettes
    jspaintshop/autosave/         autosaved images
*/
import { splitPath } from "./path-utils.ts";

export const ROOT = "jspaintshop";

export async function getOpfsRoot(): Promise<FileSystemDirectoryHandle> {
  if (!globalThis.navigator?.storage?.getDirectory) {
    throw new Error("The browser's private file storage (OPFS) is unavailable. Open JSPaintShop over localhost or HTTPS.");
  }
  return navigator.storage.getDirectory();
}

export async function getDirectory(relativePath: string, create = false): Promise<FileSystemDirectoryHandle> {
  let current = await getOpfsRoot();
  for (const part of splitPath(relativePath)) current = await current.getDirectoryHandle(part, { create });
  return current;
}

export const ensureDirectory = (relativePath: string) => getDirectory(relativePath, true);

export async function getFileHandle(relativePath: string, create = false): Promise<FileSystemFileHandle> {
  const parts = splitPath(relativePath);
  const fileName = parts.pop();
  if (!fileName) throw new Error("File path cannot be empty.");
  const dir = await getDirectory(parts.join("/"), create);
  return dir.getFileHandle(fileName, { create });
}

export async function exists(relativePath: string): Promise<boolean> {
  try { await getFileHandle(relativePath); return true; } catch { /* not a file */ }
  try { await getDirectory(relativePath); return true; } catch { return false; }
}

/*
  Writes through createWritable where the browser has it. In a worker without it (Safari),
  a synchronous access handle does the same job.
*/
export async function writeBytesToFile(relativePath: string, bytes: Uint8Array | Blob): Promise<void> {
  const handle = await getFileHandle(relativePath, true);
  if ("createWritable" in handle) {
    const writable = await handle.createWritable();
    await writable.write(bytes as FileSystemWriteChunkType);
    await writable.close();
    return;
  }
  const sync = await (handle as FileSystemFileHandle & {
    createSyncAccessHandle(): Promise<{ truncate(n: number): void; write(b: Uint8Array, o: { at: number }): number; flush(): void; close(): void }>;
  }).createSyncAccessHandle();
  try {
    const data = bytes instanceof Blob ? new Uint8Array(await bytes.arrayBuffer()) : bytes;
    sync.truncate(0);
    sync.write(data, { at: 0 });
    sync.flush();
  } finally {
    sync.close();
  }
}

export async function writeStreamToFile(relativePath: string, readable: ReadableStream<Uint8Array>): Promise<void> {
  const handle = await getFileHandle(relativePath, true);
  if (!("createWritable" in handle)) {
    await writeBytesToFile(relativePath, await new Response(readable).blob());
    return;
  }
  await readable.pipeTo(await handle.createWritable());
}

export async function readFile(relativePath: string): Promise<File> {
  return (await getFileHandle(relativePath)).getFile();
}

export async function readBytes(relativePath: string): Promise<Uint8Array> {
  return new Uint8Array(await (await readFile(relativePath)).arrayBuffer());
}

export async function readTextFile(relativePath: string): Promise<string> {
  return (await readFile(relativePath)).text();
}

export interface DirEntry { name: string; kind: "file" | "directory"; size?: number; lastModified?: number }

/** The entries of a folder, sorted by name. An absent folder lists as empty. */
export async function listDirectory(relativePath: string, withSizes = false): Promise<DirEntry[]> {
  let dir: FileSystemDirectoryHandle;
  try { dir = await getDirectory(relativePath); } catch { return []; }
  const out: DirEntry[] = [];
  for await (const [name, handle] of (dir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
    const entry: DirEntry = { name, kind: handle.kind };
    if (withSizes && handle.kind === "file") {
      const file = await (handle as FileSystemFileHandle).getFile();
      entry.size = file.size;
      entry.lastModified = file.lastModified;
    }
    out.push(entry);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function removePath(relativePath: string): Promise<void> {
  const parts = splitPath(relativePath);
  const name = parts.pop();
  if (!name) return;
  let dir: FileSystemDirectoryHandle;
  try { dir = await getDirectory(parts.join("/")); } catch { return; }
  try { await dir.removeEntry(name, { recursive: true }); } catch { /* already gone */ }
}

/** How much OPFS holds and may hold, when the browser says. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch { return null; }
}
