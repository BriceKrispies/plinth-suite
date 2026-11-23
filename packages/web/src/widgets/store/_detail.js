// The product summary (artwork, price, stock, buy box, attributes, promotions) shared by store.product and the
// catalogue's in-widget product view.
import { h } from "../../ds/js/dom.js";
import { cents, number } from "../../ds/js/format.js";
import { button, linkButton } from "../../ds/js/button.js";
import { pill } from "../../ds/js/pill.js";
import { icon } from "../../ds/js/icons.js";
import { dl, kv } from "../points/_kit.js";
import {
  productArt,
  stars,
  stockPill,
  priceNode,
  promoPill,
  lockedText,
  affordText,
  qtyStepper,
  heartButton,
  productHref,
} from "./_shop.js";

export const FULFILMENT = {
  ship: "Shipped to you",
  pickup: "Collected on site",
  digital: "Delivered digitally",
  donation: "Donated on your behalf",
};

const cap = (t) => `${t[0].toUpperCase()}${t.slice(1)}`;

/**
 * `detail` is a ProductDetailOut. `ops`: `{ addToCart(btn), setQty(n), toggleWish(on) }`.
 * `canShop` is false for viewers without store:shop (no buy box).
 */
export const productSummary = ({ detail, ops, canShop = true, page = false }) => {
  const { card, spec } = detail;
  const locked = lockedText(card);
  const afford = affordText(card);
  const canBuy = canShop && !card.locked_reason && card.stock_status !== "out";
  const max = Math.max(
    card.in_cart_qty,
    Math.min(
      card.on_hand,
      spec.limit_per_member ? Math.max(1, spec.limit_per_member - detail.member_purchased_qty) : 99,
    ),
  );

  const buy = h("div", { class: "w-store-buy" });
  if (canShop) {
    if (card.in_cart_qty > 0 && canBuy) {
      const stepper = qtyStepper({
        value: card.in_cart_qty,
        min: 0,
        max,
        label: card.title,
        onChange: ops.setQty,
      });
      stepper.setAttribute("data-act", "qty");
      buy.append(h("p", { class: "u-muted w-kit-small" }, "In your cart"), stepper);
    } else {
      const add = button({
        label: card.stock_status === "out" ? "Out of stock" : "Add to cart",
        icon: "cart",
        variant: canBuy ? "primary" : "secondary",
        disabled: !canBuy,
        onClick: () => ops.addToCart(add),
      });
      add.setAttribute("data-act", "add");
      buy.append(add);
    }
    const heart = heartButton({ active: card.in_wishlist, title: card.title, onToggle: ops.toggleWish });
    heart.setAttribute("data-act", "wish");
    buy.append(heart);
  }

  const attrs = Object.entries(spec.attributes ?? {});
  const facts = [
    kv("Delivery", FULFILMENT[spec.fulfilment] ?? spec.fulfilment),
    spec.min_tier ? kv("Tier", `${cap(spec.min_tier)} and above`) : null,
    spec.limit_per_member
      ? kv(
          "Your limit",
          `${spec.limit_per_member} per member${detail.member_purchased_qty ? ` (you have bought ${detail.member_purchased_qty})` : ""}`,
        )
      : null,
    spec.cash_price_cents ? kv("Cash top-up", cents(spec.cash_price_cents)) : null,
    kv(
      "Category",
      h("a", { href: `/store/c/${encodeURIComponent(detail.category.slug)}` }, detail.category.title),
    ),
    ...attrs.map(([k, v]) => kv(cap(k.replaceAll("_", " ")), v)),
  ].filter(Boolean);

  return h(
    "div",
    { class: "w-store-summary" },
    h("div", { class: "w-store-summary__art" }, productArt(card, 192, `${card.title} artwork`)),
    h(
      "div",
      { class: "w-store-summary__info" },
      h(
        "div",
        { class: "w-store-summary__head" },
        h(
          page ? "h2" : "h3",
          { class: "w-store-summary__title", tabindex: "-1", "data-focus": "" },
          card.title,
        ),
        stockPill(card),
      ),
      h(
        "div",
        { class: "w-store-card__meta" },
        stars(card.rating),
        card.tags.length
          ? h("span", { class: "w-kit-pills" }, ...card.tags.slice(0, 4).map((t) => pill({ label: t })))
          : null,
      ),
      h(
        "div",
        { class: "w-store-summary__price" },
        priceNode(card),
        promoPill(card),
        card.stock_status === "low"
          ? h("span", { class: "u-muted w-kit-small" }, `Only ${card.on_hand} left`)
          : null,
      ),
      locked
        ? h("p", { class: "w-store-card__note is-locked" }, icon("lock", { size: 16 }), locked)
        : afford
          ? h("p", { class: "w-store-card__note" }, afford, " points to afford this")
          : null,
      canShop ? buy : h("p", { class: "u-muted w-kit-small" }, "Shopping is not enabled for your role."),
      h("p", { class: "w-store-summary__desc" }, spec.description || spec.summary),
      detail.promotions.length
        ? h(
            "ul",
            { class: "w-store-summary__promos", "aria-label": "Active promotions" },
            ...detail.promotions.map((p) =>
              h(
                "li",
                {},
                pill({ label: p.title, tone: "signal", icon: "percent" }),
                p.headline ? h("span", { class: "u-muted w-kit-small" }, p.headline) : null,
              ),
            ),
          )
        : null,
      dl(facts),
      page
        ? null
        : linkButton({
            href: productHref(card.slug),
            label: "Open product page",
            icon: "external",
            variant: "ghost",
            size: "sm",
          }),
    ),
  );
};

/** Histogram rows for [1..5] stars (index 0 is one star). */
export const histogram = (counts) => {
  const total = counts.reduce((a, b) => a + b, 0);
  return h(
    "ul",
    { class: "w-store-histogram", "aria-label": "Rating distribution" },
    ...[5, 4, 3, 2, 1].map((star) => {
      const n = counts[star - 1] ?? 0;
      const pct = total ? Math.round((n / total) * 100) : 0;
      return h(
        "li",
        {},
        h("span", { class: "u-tabular" }, `${star} star${star === 1 ? "" : "s"}`),
        h(
          "span",
          { class: "w-store-histogram__bar", "aria-hidden": "true" },
          h("span", { style: `--_w:${pct}%` }),
        ),
        h("span", { class: "u-tabular u-muted" }, number(n)),
      );
    }),
  );
};
