// store.catalog: browse, filter, sort and search; add to cart and wishlist in place; a product opens inside the
// widget, on the page bus (product.selected) or on its own page, as configured.
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { points, number } from "../../ds/js/format.js";
import { button } from "../../ds/js/button.js";
import { searchField, selectField, radioGroup, numberField, switchField } from "../../ds/js/field.js";
import { openSheet } from "../../ds/js/sheet.js";
import { emptyState, skeleton } from "../../ds/js/states.js";
import { icon } from "../../ds/js/icons.js";
import {
  disposer,
  reportLoadError,
  inlineError,
  markArrived,
  messageOf,
  serialQueue,
  batchAnnouncer,
} from "../points/_kit.js";
import {
  productCard,
  replaceKeepFocus,
  cartSetQty,
  qtyIn,
  toggleWishlist,
  addToCart,
  productHref,
} from "./_shop.js";
import { productSummary } from "./_detail.js";

const SORTS = [
  { value: "featured", label: "Featured" },
  { value: "price_asc", label: "Price, low to high" },
  { value: "price_desc", label: "Price, high to low" },
  { value: "rating", label: "Top rated" },
  { value: "newest", label: "Newest" },
];
const FILTER_KEYS = new Set([
  "q",
  "category",
  "tag",
  "sort",
  "in_stock",
  "affordable",
  "min_points",
  "max_points",
]);

