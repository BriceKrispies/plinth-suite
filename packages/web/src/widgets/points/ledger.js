// points.ledger: the statement with filters, opening and closing balances, and transaction detail inside the widget.
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { points, signedPoints } from "../../ds/js/format.js";
import { button } from "../../ds/js/button.js";
import { selectField, searchField, checkboxField } from "../../ds/js/field.js";
import { popover } from "../../ds/js/popover.js";
import { menuButton } from "../../ds/js/menu.js";
import { emptyState, skeleton } from "../../ds/js/states.js";
import {
  disposer,
  resolveMember,
  reportLoadError,
  inlineError,
  nowIso,
  TXN_TYPES,
  cursorPaging,
  pagerFor,
  downloadText,
  csvCell,
} from "./_kit.js";
import { statementTable, transactionView, counterpartyText } from "./_statement.js";

const RANGES = [
  { value: "all", label: "All time", days: null },
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "90", label: "Last 90 days", days: 90 },
];

export default {
  id: "points.ledger",
  domain: "points",
  title: "Statement",
  configSchema: schemaOf("points.ledger"),
  sizes: ["l", "xl", "full"],
  mount(el, { config, size, api, rt, bus, ctx }) {
    const life = disposer();
    const root = h("div", { class: `w-points w-points-ledger w-points-ledger--${size}` });
    el.append(root);

    if (!ctx.me?.member) {
      root.append(
        emptyState({
          icon: "coins",
          title: "No points account",
          body: "Agents and services do not hold points.",
        }),
      );
      return () => {};
    }

    let who = resolveMember(ctx, config.member ?? "$me");
    const state = {
      types: new Set(config.types ?? []),
      range: "all",
      q: "",
      lines: [],
      stat: null,
      loaded: false,
      loading: false,
      view: "lines", // "lines" | "transaction"
      txnTrail: [], // the stack of opened transactions, newest last
      txn: null,
      txnLoading: false,
    };
    const paging = cursorPaging();
    const pageSize = config.page_size ?? 25;
    let arrived = new Set();
    let seq = 0;

    const listHost = h("div", { class: "w-points-ledger__list", "aria-live": "off" });
    const summaryHost = h("div", { class: "w-points-ledger__summary" });
    const pagerHost = h("div", { class: "w-points-ledger__pager" });
    const detailHost = h("div", { class: "w-points-ledger__detail" });

    const fromIso = () => {
      const r = RANGES.find((x) => x.value === state.range);
      if (!r?.days) return undefined;
      return new Date(new Date(nowIso()).getTime() - r.days * 86400000).toISOString();
    };

    // ---- toolbar ----
    const typeButton = button({
      label: "Types",
      icon: "filter",
      variant: "secondary",
      size: "md",
      onClick: () => {
        const boxes = checkboxField({
          name: "/types",
          label: "Transaction types",
          options: Object.entries(TXN_TYPES).map(([value, [label]]) => ({ value, label })),
          value: [...state.types],
          onChange: (vals) => {
            state.types = new Set(vals);
            refreshTypeLabel();
            paging.reset();
            load();
          },
        });
        const clearBtn = button({
          label: "Show all types",
          variant: "ghost",
          size: "sm",
          onClick: () => {
            state.types = new Set();
            for (const i of boxes.querySelectorAll("input")) i.checked = false;
            refreshTypeLabel();
            paging.reset();
            load();
          },
        });
        popover(
          typeButton,
          h(
            "div",
            {
              class: "w-points-ledger__pop",
              "data-widget-domain": "points",
              "aria-label": "Filter by transaction type",
            },
            boxes,
            clearBtn,
          ),
          {
            label: "Filter by transaction type",
          },
        );
      },
    });
    const refreshTypeLabel = () => {
      const label = typeButton.querySelector(".c-button__label");
      if (label) label.textContent = state.types.size ? `Types (${state.types.size})` : "Types";
    };
    refreshTypeLabel();

    const exportMenu = menuButton({
      label: "Export",
      icon: "external",
      variant: "secondary",
      items: [
        {
          label: "Download loaded lines (CSV)",
          icon: "list",
          onSelect: () => {
            const rows = [["Transaction", "When", "Type", "Memo", "With", "Amount", "Balance after"]];
            for (const l of state.lines)
              rows.push([
                l.txn_no,
                l.occurred_at,
                l.txn_type,
                l.memo,
                counterpartyText(l.counterparty),
                l.amount,
                l.balance_after,
              ]);
            downloadText("statement.csv", rows.map((r) => r.map(csvCell).join(",")).join("\n"));
            ctx.toast({
              title: "Statement downloaded",
              body: `${state.lines.length} lines`,
              tone: "success",
            });
          },
        },
      ],
    });

    const toolbar = h(
      "div",
      { class: "w-kit-toolbar", role: "group", "aria-label": "Statement filters" },
      searchField({
        name: "q",
        label: "Search these lines",
        placeholder: "Memo, person, reference",
        onInput: (v) => {
          state.q = v.trim().toLowerCase();
          drawList();
        },
      }),
      selectField({
        name: "range",
        label: "Period",
        value: state.range,
        options: RANGES.map((r) => ({ value: r.value, label: r.label })),
        onChange: (v) => {
          state.range = v;
          paging.reset();
          load();
        },
      }),
      h("div", { class: "w-kit-toolbar__buttons" }, typeButton, exportMenu),
    );

    // ---- data ----
    const load = async ({ initial = false, silent = false } = {}) => {
      const mine = ++seq;
      state.loading = true;
      if (!silent) {
        listHost.setAttribute("aria-busy", "true");
        if (!state.loaded) {
          clear(listHost);
          listHost.append(skeleton({ shape: "table", lines: 4 }));
        }
      }
      try {
        const input = {
          limit: pageSize,
          ...(who.arg ? { member: who.arg } : {}),
          ...(state.types.size ? { types: [...state.types] } : {}),
          ...(fromIso() ? { from: fromIso() } : {}),
          ...(paging.current() ? { cursor: paging.current() } : {}),
        };
        const res = await api.call("points.statement", input);
        if (life.done || mine !== seq) return;
        const previous = new Set(state.lines.map((l) => l.txn_id));
        state.lines = res.items;
        state.stat = res;
        state.next = res.next_cursor;
        state.loaded = true;
        arrived = silent
          ? new Set(res.items.filter((l) => !previous.has(l.txn_id)).map((l) => l.txn_id))
          : new Set();
        ctx.setState("ready");
        ctx.setCount(res.items.length);
        drawSummary();
        drawList();
        if (arrived.size)
          ctx.announce(`${arrived.size} new ${arrived.size === 1 ? "transaction" : "transactions"}`);
      } catch (e) {
        if (life.done || mine !== seq) return;
        reportLoadError({
          ctx,
          host: listHost,
          error: e,
          retry: () => load({ initial: true }),
          initial: initial || !state.loaded,
        });
      } finally {
        if (mine === seq) {
          state.loading = false;
          listHost.removeAttribute("aria-busy");
        }
      }
    };

    const drawSummary = () => {
      clear(summaryHost);
      const s = state.stat;
      if (!s) return;
      const cell = (label, value, cls = "") =>
        h(
          "div",
          { class: `w-points-ledger__sum ${cls}`.trim() },
          h("p", { class: "u-caps" }, label),
          h("p", { class: "w-points-ledger__sumval u-tabular" }, value),
        );
      summaryHost.append(
        cell("Opening", points(s.opening_balance)),
        cell("Credits", signedPoints(s.credits), "is-credit"),
        cell("Debits", signedPoints(-Math.abs(s.debits)), "is-debit"),
        cell("Closing", points(s.closing_balance)),
      );
    };

    const matches = (l) => {
      if (!state.q) return true;
      const hay = [l.memo, counterpartyText(l.counterparty), l.ref?.label, l.txn_type, String(l.txn_no)]
        .join(" ")
        .toLowerCase();
      return hay.includes(state.q);
    };

    const drawList = () => {
      clear(listHost);
      clear(pagerHost);
      const rows = state.lines.filter(matches);
      let empty;
      if (state.lines.length === 0) {
        empty = emptyState({
          icon: "coins",
          title:
            state.types.size || state.range !== "all"
              ? "No transactions match the filters"
              : "No transactions yet",
          body:
            state.types.size || state.range !== "all"
              ? "Try a longer period or fewer types."
              : "Earning, spending and transfers will appear here.",
          action:
            state.types.size || state.range !== "all"
              ? button({
                  label: "Clear filters",
                  variant: "secondary",
                  onClick: () => {
                    state.types = new Set();
                    state.range = "all";
                    const sel = toolbar.querySelector("select");
                    if (sel) sel.value = "all";
                    refreshTypeLabel();
                    paging.reset();
                    load();
                  },
                })
              : null,
        });
      } else if (rows.length === 0) {
        empty = emptyState({
          icon: "search",
          title: `No lines match "${state.q}"`,
          body: "Search covers the lines on this page only.",
        });
      }
      listHost.append(
        statementTable({
          lines: rows,
          caption: who.mine ? "Your statement" : "Statement",
          onOpen: (l) => openTxn(l.txn_id),
          arrived,
          life,
          empty,
          compact: size === "l",
        }),
      );
      if (state.lines.length > 0 || paging.canPrev())
        pagerHost.append(
          pagerFor(paging, state.next ?? null, { label: "Statement pages", onChange: () => load() }),
        );
    };

    // ---- transaction view ----
    const openTxn = async (txnId, { push = true } = {}) => {
      if (push) state.txnTrail.push(txnId);
      state.view = "transaction";
      state.txn = null;
      state.txnLoading = true;
      showView();
      try {
        const d = await api.call("points.transaction", { txn_id: txnId });
        if (life.done || state.txnTrail[state.txnTrail.length - 1] !== txnId) return;
        state.txn = d;
        state.txnLoading = false;
        if (d.ref?.kind === "order") bus.publish("order.selected", { id: d.ref.id });
        showView(true);
      } catch (e) {
        if (life.done) return;
        state.txnLoading = false;
        clear(detailHost);
        inlineError(detailHost, e, () => openTxn(txnId, { push: false }));
        detailHost.prepend(
          h(
            "div",
            { class: "w-kit-head" },
            button({
              label: "Back to statement",
              icon: "chevron-left",
              variant: "ghost",
              size: "sm",
              onClick: backToLines,
            }),
          ),
        );
      }
    };

    const backToLines = () => {
      state.view = "lines";
      state.txn = null;
      state.txnTrail = [];
      showView();
      listHost.querySelector(".w-kit-link")?.focus();
      load({ silent: true });
    };

    const showView = (focusTitle = false) => {
      const lines = state.view === "lines";
      toolbar.hidden = !lines;
      summaryHost.hidden = !lines;
      listHost.hidden = !lines;
      pagerHost.hidden = !lines;
      detailHost.hidden = lines;
      clear(detailHost);
      if (lines) return;
      if (!state.txn) {
        detailHost.append(h("p", { class: "u-muted" }, "Loading transaction"), skeleton({ lines: 4 }));
        return;
      }
      detailHost.append(
        transactionView({
          detail: state.txn,
          backLabel: state.txnTrail.length > 1 ? "Back" : "Back to statement",
          onBack: () => {
            if (state.txnTrail.length > 1) {
              state.txnTrail.pop();
              openTxn(state.txnTrail[state.txnTrail.length - 1], { push: false });
            } else backToLines();
          },
          onOpenTxn: (id) => openTxn(id),
          reverse: null,
        }),
      );
      if (focusTitle) detailHost.querySelector("[data-focus]")?.focus();
    };

    root.append(summaryHost, toolbar, listHost, pagerHost, detailHost);
    detailHost.hidden = true;

    // ---- realtime and bus ----
    const refresh = life.debounce(() => {
      if (state.view === "lines" && !paging.canPrev() && !state.q) load({ silent: true });
    }, 500);
    life.add(
      rt.on("points.posted", (ev) => {
        const p = ev.payload;
        if (!p.member || p.member !== who.handle) return;
        refresh();
      }),
    );
    life.add(
      bus.subscribe("member.selected", (p) => {
        const handle = p?.id;
        if (!handle || handle === who.handle) return;
        who = resolveMember(ctx, handle);
        state.loaded = false;
        state.lines = [];
        paging.reset();
        state.view = "lines";
        showView();
        ctx.setTitle(who.mine ? "Statement" : `Statement for @${handle}`);
        load({ initial: true });
      }),
    );
    life.add(() => (detailHost.hidden = true));

    load({ initial: true });
    return life.dispose;
  },
};
