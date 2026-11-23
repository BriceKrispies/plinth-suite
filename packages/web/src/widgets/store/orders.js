// store.orders: your orders, or every order for store staff, with status filters and transitions. The order opens
// inside the widget (and is announced on the page bus as order.selected).
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { points, number } from "../../ds/js/format.js";
import { button, linkButton } from "../../ds/js/button.js";
import { searchField } from "../../ds/js/field.js";
import { dataTable } from "../../ds/js/table.js";
import { pill, statusPill, STATUS_VOCABULARIES } from "../../ds/js/pill.js";
import { personChip } from "../../ds/js/avatar.js";
import { emptyState, skeleton } from "../../ds/js/states.js";
import { icon } from "../../ds/js/icons.js";
import {
  disposer,
  reportLoadError,
  inlineError,
  cursorPaging,
  pagerFor,
  markArrived,
  timeEl,
} from "../points/_kit.js";
import { productArt } from "./_shop.js";
import { orderDetailView } from "./_order.js";

const ORDER_STATUSES = ["placed", "approved", "fulfilled", "shipped", "delivered", "cancelled", "refunded"];

export default {
  id: "store.orders",
  domain: "store",
  title: "Orders",
  configSchema: schemaOf("store.orders"),
  sizes: ["m", "l", "xl", "full"],
  mount(el, { config, size, api, rt, bus, nav, ctx }) {
    const life = disposer();
    const root = h("div", { class: `w-store w-store-orders w-store-orders--${size}` });
    el.append(root);
    if (!ctx.can("store:shop")) {
      root.append(emptyState({ icon: "lock", title: "Orders are not available for your role" }));
      return () => {};
    }

    const scope = config.scope === "all" && ctx.can("store:orders") ? "all" : "mine";
    const compactList = size === "m";
    const state = {
      statuses: new Set(config.status ?? []),
      approval: Boolean(config.requires_approval),
      q: "",
      member: null,
      items: [],
      counts: {},
      next: null,
      loaded: false,
      view: "list",
      order: null,
      orderId: null,
      lastSeqs: new Set(),
    };
    const paging = cursorPaging();
    const pageSize = config.page_size ?? 15;
    let seq = 0;
    let arrived = new Set();

    const listView = h("div", { class: "w-store-orders__list" });
    const orderView = h("div", { class: "w-store-orders__order", hidden: true });
    root.append(listView, orderView);

    const searchBox = searchField({
      name: "q",
      label: scope === "all" ? "Search orders" : "Search your orders",
      placeholder: scope === "all" ? "Order number or member" : "Order number",
      onInput: (v) => {
        state.q = v.trim();
        soon();
      },
    });
    const soon = life.debounce(() => {
      paging.reset();
      load();
    }, 250);
    const filtersHost = h("div", { class: "w-store-orders__filters" });
    const tableHost = h("div", { class: "w-store-orders__table" });
    const pagerHost = h("div", {});
    listView.append(
      h("div", { class: "w-kit-toolbar w-store-orders__toolbar" }, searchBox),
      filtersHost,
      tableHost,
      pagerHost,
    );

    // ---- data ----
    const load = async ({ initial = false, silent = false } = {}) => {
      const mine = ++seq;
      if (!silent && !state.loaded) {
        clear(tableHost);
        tableHost.append(skeleton({ shape: "table", lines: compactList ? 2 : 5 }));
      }
      try {
        const res = await api.call("orders.list", {
          scope,
          limit: pageSize,
          ...(state.statuses.size ? { status: [...state.statuses] } : {}),
          ...(state.approval ? { requires_approval: true } : {}),
          ...(state.q ? { q: state.q } : {}),
          ...(state.member ? { member: state.member } : {}),
          ...(paging.current() ? { cursor: paging.current() } : {}),
        });
        if (life.done || mine !== seq) return;
        const known = new Set(state.items.map((o) => o.order_id));
        arrived = silent
          ? new Set(res.items.filter((o) => !known.has(o.order_id)).map((o) => o.order_id))
          : new Set();
        state.items = res.items;
        state.next = res.next_cursor;
        state.counts = res.status_counts ?? {};
        state.loaded = true;
        ctx.setState("ready");
        ctx.setCount(res.items.length);
        drawFilters();
        drawList();
        if (arrived.size) ctx.announce(`${arrived.size} new ${arrived.size === 1 ? "order" : "orders"}`);
      } catch (e) {
        if (life.done || mine !== seq) return;
        reportLoadError({
          ctx,
          host: tableHost,
          error: e,
          retry: () => load({ initial: true }),
          initial: initial || !state.loaded,
        });
      }
    };

    // ---- list ----
    function drawFilters() {
      clear(filtersHost);
      const chip = (label, active, onClick) =>
        button({ label, variant: "secondary", size: "sm", pressed: active, onClick });
      const total = Object.values(state.counts).reduce((a, b) => a + b, 0);
      filtersHost.append(
        h(
          "div",
          { class: "w-store-catalog__chiprow", role: "group", "aria-label": "Filter by status" },
          chip(`All (${number(total)})`, state.statuses.size === 0, () => {
            state.statuses = new Set();
            paging.reset();
            load();
          }),
          ...ORDER_STATUSES.filter((s) => state.counts[s] || state.statuses.has(s)).map((s) =>
            chip(
              `${STATUS_VOCABULARIES.order[s].label} (${number(state.counts[s] ?? 0)})`,
              state.statuses.has(s),
              () => {
                if (state.statuses.has(s)) state.statuses.delete(s);
                else state.statuses.add(s);
                paging.reset();
                load();
              },
            ),
          ),
          scope === "all"
            ? chip("Needs approval", state.approval, () => {
                state.approval = !state.approval;
                paging.reset();
                load();
              })
            : null,
        ),
      );
      if (state.member)
        filtersHost.append(
          h(
            "span",
            { class: "c-chip" },
            h("span", {}, `Member: @${state.member}`),
            h(
              "button",
              {
                type: "button",
                class: "c-chip__remove",
                "aria-label": "Remove member filter",
                onclick: () => ((state.member = null), paging.reset(), load()),
              },
              icon("x", { size: 16 }),
            ),
          ),
        );
    }

    const openBtn = (o) =>
      h(
        "button",
        {
          type: "button",
          class: "w-kit-link",
          "aria-label": `Open order ${o.order_no}`,
          onclick: () => openOrder(o.order_id),
        },
        o.order_no,
      );

    function drawList() {
      clear(tableHost);
      clear(pagerHost);
      const filtered = state.statuses.size || state.q || state.approval || state.member;
      const empty = emptyState({
        icon: "box",
        title: filtered ? "No orders match" : scope === "all" ? "No orders yet" : "You have not ordered yet",
        body: filtered
          ? "Try another status or search."
          : scope === "all"
            ? "Orders placed by members will show up here."
            : "Spend your points in the store.",
        action: filtered
          ? button({
              label: "Clear filters",
              variant: "secondary",
              onClick: () => (
                (state.statuses = new Set()),
                (state.q = ""),
                (state.approval = false),
                (state.member = null),
                (searchBox.querySelector("input").value = ""),
                paging.reset(),
                load()
              ),
            })
          : linkButton({ href: nav.href("/store"), label: "Browse the store", variant: "primary" }),
      });
      if (state.items.length === 0) {
        tableHost.append(empty);
        if (paging.canPrev())
          pagerHost.append(pagerFor(paging, null, { label: "Order pages", onChange: () => load() }));
        return;
      }
      if (compactList) {
        tableHost.append(
          h(
            "ul",
            { class: "w-store-orders__rows", "aria-label": "Orders" },
            ...state.items.map((o) => {
              const li = h(
                "li",
                { "data-key": o.order_id },
                h(
                  "span",
                  { class: "w-store-order__item" },
                  productArt({ title: o.first_item.title, artwork: o.first_item.artwork }, 40),
                  h(
                    "span",
                    {},
                    openBtn(o),
                    h(
                      "span",
                      { class: "u-muted w-kit-small" },
                      ` ${o.first_item.title}${o.item_count > 1 ? ` +${o.item_count - 1}` : ""}`,
                    ),
                  ),
                ),
                h("span", { class: "u-tabular" }, points(o.total_points)),
                statusPill("order", o.status),
                h("span", { class: "w-kit-new-slot" }),
              );
              if (arrived.has(o.order_id)) markArrived(life, li, li.querySelector(".w-kit-new-slot"));
              return li;
            }),
          ),
        );
      } else {
        const columns = [
          {
            key: "order_no",
            label: "Order",
            render: (o) =>
              h("span", { class: "w-kit-when" }, openBtn(o), h("span", { class: "w-kit-new-slot" })),
          },
          scope === "all" ? { key: "member", label: "Member", render: (o) => personChip(o.member) } : null,
          { key: "placed_at", label: "Placed", render: (o) => timeEl(o.placed_at) },
          {
            key: "first_item",
            label: "Items",
            render: (o) =>
              h(
                "span",
                { class: "w-store-order__item" },
                productArt({ title: o.first_item.title, artwork: o.first_item.artwork }, 32),
                h(
                  "span",
                  {},
                  o.first_item.title,
                  o.item_count > 1 ? h("span", { class: "u-muted" }, ` +${o.item_count - 1} more`) : null,
                ),
              ),
          },
          { key: "total_points", label: "Total", align: "end", render: (o) => points(o.total_points) },
          {
            key: "status",
            label: "Status",
            render: (o) =>
              h(
                "span",
                { class: "w-kit-pills" },
                statusPill("order", o.status),
                o.requires_approval && o.status === "placed"
                  ? pill({ label: "Needs approval", tone: "warning", icon: "clock" })
                  : null,
              ),
          },
        ].filter(Boolean);
        const table = dataTable({
          caption: scope === "all" ? "All orders" : "Your orders",
          columns,
          rows: state.items,
          rowKey: "order_id",
          density: "compact",
          onRowClick: (o) => openOrder(o.order_id),
        });
        for (const tr of table.querySelectorAll("tbody tr[data-key]"))
          if (arrived.has(tr.dataset.key)) markArrived(life, tr, tr.querySelector(".w-kit-new-slot"));
        tableHost.append(table);
      }
      pagerHost.append(pagerFor(paging, state.next, { label: "Order pages", onChange: () => load() }));
    }

    // ---- order view ----
    async function openOrder(id, { silent = false, newSeqs } = {}) {
      state.view = "order";
      state.orderId = id;
      listView.hidden = true;
      orderView.hidden = false;
      if (!silent) {
        clear(orderView);
        orderView.append(skeleton({ lines: 5 }));
        bus.publish("order.selected", { id });
      }
      try {
        const o = await api.call("orders.get", { order_id: id });
        if (life.done || state.orderId !== id) return;
        const prev = state.lastSeqs;
        state.order = o;
        state.lastSeqs = new Set(o.events.map((e) => e.seq));
        const arrivedSeqs =
          newSeqs ?? (silent ? new Set([...state.lastSeqs].filter((s) => !prev.has(s))) : undefined);
        drawOrder({ focus: !silent, arrivedSeqs });
      } catch (e) {
        if (life.done) return;
        clear(orderView);
        inlineError(orderView, e, () => openOrder(id));
        orderView.prepend(
          h(
            "div",
            { class: "w-kit-head" },
            button({
              label: "Back to orders",
              icon: "chevron-left",
              variant: "ghost",
              size: "sm",
              onClick: backToList,
            }),
          ),
        );
      }
    }

    function drawOrder({ focus, arrivedSeqs }) {
      clear(orderView);
      orderView.append(
        orderDetailView({
          order: state.order,
          api,
          ctx,
          life,
          arrivedSeqs,
          onBack: backToList,
          onUpdated: (res) => {
            if (res) {
              const before = state.lastSeqs;
              state.order = res;
              state.lastSeqs = new Set(res.events.map((e) => e.seq));
              drawOrder({
                focus: false,
                arrivedSeqs: new Set([...state.lastSeqs].filter((s) => !before.has(s))),
              });
            } else openOrder(state.orderId, { silent: true });
          },
        }),
      );
      if (focus) orderView.querySelector("[data-focus]")?.focus();
    }

    function backToList() {
      const id = state.orderId;
      state.view = "list";
      state.order = null;
      state.orderId = null;
      orderView.hidden = true;
      listView.hidden = false;
      load({ silent: true });
      listView.querySelector(`[data-key="${id}"] .w-kit-link`)?.focus();
    }

    // ---- realtime and bus ----
    const refresh = life.debounce(() => {
      if (state.view === "list" && !paging.canPrev()) load({ silent: true });
    }, 500);
    life.add(
      rt.on("order.placed", () => {
        refresh();
      }),
    );
    life.add(
      rt.on("order.status_changed", (ev) => {
        const p = ev.payload;
        const row = state.items.find((o) => o.order_id === p.order_id);
        if (row && state.view === "list") {
          state.items = state.items.map((o) => (o.order_id === p.order_id ? { ...o, status: p.to } : o));
          arrived = new Set([p.order_id]);
          drawList();
          refresh();
        }
        if (state.view === "order" && state.orderId === p.order_id) openOrder(p.order_id, { silent: true });
      }),
    );
    life.add(
      bus.subscribe("member.selected", (p) => {
        if (scope !== "all" || !p?.id) return;
        state.member = p.id;
        if (state.view === "order") {
          state.view = "list";
          orderView.hidden = true;
          listView.hidden = false;
        }
        paging.reset();
        load();
      }),
    );
    load({ initial: true });
    return life.dispose;
  },
};
