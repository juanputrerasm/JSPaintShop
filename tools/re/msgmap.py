"""List the MFC message maps of the executable: class, base map and every entry with its handler.

A message map is found through its GetMessageMap ("mov eax, map; ret"); the class is named by
the CRuntimeClass that the same vtable's GetRuntimeClass returns, when there is one.

    python3 tools/re/msgmap.py > re/<target>/out/msgmaps.txt
"""
import struct

from recommon import IMAGE_BASE, image, section

img = image()
T0, T1 = section(".text")
R0, R1 = section(".rdata")
D0, D1 = section(".data")
MSG = {0x111: "WM_COMMAND", 0x4E: "WM_NOTIFY", 0x0F: "WM_PAINT", 0x113: "WM_TIMER", 0x05: "WM_SIZE",
       0x01: "WM_CREATE", 0x02: "WM_DESTROY", 0x10: "WM_CLOSE", 0x100: "WM_KEYDOWN", 0x101: "WM_KEYUP",
       0x102: "WM_CHAR", 0x200: "WM_MOUSEMOVE", 0x201: "WM_LBUTTONDOWN", 0x202: "WM_LBUTTONUP",
       0x203: "WM_LBUTTONDBLCLK", 0x204: "WM_RBUTTONDOWN", 0x14: "WM_ERASEBKGND", 0x1C: "WM_ACTIVATEAPP",
       0x06: "WM_ACTIVATE", 0x07: "WM_SETFOCUS", 0x08: "WM_KILLFOCUS", 0x110: "WM_INITDIALOG",
       0x114: "WM_HSCROLL", 0x115: "WM_VSCROLL", 0x20: "WM_SETCURSOR", 0x104: "WM_SYSKEYDOWN",
       0x112: "WM_SYSCOMMAND", 0x2B: "WM_DRAWITEM", 0x30F: "WM_QUERYNEWPALETTE", 0x311: "WM_PALETTECHANGED",
       0x7E: "WM_DISPLAYCHANGE", 0x3B9: "MM_MCINOTIFY", 0x24: "WM_GETMINMAXINFO", 0x03: "WM_MOVE",
       0x116: "WM_INITMENU", 0x117: "WM_INITMENUPOPUP", 0x11F: "WM_MENUSELECT", 0x121: "WM_ENTERIDLE",
       0x19: "WM_CTLCOLOR", 0x133: "WM_CTLCOLOREDIT", 0x138: "WM_CTLCOLORSTATIC", 0x46: "WM_WINDOWPOSCHANGING"}


def u32(va):
    return struct.unpack_from("<I", img, va - IMAGE_BASE)[0]


def cstr(va):
    o = va - IMAGE_BASE
    return img[o:img.index(b"\0", o)].decode("latin-1")


def returned_constant(fn):
    """The address a "mov eax, imm32; ret" function returns, or None."""
    o = fn - IMAGE_BASE
    if T0 <= fn < T1 and img[o] == 0xB8 and img[o + 5] == 0xC3:
        return struct.unpack_from("<I", img, o + 1)[0]
    return None


def entries(map_va):
    out, e = [], u32(map_va + 4)
    if not (R0 <= e < R1 or D0 <= e < D1):
        return None
    for _ in range(400):
        msg, code, cid, last, sig, pfn = struct.unpack_from("<6I", img, e - IMAGE_BASE)
        if not (msg or code or cid or last or sig or pfn):
            return out
        if not T0 <= pfn < T1 or sig > 0x60:
            return None
        out.append((msg, code, cid, last, sig, pfn))
        e += 24
    return None


maps = {}
text = img[T0 - IMAGE_BASE:T1 - IMAGE_BASE]
i = text.find(b"\xB8")
while i >= 0:
    fn = T0 + i
    m = returned_constant(fn)
    if m and (R0 <= m < R1 or D0 <= m < D1) and m not in maps:
        base = u32(m)
        if base == 0 or T0 <= base < T1 or R0 <= base < R1 or D0 <= base < D1:
            ent = entries(m)
            if ent is not None:
                maps[m] = (fn, ent)
    i = text.find(b"\xB8", i + 1)

# class names: a vtable holding the GetMessageMap function also holds GetRuntimeClass at slot 0
names = {}
getters = {fn: m for m, (fn, _e) in maps.items()}
for sec0, sec1 in ((R0, R1),):
    for va in range(sec0, sec1 - 4, 4):
        fn = u32(va)
        if fn in getters:
            for back in range(4, 0x60, 4):
                rc = returned_constant(u32(va - back)) if T0 <= u32(va - back) < T1 else None
                if rc and (R0 <= rc < R1 or D0 <= rc < D1):
                    name_ptr = u32(rc)
                    if R0 <= name_ptr < D1:
                        try:
                            n = cstr(name_ptr)
                        except ValueError:
                            continue
                        if n[:1] == "C" and n.isidentifier():
                            names.setdefault(getters[fn], (n, va - back))
                            break

for m in sorted(maps):
    fn, ent = maps[m]
    name, vt = names.get(m, ("?", 0))
    print(f"MAP {m:x} class={name} vtable={vt:x} getter={fn:x} base={u32(m):x} entries={len(ent)}")
    for msg, code, cid, last, sig, pfn in ent:
        what = MSG.get(msg, "msg %x" % msg)
        ids = f" id={cid}" + (f"..{last}" if last != cid else "") if msg in (0x111, 0x4E) or cid else ""
        note = ""
        if msg == 0x111:
            note = {0: " (clicked/command)", 0xFFFFFFFF: " (update UI)", 1: " (LBN_SELCHANGE/CBN_SELCHANGE)",
                    2: " (dblclk)", 0x300: " (EN_CHANGE)"}.get(code, f" code={code:x}")
        print(f"    {what}{note}{ids} sig={sig} -> {pfn:x}")
