// Content block rendering, reactions and block diffs, shared by the feed, reader, editor and review queue.
// All text goes through inlineText(), never HTML parsing (CONTRACT 1.7).
import { h } from "../../ds/js/dom.js";
import { icon, ICON_PATHS } from "../../ds/js/icons.js";
import { artwork } from "../../ds/js/artwork.js";
import { inlineText } from "../../ds/js/richtext.js";
import { linkButton, button } from "../../ds/js/button.js";
import { pill } from "../../ds/js/pill.js";
import { number } from "../../ds/js/format.js";

export const BLOCK_TYPES = [
  { type: "heading", label: "Heading", icon: "article" },
  { type: "paragraph", label: "Paragraph", icon: "document" },
  { type: "list", label: "List", icon: "list" },
  { type: "quote", label: "Quote", icon: "announcement" },
  { type: "callout", label: "Callout", icon: "info" },
  { type: "image", label: "Image", icon: "image" },
  { type: "divider", label: "Divider", icon: "minus" },
  { type: "cta", label: "Call to action", icon: "link" },
  { type: "panel", label: "Report panel", icon: "chart" },
  { type: "products", label: "Products", icon: "gift" },
  { type: "badge", label: "Badge", icon: "medal" },
];
export const blockLabel = (type) => BLOCK_TYPES.find((b) => b.type === type)?.label ?? type;

export const TYPE_META = {
  page: { label: "Page", icon: "document" },
  article: { label: "Article", icon: "article" },
  announcement: { label: "Announcement", icon: "announcement" },
};

const safe = (name, fallback = "info", size = 16) => icon(name in ICON_PATHS ? name : fallback, { size });
const slugOf = (ref) => String(ref ?? "").split(":")[1] ?? ref;

export const defaultBlock = (type) =>
  ({
    heading: { type, level: 2, text: "" },
    paragraph: { type, text: "" },
    list: { type, ordered: false, items: [""] },
    quote: { type, text: "" },
    callout: { type, tone: "info", icon: "info", text: "" },
    image: { type, artwork: { icon: "image", hue: 220, pattern: "solid" }, alt: "" },
    divider: { type },
    cta: { type, label: "", href: "/" },
    panel: { type, panel: "panel:" },
    products: { type, products: [] },
    badge: { type, badge: "badge:" },
  })[type];

export const blockText = (b) => {
  switch (b?.type) {
    case "heading":
    case "paragraph":
    case "quote":
    case "callout":
      return b.text ?? "";
    case "list":
      return (b.items ?? []).join(" ");
    case "image":
      return b.caption ?? b.alt ?? "";
    case "cta":
      return b.label ?? "";
    default:
      return "";
  }
};

export const readMinutes = (blocks) => {
  const words = blocks.map(blockText).join(" ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
};

export const headingsOf = (blocks) =>
  blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.type === "heading" && b.text);

export const blockNode = (b, { idPrefix = "blk", index = 0 } = {}) => {
  switch (b.type) {
    case "heading":
      return h(
        b.level === 3 ? "h3" : "h2",
        { class: "wn-heading", id: `${idPrefix}-${index}` },
        inlineText(b.text),
      );
    case "paragraph":
      return h("p", { class: "wn-p" }, inlineText(b.text));
    case "list":
      return h(
        b.ordered ? "ol" : "ul",
        { class: "wn-list" },
        ...b.items.map((t) => h("li", {}, inlineText(t))),
      );
    case "quote":
      return h(
        "blockquote",
        { class: "wn-quote" },
        h("p", {}, inlineText(b.text)),
        b.cite ? h("footer", {}, h("cite", {}, inlineText(b.cite))) : null,
      );
    case "callout":
      return h(
        "aside",
        { class: `wn-callout wn-callout--${b.tone}`, role: "note" },
        h("span", { class: "wn-callout__icon" }, safe(b.icon)),
        h("div", {}, inlineText(b.text)),
      );
    case "image":
      return h(
        "figure",
        { class: "wn-figure" },
        h("div", { class: "wn-figure__art" }, artwork(b.artwork, { size: 480, label: b.alt || undefined })),
        b.caption ? h("figcaption", {}, b.caption) : null,
      );
    case "divider":
      return h("hr", { class: "wn-divider" });
    case "cta":
      return h(
        "p",
        { class: "wn-cta" },
        linkButton({ href: b.href, label: b.label || "Open", variant: "primary", icon: "chevron-right" }),
      );
    case "panel":
      return h(
        "p",
        { class: "wn-embed" },
        safe("chart"),
        " Report panel ",
        h("a", { href: b.dashboard ? `/reports/${b.dashboard}` : "/reports" }, slugOf(b.panel)),
      );
    case "products":
      return h(
        "ul",
        { class: "wn-products", role: "list", "aria-label": "Featured products" },
        ...b.products.map((p) =>
          h("li", {}, h("a", { class: "wn-chip", href: `/store/p/${slugOf(p)}` }, safe("gift"), slugOf(p))),
        ),
      );
    case "badge":
      return h(
        "p",
        { class: "wn-embed" },
        safe("medal"),
        " Badge ",
        h("a", { href: "/badges" }, slugOf(b.badge)),
      );
    default:
      return null;
  }
};

