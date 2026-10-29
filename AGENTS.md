# Working on JSPaintShop

JSPaintShop is a web image editor modelled on PSP 6.02. TypeScript, Vite, Canvas 2D, OPFS for files, Web Workers for heavy work. No runtime dependencies.

## Rules

- **PSP 6 is the reference.** What JSPaintShop does comes from the program itself: its resources in `Psp.exe` (menus, strings, dialogs, toolbars, cursors), its code decompiled with Ghidra, its help (`Psp.hlp`, `Psp.cnt`) and its stock files. Cite where a behaviour comes from in a comment: a resource id ("DIALOG 302 Toolbars", "MENU 436"), a function address in `Psp.exe` ("Psp.exe 0x4a1230, Buttonize"), or a help topic.
- **Reverse engineering, as in OpenMTM2.** `tools/re/decompile.sh` builds `re/` (Ghidra project, `re/out/decomp.c`, `functions.tsv`, `strings.tsv`, `cg.json`, `msgmaps.txt`) from a local install. `re/` is git-ignored and **must never be published, copied into `src/`, or quoted in commits**. Find a feature from its command id (`msgmap.py`, `imm.py`) or dialog id, read it with `fn.py`, and write the facts (formulas, constants, order of operations) into `docs/PSP_EXE_ANALYSIS.md`; the TypeScript is written from that document in this codebase's own style, never pasted from the decompiler.
- **The UI follows PSP 6's frame.** Menus, shortcuts, prompts, tooltips and button art are generated from `Psp.exe` by `scripts/psp-resources.mjs` into `src/ui/shell/psp-ui.generated.ts` and `public/ui/`. Never edit the generated files; fix the script. The `*-dark.png` strips (the dark theme's recolored button art) are generated the same way. Commands use PSP's own ids (`CMD.FILE_NEW` is 57600). A command with no behaviour yet stays listed and greyed out, so the menus always show the whole of PSP 6, except what the script leaves out (REMOVED in the generated file): the vendor's web links and companion programs, and what a browser cannot do (TWAIN and camera import, Capture, Export plug-ins, the CMYK, file format, association, color management and gamma preferences, WinHelp and Tip of the Day, Digimarc watermarks). File > Import (Picture Tubes, Picture Frames, Gradients, Patterns, Textures, User Defined Filters; src/app/import-resources.ts) is JSPaintShop's own.
- **The app is JSPaintShop.** PSP's full product name never appears in the UI: the script renames it in menus and prompts, and the icon is `public/jspaintshop.svg`. Format signatures that contain the name (the `.psp` header, `JASC-PAL`, `JASC_FILT`) stay as they are.
- **`src/core` and `src/worker` never touch the DOM.** They take and return plain data, so they run in workers and under `node --test`. `tests/layering.test.ts` checks this.
- **File formats live in `src/core/formats`**, as plain functions over bytes.
- **Tests.** `npm test` runs `node --test tests/`. Checks that need PSP 6's own files read a local install (`JSPAINTSHOP_PSP6`, default `~/programs/Paint Shop Pro 6`, the install's folder name) and skip when it is absent. PSP's program files and stock content are never committed.
- **Parity.** `docs/PARITY.md` lists every menu item, tool, palette and dialog with its status. Update it with each change; the boxes are ticked by hand after testing in a browser.
- **Docs and comments** never use em dashes.

## Commands

```sh
npm run dev         # Vite dev server
npm run typecheck
npm test
npm run build
npm run assets      # regenerate the shell tables and art from Psp.exe (path as first argument)
```
