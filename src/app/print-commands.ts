/*
  File > Page Setup (DIALOG 223), Print (DIALOG 413), Print Preview and Print Multiple Images.

  The page is laid out as PSP does (core/print/layout.ts) and handed to the browser's print
  dialog in a hidden frame: the browser chooses the printer, so the Print dialog keeps only
  PSP's print options (crop marks, registration marks, title, copies). Greyscale and Negative
  change the printed pixels; CMYK Separations is not available.

  Print Multiple Images: PSP 6 opens its own layout window (MENU 450) where the images are
  placed by hand; JSPaintShop lays the open images out in a grid on one page, shown first.
*/
import type { Editor } from "./editor.ts";
import type { Workspace } from "./workspace.ts";
import { CMD, type CommandRegistry } from "../ui/shell/commands.ts";
import { el } from "../shared/dom.ts";
import { openDialog } from "../ui/shell/dialog.ts";
import { composite } from "../core/layers/composite.ts";
import { luminance } from "../core/color/color-space.ts";
import { PAPERS, defaultPageSetup, gridLayout, placeImage, type PageSetup } from "../core/print/layout.ts";
import type { ImageDocument } from "./image-document.ts";

const OK_CANCEL = [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }];

/* The image as a PNG data URL, with the Greyscale and Negative options applied. */
function imageUrl(image: ImageDocument, s: PageSetup): string {
  const r = composite(image.doc), d = new Uint8ClampedArray(r.data);
  for (let i = 0; i < d.length; i += 4) {
    if (s.output === "greyscale") d[i] = d[i + 1] = d[i + 2] = luminance(d[i], d[i + 1], d[i + 2]);
    if (s.negative) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }
  }
  const c = document.createElement("canvas");
  c.width = r.width; c.height = r.height;
  c.getContext("2d")!.putImageData(new ImageData(d, r.width, r.height), 0, 0);
  return c.toDataURL("image/png");
}

interface Placed { url: string; x: number; y: number; w: number; h: number; title: string }

/* Crop and registration marks around a placed image, as SVG in inches. */
function marks(p: Placed, s: PageSetup): string {
  const L = 0.25, gap = 0.08, parts: string[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number) => parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`);
  const { x, y, w, h } = p;
  if (s.cornerMarks) for (const [cx, cy, sx, sy] of [[x, y, -1, -1], [x + w, y, 1, -1], [x, y + h, -1, 1], [x + w, y + h, 1, 1]]) {
    line(cx + sx * gap, cy, cx + sx * (gap + L), cy);
    line(cx, cy + sy * gap, cx, cy + sy * (gap + L));
  }
  if (s.centerMarks) {
    line(x + w / 2, y - gap, x + w / 2, y - gap - L); line(x + w / 2, y + h + gap, x + w / 2, y + h + gap + L);
    line(x - gap, y + h / 2, x - gap - L, y + h / 2); line(x + w + gap, y + h / 2, x + w + gap + L, y + h / 2);
  }
  if (s.registrationMarks) for (const [cx, cy] of [[x + w / 2, y - gap - L - 0.12], [x + w / 2, y + h + gap + L + 0.12], [x - gap - L - 0.12, y + h / 2], [x + w + gap + L + 0.12, y + h / 2]]) {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="0.08" />`);
    line(cx - 0.12, cy, cx + 0.12, cy); line(cx, cy - 0.12, cx, cy + 0.12);
  }
  return parts.join("");
}

/* One printed page as HTML (inches), `copies` times. */
function pageHtml(placed: Placed[], pageW: number, pageH: number, s: PageSetup, copies = 1): string {
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const one = `<div class="page">${placed.map((p) => `<img src="${p.url}" style="left:${p.x}in;top:${p.y}in;width:${p.w}in;height:${p.h}in">${s.title ? `<div class="title" style="left:${p.x}in;top:${p.y + p.h + 0.1}in;width:${p.w}in">${esc(p.title)}</div>` : ""}`).join("")}
<svg viewBox="0 0 ${pageW} ${pageH}" width="${pageW}in" height="${pageH}in" stroke="black" stroke-width="0.01" fill="none">${placed.map((p) => marks(p, s)).join("")}</svg></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: ${pageW}in ${pageH}in; margin: 0 }
html, body { margin: 0; padding: 0 }
.page { position: relative; width: ${pageW}in; height: ${pageH}in; background: ${s.background}; overflow: hidden; page-break-after: always; break-after: page }
.page img { position: absolute; image-rendering: auto }
.page svg { position: absolute; left: 0; top: 0 }
.title { position: absolute; text-align: center; font: 10pt sans-serif }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact }
</style></head><body>${Array.from({ length: Math.max(1, copies) }, () => one).join("")}</body></html>`;
}

