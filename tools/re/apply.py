"""Print a command's apply method (vtable slot 16) and the functions it calls, by script name.

    re/venv/bin/python tools/re/apply.py AdjBright [slot]
"""
import re
import struct
import sys

from recommon import IMAGE_BASE, image, decompiled_blocks

img = image()


def u32(va):
    return struct.unpack_from("<I", img, va - IMAGE_BASE)[0]


def follow(va):
    for _ in range(4):
        o = va - IMAGE_BASE
        if img[o] == 0xE9:
            va = va + 5 + struct.unpack_from("<i", img, o + 1)[0]
        else:
            break
    return va


name, slot = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 16
rows = [l.split("\t") for l in open("re/out/commands.tsv")]
vt = next(int(r[3], 16) for r in rows if r[1] == name)
fn = follow(u32(vt + slot * 4))
blocks = {s: t for s, n, t in decompiled_blocks()}
text = blocks.get(fn, "")
print(text)
for callee in dict.fromkeys(re.findall(r"thunk_FUN_([0-9a-f]{8})", text)):
    print(f"-> thunk {callee} = {follow(int(callee, 16)):x}")
