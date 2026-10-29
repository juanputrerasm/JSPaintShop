/*
  Reads PSP 6's own resources out of Psp.exe and writes what the shell is built
  from:

    src/ui/shell/psp-ui.generated.ts   menus, command names and texts, accelerators, toolbars, cursor hotspots
    public/ui/*.png                    toolbar and tool palette strips, and *-dark.png for the dark theme
    public/ui/bmp/<name>.png           every BITMAP resource
    public/ui/cursors/<id>.png         every cursor group

    node scripts/psp-resources.mjs ["/path/to/PSP 6 install"]
    node scripts/psp-resources.mjs <dir> --parity    also writes docs/PARITY.md when it is absent

  Command ids are PSP's own numbers. Each also gets a name, made from its place in the menus
  (Image > Deformations > Circle is IMAGE_DEFORMATIONS_CIRCLE) or, for commands no menu
  lists, from its tooltip; tools are TOOL_<name>.
*/
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { PeResources, RT, parseMenu, parseStringBlock, parseAccelerators, parseToolbar, parseGroup, decodeDib } from "./pe.mjs";
import { encodePng } from "./png.mjs";

const install = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : join(homedir(), "programs/Paint Shop Pro 6");
const writeParity = process.argv.includes("--parity");
const root = new URL("../", import.meta.url).pathname;
const pe = new PeResources(readFileSync(join(install, "Psp.exe")));

// ---- Strings -------------------------------------------------------------------------------

const strings = new Map();
for (const n of pe.names(RT.STRING)) for (const [k, s] of parseStringBlock(n, pe.get(RT.STRING, n))) strings.set(k, s);

/*
  The app is JSPaintShop: PSP's own name in menu texts, prompts and tips becomes JSPaintShop.
  Left out of the menus and the command table altogether:
  - Jasc's links, online services and companion programs (Animation Shop, Image Robot);
  - what a browser cannot do: File > Import (TWAIN, digital cameras), the Capture menu, Export
    plug-ins, the Preferences for CMYK conversion, file formats, file associations, color
    management and monitor gamma, and PSP's WinHelp (Help Topics, How Do I, context help, Tip
    of the Day);
  - Digimarc watermarking (proprietary).
  Every command inside a removed submenu goes with it.
*/
const rename = (s) => s.replace(/Paint Shop Pro/g, "JSPaintShop");
const REMOVED_MENUS = new Set(["&Jasc Software Online", "&Import", "C&apture", "Watermar&king"]);
const REMOVED_SLOTS = new Set([65535]); // the Export plug-ins list
const REMOVED_IDS = new Set([
  33262, 34023, // Run Image Robot
  33688, 33773, 33775, // Run Animation Shop, Paste AS2 Animation, Update Back to Animation Shop
  34048, 34054, // Export > StudioAvenue
  33660, 33661, 33667, 33671, 33676, 33677, // Help > Jasc Software Online
  33254, 57666, 33915, 57669, // Tip of the Day, Help Topics, How Do I, context help
  33643, 32826, 33568, 33675, 33674, // Preferences: CMYK, file formats, associations, color management, monitor gamma
  34045, // End TWAIN Session
]);
/* The ids under a removed submenu are removed too. */
function removeAll(items) {
  for (const it of items) if (it.items) removeAll(it.items); else if (!it.separator) REMOVED_IDS.add(it.id);
}

/** "Create a new image\nNew" -> prompt and tip. */
function texts(id) {
  const s = strings.get(id) && rename(strings.get(id));
  if (!s) return { prompt: "", tip: "" };
  // A third part, on tools, names their options ("Paint Brush Options"); it is not shown.
  const [prompt, tip = ""] = s.split("\n");
  return { prompt, tip };
}

// ---- Menus ---------------------------------------------------------------------------------

/*
  Menu resources that hold real menus. 4, 5, 6 and 7 are MDI window-list variants of 128 and
  129 and 426 is a debug menu; they are left out.
*/
const MENU_IDS = { 128: "No image", 129: "Image", 130: "Browser", 450: "Print Multiple Images", 554: "Batch", 212: "Histogram", 290: "Brush", 292: "Layer", 436: "Toolbar", 469: "Edit context", 470: "Base edit context", 491: "Print layout image", 492: "Print layout page", 495: "Shape select", 497: "Node edit", 498: "Browser context", 499: "Add layer", 500: "Vector object", 501: "Quick mask", 550: "Text entry" };

const ID_RECENT = 57616, ID_LAYER_LIST = 33535, ID_NONE = 65535, ID_CROP = 33099;

const commands = new Map(); // id -> { name, label, shortcut, prompt, tip }

