/*
  A small element builder, ported from OpenMTM2 src/ui/dom.js:

    el("button", { class: "primary", onclick: go }, "Apply")

  Attributes starting with "on" become listeners; null, undefined and false are skipped,
  both as attributes and as children; strings become text nodes.
*/
type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown>;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name.startsWith("on") && typeof value === "function") node.addEventListener(name.slice(2), value as EventListener);
    else if (name === "style" && typeof value === "object") Object.assign(node.style, value);
    else if (value === true) node.setAttribute(name, "");
    else node.setAttribute(name, String(value));
  }
  append(node, children);
  return node;
}

function append(node: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(node, child);
    else node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}
