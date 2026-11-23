// Tiny DOM helpers. Text always goes through text nodes, never innerHTML.
const append = (el, kids) => {
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
};

export const h = (tag, props, ...kids) => {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, kids);
  return el;
};

let counter = 0;
export const uid = (prefix) => `${prefix}-${++counter}`;

export const $ = (selector, root = document) => root.querySelector(selector);

/** Polite announcement for assistive tech, in the page's status region. */
export const announce = (text) => {
  const region = document.getElementById('announcer');
  if (!region) return;
  region.textContent = '';
  requestAnimationFrame(() => {
    region.textContent = text;
  });
};
