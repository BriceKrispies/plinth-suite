// points.accounts: every ledger account with its balance; open a member account for its statement and any
// transaction, and reverse an award, adjustment or bonus (finance).
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { points, number, signedPoints } from "../../ds/js/format.js";
import { button } from "../../ds/js/button.js";
import { dataTable } from "../../ds/js/table.js";
import { selectField, searchField } from "../../ds/js/field.js";
import { pill } from "../../ds/js/pill.js";
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
} from "./_kit.js";
import { statementTable, transactionView } from "./_statement.js";

const REVERSIBLE = new Set(["award", "adjustment", "promotion_bonus"]);

export default {
  id: "points.accounts",
  domain: "points",
  title: "Ledger accounts",
  configSchema: schemaOf("points.accounts"),
  sizes: ["l", "xl", "full"],
  mount(el, { config, size, api, rt, bus, ctx }) {
    const life = disposer();
    const root = h("div", { class: `w-points w-points-accounts w-points-accounts--${size}` });
    el.append(root);

    const state = {
      view: "accounts", // accounts | statement | transaction
      kind: config.kind ?? "all",
      q: "",
      sort: { key: "balance", dir: "descending" },
      items: [],
      next: null,
      loaded: false,
      member: null, // { handle, person }
      lines: [],
      stat: null,
      stmtNext: null,
      trail: [],
      txn: null,
    };
    const paging = cursorPaging();
    const stmtPaging = cursorPaging();
    let seq = 0;
    let stmtSeq = 0;
    let arrivedAccounts = new Set();
    let arrivedTxns = new Set();
    const listView = h("div", { class: "w-points-accounts__view" });
    const stmtView = h("div", { class: "w-points-accounts__view", hidden: true });
    const txnView = h("div", { class: "w-points-accounts__view", hidden: true });
    root.append(listView, stmtView, txnView);

    const show = (view) => {
      state.view = view;
      listView.hidden = view !== "accounts";
      stmtView.hidden = view !== "statement";
      txnView.hidden = view !== "transaction";
    };

    // ---- accounts ----
    const load = async ({ initial = false, silent = false } = {}) => {
      const mine = ++seq;
      if (!silent && !state.loaded) {
        clear(listView);
        listView.append(skeleton({ shape: "table", lines: 5 }));
      }
      try {
        const res = await api.call("ledger.accounts", {
          limit: 25,
          ...(state.kind !== "all" ? { kind: state.kind } : {}),
          ...(state.q ? { q: state.q } : {}),
          ...(paging.current() ? { cursor: paging.current() } : {}),
        });
        if (life.done || mine !== seq) return;
        const old = new Map(state.items.map((a) => [a.account, a.balance]));
        state.items = res.items;
        state.next = res.next_cursor;
        arrivedAccounts = silent
          ? new Set(
              res.items
                .filter((a) => old.has(a.account) && old.get(a.account) !== a.balance)
                .map((a) => a.account),
            )
          : new Set();
        state.loaded = true;
        ctx.setState("ready");
        ctx.setCount(res.items.length);
        drawAccounts();
      } catch (e) {
        if (life.done || mine !== seq) return;
        reportLoadError({
          ctx,
          host: listView,
          error: e,
          retry: () => load({ initial: true }),
          initial: initial || !state.loaded,
        });
      }
    };

    const sorted = () => {
      const { key, dir } = state.sort ?? {};
      if (!key || !dir) return state.items;
      const val = (a) =>
        key === "last_entry_at" ? (a.last_entry_at ? new Date(a.last_entry_at).getTime() : 0) : a[key];
      const sign = dir === "ascending" ? 1 : -1;
      return [...state.items].sort((a, b) => (val(a) - val(b)) * sign);
    };

    const toolbar = () =>
      h(
        "div",
        { class: "w-kit-toolbar", role: "group", "aria-label": "Account filters" },
        searchField({
          name: "q",
          label: "Search accounts",
          placeholder: "Name or account code",
          value: state.q,
          onChange: (v) => {
            state.q = v.trim();
            paging.reset();
            load();
          },
        }),
        selectField({
          name: "kind",
          label: "Kind",
          value: state.kind,
          options: [
            { value: "all", label: "All accounts" },
            { value: "member", label: "Member accounts" },
            { value: "system", label: "System accounts" },
          ],
          onChange: (v) => {
            state.kind = v;
            paging.reset();
            load();
          },
        }),
      );

    const drawAccounts = () => {
      const focusInSearch =
        listView.contains(document.activeElement) && document.activeElement.type === "search";
      clear(listView);
      listView.append(toolbar());
      const table = dataTable({
        caption: "Ledger accounts (sorted within this page)",
        rows: sorted(),
        rowKey: "account",
        sort: state.sort,
        onSort: (s) => {
          state.sort = s.dir ? s : null;
          drawAccounts();
        },
        empty: emptyState({
          icon: "wallet",
          title: state.q || state.kind !== "all" ? "No accounts match" : "No accounts yet",
        }),
        columns: [
          {
            key: "account",
            label: "Account",
            render: (a) =>
              a.member
                ? h(
                    "span",
                    { class: "w-kit-when" },
                    h(
                      "button",
                      {
                        type: "button",
                        class: "w-kit-link",
                        onclick: () => openMember(a),
                        "aria-label": `Open statement for ${a.member.display_name}`,
                      },
                      personChip(a.member),
                    ),
                    h("span", { class: "w-kit-new-slot" }),
                  )
                : h(
                    "span",
                    { class: "w-kit-when" },
                    h("code", { class: "w-kit-code" }, a.account),
                    h("span", { class: "w-kit-new-slot" }),
                  ),
          },
          {
            key: "kind",
            label: "Holder",
            render: (a) =>
              a.member ? personChip(a.member) : pill({ label: "System", tone: "neutral", icon: "shield" }),
          },
          {
            key: "balance",
            label: "Balance",
            align: "end",
            sortable: true,
            render: (a) => `${a.balance < 0 ? "−" : ""}${points(Math.abs(a.balance))}`,
          },
          {
            key: "lifetime_earned",
            label: "Lifetime earned",
            align: "end",
            sortable: true,
            render: (a) => (a.kind === "member" ? points(a.lifetime_earned) : "–"),
          },
          {
            key: "entries",
            label: "Entries",
            align: "end",
            sortable: true,
            render: (a) => number(a.entries),
          },
          {
            key: "last_entry_at",
            label: "Last entry",
            sortable: true,
            render: (a) => (a.last_entry_at ? timeEl(a.last_entry_at) : "–"),
          },
        ],
      });
      for (const tr of table.querySelectorAll("tbody tr[data-key]")) {
        if (arrivedAccounts.has(tr.dataset.key)) markArrived(life, tr, tr.querySelector(".w-kit-new-slot"));
      }
      listView.append(
        table,
        pagerFor(paging, state.next, { label: "Account pages", onChange: () => load() }),
      );
      if (state.kind !== "member" && state.items.some((a) => a.kind === "system"))
        listView.append(
          h(
            "p",
            { class: "u-muted w-kit-small" },
            icon("info", { size: 16 }),
            " Statements are available for member accounts. System accounts are summarised in the trial balance.",
          ),
        );
      if (focusInSearch) listView.querySelector("input[type=search]")?.focus();
    };

    // ---- statement ----
    const openMember = (a) => {
      state.member = { handle: a.member.handle, person: a.member, account: a };
      state.lines = [];
      state.stat = null;
      stmtPaging.reset();
      bus.publish("member.selected", { id: a.member.handle });
      show("statement");
      loadStatement({ initial: true });
    };

    const loadStatement = async ({ initial = false, silent = false } = {}) => {
      const mine = ++stmtSeq;
      if (!silent) {
        clear(stmtView);
        stmtView.append(skeleton({ shape: "table", lines: 4 }));
      }
      try {
        const res = await api.call("points.statement", {
          member: state.member.handle,
          limit: 25,
          ...(stmtPaging.current() ? { cursor: stmtPaging.current() } : {}),
        });
        if (life.done || mine !== stmtSeq || state.view !== "statement") return;
        const prev = new Set(state.lines.map((l) => l.txn_id));
        arrivedTxns = silent
          ? new Set(res.items.filter((l) => !prev.has(l.txn_id)).map((l) => l.txn_id))
          : new Set();
        state.lines = res.items;
        state.stat = res;
        state.stmtNext = res.next_cursor;
        drawStatement(initial);
      } catch (e) {
        if (life.done || mine !== stmtSeq) return;
        clear(stmtView);
        inlineError(stmtView, e, () => loadStatement({ initial: true }));
        stmtView.prepend(backBar("Back to accounts", backToAccounts));
      }
    };

    const backBar = (label, onClick) =>
      h(
        "div",
        { class: "w-kit-head" },
        button({ label, icon: "chevron-left", variant: "ghost", size: "sm", onClick }),
      );

    const backToAccounts = () => {
      show("accounts");
      load({ silent: true });
      listView.querySelector(".w-kit-link")?.focus();
    };

    const drawStatement = (focus) => {
      clear(stmtView);
      const m = state.member;
      const s = state.stat;
      stmtView.append(
        backBar("Back to accounts", backToAccounts),
        h(
          "div",
          { class: "w-kit-titlerow" },
          h(
            "h3",
            { class: "w-kit-title", tabindex: "-1", "data-focus": "" },
            `Statement for ${m.person.display_name}`,
          ),
          h("span", { class: "u-muted" }, `@${m.handle}`),
        ),
        h(
          "div",
          { class: "w-points-ledger__summary" },
          ...[
            ["Opening", points(s.opening_balance)],
            ["Credits", signedPoints(s.credits)],
            ["Debits", signedPoints(-Math.abs(s.debits))],
            ["Closing", points(s.closing_balance)],
          ].map(([label, value]) =>
            h(
              "div",
              { class: "w-points-ledger__sum" },
              h("p", { class: "u-caps" }, label),
              h("p", { class: "w-points-ledger__sumval u-tabular" }, value),
            ),
          ),
        ),
        statementTable({
          lines: state.lines,
          caption: `Statement for ${m.person.display_name}`,
          onOpen: (l) => openTxn(l.txn_id, { reset: true }),
          arrived: arrivedTxns,
          life,
          compact: size === "l",
          empty: emptyState({ icon: "coins", title: "No transactions yet" }),
        }),
        pagerFor(stmtPaging, state.stmtNext, { label: "Statement pages", onChange: () => loadStatement() }),
      );
      if (arrivedTxns.size)
        ctx.announce(`${arrivedTxns.size} new ${arrivedTxns.size === 1 ? "transaction" : "transactions"}`);
      if (focus) stmtView.querySelector("[data-focus]")?.focus();
    };

    // ---- transaction ----
    const openTxn = async (txnId, { reset = false } = {}) => {
      if (reset) state.trail = [];
      state.trail.push(txnId);
      state.txn = null;
      show("transaction");
      clear(txnView);
      txnView.append(skeleton({ lines: 5 }));
      await readTxn(txnId, true);
    };

    const readTxn = async (txnId, focus) => {
      try {
        const d = await api.call("points.transaction", { txn_id: txnId });
        if (life.done || state.trail[state.trail.length - 1] !== txnId) return;
        state.txn = d;
        drawTxn(focus);
      } catch (e) {
        if (life.done) return;
        clear(txnView);
        inlineError(txnView, e, () => readTxn(txnId, true));
        txnView.prepend(backBar("Back to statement", backFromTxn));
      }
    };

    const backFromTxn = () => {
      if (state.trail.length > 1) {
        state.trail.pop();
        readTxn(state.trail[state.trail.length - 1], true);
        return;
      }
      state.trail = [];
      if (state.member) {
        show("statement");
        loadStatement({ silent: true });
      } else backToAccounts();
    };

    const drawTxn = (focus) => {
      const d = state.txn;
      clear(txnView);
      const canReverse =
        ctx.can("points:adjust") && REVERSIBLE.has(d.txn_type) && !d.reversed_by && !d.reverses;
      txnView.append(
        transactionView({
          detail: d,
          backLabel: state.trail.length > 1 ? "Back" : "Back to statement",
          onBack: backFromTxn,
          onOpenTxn: (id) => {
            state.trail.push(id);
            readTxn(id, true);
          },
          reverse: canReverse
            ? {
                onSubmit: async (reason) => {
                  const ok = await ctx.confirm({
                    title: `Reverse transaction ${number(d.txn_no)}?`,
                    message: `This posts the mirror of this ${d.txn_type.replace("_", " ")}. It cannot be undone, only reversed again by a new adjustment.`,
                    confirmLabel: "Reverse it",
                    tone: "danger",
                  });
                  if (!ok) return;
                  const res = await api.call("ledger.reverse", {
                    txn_id: d.txn_id,
                    reason,
                    idempotency_key: api.idempotencyKey("reverse"),
                  });
                  ctx.toast({
                    title: "Transaction reversed",
                    body: `Posted as transaction ${number(res.txn_no)}`,
                    tone: "success",
                  });
                  ctx.announce("Transaction reversed");
                  await readTxn(d.txn_id, false);
                },
              }
            : null,
        }),
      );
      if (focus) txnView.querySelector("[data-focus]")?.focus();
    };

    // ---- realtime ----
    const refresh = life.debounce(() => {
      if (state.view === "accounts") load({ silent: true });
      else if (state.view === "statement" && !stmtPaging.canPrev()) loadStatement({ silent: true });
    }, 600);
    life.add(
      rt.on("points.posted", (ev) => {
        refresh();
        const p = ev.payload;
        if (state.view === "transaction" && state.txn && p.txn_id === state.txn.reversed_by)
          readTxn(state.txn.txn_id, false);
      }),
    );
    load({ initial: true });
    return life.dispose;
  },
};
