// Generated artwork: pure functions of data, no image files. Colours come from artwork.css via --art-hue.
import { s } from "./dom.js";
import { ICON_PATHS } from "./icons.js";

const frame = (cls, hue, size, label, kids) =>
  s(
    "svg",
    {
      class: `c-art ${cls}`,
      viewBox: "0 0 96 96",
      width: size,
      height: size,
      style: `--art-hue:${Number(hue) || 0}`,
      ...(label ? { role: "img", "aria-label": label } : { "aria-hidden": "true", focusable: "false" }),
    },
    ...kids,
  );

const range = (n) => Array.from({ length: n }, (_, i) => i);

const patternNodes = (pattern, clipId) => {
  const kids = [];
  switch (pattern) {
    case "stripes":
      for (let i = -12; i <= 24; i += 1) {
        kids.push(
          s("path", { class: "c-art__pat", d: `M${i * 8 - 8} 104L${i * 8 + 104} -8`, "stroke-width": 2 }),
        );
      }
      break;
    case "dots":
      for (const y of range(12))
        for (const x of range(12))
          kids.push(s("circle", { class: "c-art__pat-fill", cx: 4 + x * 8, cy: 4 + y * 8, r: 1.5 }));
      break;
    case "rings":
      for (const r of [12, 24, 36, 48])
        kids.push(s("circle", { class: "c-art__pat", cx: 48, cy: 48, r, fill: "none", "stroke-width": 2 }));
      break;
    case "grid":
      for (let i = 16; i < 96; i += 16) {
        kids.push(s("path", { class: "c-art__pat", d: `M${i} 0V96M0 ${i}H96`, "stroke-width": 1 }));
      }
      break;
    case "waves":
      for (const y of [24, 48, 72]) {
        let d = `M0 ${y}`;
        for (let x = 0; x <= 96; x += 4)
          d += `L${x} ${(y + 8 * Math.sin((x / 96) * Math.PI * 4)).toFixed(2)}`;
        kids.push(s("path", { class: "c-art__pat", d, fill: "none", "stroke-width": 2 }));
      }
      break;
    default:
      break;
  }
  return kids.length ? [s("g", { "clip-path": `url(#${clipId})` }, ...kids)] : [];
};

const iconGlyph = (name, box, cls = "c-art__icon") => {
  const d = ICON_PATHS[name];
  if (!d) throw new TypeError(`Unknown icon "${name}"`);
  const k = box / 24;
  const o = 48 - box / 2;
  return s(
    "g",
    {
      class: cls,
      transform: `translate(${o} ${o}) scale(${k})`,
      fill: "none",
      "stroke-width": +(2.4 / k).toFixed(2),
      "stroke-linecap": "square",
      "stroke-linejoin": "miter",
    },
    s("path", { d }),
  );
};

let n = 0;

export const artwork = ({ icon, hue, pattern = "solid", glyph }, { size = 96, label } = {}) => {
  const clipId = `art-clip-${++n}`;
  return frame("c-art--field", hue, size, label, [
    s("defs", {}, s("clipPath", { id: clipId }, s("rect", { width: 96, height: 96 }))),
    s("rect", { class: "c-art__field", width: 96, height: 96 }),
    ...patternNodes(pattern, clipId),
    s("circle", { class: "c-art__disc", cx: 48, cy: 48, r: 28 }),
    iconGlyph(icon, glyph ? 32 : 40),
    glyph
      ? s("text", { class: "c-art__glyph", x: 48, y: 72, "text-anchor": "middle" }, String(glyph).slice(0, 3))
      : null,
  ]);
};

const star = () => {
  const pts = range(10).map((i) => {
    const r = i % 2 === 0 ? 42 : 18;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    return `${(48 + r * Math.cos(a)).toFixed(2)},${(48 + r * Math.sin(a)).toFixed(2)}`;
  });
  return `M${pts.join("L")}Z`;
};
const hexagon = () => {
  const pts = range(6).map((i) => {
    const a = (i * Math.PI) / 3;
    return `${(48 + 42 * Math.cos(a)).toFixed(2)},${(48 + 42 * Math.sin(a)).toFixed(2)}`;
  });
  return `M${pts.join("L")}Z`;
};

const SHAPES = {
  disc: () => s("circle", { cx: 48, cy: 48, r: 40 }),
  hexagon: () => s("path", { d: hexagon() }),
  shield: () => s("path", { d: "M48 6L84 18V48C84 70 68 84 48 92 28 84 12 70 12 48V18Z" }),
  star: () => s("path", { d: star() }),
  diamond: () => s("path", { d: "M48 6L90 48 48 90 6 48Z" }),
};

export const badgeArt = ({ shape = "disc", icon, hue, ring = null }, { size = 96, label } = {}) => {
  const make = SHAPES[shape] ?? SHAPES.disc;
  const field = make();
  field.setAttribute("class", "c-art__field");
  const kids = [];
  if (ring) {
    const r = make();
    r.setAttribute("class", `c-art__ring c-art__ring--${ring}`);
    r.setAttribute("fill", "none");
    r.setAttribute("stroke-width", 4);
    r.setAttribute("transform", "translate(48 48) scale(1.1) translate(-48 -48)");
    kids.push(r);
  }
  kids.push(field, iconGlyph(icon, 36, "c-art__icon c-art__icon--badge"));
  return frame("c-art--badge", hue, size, label, kids);
};

export const avatarArt = ({ initials, hue }, { size = 32, label } = {}) =>
  frame("c-art--avatar", hue, size, label, [
    s("rect", { class: "c-art__avatar-bg", width: 96, height: 96 }),
    s(
      "text",
      { class: "c-art__avatar-text", x: 48, y: 50, "text-anchor": "middle", "dominant-baseline": "central" },
      initials,
    ),
  ]);

/** FNV-1a 32-bit hash of a slug, for category and product placeholders (DESIGN-SYSTEM 7.5). */
export const hashSlug = (slug) => {
  let hash = 0x811c9dc5;
  for (const ch of String(slug)) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};
