/*
  The Layer palette (L): the active image's layers, top first. Each row has the visibility
  toggle, the name (click to edit that layer, double-click for its properties), the opacity,
  the blend mode, the lock transparency toggle and the group, as PSP 6's palette has. The
  buttons above add a layer (with the Add Layer menu, MENU 499) and delete the active one.
  Rows drag to reorder; right-click shows the layer menu (MENU 292).

  A vector layer lists its objects under it, top first, as PSP's palette does: the eye shows
  or hides the object, a click selects it (Shift adds), and right-click shows the object menu
  (MENU 500), whose Select toggles that object.

  Every change is an undo step. Dragging the opacity slider previews live and records one
  step when it is let go.
*/
import { el, clear } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";
import type { Editor } from "../../app/editor.ts";
import { CMD, MENUS, type CommandRegistry } from "../shell/commands.ts";
import { showContextMenu } from "../shell/context-menu.ts";
import { BLEND_MODES, type Layer } from "../../core/doc/image-doc.ts";
import { moveLayer } from "../../core/layers/layer-ops.ts";
import { recordFields } from "../../core/edit/record.ts";
import type { FloatingPanel } from "../shell/panel.ts";
import { changeObjects, vectorSel } from "../../app/tools/vector-tools.ts";

const KIND_MARK: Record<Layer["kind"], string> = { raster: "", vector: "◇ ", adjustment: "◐ ", floating: "⬚ " };

