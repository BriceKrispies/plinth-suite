/** Tiny DOM helpers. Text always goes in through text nodes, never innerHTML. */

const apply = (el, props) => {
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key === "style") for (const [name, v] of Object.entries(value)) el.style.setProperty(name, String(v));
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
};

const kids = (list) => list.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false);

export const h = (tag, props, ...children) => {
  const el = document.createElement(tag);
  apply(el, props);
  el.append(...kids(children));
  return el;
};

export const $ = (selector, root = document) => root.querySelector(selector);

export const clear = (el) => el.replaceChildren();

/** Announce a short sentence to assistive technology through the shared status region. */
export const announce = (() => {
  let timer = 0;
  return (text) => {
    const region = document.getElementById("announcer");
    if (!region) return;
    region.textContent = "";
    clearTimeout(timer);
    timer = setTimeout(() => { region.textContent = text; }, 60);
  };
})();
