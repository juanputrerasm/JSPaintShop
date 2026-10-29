/*
  The layering rule from AGENTS.md, checked: src/core imports only src/core, and src/worker
  only src/core and the worker-safe shared helpers. Neither touches the DOM.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

const src = resolve(import.meta.dirname, "../src");
const WORKER_SHARED = ["shared/worker-host.ts", "shared/opfs.ts", "shared/path-utils.ts", "shared/emitter.ts"];
const DOM = /\b(document|window|HTMLElement|HTMLCanvasElement|localStorage|sessionStorage)\b/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

function code(path: string): string {
  // Comments may name the DOM; only code counts.
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function imports(text: string): string[] {
  return [...text.matchAll(/(?:import|export)[^"']*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2]);
}

function check(area: "core" | "worker", allowed: (target: string) => boolean): void {
  for (const file of files(join(src, area))) {
    const text = code(file);
    const rel = relative(src, file);
    assert.ok(!DOM.test(text), `${rel} uses the DOM`);
    for (const spec of imports(text)) {
      if (spec.startsWith("node:")) assert.fail(`${rel} imports ${spec}`);
      if (!spec.startsWith(".")) continue;
      const target = relative(src, resolve(dirname(file), spec)).replaceAll("\\", "/");
      assert.ok(allowed(target), `${rel} imports ${target}`);
    }
  }
}

test("src/core imports only src/core and never touches the DOM", () => {
  check("core", (t) => t.startsWith("core/"));
});

test("src/worker imports only src/core, src/worker and worker-safe helpers", () => {
  check("worker", (t) => t.startsWith("core/") || t.startsWith("worker/") || WORKER_SHARED.includes(t));
});
