// The order detail shared by store.orders (its "order" view) and store.order: lines, promotions, delivery,
// timeline and the transitions the server says are allowed, each with a note and a confirmation.
import { h, clear } from "../../ds/js/dom.js";
import { points, cents, dateTime, number } from "../../ds/js/format.js";
import { button } from "../../ds/js/button.js";
import { pill, statusPill, STATUS_VOCABULARIES } from "../../ds/js/pill.js";
import { personChip } from "../../ds/js/avatar.js";
import { dataTable } from "../../ds/js/table.js";
import { timeline } from "../../ds/js/timeline.js";
import { textArea, checkboxField } from "../../ds/js/field.js";
import { icon } from "../../ds/js/icons.js";
import {
  nowIso,
  kv,
  dl,
  sectionHead,
  markArrived,
  withBusy,
  showFormError,
  myHandle,
} from "../points/_kit.js";
import { productArt, productHref } from "./_shop.js";
import { FULFILMENT } from "./_detail.js";

const ORDER_ICON = {
  placed: "box",
  approved: "check",
  fulfilled: "box",
  shipped: "truck",
  delivered: "check-circle",
  cancelled: "x",
  refunded: "history",
};
const EFFECTS = {
  points_multiplier: "Points multiplier",
  bonus_points: "Bonus points",
  store_discount: "Store discount",
  free_item: "Free item",
};

export const TRANSITIONS = {
  approve: { label: "Approve", variant: "primary", icon: "check", done: "Order approved", danger: false },
  fulfil: {
    label: "Mark fulfilled",
    variant: "primary",
    icon: "box",
    done: "Order fulfilled",
    danger: false,
  },
  ship: { label: "Mark shipped", variant: "primary", icon: "truck", done: "Order shipped", danger: false },
  deliver: {
    label: "Mark delivered",
    variant: "primary",
    icon: "check-circle",
    done: "Order delivered",
    danger: false,
  },
  cancel: { label: "Cancel order", variant: "danger", icon: "x", done: "Order cancelled", danger: true },
  refund: { label: "Refund order", variant: "danger", icon: "history", done: "Order refunded", danger: true },
};

export const deliveryText = (d) => {
  if (!d) return "";
  if (d.method === "ship" && d.address) {
    const a = d.address;
    return [a.name, a.line1, a.line2, `${a.city} ${a.postal_code}`, a.country]
      .filter((x) => x && String(x).trim())
      .join(", ");
  }
  if (d.method === "pickup") return d.pickup_site ? `Pickup at ${d.pickup_site}` : "Pickup";
  return FULFILMENT[d.method] ?? d.method;
};

/**
 * `order` is an OrderDetailOut. Options: `api`, `ctx`, `life`, `onUpdated(order)` after a transition,
 * `onBack` and `backLabel` (omit for no back button), `arrivedSeqs` (a Set of event seqs to mark as new).
 */