export function layerPalette(app: AppState, registry: CommandRegistry, ed: Editor, panel: FloatingPanel): void {
  const list = el("div", { class: "layer-list", role: "listbox", "aria-label": "Layers" });
  const add = el("button", { class: "mini", title: "Create Layer", onclick: (e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    showContextMenu(r.left, r.bottom, MENUS[499], registry, app);
  } }, "+ Layer ▾");
  const del = el("button", { class: "mini", title: "Delete Layer", onclick: () => registry.exec(CMD.LAYERS_DELETE) }, "Delete");
  const body = el("div", { class: "layer-palette" }, el("div", { class: "layer-tools" }, add, del), list);
  clear(panel.body);
  panel.body.append(body);

  let dragFrom = -1;
  // While an opacity slider is dragged the palette is not rebuilt under it.
  let live = false;
  const draw = () => {
    if (live) return;
    const image = ed.image;
    clear(list);
    del.disabled = !registry.isEnabled(CMD.LAYERS_DELETE);
    add.disabled = !image;
    if (!image) { list.append(el("p", { class: "panel-empty" }, "Open an image to see its layers.")); return; }
    const d = image.doc;
    for (let i = d.layers.length - 1; i >= 0; i--) {
      const layer = d.layers[i];
      const set = (label: string, change: (l: Layer) => void) => ed.run(label, (doc) => { change(doc.layers[i]); return { layers: true }; });
      const eye = el("button", { class: `layer-eye${layer.visible ? " on" : ""}`, title: layer.visible ? "Hide layer" : "Show layer", "aria-pressed": String(layer.visible), onclick: () => set(layer.visible ? "Hide Layer" : "Show Layer", (l) => { l.visible = !l.visible; }) }, layer.visible ? "👁" : "–");
      const name = el("span", { class: "layer-name", title: layer.name }, KIND_MARK[layer.kind], layer.name, layer.mask ? el("span", { class: "layer-mask-mark", title: layer.maskEnabled ? "Mask" : "Mask (disabled)" }, layer.maskEnabled ? " ▣" : " ▢") : null);
      const opacity = el("input", { type: "range", class: "layer-opacity", min: 0, max: 100, value: Math.round((layer.opacity * 100) / 255), title: "Opacity" });
      const pct = el("span", { class: "layer-pct" }, `${opacity.value}`);
      let rec: ReturnType<typeof recordFields> | null = null;
      opacity.addEventListener("input", () => {
        live = true;
        rec ??= recordFields(layer, ["opacity"], "Layer Opacity", { layers: true });
        layer.opacity = Math.round((Number(opacity.value) * 255) / 100);
        pct.textContent = opacity.value;
        image.changed({ layers: true });
      });
      opacity.addEventListener("change", () => { live = false; const c = rec?.finish(); rec = null; if (c) ed.push(c, image, false); draw(); });
      const blend = el("select", { class: "layer-blend", title: "Blend mode", disabled: layer.kind === "adjustment" }, ...BLEND_MODES.map((m, k) => el("option", { value: k, selected: k === layer.blend }, m)));
      blend.addEventListener("change", () => set("Layer Blend Mode", (l) => { l.blend = Number(blend.value); }));
      const lock = el("button", { class: `layer-lock${layer.lockTransparency ? " on" : ""}`, title: "Lock transparency", "aria-pressed": String(layer.lockTransparency), onclick: () => set("Lock Transparency", (l) => { l.lockTransparency = !l.lockTransparency; }) }, layer.lockTransparency ? "🔒" : "🔓");
      const group = el("select", { class: "layer-group", title: "Layer group" }, el("option", { value: 0 }, "–"), ...Array.from({ length: 9 }, (_, k) => el("option", { value: k + 1, selected: layer.group === k + 1 }, String(k + 1))));
      group.addEventListener("change", () => set("Layer Group", (l) => { l.group = Number(group.value); }));
      const row = el("div", {
        class: `layer-row${i === d.active ? " active" : ""}${layer.visible ? "" : " hidden-layer"}`, role: "option", "aria-selected": String(i === d.active), draggable: "true",
        onclick: (e: MouseEvent) => { if ((e.target as HTMLElement).closest("button, select, input")) return; ed.setActiveLayer(i); },
        ondblclick: (e: MouseEvent) => { if ((e.target as HTMLElement).closest("button, select, input")) return; ed.setActiveLayer(i); void registry.exec(CMD.LAYERS_PROPERTIES); },
        oncontextmenu: (e: MouseEvent) => { e.preventDefault(); ed.setActiveLayer(i); showContextMenu(e.clientX, e.clientY, MENUS[292], registry, app); },
        ondragstart: (e: DragEvent) => { dragFrom = i; e.dataTransfer?.setData("text/plain", String(i)); },
        ondragover: (e: DragEvent) => { if (dragFrom >= 0) e.preventDefault(); },
        ondrop: (e: DragEvent) => {
          e.preventDefault();
          const from = dragFrom;
          dragFrom = -1;
          if (from >= 0 && from !== i) ed.run("Move Layer", (doc) => { moveLayer(doc, from, i); return { layers: true }; });
        },
      }, eye, name, opacity, pct, blend, lock, group);
      list.append(row);
      if (layer.kind === "vector") {
        const objs = layer.objects ?? [];
        for (let k = objs.length - 1; k >= 0; k--) {
          const o = objs[k];
          const picked = vectorSel.image === image && i === d.active && vectorSel.objects.has(k);
          const pick = (add: boolean) => {
            ed.setActiveLayer(i);
            if (vectorSel.image !== image) { vectorSel.image = image; vectorSel.objects = new Set(); vectorSel.nodes = []; }
            if (add) vectorSel.objects.add(k); else vectorSel.objects = new Set([k]);
            image.changed({});
          };
          const oeye = el("button", { class: `layer-eye${o.visible ? " on" : ""}`, title: o.visible ? "Hide object" : "Show object", "aria-pressed": String(o.visible), onclick: () => { ed.setActiveLayer(i); changeObjects(ed, image, o.visible ? "Hide Vector Object" : "Show Vector Object", (os) => os.map((x, j) => (j === k ? { ...x, visible: !x.visible } : x))); } }, o.visible ? "👁" : "–");
          list.append(el("div", {
            class: `layer-row object-row${picked ? " active" : ""}`, role: "option", "aria-selected": String(picked),
            onclick: (e: MouseEvent) => { if ((e.target as HTMLElement).closest("button")) return; pick(e.shiftKey); },
            oncontextmenu: (e: MouseEvent) => { e.preventDefault(); ed.setActiveLayer(i); vectorSel.row = k; showContextMenu(e.clientX, e.clientY, MENUS[500], registry, app); },
          }, oeye, el("span", { class: "layer-name", title: o.name }, "   ", o.name || (o.text ? "Text" : "Object"))));
        }
      }
    }
  };
  app.on("image", draw);
  draw();
}
