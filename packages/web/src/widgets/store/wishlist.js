// store.wishlist: saved products with stock and affordability; move to cart or remove.
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { points, number, relativeTime } from "../../ds/js/format.js";
import { button, iconButton, linkButton } from "../../ds/js/button.js";
import { selectField } from "../../ds/js/field.js";
import { emptyState, skeleton } from "../../ds/js/states.js";
import {
  disposer,
  reportLoadError,
  markArrived,
  messageOf,
  serialQueue,
  setBusy,
  nowIso,
} from "../points/_kit.js";
import {
  productArt,
  stockPill,
  priceNode,
  promoPill,
  lockedText,
  affordText,
  productHref,
  cartSetQty,
} from "./_shop.js";

const SORTS = [
  { value: "recent", label: "Recently added" },
  { value: "price_asc", label: "Price, low to high" },
  { value: "price_desc", label: "Price, high to low" },
  { value: "afford", label: "Affordable first" },
];

const canBuy = (c) => !c.locked_reason && c.stock_status !== "out";

export default {
  id: "store.wishlist",
  domain: "store",
  title: "Wishlist",
  configSchema: schemaOf("store.wishlist"),
  sizes: ["m", "l", "xl"],
  mount(el, { size, api, rt, bus, nav, ctx }) {
    const life = disposer();
    const root = h("div", { class: `w-store w-store-wishlist w-store-wishlist--${size}` });
    el.append(root);
    if (!ctx.can("store:shop")) {
      root.append(emptyState({ icon: "lock", title: "The wishlist is not available for your role" }));
      return () => {};
    }
    const queue = serialQueue();
    const state = { items: [], loaded: false, sort: "recent", filter: "all" };
    let seq = 0;
    let arrived = new Set();
    let mutedUntil = 0;
    const listHost = h("ul", { class: "w-store-wishlist__list", "aria-label": "Saved products" });
    const barHost = h("div", { class: "w-store-wishlist__bar" });

    const load = async ({ initial = false, silent = false } = {}) => {
      const mine = ++seq;
      if (!silent && !state.loaded) {
        clear(root);
        root.append(skeleton({ lines: 4 }));
      }
      try {
        const res = await api.call("wishlist.list", {});
        if (life.done || mine !== seq) return;
        const known = new Set(state.items.map((i) => i.product.slug));
        arrived = silent
          ? new Set(res.items.filter((i) => !known.has(i.product.slug)).map((i) => i.product.slug))
          : new Set();
        state.items = res.items;
        state.loaded = true;
        ctx.setState("ready");
        ctx.setCount(res.items.length);
        draw();
      } catch (e) {
        if (life.done || mine !== seq) return;
        reportLoadError({
          ctx,
          host: root,
          error: e,
          retry: () => load({ initial: true }),
          initial: initial || !state.loaded,
        });
      }
    };

    const visible = () => {
      let rows = [...state.items];
      if (state.filter === "stock") rows = rows.filter((i) => i.product.stock_status !== "out");
      if (state.filter === "afford") rows = rows.filter((i) => i.product.affordable && canBuy(i.product));
      const byPrice = (a, b) => a.product.price_points - b.product.price_points;
      if (state.sort === "recent") rows.sort((a, b) => b.added_at.localeCompare(a.added_at));
      else if (state.sort === "price_asc") rows.sort(byPrice);
      else if (state.sort === "price_desc") rows.sort((a, b) => byPrice(b, a));
      else
        rows.sort(
          (a, b) =>
            Number(b.product.affordable && canBuy(b.product)) -
              Number(a.product.affordable && canBuy(a.product)) || byPrice(a, b),
        );
      return rows;
    };

    // ---- actions ----
    const remove = (item) => {
      const slug = item.product.slug;
      const before = state.items;
      state.items = state.items.filter((i) => i.product.slug !== slug);
      ctx.setCount(state.items.length);
      draw();
      queue(async () => {
        try {
          await api.call("wishlist.remove", { slug });
          mutedUntil = Date.now() + 1500;
          ctx.announce(`${item.product.title} removed from wishlist`);
        } catch (e) {
          state.items = before;
          ctx.setCount(before.length);
          draw();
          ctx.toast({ title: "Could not remove", body: messageOf(e), tone: "danger" });
        }
      });
    };

    const moveToCart = (item, btn) => {
      const p = item.product;
      const before = state.items;
      const prevQty = p.in_cart_qty;
      setBusy(btn, true);
      queue(async () => {
        try {
          await cartSetQty(api, p.slug, Math.max(1, prevQty));
          await api.call("wishlist.remove", { slug: p.slug });
          mutedUntil = Date.now() + 1500;
          state.items = state.items.filter((i) => i.product.slug !== p.slug);
          ctx.setCount(state.items.length);
          draw();
          ctx.announce(`${p.title} moved to cart`);
          ctx.toast({
            title: "Moved to cart",
            body: p.title,
            tone: "success",
            action: { label: "View cart", href: nav.href("/store/cart") },
          });
        } catch (e) {
          state.items = before;
          draw();
          ctx.toast({ title: "Could not move to cart", body: messageOf(e), tone: "danger" });
        } finally {
          setBusy(btn, false);
        }
      });
    };

    const moveAll = async () => {
      const movable = visible().filter((i) => canBuy(i.product));
      if (!movable.length) return;
      const total = movable.reduce((a, i) => a + i.product.price_points, 0);
      const ok = await ctx.confirm({
        title: `Move ${movable.length} ${movable.length === 1 ? "item" : "items"} to your cart?`,
        message: `They come to ${points(total)} at list price. They stay out of the wishlist once moved.`,
        confirmLabel: "Move to cart",
      });
      if (!ok) return;
      let moved = 0;
      let failed = 0;
      await queue(async () => {
        for (const i of movable) {
          try {
            await cartSetQty(api, i.product.slug, Math.max(1, i.product.in_cart_qty));
            await api.call("wishlist.remove", { slug: i.product.slug });
            moved += 1;
          } catch {
            failed += 1;
          }
        }
      });
      mutedUntil = Date.now() + 1500;
      ctx.toast({
        title: `${moved} moved to cart`,
        body: failed ? `${failed} could not be moved` : undefined,
        tone: failed ? "warning" : "success",
        action: { label: "View cart", href: nav.href("/store/cart") },
      });
      ctx.announce(`${moved} items moved to cart`);
      await load({ silent: true });
    };

    // ---- drawing ----
    const row = (item) => {
      const p = item.product;
      const locked = lockedText(p);
      const afford = affordText(p);
      const move = button({
        label: "Move to cart",
        icon: "cart",
        variant: canBuy(p) ? "primary" : "secondary",
        size: "sm",
        disabled: !canBuy(p),
        onClick: () => moveToCart(item, move),
      });
      move.setAttribute("data-act", "move");
      const li = h(
        "li",
        { class: "w-store-wishlist__row", "data-slug": p.slug },
        h("div", { class: "w-store-cart__art" }, productArt(p, size === "m" ? 40 : 56)),
        h(
          "div",
          { class: "w-store-cart__info" },
          h(
            "a",
            {
              class: "w-store-cart__title",
              href: productHref(p.slug),
              onclick: () => bus.publish("product.selected", { id: p.slug }),
            },
            p.title,
          ),
          h("div", { class: "w-store-card__meta" }, priceNode(p), promoPill(p), stockPill(p)),
          locked
            ? h("span", { class: "w-store-card__note is-locked" }, locked)
            : afford
              ? h("span", { class: "w-store-card__note" }, afford)
              : null,
          h(
            "span",
            { class: "u-muted w-kit-small" },
            `Saved ${relativeTime(item.added_at, nowIso())}`,
            h("span", { class: "w-kit-new-slot" }),
          ),
        ),
        h(
          "div",
          { class: "w-store-wishlist__actions" },
          move,
          iconButton({
            icon: "trash",
            label: `Remove ${p.title} from wishlist`,
            variant: "ghost",
            size: "sm",
            onClick: () => remove(item),
          }),
        ),
      );
      if (arrived.has(p.slug)) markArrived(life, li, li.querySelector(".w-kit-new-slot"));
      return li;
    };

    function draw() {
      const active = root.contains(document.activeElement)
        ? document.activeElement.closest("li[data-slug]")?.getAttribute("data-slug")
        : null;
      clear(root);
      if (state.items.length === 0) {
        root.append(
          emptyState({
            icon: "heart",
            title: "Your wishlist is empty",
            body: "Tap the heart on a product to save it for later.",
            action: linkButton({ href: nav.href("/store"), label: "Browse the store", variant: "primary" }),
          }),
        );
        return;
      }
      const rows = visible();
      const movable = rows.filter((i) => canBuy(i.product)).length;
      clear(barHost);
      barHost.append(
        selectField({
          name: "sort",
          label: "Sort by",
          value: state.sort,
          options: SORTS,
          onChange: (v) => ((state.sort = v), draw()),
        }),
        h(
          "div",
          { class: "w-store-catalog__chiprow", role: "group", "aria-label": "Filter wishlist" },
          ...[
            ["all", "All"],
            ["stock", "In stock"],
            ["afford", "I can afford"],
          ].map(([v, label]) =>
            button({
              label,
              variant: "secondary",
              size: "sm",
              pressed: state.filter === v,
              onClick: () => ((state.filter = v), draw()),
            }),
          ),
        ),
        ...[
          size === "m"
            ? null
            : button({
                label: `Move all available (${movable})`,
                icon: "cart",
                variant: "secondary",
                size: "sm",
                disabled: movable === 0,
                onClick: moveAll,
              }),
        ].filter(Boolean),
      );
      clear(listHost);
      if (rows.length === 0)
        listHost.append(
          h(
            "li",
            {},
            emptyState({
              icon: "filter",
              title: "Nothing matches this filter",
              body: `${number(state.items.length)} saved in total.`,
            }),
          ),
        );
      else listHost.append(...rows.map(row));
      root.append(barHost, listHost);
      if (arrived.size) ctx.announce(`${arrived.size} added to your wishlist`);
      arrived = new Set();
      if (active) listHost.querySelector(`li[data-slug="${active}"] [data-act=move]`)?.focus();
    }

    // ---- realtime ----
    life.add(
      rt.on("wishlist.changed", (ev) => {
        const p = ev.payload;
        const present = state.items.some((i) => i.product.slug === p.product);
        if (!p.in_wishlist && present) {
          state.items = state.items.filter((i) => i.product.slug !== p.product);
          ctx.setCount(state.items.length);
          draw();
        } else if (p.in_wishlist && !present && Date.now() > mutedUntil) load({ silent: true });
      }),
    );
    life.add(
      rt.on("stock.changed", (ev) => {
        const p = ev.payload;
        const item = state.items.find((i) => i.product.slug === p.product);
        if (!item) return;
        const out = p.stock_status === "out";
        item.product = {
          ...item.product,
          on_hand: p.on_hand,
          stock_status: p.stock_status,
          ...(out
            ? { locked_reason: "out_of_stock" }
            : item.product.locked_reason === "out_of_stock"
              ? { locked_reason: null }
              : {}),
        };
        draw();
        const li = listHost.querySelector(`li[data-slug="${p.product}"]`);
        if (li) markArrived(life, li, li.querySelector(".w-kit-new-slot"));
      }),
    );
    load({ initial: true });
    return life.dispose;
  },
};
