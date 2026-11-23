// The Plat's tiny DOM kit: h() as in the web app, plus text leaves that the painter registers.

type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;
type Child = Node | string | null | undefined | false;

export const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2), v as EventListener);
    } else if (v === true) {
      el.setAttribute(k, "");
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
};

/** Normalise like `white-space: normal` would, so the text node's offsets equal what the browser lays out. */
export const norm = (v: unknown, fallback = ""): string => {
  if (v === null || v === undefined) return fallback;
  return String(v).replace(/\s+/g, " ").trim() || fallback;
};

/**
 * A text leaf: a block-level element whose only child is one text node, painted by the GPU text engine.
 * `tone` picks the painted colour.
 */
export const t = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text: unknown,
  attrs: Attrs = {},
): HTMLElementTagNameMap[K] => {
  const paint = attrs["data-paint"] ? `${String(attrs["data-paint"])} text` : "text";
  return h(
    tag,
    { ...attrs, "data-paint": paint, class: `t ${String(attrs["class"] ?? "")}`.trim() },
    norm(text),
  );
};

export const setText = (el: Element, text: unknown): void => {
  const v = norm(text);
  const first = el.firstChild;
  if (first && first.nodeType === Node.TEXT_NODE && el.childNodes.length === 1) {
    if ((first as Text).data !== v) (first as Text).data = v;
  } else {
    el.textContent = v;
  }
};

export const clear = (el: Element): void => {
  while (el.firstChild) el.firstChild.remove();
};
