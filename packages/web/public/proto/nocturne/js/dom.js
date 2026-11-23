// Tiny DOM helpers. Text is only ever inserted as text nodes or via setAttribute, never as markup.
const SVG_NS = "http://www.w3.org/2000/svg";

const apply = (node, props) => {
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  return node;
};

const append = (node, kids) => {
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) node.append(kid);
  return node;
};

export const h = (tag, props, ...kids) => append(apply(document.createElement(tag), props), kids);
export const s = (tag, props, ...kids) => append(apply(document.createElementNS(SVG_NS, tag), props), kids);

/** Reference an icon from the sprite in index.html. Decorative: the label always lives in adjacent text. */
export const icon = (name, cls = "") =>
  s("svg", { class: `icon ${cls}`.trim(), "aria-hidden": "true", focusable: "false" }, s("use", { href: `#i-${name}` }));

let counter = 0;
export const uid = (prefix) => `${prefix}-${++counter}`;

export const $ = (selector, root = document) => root.querySelector(selector);
