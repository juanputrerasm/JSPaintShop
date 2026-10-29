"""For every filter/deformation/effect command (ids 33005-33079 and the others on the effect
base class), the pixel routine its apply method (vtable slot 16) calls, with the size of that
routine's decompiled text.

    re/venv/bin/python tools/re/effects.py
"""
import re
import struct

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


blocks = {s: t for s, n, t in decompiled_blocks()}
for line in open("re/out/commands.tsv"):
    cid, name, fac, vt, run = line.rstrip("\n").split("\t")
    if run != "5c0b20" or vt == "0":
        continue
    apply = follow(u32(int(vt, 16) + 16 * 4))
    text = blocks.get(apply, "")
    callees = [c for c in re.findall(r"(?:thunk_)?FUN_([0-9a-f]{8})\(", text) if not c.startswith("005bc") and not c.startswith("004da")]
    core = [follow(int(c, 16)) for c in callees]
    core = [c for c in core if c not in (apply,)]
    sizes = [(f"{c:x}", len(blocks.get(c, ""))) for c in dict.fromkeys(core)]
    print(cid, name, f"{apply:x}", sizes[:3])