/* Keys with no string of their own: Tab hides and shows every palette (Tips.txt), Escape cancels. */
const UNNAMED = { 33605: ["PALETTES_TOGGLE_ALL", "Hide or show all palettes"], 32769: ["CANCEL", "Cancel the current operation"] };
const usedNames = new Set();

function clean(label) {
  return label.replace(/\t.*$/, "").replace(/&/g, "").replace(/\.\.\.$/, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").toUpperCase();
}

function addCommand(id, label, path) {
  if (commands.has(id)) return;
  if (UNNAMED[id]) {
    const [name, text] = UNNAMED[id];
    usedNames.add(name);
    commands.set(id, { name, label: text, shortcut: "", prompt: text, tip: text });
    return;
  }
  const [text, shortcut = ""] = rename(label).split("\t");
  let name = [...path, clean(text)].filter(Boolean).join("_") || `CMD_${id}`;
  if (/^[0-9]/.test(name)) name = `CMD_${name}`;
  if (usedNames.has(name)) name = `${name}_${id}`;
  usedNames.add(name);
  commands.set(id, { name, label: text, shortcut, ...texts(id) });
}

function convert(items, path, top) {
  const out = [];
  for (const it of items) {
    if (it.separator) { out.push("-"); continue; }
    if (it.items && REMOVED_MENUS.has(it.label)) { removeAll(it.items); continue; }
    if (!it.items && (REMOVED_IDS.has(it.id) || REMOVED_SLOTS.has(it.id))) continue;
    if (it.items) { out.push({ label: it.label, items: convert(it.items, [...path, clean(it.label)], false) }); continue; }
    if (it.id === ID_RECENT) { out.push("@recent"); continue; }
    if (it.id === ID_LAYER_LIST) { out.push("@layers"); continue; }
    if (it.id === ID_NONE) { out.push("@plugins"); continue; }
    let label = it.label;
    // The Crop item is renamed at run time from string 23729 (CROP PLACEHOLDER in the menu).
    if (it.id === ID_CROP) label = strings.get(23729) ?? label;
    addCommand(it.id, label, path);
    const c = commands.get(it.id);
    const [text] = rename(label).split("\t");
    out.push(text === c.label ? it.id : { id: it.id, label: text });
  }
  void top;
  return tidy(out);
}

/* No separator at either end of a menu or next to another, once Jasc's items are gone. */
function tidy(items) {
  return items.filter((it, i, a) => it !== "-" || (i > 0 && i < a.length - 1 && a[i - 1] !== "-"));
}

const menus = {};
for (const [id, title] of Object.entries(MENU_IDS)) {
  const raw = parseMenu(pe.get(RT.MENU, Number(id)));
  // Context menus are one popup holding the items; the popup's caption is only a name.
  const isBar = raw.length > 1 || Number(id) === 128 || Number(id) === 129 || Number(id) === 130;
  const prefix = isBar ? [] : [clean(title)];
  menus[id] = isBar ? convert(raw, prefix, true) : convert(raw.flatMap((p) => p.items ?? []), prefix, true);
}

// ---- Toolbars ------------------------------------------------------------------------------

const toolbars = {};
for (const n of pe.names(RT.TOOLBAR)) toolbars[n] = parseToolbar(pe.get(RT.TOOLBAR, n));
for (const id of toolbars[161].ids) {
  const { tip } = texts(id);
  if (!commands.has(id)) addCommand(id, tip, ["TOOL"]);
}

// ---- Accelerators --------------------------------------------------------------------------

const VK = { 8: "Backspace", 9: "Tab", 13: "Enter", 27: "Escape", 32: "Space", 33: "PageUp", 34: "PageDown", 35: "End", 36: "Home", 37: "ArrowLeft", 38: "ArrowUp", 39: "ArrowRight", 40: "ArrowDown", 45: "Insert", 46: "Delete", 107: "+", 109: "-", 187: "=", 189: "-" };
function keyLabel(a) {
  let key;
  if (a.virt) {
    if ((a.key >= 0x30 && a.key <= 0x39) || (a.key >= 0x41 && a.key <= 0x5a)) key = String.fromCharCode(a.key);
    else if (a.key >= 0x70 && a.key <= 0x87) key = `F${a.key - 0x6f}`;
    else key = VK[a.key] ?? `VK${a.key}`;
  } else key = String.fromCharCode(a.key).toUpperCase();
  // The same order as keyName() in commands.ts.
  return [a.ctrl && "Ctrl", a.alt && "Alt", a.shift && "Shift", key].filter(Boolean).join("+");
}
const accelerators = {};
for (const n of pe.names(RT.ACCELERATOR)) {
  const table = {};
  for (const a of parseAccelerators(pe.get(RT.ACCELERATOR, n))) table[keyLabel(a)] = a.cmd;
  accelerators[n] = table;
}

// Commands that only a toolbar or a key reaches still get a name and texts.
for (const tb of Object.values(toolbars)) for (const id of tb.ids) if (id && !commands.has(id) && !REMOVED_IDS.has(id)) addCommand(id, texts(id).tip || `CMD_${id}`, []);
for (const t of [128, 129]) for (const id of Object.values(accelerators[t])) if (!commands.has(id) && !REMOVED_IDS.has(id)) addCommand(id, texts(id).tip || `CMD_${id}`, []);

// ---- Images --------------------------------------------------------------------------------

mkdirSync(join(root, "public/ui/bmp"), { recursive: true });
mkdirSync(join(root, "public/ui/cursors"), { recursive: true });

/* MFC draws a toolbar strip's light grey (192,192,192) as the button face: make it transparent. */
function keyOutGrey(rgba) {
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i] === 192 && rgba[i + 1] === 192 && rgba[i + 2] === 192) rgba[i + 3] = 0;
  return rgba;
}

