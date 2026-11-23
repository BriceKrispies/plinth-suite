// Icon paths on a 24 by 24 grid: stroke 1.5, square caps, miter joins, currentColor. Names are ICON_NAMES.
import { s } from "./dom.js";
import { PElement, define, reflect } from "./element-base.js";

const dot = (x, y) => `M${x - 1} ${y}a1 1 0 1 0 2 0 1 1 0 1 0-2 0z`;

const PATHS = {
  home: "M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6",
  inbox: "M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5",
  send: "M21 3L10 14M21 3l-7 18-4-7-7-4z",
  archive: "M3 4h18v4H3zM5 8v12h14V8M10 12h4",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
  bell: "M6 17v-6a6 6 0 0 1 12 0v6l2 2H4zM10 21h4",
  search: "M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15zM16 16l5 5",
  command:
    "M9 9h6v6H9zM9 9V6a3 3 0 1 0-3 3zM15 9V6a3 3 0 1 1 3 3zM9 15v3a3 3 0 1 1-3-3zM15 15v3a3 3 0 1 0 3-3z",
  store:
    "M3 9l2-5h14l2 5M4 9v11h16V9M3 9c0 2 1.5 3 3 3s3-1 3-3c0 2 1.5 3 3 3s3-1 3-3c0 2 1.5 3 3 3s3-1 3-3M9 20v-5h6v5",
  cart: "M2 3h3l3 12h11l2-8H6M9 21a1 1 0 1 0 0-.01M18 21a1 1 0 1 0 0-.01",
  bag: "M5 8h14l1 13H4zM9 8V6a3 3 0 0 1 6 0v2",
  tag: "M3 12V3h9l9 9-9 9zM8 8h.01",
  gift: "M3 8h18v4H3zM5 12v9h14v-9M12 8v13M12 8C9 8 7 7 7 5.5S9.5 3 12 8c2.5-5 5-3.5 5-2.5S15 8 12 8",
  coins:
    "M12 4c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 7v5c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5",
  wallet: "M3 7h16V5H5a2 2 0 0 0-2 2v12h18V9H5M16 14h.01",
  transfer: "M4 8h16M16 4l4 4-4 4M20 16H4M8 12l-4 4 4 4",
  trophy: "M7 4h10v6a5 5 0 0 1-10 0zM7 6H3v2a4 4 0 0 0 4 4M17 6h4v2a4 4 0 0 1-4 4M12 15v4M8 21h8",
  medal: "M8 3l4 7 4-7M12 22a6 6 0 1 0 0-12 6 6 0 0 0 0 12z",
  award: "M12 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8.5 13L7 22l5-3 5 3-1.5-9",
  crown: "M3 18L2 6l6 5 4-7 4 7 6-5-1 12zM3 21h18",
  flame: "M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-4 3-6 1 1 1 2 2 2 0-3-1-5 1-8z",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
  megaphone: "M3 10v4h4l9 5V5L7 10zM19 9a4 4 0 0 1 0 6M7 14l1 6h3l-1-6",
  percent: "M19 5L5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  calendar: "M4 6h16v15H4zM4 10h16M8 3v4M16 3v4",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  workflow: "M3 3h6v6H3zM15 15h6v6h-6zM6 9v6a3 3 0 0 0 3 3h6M15 6h3a3 3 0 0 1 3 3v3",
  play: "M6 4l14 8-14 8z",
  pause: "M7 4h3v16H7zM14 4h3v16h-3z",
  stop: "M5 5h14v14H5z",
  branch: "M6 3v12M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9c0 5-6 4-12 6",
  webhook:
    "M12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM11 8L7 16M13 8l4 8M9 19h6",
  document: "M6 3h8l5 5v13H6zM14 3v5h5M9 13h7M9 17h7",
  article: "M4 4h16v16H4zM8 8h8M8 12h8M8 16h5",
  announcement: "M4 5h16v11H9l-5 4zM8 9h8M8 12h5",
  image: "M3 4h18v16H3zM8 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM3 17l5-5 4 4 3-3 6 6",
  users:
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 14 0v1M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 6v1",
  user: "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a8 8 0 0 1 16 0v1",
  group:
    "M8 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20a6 6 0 0 1 12 0M12 20a6 6 0 0 1 10 0",
  segment: "M12 3a9 9 0 1 0 9 9h-9zM15 3.5A9 9 0 0 1 20.5 9H15z",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  key: "M7.5 15.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM11 11h10M18 11v4M15 11v3",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  chart: "M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3",
  board: "M3 4h18v16H3zM3 9h18M9 9v11",
  check: "M4 12l5 5L20 6",
  "check-circle": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM7.5 12l3 3 6-6",
  x: "M5 5l14 14M19 5L5 19",
  alert: "M12 3l10 18H2zM12 10v5M12 18h.01",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01",
  task: "M5 4h14v17H5zM9 4V2h6v2M9 13l2 2 4-4",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  sliders: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2",
  audit: "M5 3h14v18H5zM9 8h6M9 12h6M9 16h3",
  attachment: "M20 11l-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7",
  reply: "M10 8L4 13l6 5M4 13h10a6 6 0 0 1 6 6",
  mention: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7",
  heart: "M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z",
  sparkle:
    "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  leaf: "M5 20C5 10 10 5 20 4c0 10-4 15-13 15zM5 20l8-8",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  truck:
    "M2 6h12v10H2zM14 9h5l3 4v3h-8zM6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  box: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10",
  ticket: "M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4zM14 6v12",
  coffee: "M4 8h13v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h2a2 2 0 0 1 0 4h-2M8 2v3M12 2v3",
  headphones: "M4 15v-3a8 8 0 0 1 16 0v3M4 15h4v6H6a2 2 0 0 1-2-2zM20 15h-4v6h2a2 2 0 0 0 2-2z",
  laptop: "M5 5h14v10H5zM2 19h20M2 19l2-4h16l2 4",
  shirt: "M8 3L2 7l3 4 3-1v11h8V10l3 1 3-4-6-4a4 4 0 0 1-8 0z",
  book: "M4 4h6a3 3 0 0 1 2 1 3 3 0 0 1 2-1h6v15h-6a3 3 0 0 0-2 1 3 3 0 0 0-2-1H4zM12 5v15",
  plant: "M12 21v-8M12 13c0-4-3-6-7-6 0 4 3 6 7 6zM12 15c0-3 2-5 6-5 0 3-2 5-6 5zM8 21h8",
  mountain: "M2 20l7-12 4 7 3-4 6 9z",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5",
  moon: "M20 14A8 8 0 1 1 10 4a6.5 6.5 0 0 0 10 10z",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  edit: "M4 20h4L19 9l-4-4L4 16zM13 7l4 4",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6",
  copy: "M8 8h12v12H8zM16 8V4H4v12h4",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  filter: "M3 5h18l-7 8v6l-4 2v-8z",
  sort: "M8 4v16M4 16l4 4 4-4M16 20V4M12 8l4-4 4 4",
  more: `${dot(5, 12)}${dot(12, 12)}${dot(19, 12)}`,
  "chevron-left": "M15 5l-7 7 7 7",
  "chevron-right": "M9 5l7 7-7 7",
  "chevron-down": "M5 9l7 7 7-7",
  "chevron-up": "M5 15l7-7 7 7",
  menu: "M3 6h18M3 12h18M3 18h18",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  "eye-off":
    "M3 3l18 18M10 5.2A9 9 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.6M6.5 6.6C3.7 8.4 2 12 2 12s4 7 10 7c1.7 0 3.3-.5 4.6-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2",
  logout: "M9 4H4v16h5M16 8l4 4-4 4M20 12H9",
};

