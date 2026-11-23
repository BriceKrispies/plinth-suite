// Stat tile (tier 1). DESIGN-SYSTEM 6.16.
import { h } from "./dom.js";
import { icon } from "./icons.js";
import { number } from "./format.js";
import { sparkline } from "./chart.js";

export const statTile = ({ label, value, unit, delta, good, spark, href, hint } = {}) => {
  const text = typeof delta === "string" ? delta : "";
  const up = text.trim().startsWith("+");
  const down = /^[-−]/.test(text.trim());
  const tone =
    !text || (!up && !down) ? "neutral" : good ? ((good === "up") === up ? "success" : "danger") : "neutral";
  const root = h(
    href ? "a" : "div",
    { class: `c-stat${href ? " c-stat--linked" : ""}`, href: href ?? null },
    h("p", { class: "c-stat__label" }, label),
    h(
      "p",
      { class: "c-stat__value u-tabular" },
      typeof value === "number" ? number(value) : value,
      unit ? h("span", { class: "c-stat__unit" }, unit) : null,
    ),
    text
      ? h(
          "p",
          { class: `c-stat__delta c-stat__delta--${tone}` },
          up || down ? icon(up ? "chevron-up" : "chevron-down", { size: 16 }) : null,
          h("span", {}, text),
        )
      : null,
    hint ? h("p", { class: "c-stat__hint" }, hint) : null,
    spark && spark.length > 1
      ? h("div", { class: "c-stat__spark" }, sparkline(spark, { label: `${label} trend` }))
      : null,
  );
  return root;
};
