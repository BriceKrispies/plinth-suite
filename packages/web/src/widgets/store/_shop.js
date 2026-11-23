// Shared pieces of the store widgets: product artwork, stars, price, stock, quantity stepper, wishlist heart and
// the product card used by the catalogue, the featured row and related products.
import { h } from "../../ds/js/dom.js";
import { artwork } from "../../ds/js/artwork.js";
import { icon } from "../../ds/js/icons.js";
import { points, number } from "../../ds/js/format.js";
import { pill, statusPill } from "../../ds/js/pill.js";
import { button, iconButton } from "../../ds/js/button.js";
import { balanceStore } from "../../core/stores.js";
import { messageOf, setBusy } from "../points/_kit.js";

const cap = (t) => `${t[0].toUpperCase()}${t.slice(1)}`;

/** Generated product artwork; the glyph is the first two letters of the title (DESIGN-SYSTEM 7.5). */
export const productArt = (card, size = 96, label) => {
  const art = card.artwork ?? {};
  try {
    return artwork(
      {
        icon: art.icon,
        hue: art.hue,
        pattern: art.pattern,
        glyph: art.glyph ?? card.title.slice(0, 2).toUpperCase(),
      },
      { size, label },
    );
  } catch {
    return artwork({ icon: "gift", hue: art.hue ?? 0, pattern: "solid" }, { size, label });
  }
};

/** Five stars, filled up to the rounded average, with the numbers as text. */
export const stars = (rating, { count = true } = {}) => {
  if (!rating || !rating.count)
    return h("span", { class: "w-store-stars is-none u-muted" }, "No reviews yet");
  const full = Math.round(rating.average);
  return h(
    "span",
    { class: "w-store-stars" },
    h(
      "span",
      { class: "w-store-stars__row", "aria-hidden": "true" },
      ...[1, 2, 3, 4, 5].map((i) =>
        h("span", { class: i <= full ? "is-on" : "" }, icon("star", { size: 16 })),
      ),
    ),
    h("span", { class: "sr-only" }, `Rated ${rating.average.toFixed(1)} out of 5`),
    h("span", { class: "u-tabular w-store-stars__num" }, rating.average.toFixed(1)),
    count ? h("span", { class: "u-muted u-tabular" }, `(${number(rating.count)})`) : null,
  );
};

export const stockPill = (card) => {
  const el = statusPill("stock", card.stock_status);
  el.dataset.stock = card.stock_status;
  return el;
};

export const promoPill = (card) =>
  card.promo_percent ? pill({ label: `−${card.promo_percent}%`, tone: "signal", icon: "percent" }) : null;

/** The list price, and the estimated price after the best promotion (display only; checkout recomputes). */
export const priceNode = (card) => {
  const est = card.promo_percent ? Math.round((card.price_points * (100 - card.promo_percent)) / 100) : null;
  return h(
    "span",
    { class: "w-store-price u-tabular" },
    est !== null
      ? [
          h("strong", {}, points(est)),
          " ",
          h(
            "s",
            { class: "u-muted", "aria-label": `list price ${points(card.price_points)}` },
            points(card.price_points),
          ),
        ]
      : h("strong", {}, points(card.price_points)),
  );
};

const LOCKED = { out_of_stock: "Out of stock", limit: "Limit reached for you" };
/** Why a product cannot be bought right now, as text, or null. */
export const lockedText = (card) => {
  if (!card.locked_reason) return null;
  if (card.locked_reason === "tier") return `Needs ${card.min_tier ? cap(card.min_tier) : "a higher"} tier`;
  return LOCKED[card.locked_reason] ?? null;
};

/** "Need 120 more pts" when the viewer cannot afford it (tier and stock gates take precedence). */
export const affordText = (card) => {
  if (card.affordable || card.locked_reason) return null;
  const balance = balanceStore.get()?.balance;
  if (balance === null || balance === undefined) return null;
  const need = card.price_points - balance;
  return need > 0 ? `Need ${points(need)} more` : null;
};

/** The product's detail path (opens through the router). */
export const productHref = (slug) => `/store/p/${encodeURIComponent(slug)}`;

// ---- cart and wishlist calls shared by the widgets ----

export const cartSetQty = async (api, slug, qty) => api.call("cart.set_item", { slug, qty });

/** Quantity of `slug` in a CartOut. */
export const qtyIn = (cart, slug) => cart.lines.find((l) => l.product.slug === slug)?.qty ?? 0;

export const toggleWishlist = (api, slug, on) => api.call(on ? "wishlist.add" : "wishlist.remove", { slug });

/**
 * A quantity stepper: minus, a number input, plus. `onChange(n)` fires for committed values (button, blur, Enter).
 * Returns the element with `.set(n)` and `.setBusy(on)`.
 */
export const qtyStepper = ({ value, min = 0, max = 99, label, onChange }) => {
  let current = value;
  const input = h("input", {
    class: "w-store-qty__input u-tabular",
    type: "number",
    inputmode: "numeric",
    min,
    max,
    step: 1,
    value,
    "aria-label": label,
  });
  const commit = (n) => {
    const v = Math.min(max, Math.max(min, Number.isFinite(n) ? Math.round(n) : current));
    input.value = String(v);
    if (v !== current) {
      current = v;
      onChange(v);
    }
  };
  const minus = iconButton({
    icon: "minus",
    label: `Decrease ${label}`,
    size: "sm",
    variant: "secondary",
    onClick: () => commit(current - 1),
  });
  const plus = iconButton({
    icon: "plus",
    label: `Increase ${label}`,
    size: "sm",
    variant: "secondary",
    onClick: () => commit(current + 1),
  });
  input.addEventListener("change", () => commit(Number(input.value)));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(Number(input.value));
    }
  });
  const sync = () => {
    minus.disabled = current <= min;
    plus.disabled = current >= max;
  };
  sync();
  const el = h(
    "div",
    { class: "w-store-qty", role: "group", "aria-label": `Quantity of ${label}` },
    minus,
    input,
    plus,
  );
  el.set = (n) => {
    current = n;
    input.value = String(n);
    sync();
  };
  el.setLimits = (lo, hi) => {
    min = lo;
    max = hi;
    input.min = String(lo);
    input.max = String(hi);
    sync();
  };
  el.focusInput = () => input.focus();
  el.commit = commit;
  return el;
};

