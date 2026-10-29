/* Path helpers for OPFS paths ("jspaintshop/settings.json") and file names. */

export function joinPath(...parts: (string | null | undefined | false)[]): string {
  return parts
    .filter((p): p is string => Boolean(p))
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

export function splitPath(value: string): string[] {
  return String(value ?? "").split("/").map((p) => p.trim()).filter(Boolean);
}

/** "photo.PSP" -> ".psp" ("" when there is none). */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/** "a/b/photo.psp" -> "photo". */
export function basenameWithoutExtension(name: string): string {
  const base = name.split("/").pop() ?? name;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}