/* Print a page through a hidden frame and the browser's print dialog. */
function printHtml(html: string): void {
  const frame = el("iframe", { class: "print-frame", srcdoc: html, "aria-hidden": "true" }) as HTMLIFrameElement;
  frame.addEventListener("load", () => {
    const w = frame.contentWindow!;
    w.addEventListener("afterprint", () => setTimeout(() => frame.remove(), 500));
    w.focus();
    w.print();
    setTimeout(() => frame.remove(), 60_000);
  });
  document.body.append(frame);
}

/* A scaled view of the page for Print Preview. */
function previewFrame(html: string, pageW: number, pageH: number): HTMLElement {
  const W = 360, scale = Math.min(W / (pageW * 96), 480 / (pageH * 96));
  const frame = el("iframe", { srcdoc: html, class: "print-preview-frame", style: { width: `${pageW * 96}px`, height: `${pageH * 96}px`, transform: `scale(${scale})` } });
  return el("div", { class: "print-preview", style: { width: `${pageW * 96 * scale}px`, height: `${pageH * 96 * scale}px` } }, frame);
}

export function bindPrintCommands(registry: CommandRegistry, ed: Editor, ws: Workspace): void {
  const setup: PageSetup = defaultPageSetup(/^en-(US|CA)|^es-(MX|US)/.test(navigator.language));
  const has = () => ed.image !== null;

  const layoutOne = (image: ImageDocument): { placed: Placed[]; pageW: number; pageH: number } => {
    const p = placeImage(setup, image.doc.width, image.doc.height, image.doc.dpi);
    return { placed: [{ url: imageUrl(image, setup), x: p.x, y: p.y, w: p.w, h: p.h, title: image.name }], pageW: p.pageW, pageH: p.pageH };
  };

  const pageSetup = async (): Promise<boolean> => {
    const s = structuredClone(setup);
    const num = (k: "left" | "top" | "scale", min: number, max: number, step: number) => {
      const n = el("input", { type: "number", class: "spin", min, max, step, value: s[k] });
      n.addEventListener("change", () => { s[k] = Math.max(min, Math.min(max, Number(n.value) || min)); });
      return n;
    };
    const chk = (k: "center" | "fit" | "negative", label: string) => {
      const c = el("input", { type: "checkbox", checked: s[k] });
      c.addEventListener("change", () => { s[k] = c.checked; });
      return el("label", { class: "opt-check" }, c, label);
    };
    const rad = (name: string, label: string, on: boolean, set: () => void, disabled = false) => {
      const r = el("input", { type: "radio", name, checked: on, disabled });
      r.addEventListener("change", () => { if (r.checked) set(); });
      return el("label", { class: `opt-check${disabled ? " disabled" : ""}` }, r, label);
    };
    const paper = el("select", {}, ...PAPERS.map((p, i) => el("option", { value: String(i), selected: i === s.paper }, `${p.name} (${p.width} x ${p.height} in)`)));
    paper.addEventListener("change", () => { s.paper = Number(paper.value); });
    const bg = el("input", { type: "color", value: s.background });
    bg.addEventListener("input", () => { s.background = bg.value; });
    const v = await openDialog({
      title: "Page Setup", className: "page-setup", buttons: OK_CANCEL,
      body: el("div", { class: "layer-props" },
        el("fieldset", { class: "opt-group" }, el("legend", {}, "Paper"), el("label", { class: "form-row" }, el("span", {}, "Size:"), paper)),
        el("fieldset", { class: "opt-group" }, el("legend", {}, "Orientation"), rad("po", "Portrait", !s.landscape, () => { s.landscape = false; }), rad("po", "Landscape", s.landscape, () => { s.landscape = true; })),
        el("fieldset", { class: "opt-group" }, el("legend", {}, "Position"), chk("center", "Center on page"),
          el("label", { class: "form-row" }, el("span", {}, "Left margin:"), num("left", 0, 20, 0.05)), el("label", { class: "form-row" }, el("span", {}, "Top margin:"), num("top", 0, 20, 0.05)),
          el("label", { class: "form-row" }, el("span", {}, "Scale:"), num("scale", 1, 999, 1)), chk("fit", "Fit to page")),
        el("fieldset", { class: "opt-group" }, el("legend", {}, "Print Output"),
          rad("pout", "Color", s.output === "color", () => { s.output = "color"; }), rad("pout", "Greyscale", s.output === "greyscale", () => { s.output = "greyscale"; }),
          rad("pout", "CMYK Separations (not available)", false, () => undefined, true)),
        el("fieldset", { class: "opt-group" }, el("legend", {}, "Options"), chk("negative", "Negative"), el("label", { class: "form-row" }, el("span", {}, "Background:"), bg))),
    });
    if (v !== "ok") return false;
    Object.assign(setup, s);
    return true;
  };

  const printDialog = async (): Promise<boolean> => {
    const s = setup;
    const chk = (k: "cornerMarks" | "centerMarks" | "registrationMarks" | "title", label: string) => {
      const c = el("input", { type: "checkbox", checked: s[k] });
      c.addEventListener("change", () => { s[k] = c.checked; });
      return el("label", { class: "opt-check" }, c, label);
    };
    const copies = el("input", { type: "number", class: "spin", min: 1, max: 99, value: s.copies });
    copies.addEventListener("change", () => { s.copies = Math.max(1, Math.min(99, Number(copies.value) || 1)); });
    const v = await openDialog({
      title: "Print", buttons: OK_CANCEL,
      body: el("div", { class: "layer-props" },
        el("p", { class: "opt-hint" }, "The printer is chosen in the browser's print dialog, which opens next."),
        el("fieldset", { class: "opt-group" }, el("legend", {}, "Print Options"), chk("cornerMarks", "Print Corner Crop Marks"), chk("centerMarks", "Print Center Crop Marks"), chk("registrationMarks", "Print Registration Marks"), chk("title", "Title")),
        el("fieldset", { class: "opt-group" }, el("legend", {}, "Copies"), el("label", { class: "form-row" }, el("span", {}, "Number of copies:"), copies))),
    });
    return v === "ok";
  };

  const print = async () => {
    const image = ed.image;
    if (!image || !(await printDialog())) return;
    const { placed, pageW, pageH } = layoutOne(image);
    printHtml(pageHtml(placed, pageW, pageH, setup, setup.copies));
  };

  registry.bind(CMD.FILE_PAGE_SETUP, () => pageSetup(), { enabled: has });
  registry.bind(CMD.FILE_PRINT, print, { enabled: has });
  registry.bind(CMD.FILE_PRINT_PREVIEW, async () => {
    for (;;) {
      const image = ed.image;
      if (!image) return;
      const { placed, pageW, pageH } = layoutOne(image);
      const html = pageHtml(placed, pageW, pageH, setup);
      const p = placeImage(setup, image.doc.width, image.doc.height, image.doc.dpi);
      const v = await openDialog({
        title: `Print Preview - ${image.name}`, className: "print-preview-dialog",
        body: [previewFrame(html, pageW, pageH), el("p", { class: "opt-hint" }, `${PAPERS[setup.paper].name}, ${setup.landscape ? "landscape" : "portrait"}; image ${p.w.toFixed(2)} x ${p.h.toFixed(2)} in at ${Math.round(p.scale)}%`)],
        buttons: [{ label: "Print...", value: "print", primary: true }, { label: "Setup...", value: "setup" }, { label: "Close", value: "cancel" }],
      });
      if (v === "print") { await print(); return; }
      if (v !== "setup") return;
      await pageSetup();
    }
  }, { enabled: has });

  registry.bind(CMD.FILE_PRINT_MULTIPLE_IMAGES, async () => {
    const images = ws.images;
    if (!images.length) return;
    const paper = PAPERS[setup.paper];
    const pageW = setup.landscape ? paper.height : paper.width, pageH = setup.landscape ? paper.width : paper.height;
    const cells = gridLayout(images.length, pageW, pageH, 0.5, images.map((i) => [i.doc.width / i.doc.dpi, i.doc.height / i.doc.dpi]));
    const placed = images.map((image, k) => ({ url: imageUrl(image, setup), ...cells[k], title: image.name }));
    const html = pageHtml(placed, pageW, pageH, setup);
    const v = await openDialog({
      title: "Print Multiple Images", className: "print-preview-dialog",
      body: [previewFrame(html, pageW, pageH), el("p", { class: "opt-hint" }, `The ${images.length} open image${images.length > 1 ? "s" : ""}, laid out on one ${paper.name} page.`)],
      buttons: [{ label: "Print...", value: "print", primary: true }, { label: "Cancel", value: "cancel" }],
    });
    if (v === "print" && (await printDialog())) printHtml(pageHtml(placed, pageW, pageH, setup, setup.copies));
  }, { enabled: () => ws.images.length > 0 });
}
