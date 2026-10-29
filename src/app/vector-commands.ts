/*
  The vector object commands: the Object Selector's right-click menu (MENU 495), the vector
  object menu (MENU 500), the node edit menu (MENU 497, docs/PSP_EXE_ANALYSIS.md section 15) and
  Edit > Paste > As New Vector Selection. They act on the Object Selector's selection
  (vectorSel in tools/vector-tools.ts). Copied objects stay in the app (PSP keeps them on its
  own clipboard format); Paste As New Vector Selection puts them back selected.
*/
import type { Editor } from "./editor.ts";
import type { AppState } from "./state.ts";
import { CMD, type CommandRegistry } from "../ui/shell/commands.ts";
import { MENUS } from "../ui/shell/psp-ui.generated.ts";
import { showContextMenu } from "../ui/shell/context-menu.ts";
import { activeLayer } from "../core/doc/image-doc.ts";
import type { NodeType, VectorObject } from "../core/vector/objects.ts";
import {
  allNodes, breakAt, closeContours, convertToLine, curveAfter, curveBefore, deleteNodes, joinEnds,
  lineAfter, lineBefore, mergeNodes, reverseContours, reversePath, setNodeType, type NodeRef,
} from "../core/vector/node-edit.ts";
import { changeObjects, clearVectorSelection, objectProperties, selectedObjects, vectorSel, vectorTarget } from "./tools/vector-tools.ts";
import { renderVectorLayer, textToCurves } from "./vector/render-vector.ts";

let clipboard: VectorObject[] = [];
let nodeClipboard: VectorObject["contours"] = [];

