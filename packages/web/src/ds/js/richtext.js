import { h } from "./dom.js";

const HANDLE = /^[a-z][a-z0-9-]{1,39}$/;
const TOKEN = /\*\*([^*\n]+)\*\*|(?<![\w])_([^_\n]+)_(?![\w])|(?<![\w@])@([a-z][a-z0-9-]{1,39})(?![\w-])/g;

/** Inline grammar: **bold**, _em_ and @handle. No HTML is parsed; everything else is text. */
export const inlineText = (text, { mentions } = {}) => {
  const root = h("span", { class: "c-richtext" });
  const src = String(text ?? "");
  let last = 0;
  for (const m of src.matchAll(TOKEN)) {
    if (m.index > last) root.append(document.createTextNode(src.slice(last, m.index)));
    if (m[1] !== undefined) root.append(h("strong", {}, m[1]));
    else if (m[2] !== undefined) root.append(h("em", {}, m[2]));
    else if (HANDLE.test(m[3])) {
      const href = mentions?.(m[3]);
      root.append(
        href
          ? h("a", { class: "c-mention", href }, `@${m[3]}`)
          : h("span", { class: "c-mention" }, `@${m[3]}`),
      );
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) root.append(document.createTextNode(src.slice(last)));
  return root;
};