/*
  The dark theme's copy of a strip. The art uses only the 16 Windows colors and is not
  antialiased, so colors swap exactly: the outlines turn light, and the dark colors are
  lightened so they still read on the dark frame. Everything else stays.
*/
const DARK = new Map([
  ["0,0,0", [230, 229, 226]],
  ["128,128,128", [150, 150, 150]],
  ["0,0,128", [110, 150, 240]],
  ["0,0,255", [90, 130, 255]],
  ["128,0,0", [220, 90, 90]],
  ["128,128,0", [190, 180, 70]],
  ["0,128,0", [90, 190, 90]],
  ["0,128,128", [70, 180, 180]],
  ["128,0,128", [190, 110, 190]],
]);
function darkArt(rgba) {
  const out = Uint8Array.from(rgba);
  for (let i = 0; i < out.length; i += 4) {
    const to = out[i + 3] ? DARK.get(`${out[i]},${out[i + 1]},${out[i + 2]}`) : undefined;
    if (to) [out[i], out[i + 1], out[i + 2]] = to;
  }
  return out;
}

const strips = { 128: "toolbar-main.png", 264: "toolbar-main-large.png", 161: "tools.png", 260: "tools-large.png", 547: "toolbar-extra.png", 481: "toolbar-481.png" };
for (const n of pe.names(RT.BITMAP)) {
  const img = decodeDib(pe.get(RT.BITMAP, n));
  const name = typeof n === "number" ? String(n) : n.toLowerCase();
  writeFileSync(join(root, "public/ui/bmp", `${name}.png`), encodePng(img.width, img.height, img.rgba));
  if (!strips[n]) continue;
  const light = keyOutGrey(img.rgba);
  writeFileSync(join(root, "public/ui", strips[n]), encodePng(img.width, img.height, light));
  writeFileSync(join(root, "public/ui", strips[n].replace(".png", "-dark.png")), encodePng(img.width, img.height, darkArt(light)));
}

const cursors = {};
for (const g of pe.names(RT.GROUP_CURSOR)) {
  const [entry] = parseGroup(pe.get(RT.GROUP_CURSOR, g), true);
  const data = pe.get(RT.CURSOR, entry.id);
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const hot = [v.getUint16(0, true), v.getUint16(2, true)];
  const img = decodeDib(data, 4, { height: entry.height, mask: true });
  writeFileSync(join(root, "public/ui/cursors", `${g}.png`), encodePng(img.width, img.height, img.rgba));
  cursors[g] = hot;
}


// ---- The generated module ------------------------------------------------------------------

// No removed command keeps a name or a key (F1, Shift+F1, Shift+C...).
for (const id of REMOVED_IDS) commands.delete(id);
for (const table of Object.values(accelerators)) for (const [k, id] of Object.entries(table)) if (REMOVED_IDS.has(id)) delete table[k];