export const orderDetailView = ({
  order: o,
  api,
  ctx,
  onUpdated,
  onBack,
  backLabel = "Back to orders",
  arrivedSeqs,
  life,
}) => {
  const root = h("div", { class: "w-store-order" });
  const mine = o.member?.handle === myHandle();

  const head = h(
    "div",
    { class: "w-store-order__head" },
    onBack
      ? button({ label: backLabel, icon: "chevron-left", variant: "ghost", size: "sm", onClick: onBack })
      : null,
    h(
      "div",
      { class: "w-kit-titlerow" },
      h("h3", { class: "w-kit-title", tabindex: "-1", "data-focus": "" }, `Order ${o.order_no}`),
      statusPill("order", o.status),
      o.requires_approval && o.status === "placed"
        ? pill({ label: "Needs approval", tone: "warning", icon: "clock" })
        : null,
    ),
    h(
      "p",
      { class: "u-muted" },
      `Placed ${dateTime(o.placed_at)}`,
      mine ? "" : " by ",
      mine ? null : personChip(o.member),
      ` · ${o.region}`,
    ),
  );
  root.append(head);

  // ---- transitions ----
  const panelHost = h("div", { class: "w-store-order__panel" });
  const open = (t) => {
    const spec = TRANSITIONS[t] ?? { label: t, variant: "secondary", danger: false, done: "Order updated" };
    clear(panelHost);
    let note = "";
    let restock = t === "cancel";
    const form = h("form", { class: "w-kit-form", novalidate: true });
    const go = button({ label: spec.label, variant: spec.variant, icon: spec.icon, type: "submit" });
    form.append(
      h("p", { class: "u-caps" }, spec.label),
      textArea({
        name: "/note",
        label: "Note",
        rows: 2,
        hint: "Optional, up to 280 characters. Shown in the order timeline.",
        onInput: (v) => (note = v),
      }),
      ...[
        t === "cancel" || t === "refund"
          ? checkboxField({
              name: "/restock",
              label: "Return the items to stock",
              value: restock,
              onChange: (v) => (restock = v),
            })
          : null,
      ].filter(Boolean),
      ...[
        t === "cancel"
          ? h("p", { class: "u-muted w-kit-small" }, "The points are refunded to the member.")
          : null,
      ].filter(Boolean),
      ...[
        t === "refund"
          ? h(
              "p",
              { class: "u-muted w-kit-small" },
              "The points are refunded and any bonus credited for this order is reversed.",
            )
          : null,
      ].filter(Boolean),
      h(
        "div",
        { class: "w-kit-actions" },
        button({ label: "Not now", variant: "secondary", onClick: () => clear(panelHost) }),
        go,
      ),
    );
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (note.length > 280)
        return showFormError(form, {
          code: "VALIDATION_FAILED",
          path: "/note",
          message: "Use at most 280 characters",
        });
      if (spec.danger) {
        const ok = await ctx.confirm({
          title: `${spec.label}?`,
          message: `${o.order_no} will be ${t === "cancel" ? "cancelled" : "refunded"}.${restock ? " Items return to stock." : ""}`,
          confirmLabel: spec.label,
          tone: "danger",
        });
        if (!ok) return;
      }
      await withBusy(go, async () => {
        try {
          const res = await api.call("orders.transition", {
            order_id: o.order_id,
            transition: t,
            ...(note.trim() ? { note: note.trim() } : {}),
            ...(t === "cancel" || t === "refund" ? { restock } : {}),
            idempotency_key: api.idempotencyKey(`order-${t}`),
          });
          ctx.toast({ title: spec.done, body: o.order_no, tone: "success" });
          ctx.announce(`${spec.done}`);
          onUpdated?.(res);
        } catch (err) {
          const reason = err?.details?.reason;
          showFormError(form, err, { INVALID_TRANSITION: "/note", SELF_ACTION: "/note" });
          if (reason === "INVALID_TRANSITION") onUpdated?.(null);
        }
      });
    });
    panelHost.append(form);
    form.querySelector("textarea")?.focus();
  };

  const allowed = (o.allowed_transitions ?? []).filter((t) => TRANSITIONS[t]);
  if (allowed.length) {
    root.append(
      h(
        "div",
        { class: "w-kit-actions", role: "group", "aria-label": "Order actions" },
        ...allowed.map((t) => {
          const spec = TRANSITIONS[t];
          return button({
            label: spec.label,
            icon: spec.icon,
            variant: spec.variant,
            size: "sm",
            onClick: () => open(t),
          });
        }),
      ),
      panelHost,
    );
  }
  if (o.cancel_deadline && allowed.includes("cancel") && mine)
    root.append(
      h(
        "p",
        { class: "u-muted w-kit-small" },
        icon("clock", { size: 16 }),
        ` You can cancel until ${dateTime(o.cancel_deadline)}.`,
      ),
    );

  // ---- lines ----
  root.append(
    sectionHead("Items"),
    dataTable({
      caption: `Items in ${o.order_no}`,
      density: "compact",
      rows: o.items,
      rowKey: "line",
      columns: [
        {
          key: "title",
          label: "Item",
          render: (r) =>
            h(
              "span",
              { class: "w-store-order__item" },
              productArt({ title: r.title, artwork: r.artwork }, 40),
              h("a", { href: productHref(r.product) }, r.title),
              r.free_item ? pill({ label: "Free item", tone: "signal", icon: "gift" }) : null,
            ),
        },
        { key: "qty", label: "Qty", align: "end", render: (r) => number(r.qty) },
        { key: "unit_points", label: "Unit", align: "end", render: (r) => points(r.unit_points) },
        {
          key: "discount_points",
          label: "Discount",
          align: "end",
          render: (r) => (r.discount_points ? `−${points(r.discount_points)}` : "–"),
        },
        { key: "line_points", label: "Line", align: "end", render: (r) => points(r.line_points) },
      ],
    }),
    dl(
      [
        kv("Subtotal", points(o.subtotal_points)),
        o.discount_points ? kv("Discounts", `−${points(o.discount_points)}`) : null,
        kv("Total", h("strong", { class: "u-tabular" }, points(o.total_points))),
        o.cash_cents ? kv("Cash", cents(o.cash_cents)) : null,
        o.bonus_points ? kv("Bonus on delivery", `+${points(o.bonus_points)}`) : null,
      ].filter(Boolean),
    ),
  );

  if (o.promotions.length) {
    root.append(
      sectionHead("Promotions applied"),
      h(
        "ul",
        { class: "w-store-cart__promos", "aria-label": "Applied promotions" },
        ...o.promotions.map((p) =>
          h(
            "li",
            {},
            pill({ label: p.title, tone: "signal", icon: "percent" }),
            h(
              "span",
              { class: "u-muted w-kit-small" },
              p.effects
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
  }

  root.append(
    sectionHead("Delivery"),
    dl([kv("Method", deliveryText(o.delivery)), o.notes ? kv("Notes", o.notes) : null].filter(Boolean)),
  );

  // ---- timeline ----
  const events = [...o.events].sort((a, b) => b.seq - a.seq);
  const tl = timeline({
    label: `History of ${o.order_no}`,
    now: nowIso(),
    items: events.map((ev) => {
      const entry = STATUS_VOCABULARIES.order[ev.to];
      return {
        at: ev.at,
        icon: ORDER_ICON[ev.to] ?? "history",
        tone: entry?.tone ?? "neutral",
        title: entry?.label ?? ev.to,
        body: ev.note ?? undefined,
        actor: ev.actor,
      };
    }),
  });
  root.append(sectionHead("History"), tl);
  if (arrivedSeqs?.size && life) {
    [...tl.children].forEach((li, i) => {
      if (arrivedSeqs.has(events[i].seq)) markArrived(life, li, li.querySelector(".c-timeline__meta"));
    });
  }

  const refs = [
    o.ledger_txn_id ? kv("Purchase transaction", h("code", { class: "w-kit-code" }, o.ledger_txn_id)) : null,
    o.refund_txn_id ? kv("Refund transaction", h("code", { class: "w-kit-code" }, o.refund_txn_id)) : null,
    o.bonus_txn_id ? kv("Bonus transaction", h("code", { class: "w-kit-code" }, o.bonus_txn_id)) : null,
  ].filter(Boolean);
  if (refs.length) root.append(sectionHead("Ledger"), dl(refs));
  return root;
};