export const renderBlocks = (blocks, opts = {}) =>
  h("div", { class: "wn-blocks" }, ...blocks.map((b, i) => blockNode(b, { ...opts, index: i })));

// ---------- reactions ----------

export const REACTIONS = [
  { value: "like", label: "Like", glyph: "heart" },
  { value: "celebrate", label: "Celebrate", glyph: "sparkle" },
  { value: "insightful", label: "Insightful", glyph: "bolt" },
];

/** Reaction toggles. `counts` is `{ like, celebrate, insightful }`; `onPick(value | null)` runs the engage call. */
export const reactionBar = ({
  counts = {},
  mine = null,
  enabled = REACTIONS.map((r) => r.value),
  onPick,
  compact = false,
}) => {
  const root = h("div", {
    class: `wn-reactions${compact ? " wn-reactions--compact" : ""}`,
    role: "group",
    "aria-label": "Reactions",
  });
  let state = { counts: { ...counts }, mine, busy: false };
  const draw = () => {
    root.replaceChildren(
      ...REACTIONS.filter((r) => enabled.includes(r.value)).map((r) => {
        const on = state.mine === r.value;
        const n = state.counts[r.value] ?? 0;
        const b = button({
          label: compact ? String(number(n)) : `${r.label} ${number(n)}`,
          icon: r.glyph,
          size: "sm",
          variant: on ? "primary" : "secondary",
          pressed: on,
          title: `${r.label}${on ? " (click to remove)" : ""}`,
          onClick: async () => {
            if (state.busy) return;
            state.busy = true;
            try {
              await onPick(on ? null : r.value);
            } finally {
              state.busy = false;
            }
          },
        });
        b.setAttribute(
          "aria-label",
          `${r.label}, ${n} reaction${n === 1 ? "" : "s"}${on ? ", selected" : ""}`,
        );
        return b;
      }),
    );
  };
  draw();
  root.update = (next) => {
    state = {
      ...state,
      counts: { ...state.counts, ...(next.counts ?? {}) },
      mine: next.mine === undefined ? state.mine : next.mine,
    };
    draw();
  };
  return root;
};

export const totalReactions = (counts) =>
  Object.values(counts ?? {}).reduce((a, n) => a + (Number(n) || 0), 0);

// ---------- diffs ----------

const CHANGE_TONE = {
  added: "success",
  removed: "danger",
  modified: "warning",
  moved: "info",
  unchanged: "neutral",
};
const CHANGE_LABEL = {
  added: "Added",
  removed: "Removed",
  modified: "Changed",
  moved: "Moved",
  unchanged: "Unchanged",
};

export const fieldValue = (v) => (v === undefined ? "none" : typeof v === "string" ? v : JSON.stringify(v));

export const diffFields = (fields) =>
  fields?.length
    ? h(
        "dl",
        { class: "wn-fielddiff" },
        ...fields.flatMap((f) => [
          h("dt", {}, h("code", {}, f.path)),
          h(
            "dd",
            {},
            h("del", {}, fieldValue(f.before)),
            h("span", { class: "sr-only" }, " changed to "),
            h("span", { "aria-hidden": "true" }, " → "),
            h("ins", {}, fieldValue(f.after)),
          ),
        ]),
      )
    : null;

/** Block-level diff: changed blocks side by side, unchanged ones folded away. */
export const diffBlocks = (blocks) => {
  const changed = blocks.filter((b) => b.change !== "unchanged");
  const same = blocks.length - changed.length;
  const col = (title, block) =>
    h(
      "div",
      { class: "wn-diff__col" },
      h("p", { class: "wk-caps" }, title),
      block ? blockNode(block) : h("p", { class: "u-muted" }, "Nothing"),
    );
  return h(
    "div",
    { class: "wn-diff" },
    ...changed.map((b) =>
      h(
        "section",
        {
          class: `wn-diff__block wn-diff__block--${b.change}`,
          "aria-label": `${CHANGE_LABEL[b.change]} block ${b.index + 1}`,
        },
        h(
          "p",
          { class: "wn-diff__head" },
          pill({ label: CHANGE_LABEL[b.change], tone: CHANGE_TONE[b.change] }),
          h(
            "span",
            { class: "u-muted" },
            ` Block ${b.index + 1}${b.change === "moved" && b.from_index !== null ? ` (was ${b.from_index + 1})` : ""}`,
          ),
        ),
        b.change === "modified"
          ? h("div", { class: "wn-diff__cols" }, col("Before", b.before), col("After", b.after))
          : b.change === "removed"
            ? col("Removed", b.before)
            : col(b.change === "added" ? "Added" : "Moved", b.after),
      ),
    ),
    same ? h("p", { class: "u-muted" }, `${same} unchanged block${same === 1 ? "" : "s"} not shown.`) : null,
    changed.length === 0 ? h("p", { class: "u-muted" }, "No block changed.") : null,
  );
};
