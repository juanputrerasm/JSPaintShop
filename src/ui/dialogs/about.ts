/*
  Help > About (57664): JSPaintShop's name, icon, version and license.
*/
import { el } from "../../shared/dom.ts";
import { openDialog } from "../shell/dialog.ts";

export async function showAbout(version: string): Promise<void> {
  const body = el("div", { class: "about" },
    el("div", { class: "about-head" },
      el("img", { src: `${import.meta.env.BASE_URL}jspaintshop.svg`, alt: "", width: 48, height: 48 }),
      el("div", {},
        el("div", { class: "about-title" }, "JSPaintShop"),
        el("div", { class: "about-sub" }, `Version ${version}`))),
    el("p", {}, "An image editor for the browser, written from scratch: layers, selections, painting tools, vector shapes and text, adjustment layers, filters and effects."),
    el("p", { class: "about-license" }, "JSPaintShop is licensed under the Apache License 2.0."));
  await openDialog({ title: "About JSPaintShop", body });
}
