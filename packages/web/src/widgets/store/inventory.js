// store.inventory: stock levels with low and out filters, restock and corrections in a drawer with a live preview.
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { scoped } from "../reporting/_common.js";
import { number } from "../../ds/js/format.js";
import { button } from "../../ds/js/button.js";
import { searchField, numberField, selectField, textField, formErrors } from "../../ds/js/field.js";
import { dataTable } from "../../ds/js/table.js";
import { statusPill } from "../../ds/js/pill.js";
import { emptyState, skeleton } from "../../ds/js/states.js";
import { icon } from "../../ds/js/icons.js";
import {
  disposer,
  reportLoadError,
  cursorPaging,
  pagerFor,
  markArrived,
  timeEl,
  messageOf,
  withBusy,
  kv,
  dl,
} from "../points/_kit.js";
import { productHref } from "./_shop.js";

const STATUS_CHIPS = [
  ["all", "All"],
  ["in_stock", "In stock"],
  ["low", "Low stock"],
  ["out", "Out of stock"],
];
const REASONS = [
  { value: "restock", label: "Restock (delivery received)" },
  { value: "count_correction", label: "Count correction" },
  { value: "damage", label: "Damaged or lost" },
  { value: "return", label: "Customer return" },
];
const QUICK = [10, 25, 50, -1, -5];

const statusFor = (row, onHand) =>
  onHand <= 0 ? "out" : onHand <= row.low_stock_threshold ? "low" : "in_stock";

