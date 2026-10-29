/* PSP palette files (.pal): "JASC-PAL", "0100", the color count, then "R G B" lines (Psp.cnt, its palette file format topic). */

export function readPal(text: string): Uint8Array {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines[0] !== "JASC-PAL") throw new Error("Not a PSP palette file: no JASC-PAL header.");
  const n = Math.min(256, Number(lines[2]) || 0);
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = (lines[3 + i] ?? "0 0 0").split(/\s+/).map(Number);
    out.set([v[0] & 255, v[1] & 255, v[2] & 255], i * 3);
  }
  return out;
}

export function writePal(p: Uint8Array): string {
  const n = p.length / 3;
  const rows = Array.from({ length: n }, (_, i) => `${p[i * 3]} ${p[i * 3 + 1]} ${p[i * 3 + 2]}`);
  return ["JASC-PAL", "0100", String(n), ...rows, ""].join("\r\n");
}
