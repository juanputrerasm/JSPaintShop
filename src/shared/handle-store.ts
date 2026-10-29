/*
  File handles kept between visits, for File > Recent File: IndexedDB can store a
  FileSystemFileHandle where OPFS and settings.json cannot. The browser asks again for
  permission to read a remembered file the first time it is reopened.
*/
const DB = "jspaintshop", STORE = "handles";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function rememberHandle(key: string, handle: FileSystemFileHandle): Promise<void> {
  try { await run("readwrite", (s) => s.put(handle, key)); } catch { /* storage refused: the entry just cannot reopen */ }
}

export async function recallHandle(key: string): Promise<FileSystemFileHandle | null> {
  try { return (await run("readonly", (s) => s.get(key))) ?? null; } catch { return null; }
}

export async function forgetHandle(key: string): Promise<void> {
  try { await run("readwrite", (s) => s.delete(key)); } catch { /* nothing to forget */ }
}

/** Ask for read permission on a remembered handle; false when refused. */
export async function canRead(handle: FileSystemFileHandle): Promise<boolean> {
  const h = handle as FileSystemFileHandle & { queryPermission?(o: { mode: string }): Promise<string>; requestPermission?(o: { mode: string }): Promise<string> };
  if (!h.queryPermission) return true;
  if ((await h.queryPermission({ mode: "read" })) === "granted") return true;
  return (await h.requestPermission?.({ mode: "read" })) === "granted";
}
