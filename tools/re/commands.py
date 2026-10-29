"""Map PSP 6's command objects: command id -> script name, factory, class vtable and its run method.

PSP 6 wraps each image command in an object (that is what Command History lists). A
registration function fills a descriptor {id, script name, factory}; the factory news the object,
whose constructor stores the class vtable; the dispatcher (0x6fc610) calls vtable+0x14 to run it.

    re/venv/bin/python tools/re/commands.py > re/out/commands.tsv
"""
import re
import struct

from recommon import IMAGE_BASE, image, decompiled_blocks

img = image()


def u32(va):
    return struct.unpack_from("<I", img, va - IMAGE_BASE)[0]


def follow(va):
    """Through 5-byte jmp thunks to the real function."""
    for _ in range(4):
        o = va - IMAGE_BASE
        if img[o] == 0xE9:
            va = va + 5 + struct.unpack_from("<i", img, o + 1)[0]
        else:
            break
    return va


blocks = {}
for start, name, text in decompiled_blocks():
    blocks[start] = (name, text)

desc = re.compile(r"\*param_1 = 0x([0-9a-f]+);\s*param_1\[1\] = s_(\w+?)_[0-9a-f]{8};\s*param_1\[2\] = (?:&?(?:LAB|FUN)_|thunk_FUN_)([0-9a-f]{8});")
vt = re.compile(r"\*\w+ = &PTR_GetRuntimeClass_([0-9a-f]{8});")
rows = []
for start, (name, text) in blocks.items():
    m = desc.search(text)
    if not m:
        continue
    cid, script, factory = int(m.group(1), 16), m.group(2), follow(int(m.group(3), 16))
    # The factory, then the constructor it calls: the last vtable it stores is the class's.
    vtable = None
    seen = [factory]
    for fva in seen[:6]:
        b = blocks.get(fva)
        if not b:
            continue
        found = vt.findall(b[1])
        if found and vtable is None:
            vtable = int(found[0], 16)
        for callee in re.findall(r"(?:thunk_)?FUN_([0-9a-f]{8})\(", b[1])[:3]:
            seen.append(follow(int(callee, 16)))
    run = follow(u32(vtable + 0x14)) if vtable else 0
    rows.append((cid, script, factory, vtable or 0, run))
for cid, script, factory, vtable, run in sorted(rows):
    print(f"{cid}\t{script}\t{factory:x}\t{vtable:x}\t{run:x}")
