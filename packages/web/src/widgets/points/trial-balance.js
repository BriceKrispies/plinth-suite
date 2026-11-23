// points.trial-balance: the ledger invariants and the system account balances, for finance.
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { points, number, dateTime } from "../../ds/js/format.js";
import { pill } from "../../ds/js/pill.js";
import { button } from "../../ds/js/button.js";
import { dataTable } from "../../ds/js/table.js";
import { icon } from "../../ds/js/icons.js";
import { skeleton } from "../../ds/js/states.js";
import { disposer, reportLoadError, withBusy, markArrived, timeEl, kv, dl, messageOf } from "./_kit.js";

const SYSTEM_LABEL = {
  "system:issuance": "Issuance (source of awards)",
  "system:promotions": "Promotions (source of bonuses)",
  "system:redemption": "Redemption (sink of purchases)",
  "system:expiry": "Expiry (sink of expired points)",
  "system:adjustments": "Adjustments (both directions)",
};

export default {
  id: "points.trial-balance",
  domain: "points",
  title: "Trial balance",
  configSchema: schemaOf("points.trial-balance"),
  sizes: ["m", "l"],
  mount(el, { size, api, rt, ctx }) {
    const life = disposer();
    const root = h("div", { class: `w-points w-points-tb w-points-tb--${size}` });
    el.append(root);
    let data = null;
    let seq = 0;
    let recheckBtn = null;

    const checks = (d) => [
      {
        id: "L1",
        label: "Every transaction balances to zero",
        ok: d.unbalanced_txns.length === 0,
        detail: d.unbalanced_txns.length
          ? `${d.unbalanced_txns.length} unbalanced`
          : `${number(d.txn_count)} transactions checked`,
      },
      {
        id: "L3",
        label: "Cached balances equal the sum of entries",
        ok: d.drift.length === 0,
        detail: d.drift.length ? `${d.drift.length} accounts drift` : "No drift",
      },
      {
        id: "L4",
        label: "All balances sum to zero",
        ok: d.grand_total === 0,
        detail: `Grand total ${number(d.grand_total)}`,
      },
      {
        id: "L5",
        label: "Member balances equal their lots",
        ok: d.member_total === d.lots_total,
        detail: `${points(d.member_total)} in accounts, ${points(d.lots_total)} in lots`,
      },
    ];

    const load = async ({ initial = false, arrive = false } = {}) => {
      const mine = ++seq;
      if (initial) {
        clear(root);
        root.append(skeleton({ lines: 4 }));
      }
      try {
        const res = await api.call("ledger.trial_balance", {});
        if (life.done || mine !== seq) return;
        const before = data;
        data = res;
        ctx.setState("ready");
        draw(before, arrive);
      } catch (e) {
        if (life.done || mine !== seq) return;
        if (!initial && data)
          ctx.toast({ title: "Could not re-check the ledger", body: messageOf(e), tone: "danger" });
        else
          reportLoadError({ ctx, host: root, error: e, retry: () => load({ initial: true }), initial: true });
      }
    };

    function draw(before, arrive) {
      clear(root);
      const list = checks(data);
      const failing = list.filter((c) => !c.ok).length;
      const ok = data.ok && failing === 0;
      const verdict = h(
        "div",
        { class: `w-points-tb__verdict ${ok ? "is-ok" : "is-bad"}`, role: "status" },
        icon(ok ? "check-circle" : "alert", { size: 24 }),
        h(
          "div",
          {},
          h(
            "p",
            { class: "w-points-tb__headline" },
            ok
              ? "The ledger is balanced"
              : `${failing || 1} ${failing === 1 ? "invariant is" : "invariants are"} violated`,
          ),
          h(
            "p",
            { class: "u-muted w-kit-small" },
            "Checked ",
            timeEl(data.checked_at),
            ` · ${number(data.txn_count)} transactions`,
          ),
        ),
      );
      recheckBtn = button({
        label: "Check again",
        icon: "history",
        variant: "secondary",
        size: "sm",
        onClick: () =>
          withBusy(recheckBtn, async () => {
            await load();
            ctx.announce("Ledger checked");
          }),
      });
      root.append(h("div", { class: "w-points-tb__top" }, verdict, recheckBtn));
      if (arrive || (before && before.txn_count !== data.txn_count)) markArrived(life, verdict);

      root.append(
        h(
          "ul",
          { class: "w-points-tb__checks", "aria-label": "Ledger invariants" },
          ...list.map((c) =>
            h(
              "li",
              { class: c.ok ? "is-ok" : "is-bad" },
              pill({
                label: c.ok ? "Holds" : "Violated",
                tone: c.ok ? "success" : "danger",
                icon: c.ok ? "check-circle" : "alert",
              }),
              h("span", { class: "w-points-tb__check" }, h("strong", {}, c.id), " ", c.label),
              h("span", { class: "u-muted w-kit-small" }, c.detail),
            ),
          ),
        ),
      );
      if (size === "m") {
        root.append(
          dl([
            kv("System accounts", String(data.system.length)),
            kv("Member total", points(data.member_total)),
          ]),
        );
      } else {
        root.append(
          dataTable({
            caption: "System accounts",
            density: "compact",
            rows: data.system,
            rowKey: "account",
            columns: [
              {
                key: "account",
                label: "Account",
                render: (r) =>
                  h(
                    "span",
                    {},
                    h("code", { class: "w-kit-code" }, r.account),
                    SYSTEM_LABEL[r.account]
                      ? h("span", { class: "u-muted w-kit-small" }, ` ${SYSTEM_LABEL[r.account]}`)
                      : null,
                  ),
              },
              {
                key: "balance",
                label: "Balance",
                align: "end",
                render: (r) => `${r.balance < 0 ? "−" : ""}${points(Math.abs(r.balance))}`,
              },
            ],
          }),
          dl([
            kv("Member accounts total", points(data.member_total)),
            kv("Lots total", points(data.lots_total)),
            kv("Grand total", number(data.grand_total)),
            kv("Checked", dateTime(data.checked_at)),
          ]),
        );
      }
      if (data.drift.length) {
        root.append(
          h("p", { class: "u-caps" }, "Accounts with drift"),
          dataTable({
            caption: "Cached balance against the sum of entries",
            density: "compact",
            rows: data.drift,
            rowKey: "account",
            columns: [
              {
                key: "account",
                label: "Account",
                render: (r) => h("code", { class: "w-kit-code" }, r.account),
              },
              { key: "cached", label: "Cached", align: "end", render: (r) => number(r.cached) },
              { key: "computed", label: "Computed", align: "end", render: (r) => number(r.computed) },
              {
                key: "diff",
                label: "Difference",
                align: "end",
                render: (r) => number(r.cached - r.computed),
              },
            ],
          }),
        );
      }
      if (data.unbalanced_txns.length) {
        root.append(
          h("p", { class: "u-caps" }, "Unbalanced transactions"),
          h(
            "ul",
            { class: "w-points-tb__ids" },
            ...data.unbalanced_txns.map((id) => h("li", {}, h("code", { class: "w-kit-code" }, id))),
          ),
        );
      }
    }

    // Every posting changes the totals; re-check after a quiet moment so a burst costs one read.
    const reread = life.debounce(() => load({ arrive: true }), 1500);
    life.add(rt.on("points.posted", () => reread()));
    load({ initial: true });
    return life.dispose;
  },
};
