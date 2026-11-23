// Statement table and transaction detail, shared by points.ledger and points.accounts.
import { h } from "../../ds/js/dom.js";
import { dataTable } from "../../ds/js/table.js";
import { button } from "../../ds/js/button.js";
import { pill } from "../../ds/js/pill.js";
import { dateTime, points, number } from "../../ds/js/format.js";
import { personChip } from "../../ds/js/avatar.js";
import { textArea } from "../../ds/js/field.js";
import { icon } from "../../ds/js/icons.js";
import { emptyState } from "../../ds/js/states.js";
import {
  amount,
  kv,
  dl,
  sectionHead,
  txnPill,
  markArrived,
  timeEl,
  showFormError,
  withBusy,
} from "./_kit.js";

export const counterpartyText = (cp) => {
  if (!cp) return "";
  if (cp.display_name) return cp.display_name;
  if (cp.system) return `System: ${cp.system}`;
  return "";
};

/** The statement lines as a table. `onOpen(line)` opens the transaction; `arrived` is a Set of txn ids. */
export const statementTable = ({
  lines,
  onOpen,
  arrived,
  life,
  caption = "Statement lines",
  empty,
  compact,
}) => {
  const columns = [
    {
      key: "occurred_at",
      label: "When",
      render: (r) =>
        h(
          "span",
          { class: "w-kit-when" },
          h(
            "button",
            {
              type: "button",
              class: "w-kit-link",
              "aria-label": `Open transaction ${r.txn_no}, ${txnTypeText(r)}, ${dateTime(r.occurred_at)}`,
              onclick: () => onOpen(r),
            },
            dateTime(r.occurred_at),
          ),
          h("span", { class: "w-kit-new-slot" }),
        ),
    },
    { key: "txn_type", label: "Type", render: (r) => txnPill(r.txn_type) },
    {
      key: "memo",
      label: "Details",
      render: (r) => {
        const cp = counterpartyText(r.counterparty);
        return h(
          "span",
          { class: "w-kit-detail" },
          h("span", { class: "w-kit-detail__memo" }, r.memo || "No memo"),
          cp ? h("span", { class: "w-kit-detail__sub u-muted" }, cp) : null,
          r.ref?.link
            ? h("a", { class: "w-kit-detail__sub", href: r.ref.link }, r.ref.label || r.ref.kind)
            : r.ref?.label
              ? h("span", { class: "w-kit-detail__sub u-muted" }, r.ref.label)
              : null,
          r.reversed_by ? pill({ label: "Reversed", tone: "warning" }) : null,
        );
      },
    },
    { key: "amount", label: "Amount", align: "end", render: (r) => amount(r.amount) },
  ];
  if (!compact)
    columns.push({
      key: "balance_after",
      label: "Balance",
      align: "end",
      render: (r) => points(r.balance_after),
    });
  const table = dataTable({
    caption,
    columns,
    rows: lines,
    rowKey: "txn_id",
    onRowClick: onOpen,
    empty,
    density: "compact",
  });
  if (arrived?.size) {
    for (const tr of table.querySelectorAll("tbody tr[data-key]")) {
      if (arrived.has(tr.dataset.key)) markArrived(life, tr, tr.querySelector(".w-kit-new-slot"));
    }
  }
  return table;
};

const txnTypeText = (r) =>
  ({
    award: "award",
    purchase: "purchase",
    refund: "refund",
    transfer: "transfer",
    expiry: "expiry",
    adjustment: "adjustment",
    promotion_bonus: "promotion bonus",
    badge_reward: "badge reward",
    reversal: "reversal",
  })[r.txn_type] ?? r.txn_type;

export const CHANGE_TONE = { created: "success", consumed: "warning", restored: "info", expired: "danger" };
const CHANGE_LABEL = { created: "Created", consumed: "Consumed", restored: "Restored", expired: "Expired" };

/** The reversal form: reason, confirmation by the caller, errors on the form. */
const reversePanel = ({ onSubmit }) => {
  let reason = "";
  const form = h("form", { class: "w-kit-form w-kit-reverse", novalidate: true });
  const submit = button({ label: "Reverse transaction", variant: "danger", icon: "history", type: "submit" });
  form.append(
    h(
      "p",
      { class: "u-muted" },
      "Posts the mirror transaction. Reversing a credit needs the recipient to still hold those points.",
    ),
    textArea({
      name: "/reason",
      label: "Reason",
      required: true,
      rows: 3,
      hint: "Shown in the ledger and the audit trail (up to 280 characters).",
      onInput: (v) => (reason = v),
    }),
    h("div", { class: "w-kit-actions" }, submit),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = reason.trim();
    if (!text || text.length > 280) {
      showFormError(form, {
        code: "VALIDATION_FAILED",
        path: "/reason",
        message: text ? "Use at most 280 characters" : "Give a reason",
      });
      return;
    }
    await withBusy(submit, async () => {
      try {
        await onSubmit(text);
      } catch (err) {
        showFormError(form, err, { INSUFFICIENT_POINTS: "/reason", INVALID_TRANSITION: "/reason" });
      }
    });
  });
  return form;
};

