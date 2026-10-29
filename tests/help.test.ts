/* WinHelp reading (Help > Help Topics). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { contextHash, lz77, readContents, readHelp } from "../src/core/help/winhelp.ts";

test("LZ77: literals and a back reference", () => {
  // Flags 0b0000_1000: three literals "abc", then (len 3+3=6, distance 3) -> "abcabc".
  const src = Uint8Array.from([0x08, 0x61, 0x62, 0x63, 0x02, 0x30]);
  assert.equal(new TextDecoder().decode(lz77(src, 0, src.length)), "abcabcabc");
});

test("context hash and the contents file", () => {
  assert.equal(contextHash(""), 0);
  assert.equal(contextHash("A"), 17);
  assert.equal(contextHash("a1"), 17 * 43 + 1);
  const c = readContents(":Base Psp.hlp>Main\r\n1 Getting Started\r\n2 Welcome=Welcome_to_PSP@Psp.hlp\r\n");
  assert.deepEqual(c, [{ level: 1, title: "Getting Started", context: null }, { level: 2, title: "Welcome", context: "Welcome_to_PSP" }]);
});

const install = process.env.JSPAINTSHOP_PSP6 ?? `${process.env.HOME}/programs/Paint Shop Pro 6`;
test("Psp.hlp: topics, contents targets and pictures", { skip: !install || !existsSync(join(install ?? "", "Psp.hlp")) }, () => {
  const h = readHelp(new Uint8Array(readFileSync(join(install!, "Psp.hlp"))));
  assert.ok(h.topics.length > 1000);
  const cnt = readContents(readFileSync(join(install!, "Psp.cnt"), "latin1"));
  for (const e of cnt) if (e.context) assert.ok(h.find(e.context) >= 0, e.context);
  assert.ok(h.topics[h.find("Welcome_to_Paint_Shop_Pro_6")].title.startsWith("Welcome"));
  assert.ok(h.picture("|bm0"));
});
