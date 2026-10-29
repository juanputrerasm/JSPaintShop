/*
  Pictures on the system clipboard, for Copy and the Paste commands (PSP
  uses CF_DIB). Browsers hand images over as PNG, and only from a page that has the focus;
  reading asks the user's permission the first time.
*/

export async function copyImage(rgba: Uint8ClampedArray, width: number, height: number): Promise<void> {
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

/** The first picture on the clipboard as RGBA, or null when there is none. */
export async function pasteImage(): Promise<{ width: number; height: number; rgba: Uint8ClampedArray } | null> {
  if (!navigator.clipboard?.read) return null;
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith("image/"));
    if (!type) continue;
    const bitmap = await createImageBitmap(await item.getType(type));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = canvas.getContext("2d")!;
    g.drawImage(bitmap, 0, 0);
    bitmap.close();
    return { width: canvas.width, height: canvas.height, rgba: g.getImageData(0, 0, canvas.width, canvas.height).data };
  }
  return null;
}

/** Whether the clipboard may hold a picture (to enable the Paste commands); false when the browser cannot say. */
export async function clipboardHasImage(): Promise<boolean> {
  try {
    const items = await navigator.clipboard.read();
    return items.some((i) => i.types.some((t) => t.startsWith("image/")));
  } catch {
    return false;
  }
}
