/* Settings persistence: jspaintshop/settings.json in OPFS. */
import { mergeSettings, defaultSettings, type PspSettings } from "../core/settings.ts";
import { ROOT, readTextFile, writeBytesToFile } from "./opfs.ts";

const PATH = `${ROOT}/settings.json`;

export async function loadSettings(): Promise<PspSettings> {
  try {
    return mergeSettings(JSON.parse(await readTextFile(PATH)));
  } catch {
    return defaultSettings();
  }
}

export async function saveSettings(settings: PspSettings): Promise<void> {
  await writeBytesToFile(PATH, new TextEncoder().encode(JSON.stringify(settings, null, 2)));
}
