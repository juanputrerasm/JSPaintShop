# Psp.exe reverse-engineering helpers

Tools for studying Paint Shop Pro 6.02's `Psp.exe` with Ghidra, adapted from OpenMTM2's
`tools/re`. The findings go into `docs/PSP_EXE_ANALYSIS.md`; JSPaintShop's code is written from
that document.

The decompiled code, the Ghidra project and working notes live in `re/` at the repository root.
That folder is **git-ignored and must never be published**: it is derived from Jasc's code. Only
facts, layouts, formulas and constants go into the docs and the source.

## Setup

```sh
brew install ghidra
PSP6_DIR="$HOME/programs/Paint Shop Pro 6" tools/re/decompile.sh
```

This analyses `Psp.exe`, creates the functions only reached through MFC message maps and vtables
(`FindFuncs.java`), exports every function decompiled to `re/out/decomp.c` with
`functions.tsv` and `strings.tsv` (with cross-references), builds the call graph (`cg.json`),
the strings each function uses (`func_strings.txt`) and the MFC message maps (`msgmaps.txt`:
which handler each command id runs). It also creates `re/venv` with `pefile` and `capstone`.

## Helpers

Run them with `re/venv/bin/python` from the repository root. Addresses are hexadecimal without `0x`.

| Script | Does |
|---|---|
| `fn.py 0047dce0 FUN_00470810` | prints decompiled functions by any address inside them or by name |
| `rd.py 618d38` | reads a constant as float, double and int |
| `disasm.py 585da0 0x100` | disassembles from an address |
| `xref.py 585da0` | finds callers and pointers to an address |
| `cg.py calls\|callers\|tree FUN_00470810` | queries the call graph |
| `consts.py 467a00 4bb700` | lists the floating-point constants each function in a range uses |
| `imm.py 33050` | finds instructions carrying an immediate (command ids, dialog ids) |
| `msgmap.py` | lists every MFC message map: class, command ids and handler addresses |
| `DecompAt.java` | Ghidra post-script: decompiles functions at given addresses |

## Finding a feature

1. Its command id is in `src/ui/shell/psp-ui.generated.ts` (`CMD.IMAGE_EFFECTS_BUTTONIZE`).
2. `msgmaps.txt` gives the handler for that id; `fn.py` prints it.
3. The handler usually opens the dialog (its id is in the resources) and then calls the worker
   function; follow it with `cg.py calls`.

## jff.dll (file formats)

PSP 6's file codecs (`DecodeRAW`, `EncodeSCT`, ...) live in `jff.dll`, not in `Psp.exe`. Analyse it into its own project with the same export script:

```sh
mkdir -p re/jff/out && cp "$PSP6_DIR/jff.dll" re/jff/
"$(brew --prefix ghidra)/libexec/support/analyzeHeadless" re/jff proj -import re/jff/jff.dll \
  -scriptPath tools/re -postScript ExportAll.java re/jff/out
```

`re/jff/out/decomp.c` then holds every function by its exported name.
