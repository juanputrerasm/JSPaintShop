"""Find instructions in .text carrying a 32-bit immediate (push, mov, cmp...), with their function.

Dialog templates, command ids and string ids are reached this way.

    python3 tools/re/imm.py c4 a1         (hexadecimal values)
"""
import struct
import sys

from recommon import IMAGE_BASE, functions, image, owner, section

img, rows = image(), functions()
start, end = section(".text")
text = img[start - IMAGE_BASE:end - IMAGE_BASE]
for q in sys.argv[1:]:
    needle = struct.pack("<I", int(q, 16))
    hits, i = [], text.find(needle)
    while i >= 0:
        op = text[i - 1] if i else 0
        op2 = text[i - 2] if i > 1 else 0
        kind = {0x68: "push"}.get(op) or ("mov r" if 0xB8 <= op <= 0xBF else None)
        if kind is None and op2 in (0xC7, 0x81, 0x3D, 0x05, 0x2D):
            kind = "op %02x" % op2
        if kind is None and op in (0x3D, 0x05, 0x2D, 0x25, 0x0D):
            kind = "eax op %02x" % op
        if kind is None and i > 6 and text[i - 6] == 0xC7 or (i > 3 and text[i - 3] == 0xC7) or (i > 4 and text[i - 4] == 0xC7):
            kind = "mov mem"
        if kind:
            hits.append(f"{owner(rows, start + i)}@{start + i - 1:x} ({kind})")
        i = text.find(needle, i + 1)
    print(f"{q}: " + ("; ".join(hits) or "(none)"))
