/* The tables generated from Psp.exe, and the key names the accelerator loop looks up. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCELERATORS, CMD, COMMANDS, MENUS, TOOLBARS, CURSORS, REMOVED, type MenuNode } from "../src/ui/shell/psp-ui.generated.ts";
import { acceleratorFor, keyName, plainLabel } from "../src/ui/shell/commands.ts";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const ids = new Set(COMMANDS.map((c) => c[0]));

function walk(nodes: MenuNode[], out: number[] = []): number[] {
  for (const n of nodes) {
    if (typeof n === "number") out.push(n);
    else if (typeof n === "object" && "items" in n) walk(n.items, out);
    else if (typeof n === "object") out.push(n.id);
  }
  return out;
}

test("the menu bars have PSP 6's top-level menus, without Capture", () => {
  const titles = (id: number) => MENUS[id].filter((n) => typeof n === "object" && "items" in n).map((n) => plainLabel((n as { label: string }).label));
  assert.deepEqual(titles(129), ["File", "Edit", "View", "Image", "Colors", "Layers", "Selections", "Masks", "Window", "Help"]);
  assert.deepEqual(titles(128), ["File", "Edit", "View", "Help"]);
});

test("browser-impossible items are gone: Import, Export plug-ins, help, keys to them", () => {
  const file = MENUS[129].find((n) => typeof n === "object" && "items" in n && n.label === "&File") as { items: MenuNode[] };
  assert.ok(!file.items.some((n) => typeof n === "object" && "items" in n && n.label === "&Import"));
  assert.ok(!JSON.stringify(MENUS).includes("@plugins"));
  const help = MENUS[129].find((n) => typeof n === "object" && "items" in n && n.label === "&Help") as { items: MenuNode[] };
  assert.deepEqual(help.items, [57664]);
  for (const t of Object.values(ACCELERATORS)) for (const id of Object.values(t)) assert.ok(!REMOVED.includes(id));
});

test("every command a menu, toolbar or key names is in the command table", () => {
  for (const [id, menu] of Object.entries(MENUS)) for (const c of walk(menu)) assert.ok(ids.has(c), `menu ${id} names ${c}`);
  for (const tb of [128, 161, 547]) for (const c of TOOLBARS[tb].ids) if (c && !REMOVED.includes(c)) assert.ok(ids.has(c), `toolbar ${tb} names ${c}`);
  for (const t of [128, 129]) for (const c of Object.values(ACCELERATORS[t])) assert.ok(ids.has(c), `accelerator ${t} names ${c}`);
});

test("the program is JSPaintShop: no vendor links, no PSP product name", () => {
  for (const r of REMOVED) assert.ok(!ids.has(r), `command ${r} is removed`);
  for (const [id, menu] of Object.entries(MENUS)) for (const c of walk(menu)) assert.ok(!REMOVED.includes(c), `menu ${id} names ${c}`);
  const text = JSON.stringify([COMMANDS, MENUS]);
  assert.ok(!/Paint Shop Pro|Jasc/i.test(text));
  assert.equal(COMMANDS.find((c) => c[0] === 57664)![2], "&About JSPaintShop...");
});

test("command names are unique and texts are split", () => {
  assert.equal(new Set(COMMANDS.map((c) => c[1])).size, COMMANDS.length);
  const fileNew = COMMANDS.find((c) => c[0] === 57600)!;
  assert.deepEqual(fileNew.slice(1), ["FILE_NEW", "&New...", "Ctrl+N", "Create a new image", "New"]);
  // Crop to Selection takes its label from string 23729, not the menu's placeholder.
  assert.equal(COMMANDS.find((c) => c[0] === CMD.IMAGE_CROP_TO_SELECTION)![2], "&Crop to Selection");
});

test("the tool palette has the 21 tools, Arrow to Vector Object Selection", () => {
  assert.equal(TOOLBARS[161].ids.length, 21);
  assert.equal(TOOLBARS[161].ids[0], CMD.TOOL_ARROW);
  assert.equal(TOOLBARS[161].ids[20], CMD.TOOL_VECTOR_OBJECT_SELECTION);
  assert.deepEqual(TOOLBARS[260].ids, TOOLBARS[161].ids);
});

test("accelerators: the image table first, then the frame's", () => {
  assert.equal(acceleratorFor("Ctrl+Z", true), CMD.EDIT_UNDO);
  assert.equal(acceleratorFor("Ctrl+Alt+Z", true), CMD.EDIT_REDO);
  assert.equal(acceleratorFor("Ctrl+Shift+Z", true), CMD.EDIT_COMMAND_HISTORY);
  assert.equal(acceleratorFor("F12", true), CMD.FILE_SAVE_AS);
  // P toggles the tool palette from the frame's table, with or without an image.
  assert.equal(acceleratorFor("P", false), CMD.TOOLBAR_TOOL_PALETTE);
  assert.equal(acceleratorFor("P", true), CMD.TOOLBAR_TOOL_PALETTE);
  assert.equal(acceleratorFor("Tab", false), CMD.PALETTES_TOGGLE_ALL);
  // Image commands need an image.
  assert.equal(acceleratorFor("Ctrl+I", false), undefined);
  assert.equal(acceleratorFor("Ctrl+I", true), CMD.IMAGE_FLIP);
});

test("keyName matches the tables' spelling", () => {
  const k = (key: string, code: string, mods: Partial<KeyboardEvent> = {}) => keyName({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key, code, ...mods });
  assert.equal(k("z", "KeyZ", { ctrlKey: true }), "Ctrl+Z");
  assert.equal(k("Z", "KeyZ", { metaKey: true, shiftKey: true }), "Ctrl+Shift+Z");
  assert.equal(k("!", "Digit1", { ctrlKey: true, shiftKey: true }), "Ctrl+Shift+1");
  assert.equal(k("Tab", "Tab"), "Tab");
  assert.equal(k("F12", "F12"), "F12");
  assert.equal(k("Ω", "KeyZ", { altKey: true }), "Alt+Z");
});

test("every cursor has a hotspot inside 32 x 32", () => {
  assert.ok(Object.keys(CURSORS).length >= 70);
  for (const [x, y] of Object.values(CURSORS)) assert.ok(x >= 0 && x < 32 && y >= 0 && y < 32);
});

/* The strips scripts/png.mjs writes: RGBA, 8 bits, every row with filter 0. */
function readStrip(name: string): { width: number; height: number; rgba: Uint8Array } {
  const b = readFileSync(new URL(`../public/ui/${name}`, import.meta.url));
  const width = b.readUInt32BE(16), height = b.readUInt32BE(20), idat: Buffer[] = [];
  for (let o = 8; o < b.length;) {
    const n = b.readUInt32BE(o);
    if (b.toString("latin1", o + 4, o + 8) === "IDAT") idat.push(b.subarray(o + 8, o + 8 + n));
    o += 12 + n;
  }
  const raw = inflateSync(Buffer.concat(idat)), rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (width * 4 + 1)], 0);
    rgba.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  }
  return { width, height, rgba };
}

test("toolbar strips: no button face, and a dark copy with light outlines", () => {
  for (const name of ["toolbar-main", "toolbar-main-large", "toolbar-extra", "tools", "tools-large"]) {
    const light = readStrip(`${name}.png`), dark = readStrip(`${name}-dark.png`);
    assert.deepEqual([dark.width, dark.height], [light.width, light.height], name);
    for (let i = 0; i < light.rgba.length; i += 4) {
      const [r, g, b, a] = light.rgba.subarray(i, i + 4);
      assert.equal(dark.rgba[i + 3], a, `${name}: alpha at ${i / 4}`);
      if (!a) continue;
      assert.ok(!(r === 192 && g === 192 && b === 192), `${name}: button face at ${i / 4}`);
      assert.ok(dark.rgba[i] + dark.rgba[i + 1] + dark.rgba[i + 2] > 0, `${name}: black outline at ${i / 4} in the dark copy`);
    }
  }
});
