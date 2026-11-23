/** Tiny DOM builders. Text always goes in as text nodes, never as markup. */
const SVG_NS = "http://www.w3.org/2000/svg";

const apply = (node, props) => {
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? "" : String(value));
  }
};

const append = (node, kids) => {
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
};

const factory = (create) => (tag, props, ...kids) => {
  const node = create(tag);
  apply(node, props);
  append(node, kids);
  return node;
};

export const h = factory((tag) => document.createElement(tag));
export const s = factory((tag) => document.createElementNS(SVG_NS, tag));

let counter = 0;
export const uid = (prefix = "id") => `${prefix}-${++counter}`;

export const $ = (selector, root = document) => root.querySelector(selector);
