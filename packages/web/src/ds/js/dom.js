// Tiny DOM helpers. Text always goes through text nodes, never innerHTML.
import { withBase } from "../../core/base.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const apply = (el, attrs) => {
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    // app paths ("/store") become URLs under the base path ("/plinth-suite/store"); a no-op at "/"
    else if (k === "href" && typeof v === "string") el.setAttribute(k, withBase(v));
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

/** Build an HTML element. `on*` attrs are listeners; false/null/undefined attrs are skipped. */
export const h = (tag, attrs, ...kids) => build(document.createElement(tag), attrs, kids);

/** Build an SVG element. */
export const s = (tag, attrs, ...kids) => build(document.createElementNS(SVG_NS, tag), attrs, kids);

export const $ = (sel, root = document) => root.querySelector(sel);

/** The only way to empty a node. */
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

/** Post a short message to the single polite status region. */
export const announce = (text) => {
  const el = document.getElementById("announcer");
  if (!el) return;
  el.textContent = "";
  setTimeout(() => {
    el.textContent = text;
  }, 60);
};