const list = [...commands.entries()].sort((a, b) => a[0] - b[0]);
const q = (s) => JSON.stringify(s);
const ts = `/*
  Generated by scripts/psp-resources.mjs from Psp.exe (PSP 6.02). Do not edit.

  COMMANDS   every command: [id, name, label, shortcut text, status prompt, tooltip]
  MENUS      MENU resources by id: 128 no image open, 129 image open, 130 Browser, the rest
             context menus. An entry is a command id, "-" (separator), a submenu, a command
             with this menu's own label, or a slot ("@recent", "@layers", "@plugins").
  ACCELERATORS  ACCELERATOR tables by id, "Ctrl+Alt+Shift+Key" -> command id. MFC tries the
             active image window's table (129) first, then the frame's (128).
  TOOLBARS   TOOLBAR resources: button size and ids (0 is a separator). 128 main toolbar,
             161 tool palette, 264 and 260 their large-button versions, 547 extra buttons.
  CURSORS    cursor group id -> hotspot [x, y]; the image is public/ui/cursors/<id>.png.
  REMOVED    the vendor's links and companion programs, left out of the menus and COMMANDS;
             a toolbar may still list one, as it holds that button's place in the strip.
*/
export type MenuNode = number | "-" | \`@\${string}\` | { label: string; items: MenuNode[] } | { id: number; label: string };

export const COMMANDS: [number, string, string, string, string, string][] = [
${list.map(([id, c]) => `  [${id}, ${q(c.name)}, ${q(c.label)}, ${q(c.shortcut)}, ${q(c.prompt)}, ${q(c.tip)}],`).join("\n")}
];

export const CMD = {
${list.map(([id, c]) => `  ${c.name}: ${id},`).join("\n")}
} as const;

export const MENUS: Record<number, MenuNode[]> = ${JSON.stringify(menus, null, 1).replace(/\n\s*/g, " ")};

export const ACCELERATORS: Record<number, Record<string, number>> = ${JSON.stringify(accelerators, null, 1).replace(/\n\s*/g, " ")};

export const TOOLBARS: Record<number, { width: number; height: number; ids: number[] }> = ${JSON.stringify(toolbars).replace(/\n\s*/g, " ")};

export const CURSORS: Record<number, [number, number]> = ${JSON.stringify(cursors)};

export const REMOVED: number[] = ${JSON.stringify([...REMOVED_IDS].sort((a, b) => a - b))};
`;
writeFileSync(join(root, "src/ui/shell/psp-ui.generated.ts"), ts);

// ---- PARITY.md skeleton --------------------------------------------------------------------

if (writeParity && !existsSync(join(root, "docs/PARITY.md"))) {
  const rows = [];
  const walk = (items, prefix) => {
    for (const it of items) {
      if (typeof it === "number") rows.push(`| [ ] | ${prefix}${commands.get(it).label.replace(/&/g, "")}${commands.get(it).shortcut ? ` (${commands.get(it).shortcut})` : ""} | Not yet |`);
      else if (typeof it === "string" && it.startsWith("@")) rows.push(`| [ ] | ${prefix}${{ "@recent": "Recent files", "@layers": "Layer list (Ctrl+1..9)", "@plugins": "Export plug-ins" }[it] ?? it} | Not yet |`);
      else if (typeof it === "object" && "id" in it) rows.push(`| [ ] | ${prefix}${it.label.replace(/&/g, "")} | Not yet |`);
      else if (typeof it === "object") walk(it.items, `${prefix}${it.label.replace(/&/g, "")} > `);
    }
  };
  let md = `# Parity with PSP 6.02

Every menu item, tool, palette, dialog and file format of PSP 6.02, and where JSPaintShop stands on it. Statuses:

- **Ported**: works as in PSP 6.
- **Changed**: works, differently (the reason is given).
- **Added**: not in PSP 6.
- **Not ported**: left out (the reason is given).
- **Not yet**: listed and greyed out, still to do.

The box is ticked by hand after checking the item against PSP 6 in a browser.
`;
  for (const top of menus[129]) {
    if (typeof top !== "object" || !("items" in top)) continue;
    rows.length = 0;
    walk(top.items, "");
    md += `\n## ${top.label.replace(/&/g, "")} menu\n\n| | Item | Status |\n|---|---|---|\n${rows.join("\n")}\n`;
  }
  md += `\n## Tools\n\n| | Item | Status |\n|---|---|---|\n${toolbars[161].ids.map((id) => `| [ ] | ${commands.get(id).label} | Not yet |`).join("\n")}\n`;
  for (const id of [212, 290, 292, 495, 497, 499, 500, 501, 550]) {
    rows.length = 0;
    walk(menus[id], "");
    md += `\n## ${MENU_IDS[id]} context menu\n\n| | Item | Status |\n|---|---|---|\n${rows.join("\n")}\n`;
  }
  md += `\n## Palettes and windows\n\n| | Item | Status |\n|---|---|---|\n${["Main toolbar", "Tool palette", "Tool Options palette", "Color palette", "Layer palette", "Histogram window", "Brush tip palette", "Status bar", "Image windows (MDI)", "Browser window"].map((s) => `| [ ] | ${s} | Not yet |`).join("\n")}\n`;
  writeFileSync(join(root, "docs/PARITY.md"), md);
}

console.log(`${commands.size} commands, ${Object.keys(menus).length} menus, ${Object.keys(accelerators).length} accelerator tables, ${pe.names(RT.BITMAP).length} bitmaps, ${Object.keys(cursors).length} cursors`);
