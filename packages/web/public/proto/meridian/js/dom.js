// Tiny DOM helpers. Text always goes through textContent / text nodes, never innerHTML.
const SVG_NS = "http://www.w3.org/2000/svg";

const apply = (el, attrs) => {
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
};

const append = (el, kids) => {
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
};

const build = (el, attrs, kids) => {
  apply(el, attrs);
  return append(el, kids);
};

export const h = (tag, attrs, ...kids) => build(document.createElement(tag), attrs, kids);

export const s = (tag, attrs, ...kids) => build(document.createElementNS(SVG_NS, tag), attrs, kids);

export const $ = (sel, root = document) => root.querySelector(sel);

export const clear = (el) => {
  el.replaceChildren();
  return el;
};

let counter = 0;
export const uid = (prefix = "m") => `${prefix}-${++counter}`;

/** Run `fn` on the next frame, coalescing repeated calls into one. */
export const frameOnce = (fn) => {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn();
    });
  };
};
