/*
  View > Image Information (33242, Shift+I): PSP 6's property sheet with the Image
  Information page (DIALOG 173) and the Creator Information page (DIALOG 174). The
  Watermark Information page is left out with the Digimarc watermarks.

  Changing the creator fields marks the image changed; they are saved with PSP files.
*/
import { el } from "../../shared/dom.ts";
import { openDialog } from "../shell/dialog.ts";
import type { ImageDocument } from "../../app/image-document.ts";
import { depthName, memoryUsed, type Creator } from "../../core/doc/image-doc.ts";
import { formatById } from "../../core/formats/formats.ts";

function kb(bytes: number): string {
  return bytes ? `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KB` : "0 KB";
}

function date(seconds: number): string {
  return seconds ? new Date(seconds * 1000).toLocaleString() : "";
}

export async function showImageInfo(image: ImageDocument): Promise<void> {
  const d = image.doc;
  const pair = (label: string, value: string) => el("div", { class: "info-pair" }, el("span", {}, label), el("span", { class: "info-value" }, value));
  const page1 = el("div", { class: "info-page" },
    el("fieldset", { class: "opt-group" }, el("legend", {}, "Source File"),
      pair("File Name:", image.handle || image.format ? image.name : ""),
      pair("File Type:", image.format ? formatById(image.format).name : "")),
    el("div", { class: "info-two" },
      el("fieldset", { class: "opt-group" }, el("legend", {}, "Image"),
        pair("Dimensions:", `${d.width} x ${d.height} Pixels`),
        el("div", { class: "info-value" }, `${(d.width / d.dpi).toFixed(3)} x ${(d.height / d.dpi).toFixed(3)} Inches`),
        pair("Pixels (dots) per Inch:", String(d.dpi)),
        pair("Pixel Depth/Colors:", `${d.depth}/${depthName(d.depth, d.greyscale)}`)),
      el("fieldset", { class: "opt-group" }, el("legend", {}, "Status"),
        pair("Has Been Modified:", image.modified ? "Yes" : "No"),
        pair("Has a Selection:", "No"),
        pair("Number of Layers:", String(d.layers.length)),
        pair("Number of Alphas:", "0"))),
    el("fieldset", { class: "opt-group" }, el("legend", {}, "Memory Used"),
      el("div", { class: "info-mem" },
        el("span", {}), el("span", { class: "info-head" }, "On Disk"), el("span", { class: "info-head" }, "In RAM"),
        el("span", {}, "Image:"), el("span", {}, kb(image.fileSize)), el("span", {}, kb(memoryUsed(d))),
        el("span", {}, "Undo:"), el("span", {}, ""), el("span", {}, `${image.history.undoLabels.length} steps`),
        el("span", {}, "Total:"), el("span", {}, kb(image.fileSize)), el("span", {}, kb(memoryUsed(d))))));

  const c: Creator = { ...d.creator };
  const field = (key: "title" | "artist" | "copyright", label: string) => {
    const input = el("input", { class: "text-field", value: c[key] });
    input.addEventListener("input", () => { c[key] = input.value; });
    return el("label", { class: "form-row" }, el("span", {}, label), input);
  };
  const description = el("textarea", { class: "text-field", rows: 4 });
  description.value = c.description;
  description.addEventListener("input", () => { c.description = description.value; });
  const page2 = el("div", { class: "info-page", hidden: true },
    field("title", "Image Title:"), field("artist", "Artist Name:"), field("copyright", "Copyright:"),
    el("label", { class: "form-row" }, el("span", {}, "Description:"), description),
    el("label", { class: "form-row" }, el("span", {}, "Image Created:"), el("input", { class: "text-field", readonly: true, value: date(c.created) })),
    el("label", { class: "form-row" }, el("span", {}, "Last Modified:"), el("input", { class: "text-field", readonly: true, value: date(c.modified) })));

  const tabs = ["Image Information", "Creator Information"].map((t, i) => el("button", {
    type: "button", role: "tab", "aria-selected": String(i === 0),
    onclick: () => { [page1, page2].forEach((p, k) => { p.hidden = k !== i; }); tabs.forEach((b, k) => b.setAttribute("aria-selected", String(k === i))); },
  }, t));
  const v = await openDialog({
    title: "Current Image Information", className: "info-dialog",
    body: [el("div", { class: "tabs", role: "tablist" }, ...tabs), el("div", { class: "opt-body" }, page1, page2)],
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
  });
  if (v !== "ok") return;
  const before = d.creator;
  if (c.title !== before.title || c.artist !== before.artist || c.copyright !== before.copyright || c.description !== before.description) {
    d.creator = c;
    image.touchModified();
  }
}
