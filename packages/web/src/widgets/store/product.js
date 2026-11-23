// store.product: artwork, price, stock, tier gate, add to cart, wishlist, reviews with a histogram, write a review.
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { pill } from "../../ds/js/pill.js";
import { personChip } from "../../ds/js/avatar.js";
import { radioGroup, textField, textArea, selectField } from "../../ds/js/field.js";
import { emptyState, skeleton } from "../../ds/js/states.js";
import { number } from "../../ds/js/format.js";
import {
  disposer,
  reportLoadError,
  inlineError,
  markArrived,
  messageOf,
  serialQueue,
  showFormError,
  withBusy,
  timeEl,
} from "../points/_kit.js";
import {
  productCard,
  replaceKeepFocus,
  cartSetQty,
  qtyIn,
  toggleWishlist,
  addToCart,
  stars,
} from "./_shop.js";
import { productSummary, histogram } from "./_detail.js";

const RATING_LABELS = [
  "1 star: poor",
  "2 stars: fair",
  "3 stars: good",
  "4 stars: very good",
  "5 stars: excellent",
];

const starsOf = (n) => stars({ average: n, count: 1 }, { count: false });

export default {
  id: "store.product",
  domain: "store",
  title: "Product",
  configSchema: schemaOf("store.product"),
  sizes: ["l", "xl", "full"],
  mount(el, { config, size, api, rt, bus, nav, ctx }) {
    const life = disposer();
    const root = h("div", { class: `w-store w-store-product w-store-product--${size}` });
    el.append(root);
    const canShop = ctx.can("store:shop");
    const queue = serialQueue();
    let mutedUntil = 0;

    const state = {
      slug: typeof config.product === "string" ? config.product : null,
      detail: null,
      view: "detail", // detail | reviews | write-review
      reviews: [],
      reviewsNext: null,
      reviewsLoaded: false,
      ratingFilter: "all",
      draft: { rating: null, title: "", body: "" },
      lastBody: null,
      key: null,
    };
    let seq = 0;

    // ---- loading ----
    const load = async ({ initial = false, silent = false } = {}) => {
      if (!state.slug) {
        clear(root);
        root.append(
          emptyState({ icon: "store", title: "Choose a product", body: "Select a product to see it here." }),
        );
        return;
      }
      const mine = ++seq;
      if (!silent && !state.detail) {
        clear(root);
        root.append(skeleton({ shape: "card", lines: 4 }));
      }
      try {
        const d = await api.call("store.product", { slug: state.slug });
        if (life.done || mine !== seq) return;
        state.detail = d;
        ctx.setState("ready");
        ctx.setTitle(d.card.title);
        if (!silent) draw({ focus: initial === false });
        else if (state.view === "detail") draw();
        else if (state.view === "reviews") drawReviews(false);
      } catch (e) {
        if (life.done || mine !== seq) return;
        reportLoadError({
          ctx,
          host: root,
          error: e,
          retry: () => load({ initial: true }),
          initial: initial || !state.detail,
        });
      }
    };

    const ops = () => {
      const d = state.detail;
      return {
        addToCart: async (btn) => {
          const cart = await addToCart({ api, ctx, nav, card: d.card, btn });
          if (cart) {
            mutedUntil = Date.now() + 1500;
            patch({ in_cart_qty: qtyIn(cart, d.card.slug) });
          }
        },
        setQty: (qty) => {
          const prev = d.card.in_cart_qty;
          patch({ in_cart_qty: qty });
          queue(async () => {
            try {
              const cart = await cartSetQty(api, d.card.slug, qty);
              mutedUntil = Date.now() + 1500;
              patch({ in_cart_qty: qtyIn(cart, d.card.slug) });
              ctx.announce(qty === 0 ? "Removed from cart" : `${qty} in cart`);
            } catch (e) {
              patch({ in_cart_qty: prev });
              ctx.toast({ title: "Could not change the cart", body: messageOf(e), tone: "danger" });
            }
          });
        },
        toggleWish: (on) => {
          patch({ in_wishlist: on });
          queue(async () => {
            try {
              await toggleWishlist(api, d.card.slug, on);
              mutedUntil = Date.now() + 1500;
              ctx.announce(on ? "Saved to wishlist" : "Removed from wishlist");
            } catch (e) {
              patch({ in_wishlist: !on });
              ctx.toast({ title: "Wishlist not changed", body: messageOf(e), tone: "danger" });
            }
          });
        },
      };
    };

    /** Merge fields into the card and redraw the summary (not the reviews being read). */
    function patch(fields, { arrive = false } = {}) {
      if (!state.detail) return;
      state.detail = { ...state.detail, card: { ...state.detail.card, ...fields } };
      if (state.view === "detail") drawSummary({ arrive });
    }

    // ---- views ----
    let summaryRef = null;

    function drawSummary({ arrive = false } = {}) {
      if (!summaryRef?.isConnected) return;
      const fresh = h(
        "div",
        { class: "w-store-product__summary" },
        productSummary({ detail: state.detail, ops: ops(), canShop, page: true }),
      );
      replaceKeepFocus(summaryRef, fresh);
      summaryRef = fresh;
      if (arrive) markArrived(life, fresh, fresh.querySelector(".w-store-summary__head"));
    }

    function draw({ focus = false } = {}) {
      clear(root);
      if (state.view === "detail") drawDetail(focus);
      else if (state.view === "reviews") drawReviews(focus);
      else drawWrite();
    }

    function drawDetail(focus) {
      const d = state.detail;
      const wrap = h("div", { class: "w-store-product__detail" });
      const sum = h(
        "div",
        { class: "w-store-product__summary" },
        productSummary({ detail: d, ops: ops(), canShop, page: true }),
      );
      summaryRef = sum;
      wrap.append(sum);
      // The reviews teaser: rating, distribution, the latest reviews and the way into the full list.
      const total = d.rating_histogram.reduce((a, b) => a + b, 0);
      const teaser = h(
        "section",
        { class: "w-store-product__reviews", "aria-label": "Reviews" },
        h(
          "div",
          { class: "w-kit-head" },
          h("h3", { class: "w-kit-head__title" }, `Reviews (${number(total)})`),
          button({
            label: total ? "All reviews" : "Reviews",
            icon: "chevron-right",
            variant: "secondary",
            size: "sm",
            onClick: () => goReviews(),
          }),
        ),
        total ? histogram(d.rating_histogram) : h("p", { class: "u-muted" }, "No reviews yet."),
        ...d.reviews.slice(0, 2).map(reviewItem),
        d.can_review
          ? button({ label: "Write a review", icon: "edit", variant: "primary", onClick: () => goWrite() })
          : null,
      );
      wrap.append(teaser);
      if (d.related.length) {
        const row = h("div", { class: "w-store-catalog__relatedrow" });
        for (const r of d.related.slice(0, 4))
          row.append(productCard(r, { open: (c) => switchTo(c.slug) }, { compact: true }));
        wrap.append(
          h(
            "section",
            { class: "w-store-catalog__related", "aria-label": "Related products" },
            h("h3", { class: "w-kit-head__title" }, "Related products"),
            row,
          ),
        );
      }
      root.append(wrap);
      if (focus) wrap.querySelector("[data-focus]")?.focus();
    }

    const reviewItem = (r) =>
      h(
        "article",
        { class: "w-store-review", "data-review": r.review_id },
        h(
          "div",
          { class: "w-store-review__head" },
          personChip(r.member),
          starsOf(r.rating),
          timeEl(r.created_at),
          r.verified_order
            ? pill({ label: "Verified purchase", tone: "success", icon: "check-circle" })
            : null,
          r.status === "hidden" ? pill({ label: "Hidden", tone: "warning", icon: "eye-off" }) : null,
        ),
        h("h4", { class: "w-store-review__title" }, r.title),
        r.body ? h("p", { class: "w-store-review__body" }, r.body) : null,
      );

    async function goReviews({ reset = true } = {}) {
      state.view = "reviews";
      if (reset) {
        state.reviews = [];
        state.reviewsNext = null;
        state.reviewsLoaded = false;
        state.ratingFilter = "all";
      }
      draw();
      await loadReviews({ first: true });
    }

    async function loadReviews({ first = false, more = false, arriveNew = false } = {}) {
      try {
        const res = await api.call("store.reviews", {
          slug: state.slug,
          limit: 10,
          ...(more && state.reviewsNext ? { cursor: state.reviewsNext } : {}),
        });
        if (life.done || state.view !== "reviews") return;
        const known = new Set(state.reviews.map((r) => r.review_id));
        const fresh = res.items.filter((r) => !known.has(r.review_id));
        state.reviews = more ? [...state.reviews, ...res.items] : res.items;
        state.reviewsNext = res.next_cursor;
        state.reviewsLoaded = true;
        drawReviewList(arriveNew ? new Set(fresh.map((r) => r.review_id)) : new Set());
        if (first) root.querySelector("[data-focus]")?.focus();
      } catch (e) {
        if (life.done) return;
        inlineError(listHost, e, () => loadReviews({ first, more }));
      }
    }

    const listHost = h("div", { class: "w-store-product__list" });

    function drawReviews(focus) {
      clear(root);
      const d = state.detail;
      const total = d.rating_histogram.reduce((a, b) => a + b, 0);
      const wrap = h("div", { class: "w-store-product__reviewsview" });
      wrap.append(
        h(
          "div",
          { class: "w-kit-head" },
          button({
            label: "Back to product",
            icon: "chevron-left",
            variant: "ghost",
            size: "sm",
            onClick: backToDetail,
          }),
        ),
        h("h3", { class: "w-kit-title", tabindex: "-1", "data-focus": "" }, `Reviews for ${d.card.title}`),
        h(
          "div",
          { class: "w-store-product__ratingrow" },
          stars(d.card.rating),
          h("span", { class: "u-muted" }, `${number(total)} ${total === 1 ? "review" : "reviews"}`),
        ),
        ...[total ? histogram(d.rating_histogram) : null].filter(Boolean),
        h(
          "div",
          { class: "w-kit-actions" },
          d.can_review
            ? button({ label: "Write a review", icon: "edit", variant: "primary", onClick: () => goWrite() })
            : null,
          selectField({
            name: "rating",
            label: "Show",
            value: state.ratingFilter,
            options: [
              { value: "all", label: "All ratings" },
              ...[5, 4, 3, 2, 1].map((n) => ({
                value: String(n),
                label: `${n} ${n === 1 ? "star" : "stars"}`,
              })),
            ],
            onChange: (v) => {
              state.ratingFilter = v;
              drawReviewList(new Set());
            },
          }),
        ),
        listHost,
      );
      root.append(wrap);
      if (state.reviewsLoaded) drawReviewList(new Set());
      else listHost.append(skeleton({ lines: 3 }));
      if (focus) wrap.querySelector("[data-focus]")?.focus();
    }

    function drawReviewList(arrived) {
      clear(listHost);
      const shown =
        state.ratingFilter === "all"
          ? state.reviews
          : state.reviews.filter((r) => String(r.rating) === state.ratingFilter);
      if (shown.length === 0) {
        listHost.append(
          emptyState({
            icon: "star",
            title: state.reviews.length ? "No reviews with that rating on this page" : "No reviews yet",
            body: state.reviews.length
              ? "Load more to look further."
              : "Reviews from verified purchases will appear here.",
          }),
        );
      } else {
        for (const r of shown) {
          const node = reviewItem(r);
          listHost.append(node);
          if (arrived.has(r.review_id)) markArrived(life, node, node.querySelector(".w-store-review__head"));
        }
      }
      if (state.reviewsNext)
        listHost.append(
          button({
            label: "Load more reviews",
            variant: "secondary",
            onClick: () => loadReviews({ more: true }),
          }),
        );
      if (arrived.size) ctx.announce(`${arrived.size} new ${arrived.size === 1 ? "review" : "reviews"}`);
    }

    function backToDetail() {
      state.view = "detail";
      draw({ focus: true });
    }

    function goWrite() {
      state.view = "write-review";
      state.draft = { rating: null, title: "", body: "" };
      state.lastBody = null;
      state.key = null;
      draw();
    }

    function drawWrite() {
      const d = state.detail;
      const form = h("form", { class: "w-kit-form", novalidate: true });
      const submit = button({ label: "Publish review", type: "submit", variant: "primary", icon: "check" });
      form.append(
        h(
          "p",
          { class: "u-muted w-kit-small" },
          "Fields marked * are required. Reviews are public and tied to your delivered order.",
        ),
        radioGroup({
          name: "/rating",
          label: "Rating",
          required: true,
          value: state.draft.rating ? String(state.draft.rating) : undefined,
          options: RATING_LABELS.map((label, i) => ({ value: String(i + 1), label })),
          onChange: (v) => (state.draft.rating = v ? Number(v) : null),
        }),
        textField({
          name: "/title",
          label: "Headline",
          required: true,
          value: state.draft.title,
          hint: "Up to 120 characters.",
          onInput: (v) => (state.draft.title = v),
        }),
        textArea({
          name: "/body",
          label: "Review",
          rows: 5,
          value: state.draft.body,
          hint: "Up to 2000 characters. Optional.",
          onInput: (v) => (state.draft.body = v),
        }),
        h(
          "div",
          { class: "w-kit-actions" },
          button({ label: "Cancel", variant: "secondary", onClick: () => goReviews({ reset: false }) }),
          submit,
        ),
      );
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const t = state.draft.title.trim();
        const b = state.draft.body.trim();
        if (!state.draft.rating)
          return showFormError(form, {
            code: "VALIDATION_FAILED",
            path: "/rating",
            message: "Choose a rating",
          });
        if (!t || t.length > 120)
          return showFormError(form, {
            code: "VALIDATION_FAILED",
            path: "/title",
            message: t ? "Use at most 120 characters" : "Add a headline",
          });
        if (b.length > 2000)
          return showFormError(form, {
            code: "VALIDATION_FAILED",
            path: "/body",
            message: "Use at most 2000 characters",
          });
        const body = JSON.stringify([state.draft.rating, t, b]);
        if (body !== state.lastBody || !state.key) state.key = api.idempotencyKey("review");
        state.lastBody = body;
        await withBusy(submit, async () => {
          try {
            await api.call("store.review_create", {
              slug: state.slug,
              rating: state.draft.rating,
              title: t,
              body: b,
              idempotency_key: state.key,
            });
            if (life.done) return;
            ctx.toast({ title: "Review published", body: d.card.title, tone: "success" });
            ctx.announce("Review published");
            await load({ silent: true });
            await goReviews();
          } catch (err) {
            showFormError(form, err, { NOT_ELIGIBLE: "/rating", ALREADY_EXISTS: "/rating" });
          }
        });
      });
      const wrap = h(
        "div",
        { class: "w-store-product__write" },
        h(
          "div",
          { class: "w-kit-head" },
          button({
            label: "Back to reviews",
            icon: "chevron-left",
            variant: "ghost",
            size: "sm",
            onClick: () => goReviews({ reset: false }),
          }),
        ),
        h("h3", { class: "w-kit-title", tabindex: "-1" }, `Review ${d.card.title}`),
        form,
      );
      root.append(wrap);
      wrap.querySelector("h3").focus();
    }

    // ---- switching products ----
    async function switchTo(slug) {
      if (!slug || slug === state.slug) return;
      state.slug = slug;
      state.detail = null;
      state.view = "detail";
      await load({ initial: false });
    }

    // ---- realtime and bus ----
    const isMine = (slug) => slug === state.slug;
    life.add(
      rt.on("stock.changed", (ev) => {
        const p = ev.payload;
        if (!isMine(p.product) || !state.detail) return;
        const out = p.stock_status === "out";
        const cur = state.detail.card;
        patch(
          {
            on_hand: p.on_hand,
            stock_status: p.stock_status,
            ...(out
              ? { locked_reason: "out_of_stock" }
              : cur.locked_reason === "out_of_stock"
                ? { locked_reason: null }
                : {}),
          },
          { arrive: true },
        );
      }),
    );
    life.add(
      rt.on("review.created", (ev) => {
        const p = ev.payload;
        if (!isMine(p.product) || !state.detail) return;
        patch({ rating: { average: p.average, count: p.count } }, { arrive: true });
        if (state.view === "reviews") loadReviews({ arriveNew: true });
        else load({ silent: true });
      }),
    );
    life.add(
      rt.on("wishlist.changed", (ev) => {
        if (
          isMine(ev.payload.product) &&
          state.detail &&
          state.detail.card.in_wishlist !== ev.payload.in_wishlist
        )
          patch({ in_wishlist: ev.payload.in_wishlist });
      }),
    );
    life.add(
      rt.on("cart.updated", () => {
        if (Date.now() > mutedUntil && state.detail && state.view === "detail") load({ silent: true });
      }),
    );
    life.add(bus.subscribe("product.selected", (p) => p?.id && switchTo(p.id)));
    const latest = bus.latest?.("product.selected");
    if (!state.slug && latest?.id) state.slug = latest.id;

    load({ initial: true });
    return life.dispose;
  },
};