/** Every name the module can draw (the check script compares this with ICON_NAMES). */
export const ICON_PATHS = PATHS;

const SIZES = new Set([16, 20, 24]);

const draw = (name, { label, size = 20 } = {}) => {
  const d = PATHS[name];
  if (!d) return null;
  const px = SIZES.has(Number(size)) ? Number(size) : 20;
  return s(
    "svg",
    {
      class: `c-icon c-icon--${px}`,
      viewBox: "0 0 24 24",
      width: px,
      height: px,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 1.5,
      "stroke-linecap": "square",
      "stroke-linejoin": "miter",
      ...(label ? { role: "img", "aria-label": label } : { "aria-hidden": "true", focusable: "false" }),
    },
    s("path", { d }),
  );
};

/** `<p-icon name label size>`: draws the named glyph as one inline SVG child (display: contents, see pill.css). */
export class PIcon extends PElement {
  static observedAttributes = ["name", "label", "size"];

  render() {
    this.classList.add("c-icon");
    const svg = draw(this.name, { label: this.label, size: this.size });
    this.replaceChildren(...(svg ? [svg] : []));
  }
}
reflect(PIcon, { name: ["name", "string"], label: ["label", "string"], size: ["size", "number", 20] });
define("p-icon", PIcon);

export const icon = (name, { label, size = 20 } = {}) => {
  if (!PATHS[name]) throw new TypeError(`Unknown icon "${name}"`);
  const el = document.createElement("p-icon");
  return el.configure({ name, label: label ?? null, size });
};