/** A heart toggle for the wishlist. */
export const heartButton = ({ active, title, onToggle }) => {
  const b = button({
    label: `Wishlist: ${title}`,
    icon: "heart",
    iconOnly: true,
    variant: "ghost",
    size: "sm",
    pressed: active,
    onClick: () => onToggle(!active),
  });
  b.classList.add("w-store-heart");
  if (active) b.classList.add("is-on");
  return b;
};

/**
 * The card for one product. `ops`: `{ open(card), href, addToCart(card, button), setQty(card, qty), toggleWish(card, on) }`.
 * Every interactive control carries `data-act` so the owner can restore focus after replacing the card.
 */
export const productCard = (card, ops, { compact = false } = {}) => {
  const locked = lockedText(card);
  const afford = affordText(card);
  const canBuy = !card.locked_reason && card.stock_status !== "out";
  const title = ops.href
    ? h(
        "a",
        {
          class: "w-store-card__title",
          href: ops.href(card),
          "data-act": "open",
          onclick: () => ops.open?.(card, true),
        },
        card.title,
      )
    : h(
        "button",
        {
          type: "button",
          class: "w-store-card__title w-kit-link",
          "data-act": "open",
          onclick: () => ops.open?.(card),
        },
        card.title,
      );
  const actions = h("div", { class: "w-store-card__actions" });
  if (ops.toggleWish) {
    const heart = heartButton({
      active: card.in_wishlist,
      title: card.title,
      onToggle: (on) => ops.toggleWish(card, on),
    });
    heart.setAttribute("data-act", "wish");
    actions.append(heart);
  }
  if (ops.addToCart && ops.setQty) {
    if (card.in_cart_qty > 0 && canBuy) {
      const stepper = qtyStepper({
        value: card.in_cart_qty,
        min: 0,
        max: Math.max(card.in_cart_qty, Math.min(card.on_hand, 99)),
        label: card.title,
        onChange: (n) => ops.setQty(card, n),
      });
      stepper.setAttribute("data-act", "qty");
      actions.append(stepper);
    } else {
      const add = button({
        label: card.stock_status === "out" ? "Unavailable" : "Add to cart",
        icon: "cart",
        variant: canBuy ? "primary" : "secondary",
        size: "sm",
        disabled: !canBuy,
        onClick: () => ops.addToCart(card, add),
      });
      add.setAttribute("data-act", "add");
      actions.append(add);
    }
  }
  const article = h(
    "article",
    {
      class: `w-store-card${compact ? " is-compact" : ""}`,
      "data-slug": card.slug,
      "aria-label": card.title,
    },
    h(
      "div",
      { class: "w-store-card__art" },
      productArt(card, compact ? 64 : 96),
      card.featured && !compact ? pill({ label: "Featured", tone: "info", icon: "star" }) : null,
    ),
    h(
      "div",
      { class: "w-store-card__body" },
      title,
      h("p", { class: "w-store-card__summary u-muted" }, card.summary),
      h("div", { class: "w-store-card__meta" }, priceNode(card), promoPill(card)),
      h(
        "div",
        { class: "w-store-card__meta" },
        stockPill(card),
        card.stock_status === "low"
          ? h("span", { class: "u-muted w-kit-small u-tabular" }, `${card.on_hand} left`)
          : null,
        stars(card.rating),
      ),
      locked
        ? h("p", { class: "w-store-card__note is-locked" }, icon("lock", { size: 16 }), locked)
        : afford
          ? h("p", { class: "w-store-card__note" }, afford)
          : null,
    ),
    actions,
  );
  return article;
};

/** Replace `oldEl` with `newEl`, keeping keyboard focus on the same control (matched by `data-act`). */
export const replaceKeepFocus = (oldEl, newEl) => {
  const active = document.activeElement;
  const act = oldEl.contains(active) ? active.closest("[data-act]")?.getAttribute("data-act") : null;
  oldEl.replaceWith(newEl);
  if (!act) return;
  const target =
    newEl.querySelector(`[data-act="${act}"] input`) ?? newEl.querySelector(`[data-act="${act}"]`);
  target?.focus?.();
};

/** Standard add-to-cart: optimistic count, toast with a link to the cart, errors as toasts. */
export const addToCart = async ({ api, ctx, nav, card, btn, onDone }) => {
  setBusy(btn, true);
  try {
    const cart = await cartSetQty(api, card.slug, card.in_cart_qty + 1);
    ctx.toast({
      title: "Added to cart",
      body: card.title,
      tone: "success",
      action: { label: "View cart", href: nav.href("/store/cart") },
      timeout: 4000,
    });
    ctx.announce(`${card.title} added to cart`);
    onDone?.(cart);
    return cart;
  } catch (e) {
    ctx.toast({ title: "Could not add to cart", body: messageOf(e), tone: "danger" });
    return null;
  } finally {
    setBusy(btn, false);
  }
};