export function bindVectorCommands(registry: CommandRegistry, ed: Editor, app: AppState): void {
  const image = () => ed.image;
  const objects = () => { const i = image(); return i && activeLayer(i.doc).kind === "vector" ? activeLayer(i.doc).objects ?? [] : []; };
  const picked = () => selectedObjects(image());
  const some = () => picked().length > 0;
  const onVector = () => { const i = image(); return Boolean(i && activeLayer(i.doc).kind === "vector"); };
  const nodes = () => vectorSel.nodeEdit && picked().length > 0;
  const nodesPicked = () => nodes() && vectorSel.nodes.length > 0;

  vectorSel.menu = (x, y) => showContextMenu(x, y, vectorSel.nodeEdit && some() ? MENUS[497] : MENUS[495], registry, app);

  const change = (label: string, f: (os: VectorObject[], sel: number[]) => VectorObject[]) => {
    const i = image();
    if (!i) return;
    const sel = picked();
    changeObjects(ed, i, label, (os) => f(os, sel));
  };
  const copy = () => { clipboard = structuredClone(picked().map((k) => objects()[k])); };
  const remove = (label: string) => { change(label, (os, sel) => os.filter((_, k) => !sel.includes(k))); vectorSel.objects = new Set(); };

  for (const [id, run] of [
    [CMD.SHAPE_SELECT_CUT, () => { copy(); remove("Cut Vector Objects"); }], [CMD.VECTOR_OBJECT_CUT, () => { copy(); remove("Cut Vector Objects"); }],
    [CMD.SHAPE_SELECT_COPY, copy], [CMD.VECTOR_OBJECT_COPY, copy],
    [CMD.SHAPE_SELECT_DELETE, () => remove("Delete Vector Objects")], [CMD.VECTOR_OBJECT_DELETE, () => remove("Delete Vector Objects")],
  ] as [number, () => void][]) registry.bind(id, run, { enabled: some });

  const properties = async () => {
    const i = image(), k = picked()[0], o = objects()[k];
    if (!i || !o) return;
    const next = await objectProperties(o);
    if (next) changeObjects(ed, i, "Vector Properties", (os) => os.map((x, j) => (j === k ? next : x)));
  };
  registry.bind(CMD.SHAPE_SELECT_PROPERTIES, properties, { enabled: some });
  registry.bind(CMD.VECTOR_OBJECT_PROPERTIES, properties, { enabled: some });

  const selectAll = () => { const i = image(); if (!i) return; vectorSel.image = i; vectorSel.objects = new Set(objects().map((_, k) => k)); i.changed({}); };
  const selectNone = () => { vectorSel.objects = new Set(); vectorSel.nodes = []; image()?.changed({}); };
  registry.bind(CMD.SHAPE_SELECT_SELECT_ALL, selectAll, { enabled: onVector });
  registry.bind(CMD.VECTOR_OBJECT_SELECT_ALL, selectAll, { enabled: onVector });
  registry.bind(CMD.SHAPE_SELECT_SELECT_NONE, selectNone, { enabled: some });
  registry.bind(CMD.VECTOR_OBJECT_SELECT_NONE, selectNone, { enabled: some });
  // Select (MENU 500, the Layer palette's object rows): toggles the object of the row clicked.
  registry.bind(CMD.VECTOR_OBJECT_SELECT, () => {
    const i = image(), k = vectorSel.row;
    if (!i || k === undefined || k >= objects().length) return;
    if (vectorSel.image !== i) { vectorSel.image = i; vectorSel.objects = new Set(); }
    if (vectorSel.objects.has(k)) vectorSel.objects.delete(k); else vectorSel.objects.add(k);
    i.changed({});
  }, { enabled: () => onVector() && vectorSel.row !== undefined, checked: () => vectorSel.row !== undefined && vectorSel.image === image() && vectorSel.objects.has(vectorSel.row) });

  // Arrange keeps the selected objects' order among themselves.
  const arrange = (label: string, f: (os: VectorObject[], sel: Set<number>) => number[]) => {
    const order = f(objects(), new Set(picked()));
    change(label, (os) => order.map((k) => os[k]));
    vectorSel.objects = new Set(order.map((k, j) => (picked().includes(k) ? j : -1)).filter((j) => j >= 0));
  };
  const idx = (os: VectorObject[]) => os.map((_, k) => k);
  registry.bind(CMD.SHAPE_SELECT_ARRANGE_BRING_TO_TOP, () => arrange("Bring to Top", (os, s) => [...idx(os).filter((k) => !s.has(k)), ...idx(os).filter((k) => s.has(k))]), { enabled: some });
  registry.bind(CMD.SHAPE_SELECT_ARRANGE_SEND_TO_BOTTOM, () => arrange("Send To Bottom", (os, s) => [...idx(os).filter((k) => s.has(k)), ...idx(os).filter((k) => !s.has(k))]), { enabled: some });
  registry.bind(CMD.SHAPE_SELECT_ARRANGE_MOVE_UP, () => arrange("Move Up", (os, s) => {
    const o = idx(os);
    for (let k = o.length - 2; k >= 0; k--) if (s.has(o[k]) && !s.has(o[k + 1])) [o[k], o[k + 1]] = [o[k + 1], o[k]];
    return o;
  }), { enabled: some });
  registry.bind(CMD.SHAPE_SELECT_ARRANGE_MOVE_DOWN, () => arrange("Move Down", (os, s) => {
    const o = idx(os);
    for (let k = 1; k < o.length; k++) if (s.has(o[k]) && !s.has(o[k - 1])) [o[k], o[k - 1]] = [o[k - 1], o[k]];
    return o;
  }), { enabled: some });

  // Fit Text to Path: one text object and one path selected; the text's baseline follows the path.
  const textAndPath = () => {
    const os = objects(), sel = picked();
    const t = sel.filter((k) => os[k]?.text), p = sel.filter((k) => !os[k]?.text && os[k]?.contours.length);
    return t.length === 1 && p.length === 1 ? [t[0], p[0]] : null;
  };
  registry.bind(CMD.SHAPE_SELECT_FIT_TEXT_TO_PATH, () => {
    const pair = textAndPath();
    if (!pair) return;
    const [ti, pi] = pair;
    change("Fit Text to Path", (os) => os.map((o, k) => (k === ti ? { ...o, text: { ...o.text!, path: structuredClone(os[pi].contours[0]) } } : o)));
  }, { enabled: () => textAndPath() !== null });

  const texts = () => picked().filter((k) => objects()[k]?.text);
  const toCurves = (perCharacter: boolean) => {
    const sel = new Set(texts());
    change("Convert Text to Curves", (os) => os.flatMap((o, k) => (sel.has(k) ? textToCurves(o, perCharacter) : [o])));
    vectorSel.objects = new Set();
  };
  registry.bind(CMD.SHAPE_SELECT_CONVERT_TEXT_TO_CURVES_AS_SINGLE_SHAPE, () => toCurves(false), { enabled: () => texts().length > 0 });
  registry.bind(CMD.SHAPE_SELECT_CONVERT_TEXT_TO_CURVES_AS_CHARACTER_SHAPES, () => toCurves(true), { enabled: () => texts().length > 0 });

  registry.bind(CMD.SHAPE_SELECT_NODE_EDIT, () => { vectorSel.nodeEdit = true; vectorSel.nodes = []; vectorSel.objects = new Set(picked().slice(0, 1)); image()?.changed({}); },
    { enabled: () => picked().length === 1 && !objects()[picked()[0]]?.text });

  registry.bind(CMD.EDIT_PASTE_AS_NEW_VECTOR_SELECTION, () => {
    const i = image();
    if (!i || !clipboard.length) return;
    const add = structuredClone(clipboard);
    let first = 0;
    ed.run("Paste As New Vector Selection", (doc) => {
      const l = vectorTarget(doc);
      first = l.objects?.length ?? 0;
      l.objects = [...(l.objects ?? []), ...add];
      renderVectorLayer(l, doc.width, doc.height);
      return { layers: true };
    }, i);
    vectorSel.image = i;
    vectorSel.objects = new Set(add.map((_, k) => first + k));
    i.changed({});
  }, { enabled: () => clipboard.length > 0 && image() !== null });

  // Node editing: every operation changes the first selected object's contours.
  const nodeOp = (label: string, f: (cs: VectorObject["contours"], refs: NodeRef[]) => VectorObject["contours"], keep = true) => () => {
    const k = picked()[0], refs = vectorSel.nodes;
    change(label, (os) => os.map((o, j) => (j === k ? { ...o, contours: f(o.contours, refs) } : o)));
    if (!keep) vectorSel.nodes = [];
  };
  const types: [number, NodeType, string][] = [
    [CMD.NODE_EDIT_NODE_TYPE_ASYMMETRIC, "asymmetric", "Make Asymmetrical"], [CMD.NODE_EDIT_NODE_TYPE_SYMMETRIC, "symmetric", "Make Symmetrical"],
    [CMD.NODE_EDIT_NODE_TYPE_CUSP, "cusp", "Make Cusp"], [CMD.NODE_EDIT_NODE_TYPE_SMOOTH_TANGENT, "smooth", "Make Smooth/Tangent"],
  ];
  for (const [id, type, label] of types) registry.bind(id, nodeOp(label, (cs, r) => setNodeType(cs, r, type)), { enabled: nodesPicked });
  registry.bind(CMD.NODE_EDIT_NODE_TYPE_CONVERT_TO_LINE, nodeOp("Make Line", convertToLine), { enabled: nodesPicked });
  registry.bind(CMD.NODE_EDIT_NODE_TYPE_LINE_BEFORE, nodeOp("Make Line Before", lineBefore), { enabled: nodesPicked });
  registry.bind(CMD.NODE_EDIT_NODE_TYPE_LINE_AFTER, nodeOp("Make Line After", lineAfter), { enabled: nodesPicked });
  registry.bind(CMD.NODE_EDIT_NODE_TYPE_CURVE_BEFORE, nodeOp("Make Curve Before", curveBefore), { enabled: nodesPicked });
  registry.bind(CMD.NODE_EDIT_NODE_TYPE_CURVE_AFTER, nodeOp("Make Curve After", curveAfter), { enabled: nodesPicked });
  registry.bind(CMD.NODE_EDIT_EDIT_REVERSE_CONTOUR, nodeOp("Reverse Contour", reverseContours, false), { enabled: nodesPicked });
  registry.bind(CMD.NODE_EDIT_EDIT_REVERSE_PATH, nodeOp("Reverse All", (cs) => reversePath(cs), false), { enabled: nodes });
  registry.bind(CMD.NODE_EDIT_EDIT_CLOSE, nodeOp("Close Curve", closeContours), { enabled: nodesPicked });
  registry.bind(CMD.NODE_EDIT_EDIT_BREAK, nodeOp("Break Curve", (cs, r) => breakAt(cs, r[0]), false), { enabled: () => nodesPicked() && vectorSel.nodes.length === 1 });
  registry.bind(CMD.NODE_EDIT_EDIT_JOIN_SELECT, nodeOp("Join Sub Paths", (cs, r) => joinEnds(cs, r[0], r[1]), false), { enabled: () => nodes() && vectorSel.nodes.length === 2 });
  registry.bind(CMD.NODE_EDIT_EDIT_MERGE, nodeOp("Merge Nodes", mergeNodes, false), { enabled: () => nodes() && vectorSel.nodes.length > 1 });
  registry.bind(CMD.NODE_EDIT_EDIT_DELETE, nodeOp("Delete Nodes", deleteNodes, false), { enabled: nodesPicked });
  registry.bind(CMD.NODE_EDIT_EDIT_SELECT_ALL, () => { const o = objects()[picked()[0]]; if (o) vectorSel.nodes = allNodes(o.contours); image()?.changed({}); }, { enabled: nodes });
  registry.bind(CMD.NODE_EDIT_EDIT_SELECT_NONE, () => { vectorSel.nodes = []; image()?.changed({}); }, { enabled: nodes });
  // Copy Nodes takes the contours holding the selected nodes; Paste Nodes adds them to the object.
  registry.bind(CMD.NODE_EDIT_EDIT_COPY, () => { const o = objects()[picked()[0]]; if (o) nodeClipboard = structuredClone([...new Set(vectorSel.nodes.map(([c]) => c))].map((c) => o.contours[c])); }, { enabled: nodesPicked });
  registry.bind(CMD.NODE_EDIT_EDIT_PASTE, nodeOp("Paste Nodes", (cs) => [...cs, ...structuredClone(nodeClipboard)], false), { enabled: () => nodes() && nodeClipboard.length > 0 });
  registry.bind(CMD.NODE_EDIT_EDIT_UNDO, () => ed.undo(), { enabled: () => Boolean(ed.image?.history.canUndo) });
  registry.bind(CMD.NODE_EDIT_EDIT_REDO, () => ed.redo(), { enabled: () => Boolean(ed.image?.history.canRedo) });
  registry.bind(CMD.NODE_EDIT_REFRESH, () => image()?.changed({ layers: true }), { enabled: nodes });
  // Mode Toggle (Ctrl+E) switches Node Edit between Edit mode and Drawing mode; Quit leaves node editing.
  registry.bind(CMD.NODE_EDIT_MODE_TOGGLE, () => { vectorSel.drawing = !vectorSel.drawing; image()?.changed({}); }, { enabled: () => vectorSel.nodeEdit && some(), checked: () => vectorSel.drawing });
  registry.bind(CMD.NODE_EDIT_QUIT_NODE_EDITING, () => { vectorSel.nodeEdit = false; vectorSel.drawing = false; vectorSel.nodes = []; image()?.changed({}); }, { enabled: nodes });
  void clearVectorSelection;
}
