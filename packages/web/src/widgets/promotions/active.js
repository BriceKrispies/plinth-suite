// promotions.active: member-facing offer banners for the promotions the viewer qualifies for right now.
import { schemaOf } from "../../core/widgets.js";
import { h } from "../../ds/js/dom.js";
import { button, iconButton, linkButton } from "../../ds/js/button.js";
import { icon } from "../../ds/js/icons.js";
import { pill } from "../../ds/js/pill.js";
import { emptyState, skeleton } from "../../ds/js/states.js";
import { errorState } from "../../ds/js/states.js";
import { lifecycle, debounce, rel, when, kv, enumLabel } from "./_kit.js";
import { CHANNEL_LABEL } from "./_promo.js";

const DEFAULT_LIMIT = { s: 1, m: 2, l: 3, xl: 4, full: 6 };

export default {
  id: "promotions.active",
  domain: "promotions",
  title: "Offers for you",
  configSchema: schemaOf("promotions.active"),
  sizes: ["s", "m", "l", "xl", "full"],
  mount(el, { config, size, api, rt, ctx }) {
    const life = lifecycle();
    const compact = size === "s";
    const limit = Math.min(6, config.limit ?? DEFAULT_LIMIT[size] ?? 3);
    let items = [];
    let index = 0;
    let known = new Set();
    let first = true;

    const root = h("div", { class: `wp wp-active wp-active--${size}` });
    el.append(root);

    const banner = (p, { fresh = false, large = false } = {}) => {
      const tone = p.tone ?? "info";
      const node = h(
        "article",
        { class: `wp-offer wp-offer--${tone}${large ? " wp-offer--large" : ""}${fresh ? " u-arrive" : ""}` },
        h(
          "span",
          { class: "wp-offer__icon", "aria-hidden": "true" },
          icon(p.icon ?? "percent", { size: 24 }),
        ),
        h(
          "div",
          { class: "wp-offer__text" },
          h("h3", { class: "wp-offer__headline" }, p.headline ?? p.title),
          h("p", { class: "wp-offer__effect" }, p.effect_summary),
          h(
            "p",
            { class: "wp-offer__meta u-muted" },
            h("time", { datetime: p.ends_at, title: when(p.ends_at) }, `Ends ${rel(p.ends_at)}`),
            fresh ? pill({ label: "New", tone: "signal" }) : null,
          ),
        ),
        button({ label: "Details", size: "sm", variant: "secondary", onClick: () => openDetails(p) }),
      );
      return node;
    };

    const openDetails = (p) => {
      ctx.openDrawer({
        title: p.title,
        width: "sm",
        body: h(
          "div",
          { class: "wp-quick" },
          h("p", {}, p.description),
          kv([
            ["What you get", p.effect_summary],
            ["Ends", when(p.ends_at)],
            ["Applies to", p.channels.map((c) => CHANNEL_LABEL[c] ?? enumLabel(c)).join(", ")],
          ]),
          h(
            "div",
            { class: "wk-actions" },
            p.channels.includes("store")
              ? linkButton({
                  href: "/store",
                  label: "Shop with this offer",
                  icon: "store",
                  variant: "primary",
                })
              : null,
          ),
        ),
      });
    };

    const paint = (arrivals = new Set()) => {
      root.replaceChildren();
      ctx.setCount(items.length);
      if (items.length === 0) {
        root.append(
          emptyState({
            icon: "percent",
            title: "No offers right now",
            body: "When a promotion you qualify for goes live, it appears here.",
          }),
        );
        return;
      }
      if (compact) {
        index = Math.min(index, items.length - 1);
        const p = items[index];
        root.append(
          banner(p, { fresh: arrivals.has(p.slug) }),
          ...[
            items.length > 1
              ? h(
                  "div",
                  { class: "wp-active__nav" },
                  iconButton({
                    icon: "chevron-left",
                    label: "Previous offer",
                    size: "sm",
                    onClick: () => {
                      index = (index + items.length - 1) % items.length;
                      paint();
                      ctx.announce(`Offer ${index + 1} of ${items.length}`);
                    },
                  }),
                  h(
                    "span",
                    { class: "u-tabular u-muted", "aria-live": "polite" },
                    `${index + 1} of ${items.length}`,
                  ),
                  iconButton({
                    icon: "chevron-right",
                    label: "Next offer",
                    size: "sm",
                    onClick: () => {
                      index = (index + 1) % items.length;
                      paint();
                      ctx.announce(`Offer ${index + 1} of ${items.length}`);
                    },
                  }),
                )
              : null,
          ].filter(Boolean),
        );
        return;
      }
      root.append(
        h(
          "ul",
          { class: "wp-active__list", role: "list" },
          ...items.map((p, i) =>
            h("li", {}, banner(p, { fresh: arrivals.has(p.slug), large: i === 0 && size !== "m" })),
          ),
        ),
      );
    };

    let seq = 0;
    const load = async () => {
      const mine = ++seq;
      if (first) root.append(skeleton({ shape: "card", lines: 2 }));
      try {
        const out = await api.call("promotions.active", {});
        if (life.dead || mine !== seq) return;
        items = out.items.slice(0, limit);
        const arrivals = new Set();
        if (!first) for (const p of items) if (!known.has(p.slug)) arrivals.add(p.slug);
        known = new Set(out.items.map((p) => p.slug));
        first = false;
        paint(arrivals);
        if (arrivals.size) {
          ctx.announce(`${arrivals.size} new ${arrivals.size === 1 ? "offer" : "offers"}`);
          life.timeout(
            () => root.querySelectorAll(".u-arrive").forEach((n) => n.classList.remove("u-arrive")),
            6000,
          );
        }
      } catch (e) {
        if (life.dead || mine !== seq) return;
        root.replaceChildren(errorState({ error: e, retry: load }));
      }
    };
    load();

    life.add(rt.on("promotion.state_changed", debounce(life, load, 300)));
    return () => life.dispose();
  },
};
