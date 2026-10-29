/*
  Commands: everything a menu item, toolbar button or shortcut can do, by PSP's own command
  id (CMD.FILE_NEW is 57600, as in Psp.exe).

  Labels, shortcut texts, status prompts and tooltips come from Psp.exe's menus and string
  table, through psp-ui.generated.ts. A command with no `run` yet is shown greyed out, so the
  menus already list everything PSP 6 has.
*/
import type { AppState } from "../../app/state.ts";
import { ACCELERATORS, COMMANDS, type MenuNode } from "./psp-ui.generated.ts";

export { CMD, MENUS, TOOLBARS, CURSORS } from "./psp-ui.generated.ts";
export type { MenuNode };

export interface Command {
  id: number;
  name: string;
  /** Menu text with its "&" mnemonic. */
  label: string;
  /** Shortcut as shown in menus ("Ctrl+S"). */
  shortcut?: string;
  /** Status bar prompt shown while the item is hovered. */
  prompt?: string;
  /** Toolbar tooltip. */
  tip?: string;
  run?: () => unknown;
  enabled?: () => boolean;
  checked?: () => boolean;
}

export class CommandRegistry {
  private map = new Map<number, Command>();
  private app: AppState;

  constructor(app: AppState) {
    this.app = app;
    for (const [id, name, label, shortcut, prompt, tip] of COMMANDS) this.map.set(id, { id, name, label, shortcut, prompt, tip: tip || prompt });
  }

  /** Attach behaviour to a command. */
  bind(id: number, run: Command["run"], extra: Partial<Command> = {}): void {
    const c = this.map.get(id);
    if (!c) throw new Error(`Unknown command ${id}`);
    Object.assign(c, extra, { run });
    this.app.emit("commands", undefined);
  }

  /** Make `id` run `target` (context menu copies of menu commands, under their own ids in Psp.exe). */
  alias(id: number, target: number): void {
    this.bind(id, () => this.exec(target), { enabled: () => this.isEnabled(target), checked: () => this.isChecked(target) });
  }

  get(id: number): Command | undefined {
    return this.map.get(id);
  }

  all(): Command[] {
    return [...this.map.values()];
  }

  isEnabled(id: number): boolean {
    const c = this.map.get(id);
    return Boolean(c?.run) && (c?.enabled?.() ?? true);
  }

  isChecked(id: number): boolean {
    return this.map.get(id)?.checked?.() ?? false;
  }

  async exec(id: number): Promise<void> {
    const c = this.map.get(id);
    if (!c?.run || !this.isEnabled(id)) return;
    try {
      await c.run();
    } catch (err) {
      console.error(err);
      this.app.status(err instanceof Error ? err.message : String(err));
    }
    this.app.emit("commands", undefined);
  }
}

/*
  The command a key runs. MFC tries the active image window's table (129) first, then the
  frame's (128), so with an image open both apply; with none, only the frame's.
*/
export function acceleratorFor(key: string, hasImage: boolean, browser = false): number | undefined {
  if (browser) return ACCELERATORS[130][key] ?? ACCELERATORS[128][key];
  return (hasImage ? ACCELERATORS[129][key] : undefined) ?? ACCELERATORS[128][key];
}

/** "Ctrl+Alt+Shift+Z" for a keyboard event, in the order the generated tables use; Cmd counts as Ctrl on macOS. */
export function keyName(e: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "key" | "code">): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  let key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  // Letters and digits by position, so Shift+1 is "1" and Alt+letter on a Mac is the letter.
  if (e.code.startsWith("Key")) key = e.code.slice(3);
  else if (e.code.startsWith("Digit")) key = e.code.slice(5);
  else if (key === " ") key = "Space";
  parts.push(key);
  return parts.join("+");
}

/** "&Save As..." -> "Save As...". */
export function plainLabel(label: string): string {
  return label.replace(/&(.)/g, "$1");
}
