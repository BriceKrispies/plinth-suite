// store.cart: lines with quantity steppers and issues, a live quote with promotions, and the checkout flow
// (delivery, confirm, placed) inside the widget. Compact and small frames show a summary and open the cart page.
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { points, number, cents, signedPoints } from "../../ds/js/format.js";
import { button, iconButton, linkButton } from "../../ds/js/button.js";
import { radioGroup, textField, textArea, formErrors } from "../../ds/js/field.js";
import { pill, statusPill } from "../../ds/js/pill.js";
import { emptyState, skeleton } from "../../ds/js/states.js";
import { icon } from "../../ds/js/icons.js";
import {
  disposer,
  reportLoadError,
  messageOf,
  serialQueue,
  withBusy,
  markArrived,
  kv,
  dl,
} from "../points/_kit.js";
import { productArt, qtyStepper, cartSetQty, productHref } from "./_shop.js";

const ISSUES = {
  out_of_stock: ["Out of stock", "danger"],
  insufficient_stock: ["Not enough stock", "warning"],
  retired: ["No longer available", "danger"],
  tier: ["Tier too low", "warning"],
  limit: ["Over your limit", "warning"],
};
const METHODS = [
  { value: "ship", label: "Ship to me" },
  { value: "pickup", label: "Pick up on site" },
  { value: "digital", label: "Digital delivery" },
  { value: "donation", label: "Donate on my behalf" },
];
const EFFECTS = {
  points_multiplier: "Points multiplier",
  bonus_points: "Bonus points",
  store_discount: "Store discount",
  free_item: "Free item",
};
const STEPS = [
  ["lines", "Cart"],
  ["delivery", "Delivery"],
  ["confirm", "Review"],
  ["placed", "Placed"],
];

const issueText = (line) => {
  const p = line.product;
  switch (line.issue) {
    case "insufficient_stock":
      return `Only ${p.on_hand} in stock`;
    case "tier":
      return `Needs ${p.min_tier ?? "a higher"} tier`;
    default:
      return ISSUES[line.issue]?.[0] ?? "";
  }
};

