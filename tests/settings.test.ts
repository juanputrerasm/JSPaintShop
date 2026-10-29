/* Stored settings come back valid whatever was stored. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSettings, mergeSettings, RECENT_MAX } from "../src/core/settings.ts";

test("garbage gives the defaults", () => {
  for (const junk of [null, 3, "x", [], { bars: 7, tool: "a", panels: [1] }]) assert.deepEqual(mergeSettings(junk), defaultSettings());
});

test("valid values are kept, invalid ones fall back", () => {
  const s = mergeSettings({
    theme: "dark", largeIcons: true, tool: 10010, bars: { toolbar: false, statusbar: "no" },
    panels: { layers: { x: 1, y: 2, w: 3, h: 4, open: true }, bad: { x: 1 } },
    recent: ["a.psp", 5, "", "b.png", "c", "d", "e"], toolbarButtons: [57600, 0, -1],
  });
  assert.equal(s.theme, "dark");
  assert.equal(s.largeIcons, true);
  assert.equal(s.tool, 10010);
  assert.equal(s.bars.toolbar, false);
  assert.equal(s.bars.statusbar, true);
  assert.deepEqual(Object.keys(s.panels), ["layers"]);
  assert.deepEqual(s.recent, ["a.psp", "b.png", "c", "d"].slice(0, RECENT_MAX));
  assert.deepEqual(s.toolbarButtons, defaultSettings().toolbarButtons);
});

test("a tool outside the palette falls back to the Arrow", () => {
  assert.equal(mergeSettings({ tool: 33000 }).tool, 10001);
});

test("preferences keep PSP's defaults, clamp numbers and drop bad types", () => {
  const d = defaultSettings().prefs;
  assert.equal(d.undo.memoryMB, 20);
  assert.equal(d.misc.pasteTolerance, 10);
  assert.equal(d.rulers.gridColor, "#c0c0c0");
  const s = mergeSettings({ prefs: { undo: { steps: 5000, enabled: "no", limitSteps: true }, browser: { thumbSize: 77 }, rulers: { gridColor: "red", gridX: 25 } } });
  assert.equal(s.prefs.undo.steps, 999);
  assert.equal(s.prefs.undo.enabled, true);
  assert.equal(s.prefs.undo.limitSteps, true);
  assert.equal(s.prefs.browser.thumbSize, 100);
  assert.equal(s.prefs.rulers.gridColor, "#c0c0c0");
  assert.equal(s.prefs.rulers.gridX, 25);
  // The old single grid spacing still loads.
  assert.equal(mergeSettings({ gridSpacing: 32 }).prefs.rulers.gridY, 32);
});
