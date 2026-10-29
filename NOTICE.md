# Notice

JSPaintShop is an independent web image editor modelled on Jasc Paint Shop Pro 6.02. It is written from scratch in TypeScript. PSP 6's behaviour was studied from the program itself: its resources, its help, its file formats and its machine code, analysed with Ghidra for interoperability and faithfulness. No Jasc source code was available or used, and no decompiled code is part of JSPaintShop.

It is not affiliated with, endorsed by or connected to Jasc Software, Corel or their successors. Paint Shop Pro is a trademark of its owner.

The menu texts, command prompts, shortcuts, and the toolbar, tool and cursor art are generated from `Psp.exe` by `scripts/psp-resources.mjs` and included in the app (`src/ui/shell/psp-ui.generated.ts`, `public/ui/`), so the interface matches the program it follows. JSPaintShop ships none of Jasc's program code, libraries, help or stock content (brushes, gradients, patterns, textures, tubes, frames); those are read from a user's own copy when they choose to import them.

If you hold rights in Paint Shop Pro and have a concern, please open an issue on the project's repository.
