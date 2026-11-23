// store.featured: a row of featured (or category) products that scrolls with snap points and buttons.
import { schemaOf } from "../../core/widgets.js";
import { h, clear, frameOnce } from "../../ds/js/dom.js";
import { iconButton, linkButton } from "../../ds/js/button.js";
import { emptyState, skeleton } from "../../ds/js/states.js";
import { disposer, reportLoadError, markArrived, messageOf, serialQueue } from "../points/_kit.js";
import { productCard, replaceKeepFocus, cartSetQty, qtyIn, addToCart, productHref } from "./_shop.js";

export default {
  id: "store.featured",
  domain: "store",
  title: "Featured rewards",
  configSchema: schemaOf("store.featured"),
  sizes: ["m", "l", "xl", "full"],
  mount(el, { config, size, api, rt, bus, nav, ctx }) {
    const life = disposer();
    const root = h("div", { class: `w-store w-store-featured w-store-featured--${size}` });
    el.append(root);
    const canShop = ctx.can("store:shop");
    const limit = config.limit ?? 6;
    const queue = serialQueue();
    let items = [];
    const els = new Map();
    let seq = 0;
    let list = null;
    let prev = null;
    let next = null;

    const load = async ({ initial = false } = {}) => {
      const mine = ++seq;
      if (initial) {
        clear(root);
        root.append(skeleton({ shape: "card", lines: 2 }));
      }
      try {
        const res = await api.call("store.catalog", {
          sort: "featured",
          limit,
          ...(config.category ? { category: config.category } : {}),
        });
        if (life.done || mine !== seq) return;
        items = res.items;
        ctx.setState("ready");
        ctx.setCount(items.length);
        draw();
      } catch (e) {
        if (life.done || mine !== seq) return;
        reportLoadError({
          ctx,
          host: root,
          error: e,
          retry: () => load({ initial: true }),
          initial: initial || items.length === 0,
        });
      }
    };

    const ops = {
      href: (c) => productHref(c.slug),
      open: (card, viaLink) => {
        // The link navigates; the bus tells a product widget on the same page which product was chosen.
        bus.publish("product.selected", { id: card.slug });
        if (!viaLink) nav.go(productHref(card.slug));
      },
      addToCart: canShop
        ? async (card, btn) => {
            const cart = await addToCart({ api, ctx, nav, card, btn });
            if (cart) patch(card.slug, { in_cart_qty: qtyIn(cart, card.slug) });
          }
        : undefined,
      setQty: canShop
        ? (card, qty) => {
            const before = card.in_cart_qty;
            patch(card.slug, { in_cart_qty: qty });
            queue(async () => {
              try {
                const cart = await cartSetQty(api, card.slug, qty);
                patch(card.slug, { in_cart_qty: qtyIn(cart, card.slug) });
              } catch (e) {
                patch(card.slug, { in_cart_qty: before });
                ctx.toast({ title: "Could not change the cart", body: messageOf(e), tone: "danger" });
              }
            });
          }
        : undefined,
    };

    function patch(slug, fields, { arrive = false } = {}) {
      const i = items.findIndex((c) => c.slug === slug);
      if (i < 0) return;
      items[i] = { ...items[i], ...fields };
      const old = els.get(slug);
      if (!old) return;
      const fresh = productCard(items[i], ops);
      fresh.setAttribute("role", "listitem");
      replaceKeepFocus(old, fresh);
      els.set(slug, fresh);
      if (arrive) markArrived(life, fresh, fresh.querySelector(".w-store-card__art"));
    }

    const updateButtons = frameOnce(() => {
      if (!list || !prev) return;
      const max = list.scrollWidth - list.clientWidth - 2;
      const at = Math.abs(list.scrollLeft);
      prev.disabled = at <= 2;
      next.disabled = at >= max;
    });

    function scrollBy(dir) {
      const step = Math.max(160, Math.round(list.clientWidth * 0.8));
      const rtl = getComputedStyle(list).direction === "rtl" ? -1 : 1;
      list.scrollBy({
        left: dir * step * rtl,
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    }

    function draw() {
      clear(root);
      els.clear();
      if (items.length === 0) {
        root.append(
          emptyState({
            icon: "gift",
            title: "Nothing featured yet",
            body: "Featured rewards will show up here.",
            action: linkButton({ href: nav.href("/store"), label: "Browse the store", variant: "secondary" }),
          }),
        );
        return;
      }
      prev = iconButton({
        icon: "chevron-left",
        label: "Scroll to earlier products",
        variant: "secondary",
        size: "sm",
        onClick: () => scrollBy(-1),
      });
      next = iconButton({
        icon: "chevron-right",
        label: "Scroll to more products",
        variant: "secondary",
        size: "sm",
        onClick: () => scrollBy(1),
      });
      list = h("div", { class: "w-store-featured__list", role: "list", "aria-label": "Featured products" });
      for (const card of items) {
        const node = productCard(card, ops);
        node.setAttribute("role", "listitem");
        els.set(card.slug, node);
        list.append(node);
      }
      list.addEventListener("scroll", updateButtons, { passive: true });
      const ro = new ResizeObserver(updateButtons);
      ro.observe(list);
      life.add(() => ro.disconnect());
      root.append(
        h(
          "div",
          { class: "w-store-featured__bar" },
          h("span", { class: "u-muted w-kit-small u-tabular" }, `${items.length} products`),
          h(
            "div",
            { class: "w-kit-actions" },
            prev,
            next,
            linkButton({ href: nav.href("/store"), label: "See all", variant: "ghost", size: "sm" }),
          ),
        ),
        list,
      );
      updateButtons();
    }

    life.add(
      rt.on("stock.changed", (ev) => {
        const p = ev.payload;
        const cur = items.find((c) => c.slug === p.product);
        if (!cur) return;
        patch(
          p.product,
          {
            on_hand: p.on_hand,
            stock_status: p.stock_status,
            ...(p.stock_status === "out"
              ? { locked_reason: "out_of_stock" }
              : cur.locked_reason === "out_of_stock"
                ? { locked_reason: null }
                : {}),
          },
          { arrive: true },
        );
      }),
    );
    load({ initial: true });
    return life.dispose;
  },
};
