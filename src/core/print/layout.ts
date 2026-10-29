/*
  Where File > Print puts the image on the page (Page Setup, DIALOG 223): the paper and its
  orientation, the image at its resolution times the scale (or fitted inside the margins), and
  either centred or at the left and top margins. All lengths are in inches, as PSP shows them.
*/

export interface Paper { name: string; width: number; height: number }

export const PAPERS: Paper[] = [
  { name: "Letter", width: 8.5, height: 11 }, { name: "Legal", width: 8.5, height: 14 },
  { name: "A4", width: 8.27, height: 11.69 }, { name: "A5", width: 5.83, height: 8.27 },
  { name: "A3", width: 11.69, height: 16.54 }, { name: "Tabloid", width: 11, height: 17 },
  { name: "Executive", width: 7.25, height: 10.5 },
];

export interface PageSetup {
  paper: number;
  landscape: boolean;
  center: boolean;
  /** Margins in inches, used when not centred (and as the room Fit to page keeps). */
  left: number;
  top: number;
  /** Percent of the image's printed size at its own resolution. */
  scale: number;
  fit: boolean;
  output: "color" | "greyscale";
  negative: boolean;
  /** The page color around the image (Options > Background). */
  background: string;
  /** Print dialog options. */
  cornerMarks: boolean;
  centerMarks: boolean;
  registrationMarks: boolean;
  title: boolean;
  copies: number;
}

export function defaultPageSetup(letter = true): PageSetup {
  return {
    paper: letter ? 0 : 2, landscape: false, center: true, left: 0.5, top: 0.5, scale: 100, fit: false,
    output: "color", negative: false, background: "#ffffff",
    cornerMarks: false, centerMarks: false, registrationMarks: false, title: false, copies: 1,
  };
}

export interface Placement { pageW: number; pageH: number; x: number; y: number; w: number; h: number; scale: number }

/** The image's rectangle on the page, in inches. */
export function placeImage(s: PageSetup, width: number, height: number, dpi: number): Placement {
  const paper = PAPERS[s.paper] ?? PAPERS[0];
  const pageW = s.landscape ? paper.height : paper.width, pageH = s.landscape ? paper.width : paper.height;
  const natW = width / Math.max(1, dpi), natH = height / Math.max(1, dpi);
  let scale = s.scale / 100;
  if (s.fit) {
    // Fit inside the page less a margin on every side (the left/top margins, mirrored).
    const roomW = Math.max(0.1, pageW - 2 * s.left), roomH = Math.max(0.1, pageH - 2 * s.top);
    scale = Math.min(roomW / natW, roomH / natH);
  }
  const w = natW * scale, h = natH * scale;
  const x = s.center ? (pageW - w) / 2 : s.left, y = s.center ? (pageH - h) / 2 : s.top;
  return { pageW, pageH, x, y, w, h, scale: scale * 100 };
}

/** Print Multiple Images' automatic layout: a grid of cells, each image fitted and centred in its cell. */
export function gridLayout(count: number, pageW: number, pageH: number, margin: number, sizes: [number, number][]): { x: number; y: number; w: number; h: number }[] {
  const cols = Math.ceil(Math.sqrt(count * (pageW / pageH))), rows = Math.ceil(count / Math.max(1, cols));
  const cw = (pageW - 2 * margin) / Math.max(1, cols), ch = (pageH - 2 * margin) / Math.max(1, rows);
  return sizes.map(([w, h], i) => {
    const s = Math.min((cw * 0.92) / w, (ch * 0.92) / h);
    const col = i % cols, row = Math.floor(i / cols);
    return { x: margin + col * cw + (cw - w * s) / 2, y: margin + row * ch + (ch - h * s) / 2, w: w * s, h: h * s };
  });
}