export default {
  id: "store.inventory",
  domain: "store",
  title: "Inventory",
  configSchema: schemaOf("store.inventory"),
  sizes: ["l", "xl", "full"],
  mount(el, { config, size, api, rt, bus, ctx }) {
    const life = disposer();
    const root = h("div", { class: `w-store w-store-inventory w-store-inventory--${size}` });
    el.append(root);
    if (!ctx.can("store:inventory")) {
      root.append(emptyState({ icon: "lock", title: "Inventory is for store staff" }));
      return () => {};
    }
    const state = {
      status: config.status ?? "all",
      q: "",
      sort: { key: "on_hand", dir: "ascending" },
      items: [],
      next: null,
      loaded: false,
    };
    const paging = cursorPaging();
    let seq = 0;
    let arrived = new Set();
    let drawerState = null; // { slug, setRow(row) }
    const openDrawers = new Set();

    const chipsHost = h("div", { class: "w-store-inventory__chips" });
    const summaryHost = h("p", { class: "u-muted w-kit-small", role: "status" });
    const tableHost = h("div", {});
    const pagerHost = h("div", {});
    const search = searchField({
      name: "q",
      label: "Filter this page",
      placeholder: "Product or category",
      onInput: (v) => {
        state.q = v.trim().toLowerCase();
        drawTable();
      },
    });
    root.append(
      h("div", { class: "w-kit-toolbar w-store-inventory__toolbar" }, search),
      chipsHost,
      summaryHost,
      tableHost,
      pagerHost,
    );

    const load = async ({ initial = false, silent = false } = {}) => {
      const mine = ++seq;
      if (!silent && !state.loaded) {
        clear(tableHost);
        tableHost.append(skeleton({ shape: "table", lines: 6 }));
      }
      try {
        const res = await api.call("inventory.list", {
          limit: 25,
          ...(state.status !== "all" ? { status: state.status } : {}),
          ...(paging.current() ? { cursor: paging.current() } : {}),
        });
        if (life.done || mine !== seq) return;
        const old = new Map(state.items.map((r) => [r.product, r.on_hand]));
        arrived = silent
          ? new Set(
              res.items
                .filter((r) => old.has(r.product) && old.get(r.product) !== r.on_hand)
                .map((r) => r.product),
            )
          : new Set();
        state.items = res.items;
        state.next = res.next_cursor;
        state.loaded = true;
        ctx.setState("ready");
        ctx.setCount(res.items.length);
        drawChips();
        drawTable();
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

    function drawChips() {
      clear(chipsHost);
      chipsHost.append(
        h(
          "div",
          { class: "w-store-catalog__chiprow", role: "group", "aria-label": "Filter by stock status" },
          ...STATUS_CHIPS.map(([v, label]) =>
            button({
              label,
              variant: "secondary",
              size: "sm",
              pressed: state.status === v,
              onClick: () => {
                state.status = v;
                paging.reset();
                load();
              },
            }),
          ),
        ),
      );
    }

    const shownRows = () => {
      let rows = state.items;
      if (state.q) rows = rows.filter((r) => `${r.title} ${r.category}`.toLowerCase().includes(state.q));
      const { key, dir } = state.sort ?? {};
      if (key && dir) {
        const sign = dir === "ascending" ? 1 : -1;
        const val = (r) =>
          key === "title" || key === "category"
            ? r[key].toLowerCase()
            : key === "updated_at"
              ? new Date(r.updated_at).getTime()
              : key === "cover"
                ? cover(r)
                : r[key];
        rows = [...rows].sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sign);
      }
      return rows;
    };
    const cover = (r) => (r.sold_30d > 0 ? r.on_hand / (r.sold_30d / 30) : Number.POSITIVE_INFINITY);

    function drawTable() {
      const rows = shownRows();
      const out = state.items.filter((r) => r.stock_status === "out").length;
      const low = state.items.filter((r) => r.stock_status === "low").length;
      summaryHost.textContent = `${state.items.length} on this page: ${out} out of stock, ${low} low`;
      clear(tableHost);
      clear(pagerHost);
      const table = dataTable({
        caption: "Stock levels",
        density: "compact",
        rows,
        rowKey: "product",
        sort: state.sort,
        onSort: (s) => {
          state.sort = s.dir ? s : null;
          drawTable();
        },
        empty: emptyState({
          icon: "tag",
          title: state.q || state.status !== "all" ? "No products match" : "No inventory rows",
          body: state.q ? "The filter covers the rows on this page." : undefined,
        }),
        columns: [
          {
            key: "title",
            label: "Product",
            sortable: true,
            render: (r) =>
              h(
                "span",
                { class: "w-kit-when" },
                h(
                  "button",
                  {
                    type: "button",
                    class: "w-kit-link",
                    "aria-label": `Adjust stock for ${r.title}`,
                    onclick: () => openAdjust(r),
                  },
                  r.title,
                ),
                h("span", { class: "w-kit-new-slot" }),
              ),
          },
          { key: "category", label: "Category", sortable: true, render: (r) => r.category },
          {
            key: "on_hand",
            label: "On hand",
            align: "end",
            sortable: true,
            render: (r) =>
              h(
                "span",
                { class: "w-store-inventory__stock" },
                h("span", { class: "u-tabular" }, number(r.on_hand)),
                statusPill("stock", r.stock_status),
              ),
          },
          {
            key: "low_stock_threshold",
            label: "Low at",
            align: "end",
            render: (r) => number(r.low_stock_threshold),
          },
          {
            key: "sold_30d",
            label: "Sold, 30 days",
            align: "end",
            sortable: true,
            render: (r) => number(r.sold_30d),
          },
          {
            key: "cover",
            label: "Cover",
            align: "end",
            sortable: true,
            render: (r) => (Number.isFinite(cover(r)) ? `~${Math.round(cover(r))} days` : "–"),
          },
          { key: "updated_at", label: "Updated", sortable: true, render: (r) => timeEl(r.updated_at) },
          {
            key: "act",
            label: "Action",
            render: (r) =>
              button({
                label: "Adjust",
                icon: "edit",
                variant: "secondary",
                size: "sm",
                onClick: () => openAdjust(r),
              }),
          },
        ],
      });
      for (const tr of table.querySelectorAll("tbody tr[data-key]"))
        if (arrived.has(tr.dataset.key)) markArrived(life, tr, tr.querySelector(".w-kit-new-slot"));
      tableHost.append(table);
      pagerHost.append(pagerFor(paging, state.next, { label: "Inventory pages", onChange: () => load() }));
      if (arrived.size)
        ctx.announce(`${arrived.size} ${arrived.size === 1 ? "product" : "products"} changed`);
      arrived = new Set();
    }

    // ---- the adjust view (a drawer) ----
    function openAdjust(row0) {
      bus.publish("product.selected", { id: row0.product });
      let row = row0;
      let delta = null;
      let reason = "restock";
      let note = "";
      let key = null;
      let lastBody = null;
      const form = h("form", { class: "w-kit-form", novalidate: true });
      const preview = h("p", { class: "w-store-inventory__preview", role: "status", "aria-live": "polite" });
      const banner = h("div", {});
      const current = h("div", {});

      const paintCurrent = () => {
        clear(current);
        current.append(
          h(
            "p",
            {},
            h("a", { href: productHref(row.product) }, row.title),
            h("span", { class: "u-muted" }, ` · ${row.category}`),
          ),
          dl([
            kv("On hand", h("strong", { class: "u-tabular" }, number(row.on_hand))),
            kv("Status", statusPill("stock", row.stock_status)),
            kv("Low stock at", number(row.low_stock_threshold)),
            kv("Sold, 30 days", number(row.sold_30d)),
          ]),
        );
        paintPreview();
      };
      const paintPreview = () => {
        clear(preview);
        if (!Number.isInteger(delta) || delta === 0) {
          preview.append("Enter a change to see the result.");
          return;
        }
        const after = row.on_hand + delta;
        if (after < 0) {
          preview.append(
            icon("alert", { size: 16 }),
            ` Stock cannot go below zero (it would be ${number(after)}).`,
          );
          return;
        }
        preview.append(
          h("span", { class: "u-tabular" }, `On hand ${number(row.on_hand)} → ${number(after)}`),
          " ",
          statusPill("stock", statusFor(row, after)),
        );
      };

      const setDelta = (v) => {
        delta = v;
        paintPreview();
      };
      form.append(
        h("p", { class: "u-muted w-kit-small" }, "Fields marked * are required"),
        numberField({
          name: "/delta",
          label: "Change in stock",
          required: true,
          step: 1,
          hint: "Use a positive number to add, negative to remove.",
          onInput: setDelta,
        }),
        h(
          "div",
          { class: "w-points-transfer__chips", role: "group", "aria-label": "Quick changes" },
          ...QUICK.map((n) =>
            button({
              label: n > 0 ? `+${n}` : `−${Math.abs(n)}`,
              variant: "secondary",
              size: "sm",
              onClick: () => {
                const input = form.querySelector('[name="/delta"]');
                const next = (Number.isInteger(delta) ? delta : 0) + n;
                input.value = String(next);
                setDelta(next);
                input.focus();
              },
            }),
          ),
        ),
        preview,
        selectField({
          name: "/reason",
          label: "Reason",
          required: true,
          value: reason,
          options: REASONS,
          onChange: (v) => (reason = v),
        }),
        textField({
          name: "/note",
          label: "Note",
          hint: "Optional, shown in the stock history.",
          onInput: (v) => (note = v),
        }),
      );

      const submit = async () => {
        formErrors(null, { form });
        if (!Number.isInteger(delta) || delta === 0) {
          formErrors(
            { code: "VALIDATION_FAILED", path: "/delta", message: "Enter a whole number that is not zero" },
            { form },
          )?.focus();
          return;
        }
        if (row.on_hand + delta < 0) {
          formErrors(
            {
              code: "OUT_OF_STOCK",
              path: "/delta",
              message: `Stock cannot go below zero (on hand ${number(row.on_hand)})`,
            },
            { form },
          )?.focus();
          return;
        }
        const body = JSON.stringify([row.product, delta, reason, note.trim()]);
        if (body !== lastBody || !key) key = api.idempotencyKey("inventory");
        lastBody = body;
        await withBusy(apply, async () => {
          try {
            const res = await api.call("inventory.adjust", {
              slug: row.product,
              delta,
              reason,
              ...(note.trim() ? { note: note.trim() } : {}),
              idempotency_key: key,
            });
            if (life.done) return;
            state.items = state.items.map((r) => (r.product === res.product ? res : r));
            arrived = new Set([res.product]);
            ctx.toast({
              title: "Stock updated",
              body: `${res.title}: ${number(res.on_hand)} on hand`,
              tone: "success",
            });
            ctx.announce(`Stock updated, ${number(res.on_hand)} on hand`);
            drawer.close();
            drawTable();
          } catch (e) {
            const reasonCode = e?.details?.reason;
            formErrors(
              {
                code: e.code ?? "ERROR",
                path: e.path ?? (reasonCode === "OUT_OF_STOCK" ? "/delta" : null),
                message: messageOf(e),
              },
              { form },
            )?.focus();
          }
        });
      };
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        submit();
      });
      const apply = button({ label: "Apply change", variant: "primary", icon: "check", onClick: submit });
      const cancel = button({ label: "Cancel", variant: "secondary", onClick: () => drawer.close() });
      const drawer = ctx.openDrawer({
        title: "Adjust stock",
        width: "sm",
        body: scoped("store", h("div", { class: "w-store-inventory__adjust" }, current, banner, form)),
        footer: h("div", { class: "w-kit-actions" }, cancel, apply),
        onClose: () => {
          openDrawers.delete(drawer);
          if (drawerState?.slug === row0.product) drawerState = null;
          tableHost.querySelector(`tr[data-key="${row0.product}"] button`)?.focus();
        },
      });
      openDrawers.add(drawer);
      drawerState = {
        slug: row0.product,
        setRow: (r) => {
          const changed = r.on_hand !== row.on_hand;
          row = r;
          paintCurrent();
          if (changed) {
            clear(banner);
            banner.append(
              h(
                "p",
                { class: "w-kit-note w-kit-note--warning" },
                icon("alert", { size: 16 }),
                ` Stock changed to ${number(r.on_hand)} while you were adjusting.`,
              ),
            );
          }
        },
      };
      paintCurrent();
    }

    // ---- realtime ----
    life.add(
      rt.on("stock.changed", (ev) => {
        const p = ev.payload;
        const cur = state.items.find((r) => r.product === p.product);
        if (!cur) return;
        const next = { ...cur, on_hand: p.on_hand, stock_status: p.stock_status };
        state.items = state.items.map((r) => (r.product === p.product ? next : r));
        arrived = new Set([p.product]);
        drawTable();
        drawerState?.slug === p.product && drawerState.setRow(next);
      }),
    );
    life.add(() => {
      for (const d of [...openDrawers]) d.close();
    });
    load({ initial: true });
    return life.dispose;
  },
};
