# JSPaintShop

A web image editor modelled on PSP 6.02, for the browser. It is written from scratch, with the same menus, tools, palettes and shortcuts as PSP 6, and its behaviour taken from a study of PSP 6 itself (resources, help, file formats, and its program code with Ghidra; see `tools/re/`).

It is being built in phases (see `docs/PARITY.md` for where each feature stands):

| Phase | What |
|---|---|
| 0 | The frame: every menu, shortcut and toolbar button from PSP 6, the tool palette, palettes and image windows |
| 1 | Images: New, Open, Save (PNG, JPEG, BMP, GIF, PSP), the image view, zoom, grid, rulers |
| 2 | Layers, blend modes, undo and Command History |
| 3 | Selections, masks, the clipboard, Mover and Crop |
| 4 | Painting tools, the color palette, gradients and patterns |
| 5 | The Image and Colors menus |
| 6 | Filters, effects, deformations, Picture Frames and Picture Tubes |
| 7 | Vector layers, text and adjustment layers |
| 8 | Preferences, Browse, Print, Batch Conversion, help and the remaining file formats |

## Running it

```sh
npm install
npm run dev
```

Node 22.18 or later. The build (`npm run build`) is a static site in `dist/` that runs from any folder of a web server.

## Layout

| Folder | What |
|---|---|
| `src/core` | Images, layers, edits, formats: plain TypeScript with no DOM, run in workers and tests |
| `src/worker` | The image worker |
| `src/app` | App state and the wiring between the shell and the core |
| `src/ui` | The frame (menus, toolbars, image windows, palettes) and the dialogs |
| `src/shared` | DOM builder, events, worker messaging, browser storage |
| `scripts` | Reads PSP 6's own resources from `Psp.exe` into the shell's tables and art |
| `tests` | `node --test` tests |

Settings are kept in the browser's private storage (OPFS) under `jspaintshop/`, where PSP 6 used the registry.

## Rebuilding the shell from Psp.exe

```sh
node scripts/psp-resources.mjs "/path/to/PSP 6 install"
```

This writes `src/ui/shell/psp-ui.generated.ts` (menus, commands, shortcuts, toolbars, cursor hotspots) and the PNGs in `public/ui/`. The program's name in menu texts and prompts becomes JSPaintShop, and the vendor's web links and companion programs are left out of the menus. The app icon, `public/jspaintshop.svg`, is JSPaintShop's own drawing.

## License

Apache License 2.0. See `NOTICE.md`.