export default {
  id: "store.cart",
  domain: "store",
  title: "Cart",
  configSchema: schemaOf("store.cart"),
  sizes: ["s", "m", "l", "xl"],
  mount(el, { config, size, api, rt, bus, nav, ctx }) {
    const life = disposer();
    const flow = (size === "l" || size === "xl") && !config.compact;
    const root = h("div", {
      class: `w-store w-store-cart w-store-cart--${size}${flow ? " is-flow" : " is-compact"}`,
    });
    el.append(root);
    if (!ctx.can("store:shop")) {
      root.append(emptyState({ icon: "lock", title: "Shopping is not enabled for your role" }));
      return () => {};
    }
    const queue = serialQueue();
    const me = ctx.me?.member;

    const state = {
      view: "lines",
      cart: null,
      quote: null,
      quoteError: null,
      delivery: {
        method: "ship",
        address: {
          name: me?.display_name ?? "",
          line1: "",
          line2: "",
          city: "",
          postal_code: "",
          country: "",
        },
        pickup_site: "",
      },
      notes: "",
      key: null,
      placed: null,
      banner: null, // { tone, text }
      priceChanged: false,
      loaded: false,
    };
    let cartSeq = 0;
    let quoteSeq = 0;
    let mutedUntil = 0;
    const lineEls = new Map();

    // ---- data ----
    const loadCart = async ({ initial = false, silent = false } = {}) => {
      const mine = ++cartSeq;
      if (!silent && !state.loaded) {
        clear(root);
        root.append(skeleton({ shape: "card", lines: 3 }));
      }
      try {
        const res = await api.call("cart.get", {});
        if (life.done || mine !== cartSeq) return;
        const before = state.cart;
        state.cart = res;
        state.loaded = true;
        ctx.setState("ready");
        ctx.setCount(res.item_count);
        if (state.view === "placed") return;
        const sig = (c) =>
          c?.lines.map((l) => `${l.product.slug}:${l.qty}:${l.issue ?? ""}:${l.line_points}`).join("|");
        if (silent && before && sig(before) === sig(res)) {
          // Nothing the user sees changed (for example a stock event on an unrelated product): keep the form as is.
          if (res.lines.length) requote({ silent: true });
          return;
        }
        if (res.lines.length === 0 && state.view !== "lines") state.view = "lines";
        draw({ changedFrom: silent ? before : null });
        if (res.lines.length) requote({ silent: true });
        else state.quote = null;
      } catch (e) {
        if (life.done || mine !== cartSeq) return;
        reportLoadError({
          ctx,
          host: root,
          error: e,
          retry: () => loadCart({ initial: true }),
          initial: initial || !state.loaded,
        });
      }
    };

    const requote = async ({ silent = false } = {}) => {
      if (!state.cart || state.cart.lines.length === 0) {
        state.quote = null;
        return;
      }
      const mine = ++quoteSeq;
      if (!silent) {
        state.quote = null;
        drawQuoteHost();
      }
      try {
        const q = await api.call("checkout.quote", {});
        if (life.done || mine !== quoteSeq) return;
        const changed = state.quote && state.quote.quote_hash !== q.quote_hash;
        state.quote = q;
        state.quoteError = null;
        if (state.view === "confirm") {
          if (changed) {
            state.priceChanged = true;
            state.key = api.idempotencyKey("checkout");
            state.banner = {
              tone: "warning",
              text: "Prices changed while you were reviewing. Check the new total before placing the order.",
            };
          }
          draw();
        } else drawQuoteHost();
      } catch (e) {
        if (life.done || mine !== quoteSeq) return;
        state.quote = null;
        state.quoteError = e;
        drawQuoteHost();
      }
    };
    const requoteSoon = life.debounce(() => requote({ silent: true }), 300);

    // ---- cart edits (optimistic, serialised per widget) ----
    const setQty = (line, qty) => {
      const slug = line.product.slug;
      const before = state.cart;
      const unit = line.qty > 0 ? line.line_points / line.qty : line.product.price_points;
      state.cart = {
        ...state.cart,
        lines: state.cart.lines
          .map((l) => (l.product.slug === slug ? { ...l, qty, line_points: Math.round(unit * qty) } : l))
          .filter((l) => l.qty > 0),
        item_count: state.cart.item_count - line.qty + qty,
        subtotal_points: state.cart.subtotal_points - line.line_points + Math.round(unit * qty),
      };
      draw({ keepFocusOn: slug });
      queue(async () => {
        try {
          const cart = await cartSetQty(api, slug, qty);
          mutedUntil = Date.now() + 1500;
          state.cart = cart;
          ctx.setCount(cart.item_count);
          ctx.announce(qty === 0 ? `${line.product.title} removed` : `${line.product.title}: ${qty} in cart`);
          if (cart.lines.length === 0) state.quote = null;
          draw({ keepFocusOn: qty === 0 ? null : slug });
          requoteSoon();
        } catch (e) {
          state.cart = before;
          draw({ keepFocusOn: slug });
          ctx.toast({ title: "Cart not changed", body: messageOf(e), tone: "danger" });
        }
      });
    };

    const clearCart = async () => {
      const ok = await ctx.confirm({
        title: "Empty the cart?",
        message: `Remove all ${state.cart.item_count} items from your cart.`,
        confirmLabel: "Empty cart",
        tone: "danger",
      });
      if (!ok) return;
      try {
        const cart = await api.call("cart.clear", {});
        mutedUntil = Date.now() + 1500;
        state.cart = cart;
        state.quote = null;
        ctx.setCount(0);
        ctx.announce("Cart emptied");
        draw();
      } catch (e) {
        ctx.toast({ title: "Could not empty the cart", body: messageOf(e), tone: "danger" });
      }
    };

    // ---- pieces ----
    const quoteLine = (slug) => state.quote?.lines.find((l) => l.product === slug);

    const lineRow = (line, { readonly = false } = {}) => {
      const p = line.product;
      const q = quoteLine(p.slug);
      const [issueLabel, tone] = ISSUES[line.issue] ?? [];
      const row = h(
        "li",
        { class: "w-store-cart__line", "data-slug": p.slug },
        h("div", { class: "w-store-cart__art" }, productArt(p, 56)),
        h(
          "div",
          { class: "w-store-cart__info" },
          h("a", { class: "w-store-cart__title", href: productHref(p.slug) }, p.title),
          h("span", { class: "u-muted w-kit-small u-tabular" }, `${points(p.price_points)} each`),
          line.issue
            ? h(
                "span",
                { class: "w-store-cart__issue" },
                pill({ label: issueLabel, tone, icon: "alert" }),
                h("span", { class: "w-kit-small" }, issueText(line)),
              )
            : null,
          q?.free_item ? pill({ label: "Free item", tone: "signal", icon: "gift" }) : null,
        ),
        readonly
          ? h("span", { class: "u-tabular w-kit-small" }, `× ${line.qty}`)
          : (() => {
              const stepper = qtyStepper({
                value: line.qty,
                min: 0,
                max: Math.max(line.qty, Math.min(p.on_hand, 99)),
                label: p.title,
                onChange: (n) => setQty(line, n),
              });
              stepper.setAttribute("data-act", "qty");
              return stepper;
            })(),
        h(
          "span",
          { class: "w-store-cart__total u-tabular" },
          q && q.discount_points > 0
            ? [
                h("s", { class: "u-muted w-kit-small" }, points(line.line_points)),
                " ",
                h("strong", {}, points(q.line_points)),
              ]
            : h("strong", {}, points(line.line_points)),
        ),
        readonly
          ? null
          : iconButton({
              icon: "trash",
              label: `Remove ${p.title}`,
              variant: "ghost",
              size: "sm",
              onClick: () => setQty(line, 0),
            }),
      );
      lineEls.set(p.slug, row);
      return row;
    };

    const quoteDetails = () => {
      const qt = state.quote;
      if (state.quoteError) {
        const msg = h(
          "div",
          { class: "w-kit-note w-kit-note--warning" },
          icon("alert", { size: 16 }),
          h(
            "span",
            {},
            `Could not price the cart: ${messageOf(state.quoteError)} `,
            button({ label: "Retry", variant: "ghost", size: "sm", onClick: () => requote() }),
          ),
        );
        return msg;
      }
      if (!qt) return skeleton({ lines: 3 });
      const after = qt.balance_after;
      const rows = [
        kv("Subtotal", points(qt.subtotal_points)),
        qt.discount_points ? kv("Discounts", signedPoints(-Math.abs(qt.discount_points))) : null,
        kv("Total", h("strong", { class: "u-tabular w-store-cart__grand" }, points(qt.total_points))),
        qt.cash_cents ? kv("Cash top-up", cents(qt.cash_cents)) : null,
        qt.bonus_points ? kv("Bonus on delivery", `+${points(qt.bonus_points)}`) : null,
        kv("Your balance", points(qt.balance)),
        kv(
          "Balance after",
          h(
            "span",
            { class: `u-tabular${after < 0 ? " w-kit-amount--neg" : ""}` },
            after < 0 ? `−${points(Math.abs(after))}` : points(after),
          ),
        ),
      ].filter(Boolean);
      const box = h("div", { class: "w-store-cart__quote" }, dl(rows, "w-store-cart__dl"));
      const applied = qt.evaluation?.applied ?? [];
      if (applied.length)
        box.append(
          h(
            "ul",
            { class: "w-store-cart__promos", "aria-label": "Applied promotions" },
            ...applied.map((a) =>
              h(
                "li",
                {},
                pill({ label: a.title, tone: "signal", icon: "percent" }),
                h(
                  "span",
                  { class: "u-muted w-kit-small" },
                  a.effects
                    .map(
                      (e) =>
                        `${EFFECTS[e.type] ?? e.type}${e.benefit_points ? ` ${points(e.benefit_points)}` : ""}`,
                    )
                    .join(", "),
                ),
              ),
            ),
          ),
        );
      if (qt.requires_approval)
        box.append(
          h(
            "p",
            { class: "w-kit-note w-kit-note--info" },
            icon("info", { size: 16 }),
            " This order is high value, so a manager approves it before fulfilment. Your points are reserved now.",
          ),
        );
      if (after < 0)
        box.append(
          h(
            "p",
            { class: "w-kit-note w-kit-note--danger" },
            icon("alert", { size: 16 }),
            ` You need ${points(Math.abs(after))} more to check out.`,
          ),
        );
      for (const b of qt.blocking ?? [])
        box.append(
          h(
            "p",
            { class: "w-kit-note w-kit-note--warning" },
            icon("alert", { size: 16 }),
            typeof b === "string"
              ? b
              : (b.message ?? b.reason ?? b.code ?? "This cart cannot be checked out yet"),
          ),
        );
      return box;
    };

    const quoteHost = h("div", { class: "w-store-cart__quotehost", "aria-live": "polite" });
    function drawQuoteHost() {
      const next = root.querySelector("[data-act=next]");
      if (next) next.disabled = blocked();
      if (!quoteHost.isConnected) return;
      clear(quoteHost);
      quoteHost.append(
        h("h3", { class: "w-kit-head__title" }, "Order summary"),
        quoteDetails(),
        ...(quoteHost.actions ? [quoteHost.actions()] : []),
      );
    }

    const blocked = () => {
      const c = state.cart;
      if (!c || c.lines.length === 0) return true;
      if (c.lines.some((l) => l.issue)) return true;
      if (!state.quote) return true;
      return state.quote.balance_after < 0 || (state.quote.blocking ?? []).length > 0;
    };

    const stepper = () => {
      const order = STEPS.map((s) => s[0]);
      const at = order.indexOf(state.view);
      return h(
        "ol",
        { class: "w-kit-steps", "aria-label": "Checkout steps" },
        ...STEPS.map(([id, label], i) =>
          h(
            "li",
            { "aria-current": id === state.view ? "step" : null, class: i < at ? "is-done" : "" },
            label,
          ),
        ),
      );
    };

    // ---- compact (small frames, or the compact option) ----
    function drawCompact() {
      const c = state.cart;
      if (c.lines.length === 0) {
        root.append(
          emptyState({
            icon: "cart",
            title: "Your cart is empty",
            body: "Add rewards from the store.",
            action: linkButton({ href: nav.href("/store"), label: "Browse the store", variant: "secondary" }),
          }),
        );
        return;
      }
      root.append(
        h(
          "p",
          { class: "w-store-cart__count" },
          h("strong", { class: "u-tabular" }, number(c.item_count)),
          ` ${c.item_count === 1 ? "item" : "items"} · `,
          h("strong", { class: "u-tabular" }, points(c.subtotal_points)),
        ),
        h(
          "p",
          { class: "u-muted w-kit-small u-tabular" },
          `Balance ${points(c.balance)}${c.subtotal_points > c.balance ? " (not enough yet)" : ""}`,
        ),
      );
      if (size !== "s")
        root.append(
          h("ul", { class: "w-store-cart__lines" }, ...c.lines.slice(0, 3).map((l) => lineRow(l))),
          ...[
            c.lines.length > 3
              ? h("p", { class: "u-muted w-kit-small" }, `and ${c.lines.length - 3} more`)
              : null,
          ].filter(Boolean),
        );
      if (c.lines.some((l) => l.issue))
        root.append(
          h(
            "p",
            { class: "w-kit-note w-kit-note--warning" },
            icon("alert", { size: 16 }),
            " Some items need attention.",
          ),
        );
      root.append(
        h(
          "div",
          { class: "w-kit-actions" },
          linkButton({
            href: nav.href("/store/cart"),
            label: "Open cart and check out",
            icon: "cart",
            variant: "primary",
            size: "sm",
          }),
        ),
      );
    }

    // ---- lines view ----
    function drawLines(opts) {
      const c = state.cart;
      if (c.lines.length === 0) {
        root.append(
          emptyState({
            icon: "cart",
            title: "Your cart is empty",
            body: "Browse the store and add the rewards you want.",
            action: linkButton({ href: nav.href("/store"), label: "Browse the store", variant: "primary" }),
          }),
        );
        return;
      }
      const list = h(
        "ul",
        { class: "w-store-cart__lines", "aria-label": "Cart lines" },
        ...c.lines.map((l) => lineRow(l)),
      );
      const next = button({
        label: "Continue to delivery",
        icon: "chevron-right",
        variant: "primary",
        disabled: blocked(),
        onClick: () => ((state.view = "delivery"), (state.banner = null), draw({ focusHeading: true })),
      });
      next.setAttribute("data-act", "next");
      const actions = h(
        "div",
        { class: "w-kit-actions" },
        next,
        button({ label: "Empty cart", icon: "trash", variant: "ghost", onClick: clearCart }),
      );
      quoteHost.actions = () =>
        h(
          "div",
          {},
          state.quote && blocked()
            ? h("p", { class: "u-muted w-kit-small" }, "Fix the items marked above to continue.")
            : null,
        );
      root.append(
        h(
          "div",
          { class: "w-store-cart__grid" },
          h(
            "div",
            { class: "w-store-cart__main" },
            h(
              "div",
              { class: "w-kit-head" },
              h("h3", { class: "w-kit-head__title" }, `Items (${c.item_count})`),
            ),
            list,
            actions,
          ),
          h("aside", { class: "w-store-cart__side" }, quoteHost),
        ),
      );
      drawQuoteHost();
      if (opts?.changedFrom) {
        const old = new Map(opts.changedFrom.lines.map((l) => [l.product.slug, l]));
        for (const [slug, row] of lineEls) {
          const prev = old.get(slug);
          const now = c.lines.find((l) => l.product.slug === slug);
          if (!prev || (now && (prev.qty !== now.qty || prev.issue !== now.issue))) markArrived(life, row);
        }
      }
    }

    // ---- delivery ----
    function drawDelivery() {
      const d = state.delivery;
      const form = h("form", { class: "w-kit-form", novalidate: true });
      const fieldsHost = h("div", { class: "w-kit-form" });
      const drawFields = () => {
        clear(fieldsHost);
        if (d.method === "ship") {
          const a = d.address;
          fieldsHost.append(
            textField({
              name: "/delivery/address/name",
              label: "Recipient name",
              required: true,
              value: a.name,
              onInput: (v) => (a.name = v),
            }),
            textField({
              name: "/delivery/address/line1",
              label: "Address line 1",
              required: true,
              value: a.line1,
              onInput: (v) => (a.line1 = v),
            }),
            textField({
              name: "/delivery/address/line2",
              label: "Address line 2",
              value: a.line2,
              onInput: (v) => (a.line2 = v),
            }),
            h(
              "div",
              { class: "c-form__row" },
              textField({
                name: "/delivery/address/city",
                label: "City",
                required: true,
                value: a.city,
                onInput: (v) => (a.city = v),
              }),
              textField({
                name: "/delivery/address/postal_code",
                label: "Postal code",
                required: true,
                value: a.postal_code,
                onInput: (v) => (a.postal_code = v),
              }),
            ),
            textField({
              name: "/delivery/address/country",
              label: "Country code",
              required: true,
              value: a.country,
              hint: "Two capital letters, for example US or GB.",
              onInput: (v) => (a.country = v.toUpperCase()),
            }),
          );
        } else if (d.method === "pickup") {
          fieldsHost.append(
            textField({
              name: "/delivery/pickup_site",
              label: "Pickup site",
              required: true,
              value: d.pickup_site,
              hint: "Up to 80 characters.",
              onInput: (v) => (d.pickup_site = v),
            }),
          );
        } else {
          fieldsHost.append(
            h(
              "p",
              { class: "u-muted" },
              d.method === "digital"
                ? "Digital rewards are delivered to your account email."
                : "We will donate on your behalf and send you the receipt.",
            ),
          );
        }
      };
      drawFields();
      const back = button({
        label: "Back to cart",
        icon: "chevron-left",
        variant: "secondary",
        onClick: () => ((state.view = "lines"), draw({ focusHeading: true })),
      });
      const go = button({ label: "Review order", icon: "chevron-right", variant: "primary", type: "submit" });
      form.append(
        h("p", { class: "u-muted w-kit-small" }, "Fields marked * are required"),
        radioGroup({
          name: "/delivery/method",
          label: "How should we deliver?",
          value: d.method,
          options: METHODS,
          onChange: (v) => {
            d.method = v ?? "ship";
            drawFields();
          },
        }),
        fieldsHost,
        textArea({
          name: "/notes",
          label: "Notes for the order",
          rows: 3,
          value: state.notes,
          hint: "Optional, up to 500 characters.",
          onInput: (v) => (state.notes = v),
        }),
        h("div", { class: "w-kit-actions" }, back, go),
      );
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const bad = validateDelivery();
        if (bad) {
          const summary = formErrors(
            { code: "VALIDATION_FAILED", path: bad.path, message: bad.message },
            { form },
          );
          summary?.focus();
          return;
        }
        formErrors(null, { form });
        state.view = "confirm";
        state.banner = null;
        state.priceChanged = false;
        state.key = api.idempotencyKey("checkout");
        draw({ focusHeading: true });
        requote({ silent: false });
      });
      root.append(
        h(
          "div",
          { class: "w-store-cart__grid" },
          h(
            "div",
            { class: "w-store-cart__main" },
            h("h3", { class: "w-kit-title", tabindex: "-1", "data-focus": "" }, "Delivery"),
            form,
          ),
          h("aside", { class: "w-store-cart__side" }, quoteHost),
        ),
      );
      quoteHost.actions = null;
      drawQuoteHost();
    }

    function validateDelivery() {
      const d = state.delivery;
      if (d.method === "ship") {
        const a = d.address;
        const need = [
          ["name", "Enter the recipient name", 80],
          ["line1", "Enter the address", 120],
          ["city", "Enter the city", 80],
          ["postal_code", "Enter the postal code", 20],
        ];
        for (const [k, msg, max] of need) {
          if (!a[k].trim()) return { path: `/delivery/address/${k}`, message: msg };
          if (a[k].trim().length > max)
            return { path: `/delivery/address/${k}`, message: `Use at most ${max} characters` };
        }
        if (a.line2.length > 120)
          return { path: "/delivery/address/line2", message: "Use at most 120 characters" };
        if (!/^[A-Z]{2}$/.test(a.country))
          return { path: "/delivery/address/country", message: "Use a two-letter country code, such as US" };
      }
      if (d.method === "pickup" && (!d.pickup_site.trim() || d.pickup_site.trim().length > 80))
        return {
          path: "/delivery/pickup_site",
          message: d.pickup_site.trim() ? "Use at most 80 characters" : "Name the pickup site",
        };
      if (state.notes.length > 500) return { path: "/notes", message: "Use at most 500 characters" };
      return null;
    }

    const deliveryBody = () => {
      const d = state.delivery;
      const out = { method: d.method };
      if (d.method === "ship") {
        const a = d.address;
        out.address = {
          name: a.name.trim(),
          line1: a.line1.trim(),
          ...(a.line2.trim() ? { line2: a.line2.trim() } : {}),
          city: a.city.trim(),
          postal_code: a.postal_code.trim(),
          country: a.country,
        };
      }
      if (d.method === "pickup") out.pickup_site = d.pickup_site.trim();
      return out;
    };

    // ---- confirm ----
    function drawConfirm() {
      const c = state.cart;
      const d = state.delivery;
      const place = button({
        label: "Place order",
        icon: "check",
        variant: "signal",
        disabled: blocked() || !state.key,
      });
      const addr =
        d.method === "ship"
          ? [
              d.address.name,
              d.address.line1,
              d.address.line2,
              `${d.address.city} ${d.address.postal_code}`,
              d.address.country,
            ]
              .filter((x) => x && x.trim())
              .join(", ")
          : d.method === "pickup"
            ? d.pickup_site
            : METHODS.find((m) => m.value === d.method)?.label;
      place.addEventListener("click", () =>
        withBusy(place, async () => {
          try {
            const order = await api.call("checkout.place", {
              quote_hash: state.quote.quote_hash,
              delivery: deliveryBody(),
              ...(state.notes.trim() ? { notes: state.notes.trim() } : {}),
              idempotency_key: state.key,
            });
            if (life.done) return;
            mutedUntil = Date.now() + 2000;
            state.placed = order;
            state.view = "placed";
            state.banner = null;
            ctx.announce(`Order ${order.order_no} placed`);
            bus.publish("order.selected", { id: order.order_id });
            draw({ focusHeading: true });
          } catch (e) {
            if (life.done) return;
            const reason = e?.details?.reason;
            if (reason === "PRICE_CHANGED" && e.details?.quote) {
              state.quote = e.details.quote;
              state.priceChanged = true;
              state.key = api.idempotencyKey("checkout");
              state.banner = {
                tone: "warning",
                text: "Prices changed while you were reviewing. Check the new total, then place the order again.",
              };
            } else {
              state.banner = { tone: "danger", text: messageOf(e) };
              if (
                [
                  "OUT_OF_STOCK",
                  "NOT_ELIGIBLE",
                  "LIMIT_EXCEEDED",
                  "BUDGET_EXHAUSTED",
                  "CART_EMPTY",
                  "INSUFFICIENT_POINTS",
                ].includes(reason)
              )
                loadCart({ silent: true });
            }
            draw({ focusBanner: true });
          }
        }),
      );
      root.append(
        h(
          "div",
          { class: "w-store-cart__grid" },
          h(
            "div",
            { class: "w-store-cart__main" },
            h("h3", { class: "w-kit-title", tabindex: "-1", "data-focus": "" }, "Review your order"),
            state.banner
              ? h(
                  "p",
                  {
                    class: `w-kit-note w-kit-note--${state.banner.tone}`,
                    role: "alert",
                    tabindex: "-1",
                    "data-banner": "",
                  },
                  icon("alert", { size: 16 }),
                  state.banner.text,
                )
              : null,
            h(
              "ul",
              { class: "w-store-cart__lines", "aria-label": "Items in this order" },
              ...c.lines.map((l) => lineRow(l, { readonly: true })),
            ),
            dl(
              [
                kv("Delivery", addr || "–"),
                state.notes.trim() ? kv("Notes", state.notes.trim()) : null,
              ].filter(Boolean),
            ),
            h(
              "div",
              { class: "w-kit-actions" },
              button({
                label: "Back",
                icon: "chevron-left",
                variant: "secondary",
                onClick: () => (
                  (state.view = "delivery"),
                  (state.banner = null),
                  draw({ focusHeading: true })
                ),
              }),
              place,
            ),
          ),
          h("aside", { class: "w-store-cart__side" }, quoteHost),
        ),
      );
      quoteHost.actions = null;
      drawQuoteHost();
    }

    // ---- placed ----
    function drawPlaced() {
      const o = state.placed;
      root.append(
        h(
          "div",
          { class: "w-store-cart__placed" },
          h("h3", { class: "w-kit-title", tabindex: "-1", "data-focus": "" }, "Order placed"),
          h(
            "p",
            { class: "w-kit-note w-kit-note--success", role: "status" },
            icon("check-circle", { size: 20 }),
            ` Thank you. Order ${o.order_no} is in.`,
          ),
          dl(
            [
              kv("Order", h("strong", {}, o.order_no)),
              kv("Status", statusPill("order", o.status)),
              kv("Items", number(o.item_count)),
              kv("Total", points(o.total_points)),
              o.bonus_points ? kv("Bonus on delivery", `+${points(o.bonus_points)}`) : null,
            ].filter(Boolean),
          ),
          o.requires_approval
            ? h(
                "p",
                { class: "w-kit-note w-kit-note--info" },
                icon("info", { size: 16 }),
                " A manager has to approve this order before it is fulfilled. You will be notified.",
              )
            : null,
          h(
            "div",
            { class: "w-kit-actions" },
            linkButton({
              href: nav.href(`/store/orders/${o.order_id}`),
              label: "View order",
              variant: "primary",
            }),
            linkButton({ href: nav.href("/store"), label: "Keep shopping", variant: "secondary" }),
            button({
              label: "Back to cart",
              variant: "ghost",
              onClick: () => ((state.view = "lines"), (state.placed = null), draw()),
            }),
          ),
        ),
      );
    }

    // ---- drawing ----
    function draw(opts = {}) {
      const active = opts.keepFocusOn ? root.contains(document.activeElement) : false;
      clear(root);
      lineEls.clear();
      if (!state.cart) return;
      if (!flow) {
        drawCompact();
        return;
      }
      if (state.view !== "placed" && state.cart.lines.length > 0) root.append(stepper());
      if (state.view === "lines") drawLines(opts);
      else if (state.view === "delivery") drawDelivery();
      else if (state.view === "confirm") drawConfirm();
      else drawPlaced();
      if (opts.focusHeading) root.querySelector("[data-focus]")?.focus();
      else if (opts.focusBanner) root.querySelector("[data-banner]")?.focus();
      else if (opts.keepFocusOn && active)
        lineEls.get(opts.keepFocusOn)?.querySelector("[data-act=qty] input")?.focus();
    }

    // ---- realtime ----
    life.add(
      rt.on("cart.updated", () => {
        if (Date.now() > mutedUntil && state.view !== "placed") loadCart({ silent: true });
      }),
    );
    life.add(
      rt.on("stock.changed", (ev) => {
        if (state.cart?.lines.some((l) => l.product.slug === ev.payload.product) && state.view !== "placed")
          loadCart({ silent: true });
      }),
    );
    life.add(
      rt.on("points.posted", (ev) => {
        const p = ev.payload;
        if (!p.member || p.member !== me?.handle || !state.cart) return;
        state.cart = { ...state.cart, balance: p.balance };
        if (state.view !== "placed") {
          requoteSoon();
          if (!flow) draw();
        }
      }),
    );
    life.add(
      rt.on("promotion.state_changed", () => {
        if (state.view !== "placed") requoteSoon();
      }),
    );

    loadCart({ initial: true });
    return life.dispose;
  },
};
