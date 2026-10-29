"""Print a decompiled function without the bookkeeping: declarations, progress callbacks,
JML_GlobalLock/Unlock, exception frames and return codes, so the arithmetic stands out.

    re/venv/bin/python tools/re/lean.py 545d80 [from_line] [to_line]
"""
import re
import sys

from recommon import decompiled_blocks

addr = int(sys.argv[1], 16)
lo = int(sys.argv[2]) if len(sys.argv) > 2 else 0
hi = int(sys.argv[3]) if len(sys.argv) > 3 else 10**9
for start, name, text in decompiled_blocks():
    if start != addr:
        continue
    out = []
    for line in text.splitlines():
        s = line.strip()
        if re.match(r"^(undefined\w*|byte|uint|int|char|float|double|long|short|ushort|void|bool|code|CString|CDialog|CSlider\w*)\s+\**\w+(\s*\[\d+\])?;$", s):
            continue
        if any(k in s for k in ("JML_Global", "ExceptionList", "(param_1 + 0x18))(param_1)", "*(undefined4 *)(param_1 + 4) =", "*(undefined4 *)(param_1 + 8) =", "*(byte **)(param_1 + 8)", "*(byte **)(param_1 + 4)", "lVar20 = ", "local_5c != 0", "puStack_8", "local_4 = 0x", "= &local_c;", "= local_c;")):
            continue
        out.append(line)
    for i, line in enumerate(out):
        if lo <= i <= hi:
            print(line)