/**
 * One transaction: summary, entries, lot movements, links to the reversed or reversing transaction and, for
 * finance, the reversal form. `reverse` is `{ onSubmit(reason) }` or null.
 */
export const transactionView = ({ detail, onBack, backLabel, onOpenTxn, reverse }) => {
  const d = detail;
  const root = h("div", { class: "w-kit-detailview" });
  root.append(
    h(
      "div",
      { class: "w-kit-head" },
      button({ label: backLabel, icon: "chevron-left", variant: "ghost", size: "sm", onClick: onBack }),
    ),
    h(
      "div",
      { class: "w-kit-titlerow" },
      h("h3", { class: "w-kit-title", tabindex: "-1", "data-focus": "" }, `Transaction ${number(d.txn_no)}`),
      txnPill(d.txn_type),
      d.reversed_by ? pill({ label: "Reversed", tone: "warning", icon: "history" }) : null,
      d.reverses ? pill({ label: "Is a reversal", tone: "danger" }) : null,
    ),
  );
  const links = [];
  if (d.reversed_by)
    links.push(
      button({
        label: "Open the reversing transaction",
        icon: "chevron-right",
        variant: "secondary",
        size: "sm",
        onClick: () => onOpenTxn(d.reversed_by),
      }),
    );
  if (d.reverses)
    links.push(
      button({
        label: "Open the reversed transaction",
        icon: "chevron-left",
        variant: "secondary",
        size: "sm",
        onClick: () => onOpenTxn(d.reverses),
      }),
    );
  if (links.length) root.append(h("div", { class: "w-kit-actions" }, ...links));

  root.append(
    dl(
      [
        kv("Memo", d.memo || "No memo"),
        kv("Occurred", dateTime(d.occurred_at)),
        kv("Recorded", [
          dateTime(d.recorded_at),
          " ",
          h("span", { class: "u-muted" }, timeEl(d.recorded_at)),
        ]),
        kv("By", personChip(d.actor)),
        d.on_behalf_of ? kv("On behalf of", personChip(d.on_behalf_of)) : null,
        kv("Surface", d.surface),
        d.ref
          ? kv(
              "Reference",
              d.ref.link
                ? h("a", { href: d.ref.link }, d.ref.label || d.ref.kind)
                : d.ref.label || d.ref.kind,
            )
          : null,
        d.idempotency_key
          ? kv("Idempotency key", h("code", { class: "w-kit-code" }, d.idempotency_key))
          : null,
        kv("Event", `#${number(d.event_seq)}`),
      ].filter(Boolean),
    ),
  );

  root.append(
    sectionHead("Entries"),
    dataTable({
      caption: "Ledger entries (credits positive)",
      density: "compact",
      rows: d.entries,
      rowKey: (r) => `${r.account}`,
      columns: [
        { key: "account", label: "Account", render: (r) => h("code", { class: "w-kit-code" }, r.account) },
        { key: "member", label: "Holder", render: (r) => (r.member ? personChip(r.member) : "System") },
        { key: "amount", label: "Amount", align: "end", render: (r) => amount(r.amount) },
        {
          key: "balance_after",
          label: "Balance after",
          align: "end",
          render: (r) => points(r.balance_after),
        },
      ],
    }),
  );

  root.append(
    sectionHead("Lot movements"),
    d.lots.length
      ? dataTable({
          caption: "Points lots touched by this transaction",
          density: "compact",
          rows: d.lots,
          rowKey: (r) => `${r.lot_id}:${r.change}`,
          columns: [
            {
              key: "change",
              label: "Change",
              render: (r) =>
                pill({ label: CHANGE_LABEL[r.change] ?? r.change, tone: CHANGE_TONE[r.change] ?? "neutral" }),
            },
            {
              key: "account",
              label: "Account",
              render: (r) => h("code", { class: "w-kit-code" }, r.account),
            },
            { key: "points", label: "Points", align: "end", render: (r) => points(r.points) },
            { key: "expires_at", label: "Expires", render: (r) => dateTime(r.expires_at) },
          ],
        })
      : emptyState({
          icon: "coins",
          title: "No lots moved",
          body: "This transaction did not create, consume or restore any lots.",
        }),
  );

  if (reverse) {
    root.append(sectionHead("Reverse this transaction"), reversePanel({ onSubmit: reverse.onSubmit }));
  } else if (d.reversed_by) {
    root.append(
      h(
        "p",
        { class: "w-kit-note" },
        icon("info", { size: 16 }),
        " This transaction has already been reversed.",
      ),
    );
  }
  return root;
};