export default {
  id: "store.catalog",
  domain: "store",
  title: "Catalogue",
  configSchema: schemaOf("store.catalog"),
  sizes: ["l", "xl", "full"],
  mount(el, { config, size, api, rt, bus, nav, ctx }) {
    const life = disposer();
    const root = h("div", { class: `w-store w-store-catalog w-store-catalog--${size}` });
    el.append(root);

    const canShop = ctx.can("store:shop");
    const openIn = config.open_in ?? "widget";
    const pageSize = config.page_size ?? 24;
    const showFilters = config.show_filters !== false;
    const f = {
      q: "",
      category: typeof config.category === "string" ? config.category : "",
      tag: config.tag ?? "",
      sort: config.sort ?? "featured",
      in_stock: false,
      affordable: Boolean(config.affordable_only),
      min_points: null,
      max_points: null,
    };
    const state = {
      items: [],
      total: 0,
      facets: null,
      next: null,
      cats: [],
      loaded: false,
      loadingMore: false,
      view: "grid",
      detail: null,
      detailSlug: null,
    };
    const queue = serialQueue();
    let seq = 0;
    let mutedUntil = 0;
    const cardEls = new Map();
    const arriveCount = batchAnnouncer(life, (n) => `${n} ${n === 1 ? "product" : "products"} updated`);

    const gridView = h("div", { class: "w-store-catalog__main" });
    const productView = h("div", { class: "w-store-catalog__product", hidden: true });
    root.append(gridView, productView);

    // ---- structure of the grid view ----
    const chipsHost = h("div", { class: "w-store-catalog__cats" });
    const activeHost = h("div", { class: "w-store-catalog__active" });
    const statusEl = h("p", { class: "w-store-catalog__status u-muted", role: "status" });
    const gridHost = h("div", { class: "w-store-catalog__grid", "aria-label": "Products" });
    const moreHost = h("div", { class: "w-store-catalog__more" });
    const railHost = h("aside", { class: "w-store-catalog__rail", "aria-label": "Filters" });
    const results = h("div", { class: "w-store-catalog__results" }, statusEl, activeHost, gridHost, moreHost);

    const filtersBtn = showFilters
      ? button({ label: "Filters", icon: "filter", variant: "secondary", onClick: openFiltersSheet })
      : null;
    if (filtersBtn) filtersBtn.classList.add("w-store-catalog__filtersbtn");

    const debouncedSearch = life.debounce(() => {
      load();
    }, 250);
    const toolbar = h(
      "div",
      {
        class: "w-kit-toolbar w-store-catalog__toolbar",
        role: "group",
        "aria-label": "Catalogue search and sort",
      },
      searchField({
        name: "q",
        label: "Search products",
        placeholder: "Search the store",
        value: f.q,
        onInput: (v) => {
          f.q = v.trim();
          debouncedSearch();
        },
      }),
      selectField({
        name: "sort",
        label: "Sort by",
        value: f.sort,
        options: SORTS,
        onChange: (v) => {
          f.sort = v;
          load();
        },
      }),
      filtersBtn ? h("div", { class: "w-kit-toolbar__buttons" }, filtersBtn) : null,
    );
    gridView.append(
      toolbar,
      chipsHost,
      h("div", { class: "w-store-catalog__body" }, showFilters ? railHost : null, results),
    );

    // ---- loading ----
    const inputFor = ({ limit, cursor }) => ({
      limit,
      ...(f.category ? { category: f.category } : {}),
      ...(f.q ? { q: f.q } : {}),
      ...(f.tag ? { tag: f.tag } : {}),
      ...(f.min_points !== null ? { min_points: f.min_points } : {}),
      ...(f.max_points !== null ? { max_points: f.max_points } : {}),
      ...(f.in_stock ? { in_stock: true } : {}),
      ...(f.affordable ? { affordable: true } : {}),
      sort: f.sort,
      ...(cursor ? { cursor } : {}),
    });

    const loadCategories = async () => {
      try {
        const res = await api.call("store.categories", {});
        if (life.done) return;
        state.cats = res.items;
        drawChips();
      } catch {
        /* the grid still works without category chips */
      }
    };

    const load = async ({ initial = false, silent = false, more = false } = {}) => {
      const mine = ++seq;
      if (more) {
        state.loadingMore = true;
        drawMore();
      } else if (!silent) {
        gridHost.setAttribute("aria-busy", "true");
        if (!state.loaded) {
          clear(gridHost);
          gridHost.append(
            h(
              "div",
              { class: "w-store-catalog__skeletons" },
              ...Array.from({ length: 6 }, () => skeleton({ shape: "card", lines: 2 })),
            ),
          );
        }
      }
      try {
        const limit = silent ? Math.min(100, Math.max(pageSize, state.items.length)) : pageSize;
        const res = await api.call(
          "store.catalog",
          inputFor({ limit, cursor: more ? state.next : undefined }),
        );
        if (life.done || mine !== seq) return;
        state.items = more ? [...state.items, ...res.items] : res.items;
        state.total = res.total;
        state.next = res.next_cursor;
        state.facets = res.facets;
        state.loaded = true;
        state.loadingMore = false;
        ctx.setState("ready");
        ctx.setCount(res.total);
        drawResults({ appended: more ? res.items.length : 0 });
      } catch (e) {
        if (life.done || mine !== seq) return;
        state.loadingMore = false;
        if (more) {
          ctx.toast({ title: "Could not load more", body: messageOf(e), tone: "danger" });
          drawMore();
        } else
          reportLoadError({
            ctx,
            host: gridHost,
            error: e,
            retry: () => load({ initial: true }),
            initial: initial || !state.loaded,
          });
      } finally {
        if (mine === seq) gridHost.removeAttribute("aria-busy");
      }
    };

    // ---- drawing ----
    const ops = {
      href: openIn === "page" ? (c) => productHref(c.slug) : undefined,
      open: (card, viaLink) => {
        if (viaLink) return;
        openProduct(card);
      },
      addToCart: canShop
        ? async (card, btn) => {
            const cart = await addToCart({ api, ctx, nav, card, btn });
            if (cart) {
              mutedUntil = Date.now() + 1500;
              patch(card.slug, { in_cart_qty: qtyIn(cart, card.slug) }, { quiet: true });
            }
          }
        : undefined,
      setQty: canShop
        ? (card, qty) => {
            const prev = card.in_cart_qty;
            patch(card.slug, { in_cart_qty: qty }, { quiet: true });
            queue(async () => {
              try {
                const cart = await cartSetQty(api, card.slug, qty);
                mutedUntil = Date.now() + 1500;
                patch(card.slug, { in_cart_qty: qtyIn(cart, card.slug) }, { quiet: true });
                ctx.announce(qty === 0 ? `${card.title} removed from cart` : `${card.title}: ${qty} in cart`);
              } catch (e) {
                patch(card.slug, { in_cart_qty: prev }, { quiet: true });
                ctx.toast({ title: "Could not change the cart", body: messageOf(e), tone: "danger" });
              }
            });
          }
        : undefined,
      toggleWish: canShop
        ? (card, on) => {
            patch(card.slug, { in_wishlist: on }, { quiet: true });
            queue(async () => {
              try {
                await toggleWishlist(api, card.slug, on);
                mutedUntil = Date.now() + 1500;
                ctx.announce(on ? `${card.title} saved to wishlist` : `${card.title} removed from wishlist`);
              } catch (e) {
                patch(card.slug, { in_wishlist: !on }, { quiet: true });
                ctx.toast({ title: "Wishlist not changed", body: messageOf(e), tone: "danger" });
              }
            });
          }
        : undefined,
    };

    const makeCard = (card) => productCard(card, { ...ops, href: ops.href });

    /** Merge `fields` into the product everywhere it is shown; `arrive` marks it as changed by an event. */
    function patch(slug, fields, { quiet = false, arrive = false } = {}) {
      const i = state.items.findIndex((c) => c.slug === slug);
      if (i >= 0) {
        state.items[i] = { ...state.items[i], ...fields };
        const old = cardEls.get(slug);
        if (old) {
          const fresh = makeCard(state.items[i]);
          replaceKeepFocus(old, fresh);
          cardEls.set(slug, fresh);
          if (arrive && !quiet) markArrived(life, fresh, fresh.querySelector(".w-store-card__art"));
        }
      }
      if (state.detail && state.detail.card.slug === slug) {
        state.detail = { ...state.detail, card: { ...state.detail.card, ...fields } };
        drawProduct({ keepFocus: true });
      }
    }

    function drawChips() {
      clear(chipsHost);
      const mk = (slug, label, count) =>
        button({
          label: count === undefined ? label : `${label} (${count})`,
          variant: "secondary",
          size: "sm",
          pressed: f.category === slug,
          onClick: () => {
            f.category = slug;
            load();
            drawChips();
          },
        });
      chipsHost.append(
        h(
          "div",
          { class: "w-store-catalog__chiprow", role: "group", "aria-label": "Categories" },
          mk("", "All"),
          ...state.cats.map((c) => mk(c.slug, c.title, c.product_count)),
        ),
      );
    }

    const activeFilters = () => {
      const out = [];
      if (f.q)
        out.push([
          "q",
          `Search: ${f.q}`,
          () => ((f.q = ""), (toolbar.querySelector('input[type="search"]').value = "")),
        ]);
      if (f.tag) out.push(["tag", `Tag: ${f.tag}`, () => (f.tag = "")]);
      if (f.min_points !== null)
        out.push(["min", `From ${points(f.min_points)}`, () => (f.min_points = null)]);
      if (f.max_points !== null)
        out.push(["max", `Up to ${points(f.max_points)}`, () => (f.max_points = null)]);
      if (f.in_stock) out.push(["stock", "In stock", () => (f.in_stock = false)]);
      if (f.affordable) out.push(["afford", "I can afford", () => (f.affordable = false)]);
      return out;
    };

    const clearAll = () => {
      f.q = "";
      f.tag = "";
      f.min_points = null;
      f.max_points = null;
      f.in_stock = false;
      f.affordable = false;
      f.category = "";
      const s = toolbar.querySelector('input[type="search"]');
      if (s) s.value = "";
      drawChips();
      load();
    };

    function drawActive() {
      clear(activeHost);
      const list = activeFilters();
      if (!list.length) return;
      activeHost.append(
        ...list.map(([id, label, clearFn]) =>
          h(
            "span",
            { class: "c-chip", "data-filter": id },
            h("span", {}, label),
            h(
              "button",
              {
                type: "button",
                class: "c-chip__remove",
                "aria-label": `Remove filter ${label}`,
                onclick: () => {
                  clearFn();
                  load();
                  drawRail(true);
                },
              },
              icon("x", { size: 16 }),
            ),
          ),
        ),
        button({ label: "Clear all", variant: "ghost", size: "sm", onClick: clearAll }),
      );
    }

    function drawResults({ appended = 0 } = {}) {
      statusEl.textContent = `${number(state.total)} ${state.total === 1 ? "product" : "products"}`;
      drawActive();
      drawRail();
      if (!appended) {
        clear(gridHost);
        cardEls.clear();
        if (state.items.length === 0) {
          const filtered = activeFilters().length > 0 || f.category;
          gridHost.append(
            emptyState({
              icon: "store",
              title: filtered ? "No products match" : "The store is empty",
              body: filtered
                ? "Try removing a filter or searching for something else."
                : "Products will appear here once they are added.",
              action: filtered
                ? button({ label: "Clear filters", variant: "secondary", onClick: clearAll })
                : null,
            }),
          );
          drawMore();
          return;
        }
      }
      const frag = document.createDocumentFragment();
      const start = appended ? state.items.length - appended : 0;
      for (const card of state.items.slice(start)) {
        const node = makeCard(card);
        cardEls.set(card.slug, node);
        frag.append(node);
      }
      gridHost.append(frag);
      if (appended)
        ctx.announce(`${appended} more products loaded, ${state.items.length} of ${state.total} shown`);
      drawMore();
    }

    function drawMore() {
      clear(moreHost);
      if (state.items.length === 0) return;
      moreHost.append(
        h(
          "p",
          { class: "u-muted w-kit-small u-tabular" },
          `Showing ${state.items.length} of ${number(state.total)}`,
        ),
      );
      if (state.next)
        moreHost.append(
          button({
            label: state.loadingMore ? "Loading" : "Load more",
            variant: "secondary",
            busy: state.loadingMore,
            onClick: () => load({ more: true }),
          }),
        );
    }

    // ---- filters (rail on wide frames, sheet on narrow ones) ----
    function filtersForm() {
      const form = h("form", {
        class: "w-kit-form w-store-filters",
        "data-widget-domain": "store",
        novalidate: true,
        onsubmit: (e) => e.preventDefault(),
      });
      const facets = state.facets;
      if (!facets) return form;
      const apply = () => {
        load();
        drawActive();
      };
      form.append(
        radioGroup({
          name: "tag",
          label: "Tag",
          value: f.tag,
          options: [
            { value: "", label: "Any tag" },
            ...facets.tags.slice(0, 10).map((t) => ({ value: t.tag, label: `${t.tag} (${t.count})` })),
          ],
          onChange: (v) => {
            f.tag = v ?? "";
            apply();
          },
        }),
        h(
          "div",
          { class: "c-form__row" },
          numberField({
            name: "min_points",
            label: "Min points",
            min: 0,
            step: 1,
            value: f.min_points ?? undefined,
            placeholder: String(facets.price.min),
            onChange: (v) => {
              f.min_points = v;
              apply();
            },
          }),
          numberField({
            name: "max_points",
            label: "Max points",
            min: 0,
            step: 1,
            value: f.max_points ?? undefined,
            placeholder: String(facets.price.max),
            onChange: (v) => {
              f.max_points = v;
              apply();
            },
          }),
        ),
        switchField({
          name: "in_stock",
          label: "In stock only",
          value: f.in_stock,
          onChange: (v) => {
            f.in_stock = v;
            apply();
          },
        }),
        ...[
          canShop
            ? switchField({
                name: "affordable",
                label: "I can afford",
                value: f.affordable,
                onChange: (v) => {
                  f.affordable = v;
                  apply();
                },
              })
            : null,
        ].filter(Boolean),
        button({ label: "Clear filters", variant: "ghost", size: "sm", onClick: clearAll }),
      );
      return form;
    }

    function drawRail(force = false) {
      if (!showFilters) return;
      if (!force && railHost.contains(document.activeElement)) return;
      clear(railHost);
      railHost.append(h("p", { class: "u-caps" }, "Filters"), filtersForm());
    }

    function openFiltersSheet() {
      const body = filtersForm();
      const done = button({ label: "Show results", variant: "primary", onClick: () => sheet.close() });
      const sheet = openSheet({ title: "Filters", body, footer: done });
      life.add(() => sheet.close());
    }

    // ---- product view ----
    async function openProduct(card) {
      if (openIn === "page") return nav.go(productHref(card.slug));
      if (openIn === "bus") return bus.publish("product.selected", { id: card.slug });
      state.view = "product";
      state.detailSlug = card.slug;
      state.detail = null;
      gridView.hidden = true;
      productView.hidden = false;
      clear(productView);
      productView.append(backBar(), skeleton({ shape: "card", lines: 3 }));
      await readDetail(card.slug, true);
    }

    const backBar = () =>
      h(
        "div",
        { class: "w-kit-head" },
        button({
          label: "Back to results",
          icon: "chevron-left",
          variant: "ghost",
          size: "sm",
          onClick: () => {
            state.view = "grid";
            state.detail = null;
            productView.hidden = true;
            gridView.hidden = false;
            cardEls.get(state.detailSlug)?.querySelector("[data-act=open]")?.focus();
          },
        }),
      );

    async function readDetail(slug, focus) {
      try {
        const d = await api.call("store.product", { slug });
        if (life.done || state.detailSlug !== slug) return;
        state.detail = d;
        drawProduct({ focus });
      } catch (e) {
        if (life.done) return;
        clear(productView);
        inlineError(productView, e, () => readDetail(slug, true));
        productView.prepend(backBar());
      }
    }

    function drawProduct({ focus = false, keepFocus = false } = {}) {
      if (!state.detail || state.view !== "product") return;
      const active = keepFocus
        ? document.activeElement?.closest?.("[data-act]")?.getAttribute("data-act")
        : null;
      const d = state.detail;
      clear(productView);
      productView.append(
        backBar(),
        productSummary({
          detail: d,
          canShop,
          ops: {
            addToCart: async (btn) => {
              const cart = await addToCart({ api, ctx, nav, card: d.card, btn });
              if (cart) {
                mutedUntil = Date.now() + 1500;
                patch(d.card.slug, { in_cart_qty: qtyIn(cart, d.card.slug) }, { quiet: true });
              }
            },
            setQty: (qty) => ops.setQty?.(d.card, qty),
            toggleWish: (on) => ops.toggleWish?.(d.card, on),
          },
        }),
      );
      if (d.related.length) {
        const rel = h(
          "div",
          { class: "w-store-catalog__related" },
          h("h3", { class: "w-kit-head__title" }, "Related products"),
        );
        const row = h("div", { class: "w-store-catalog__relatedrow" });
        for (const r of d.related.slice(0, 4))
          row.append(
            productCard(
              r,
              {
                href: undefined,
                open: (c) => openProduct(c),
                toggleWish: undefined,
              },
              { compact: true },
            ),
          );
        rel.append(row);
        productView.append(rel);
      }
      if (focus) productView.querySelector("[data-focus]")?.focus();
      else if (active) productView.querySelector(`[data-act="${active}"]`)?.focus?.();
    }

    // ---- realtime and bus ----
    const reloadSilently = life.debounce(() => {
      if (state.view === "grid") load({ silent: true });
      else if (state.detailSlug) readDetail(state.detailSlug, false);
    }, 500);
    life.add(
      rt.on("stock.changed", (ev) => {
        const p = ev.payload;
        const lockedOut = p.stock_status === "out";
        const cur = state.items.find((c) => c.slug === p.product);
        const fields = {
          on_hand: p.on_hand,
          stock_status: p.stock_status,
          ...(lockedOut
            ? { locked_reason: "out_of_stock" }
            : cur?.locked_reason === "out_of_stock"
              ? { locked_reason: null }
              : {}),
        };
        patch(p.product, fields, { arrive: true });
        if (cur || state.detail?.card.slug === p.product) arriveCount();
      }),
    );
    life.add(
      rt.on("wishlist.changed", (ev) =>
        patch(ev.payload.product, { in_wishlist: ev.payload.in_wishlist }, { quiet: true }),
      ),
    );
    life.add(
      rt.on("review.created", (ev) => {
        const p = ev.payload;
        patch(p.product, { rating: { average: p.average, count: p.count } }, { arrive: true });
      }),
    );
    life.add(
      rt.on("cart.updated", () => {
        if (Date.now() > mutedUntil) reloadSilently();
      }),
    );
    life.add(rt.on("promotion.state_changed", () => reloadSilently()));
    life.add(
      bus.subscribe("filter.changed", (p) => {
        if (!p || !FILTER_KEYS.has(p.key)) return;
        const value = p.value;
        if (p.key === "in_stock" || p.key === "affordable") f[p.key] = Boolean(value);
        else if (p.key === "min_points" || p.key === "max_points")
          f[p.key] = value === null || value === "" ? null : Number(value);
        else if (p.key === "sort") f.sort = SORTS.some((s) => s.value === value) ? value : f.sort;
        else f[p.key] = value ?? "";
        if (p.key === "q") {
          const s = toolbar.querySelector('input[type="search"]');
          if (s) s.value = f.q;
        }
        if (p.key === "sort") toolbar.querySelector("select").value = f.sort;
        if (state.view !== "grid") {
          state.view = "grid";
          productView.hidden = true;
          gridView.hidden = false;
        }
        drawChips();
        load();
      }),
    );

    drawChips();
    loadCategories();
    load({ initial: true });
    return life.dispose;
  },
};
