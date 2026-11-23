// approvals.inbox: held changes, held agent actions, high-value orders and content reviews in one list.
// List and item views (side by side when wide), a decision form with a required reason on reject, withdraw for
// the requester, separation-of-duties explanations, realtime arrivals and decisions, page-bus selection.
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { icon } from "../../ds/js/icons.js";
import { pill, statusPill } from "../../ds/js/pill.js";
import { personChip } from "../../ds/js/avatar.js";
import { emptyState } from "../../ds/js/states.js";
import { pager } from "../../ds/js/table.js";
import { searchField, selectField, textArea } from "../../ds/js/field.js";
import { inlineText } from "../../ds/js/richtext.js";
import { number } from "../../ds/js/format.js";
import { catalogEntry, schemaOf } from "../../core/widgets.js";
import {
  debounce,
  focusSoon,
  isCompact,
  keyValues,
  latest,
  region,
  timeNode,
  toErrorInfo,
  toastError,
} from "../reporting/_common.js";
import { splitPane } from "../reporting/_split.js";
import { detailSections } from "../reporting/_detail.js";

const TYPES = {
  change: { label: "Change", icon: "audit" },
  action: { label: "Action", icon: "bolt" },
  order: { label: "Order", icon: "box" },
  content_review: { label: "Content review", icon: "article" },
};

const BLOCKED = {
  sod_requester: "You requested this, so someone else has to decide it.",
  sod_on_behalf_of: "This was requested on your behalf, so someone else has to decide it.",
  missing_permission: "Your role does not include the permission needed to decide this.",
  not_reviewer: "You are not one of the listed reviewers for this item.",
};

const SCOPES = [
  { value: "to_decide", label: "To decide" },
  { value: "requested", label: "Requested by me" },
  { value: "all", label: "All" },
];
const STATUSES = [
  { value: "pending_approval", label: "Awaiting decision" },
  { value: "decided", label: "Decided" },
  { value: "all", label: "Any status" },
];

const keyOf = (it) => `${it.type}:${it.id}`;

export default {
  id: "approvals.inbox",
  domain: "approvals",
  title: "Approvals",
  configSchema: schemaOf("approvals.inbox"),
  sizes: catalogEntry("approvals.inbox")?.sizes ?? [],
  mount(el, { config, size, api, rt, bus, ctx }) {
    const compact = isCompact(size);
    const st = {
      scope: config.scope ?? "to_decide",
      type: "all",
      status: (config.scope ?? "to_decide") === "to_decide" ? "pending_approval" : "all",
      q: "",
      items: [],
      counts: {},
      cursor: null,
      next: null,
      stack: [],
      selected: null,
      arrived: new Set(),
    };
    const pageSize = config.page_size ?? (compact ? 5 : 20);
    const allowedTypes = config.types?.length ? config.types : Object.keys(TYPES);
    const next = latest();
    const timers = new Set();
    let alive = true;
    let busyKey = null;

    const list = region("rp-approvals__list");
    const tools = h("div", { class: "rp-tools" });
    const pane = splitPane({
      label: "Approvals",
      placeholder: emptyState({
        icon: "check-circle",
        title: "Select an item",
        body: "Its detail and decision form appear here.",
      }),
    });
    pane.list.append(list.el);
    const root = h(
      "div",
      { class: `rp-app rp-approvals rp-approvals--${size}` },
      compact ? null : tools,
      pane.el,
    );
    el.append(root);

    // ---- toolbar ----
    const paintTools = () => {
      if (compact) return;
      const typeOptions = [
        { value: "all", label: "All types" },
        ...allowedTypes.map((t) => ({
          value: t,
          label: `${TYPES[t].label}${st.counts[t] ? ` (${number(st.counts[t])})` : ""}`,
        })),
      ];
      const fields = [
        selectField({
          name: "scope",
          label: "Show",
          value: st.scope,
          options: SCOPES,
          onChange: (v) => {
            st.scope = v;
            st.status = v === "to_decide" ? "pending_approval" : "all";
            reset();
          },
        }),
        selectField({
          name: "type",
          label: "Type",
          value: st.type,
          options: typeOptions,
          onChange: (v) => {
            st.type = v;
            reset();
          },
        }),
        selectField({
          name: "status",
          label: "Status",
          value: st.status,
          options: STATUSES,
          onChange: (v) => {
            st.status = v;
            reset();
          },
        }),
      ];
      const search = searchField({
        name: "q",
        label: "Search",
        value: st.q,
        placeholder: "Title or summary",
        onInput: (v) => {
          st.q = v;
          paintList();
        },
      });
      search.classList.add("c-field--grow");
      tools.replaceChildren(...fields, search);
    };

    // ---- loading ----
    const reset = () => {
      st.cursor = null;
      st.stack = [];
      st.selected = null;
      pane.clearDetail();
      paintTools();
      load({ first: true });
    };

    const visible = () => {
      const q = st.q.trim().toLowerCase();
      return q ? st.items.filter((i) => `${i.title} ${i.summary}`.toLowerCase().includes(q)) : st.items;
    };

    async function load({ first = false, silent = false } = {}) {
      const ok = next();
      if (first) list.loading({ lines: 4 });
      else if (!silent) list.busy(true);
      try {
        const out = await api.call("approvals.list", {
          scope: st.scope,
          types: st.type === "all" ? (config.types?.length ? config.types : undefined) : [st.type],
          status: st.status,
          cursor: st.cursor ?? undefined,
          limit: pageSize,
        });
        if (!ok() || !alive) return;
        st.items = out.items;
        st.next = out.next_cursor;
        st.counts = out.counts ?? {};
        list.busy(false);
        ctx.setCount(st.items.length);
        paintTools();
        paintList();
        if (st.selected) paintDetail();
      } catch (e) {
        if (!ok() || !alive) return;
        list.busy(false);
        if (toErrorInfo(e).code === "FORBIDDEN") ctx.setState("unavailable", { reason: "forbidden" });
        else list.error(e, () => load({ first: true }));
      }
    }

    // ---- list ----
    const isMine = (it) => it.requested_by?.subject && it.requested_by.subject === ctx.me?.principal?.subject;

    const rowNode = (it) => {
      const pending = it.status === "pending_approval";
      const li = h("li", {
        class: `rp-row${st.selected === keyOf(it) ? " is-selected" : ""}${pending ? "" : " is-done"}`,
        "data-key": keyOf(it),
      });
      const open = h(
        "button",
        {
          type: "button",
          class: "rp-row__title",
          "aria-current": st.selected === keyOf(it) ? "true" : null,
          onclick: () => select(it),
        },
        icon(TYPES[it.type]?.icon ?? "audit", { size: 16 }),
        it.title,
      );
      const meta = h(
        "div",
        { class: "rp-row__meta" },
        pill({ label: TYPES[it.type]?.label ?? it.type }),
        personChip(it.requested_by),
        timeNode(it.requested_at),
        it.expires_at && pending ? h("span", {}, "Expires ", timeNode(it.expires_at)) : null,
      );
      li.append(
        h(
          "div",
          { class: "rp-row__main" },
          open,
          h("p", { class: "rp-row__summary" }, inlineText(it.summary)),
          meta,
        ),
        h(
          "div",
          { class: "rp-row__side" },
          statusPill("approval", it.status),
          st.arrived.has(keyOf(it)) ? pill({ label: "New", tone: "signal" }) : null,
        ),
      );
      if (!compact && pending && it.can_decide) {
        li.append(
          h(
            "div",
            { class: "rp-row__actions" },
            button({
              label: "Approve",
              icon: "check",
              variant: "primary",
              size: "sm",
              onClick: () => quickApprove(it, li),
            }),
            button({
              label: "Reject with reason",
              icon: "x",
              variant: "danger",
              size: "sm",
              onClick: () => select(it, "reject"),
            }),
          ),
        );
      } else if (!compact && pending && !it.can_decide && it.blocked_reason) {
        li.append(
          h(
            "p",
            { class: "rp-row__summary rp-row__actions" },
            BLOCKED[it.blocked_reason] ?? it.blocked_reason,
          ),
        );
      }
      return li;
    };

    function paintList() {
      const rows = visible();
      if (rows.length === 0) {
        list.show(
          st.q
            ? emptyState({
                icon: "search",
                title: `No results for “${st.q}”`,
                body: "Nothing on this page matches. Clear the search to see everything loaded.",
                action: button({
                  label: "Clear search",
                  variant: "secondary",
                  onClick: () => {
                    st.q = "";
                    paintTools();
                    paintList();
                  },
                }),
              })
            : emptyState({
                icon: "check-circle",
                title: st.scope === "to_decide" ? "Nothing is waiting for you" : "No approvals here",
                body:
                  st.scope === "to_decide"
                    ? "New requests show up here the moment they are filed, and in the bell and the nav count."
                    : "Change the filters above to look at other approvals.",
              }),
        );
        return;
      }
      const ul = h("ul", { class: "rp-rows", "aria-label": "Approvals" }, ...rows.map(rowNode));
      const pg =
        st.next || st.stack.length
          ? pager({
              label: "Approvals pages",
              nextCursor: st.next,
              onNext: (c) => {
                st.stack.push(st.cursor);
                st.cursor = c;
                load({});
              },
              onPrev: st.stack.length
                ? () => {
                    st.cursor = st.stack.pop();
                    load({});
                  }
                : undefined,
            })
          : null;
      list.show(ul, pg);
    }

    // ---- selection and detail ----
    function select(it, focus) {
      st.selected = keyOf(it);
      st.arrived.delete(keyOf(it));
      bus.publish("approval.selected", { id: it.id });
      paintList();
      paintDetail(focus);
      pane.showDetail();
    }

    const decideForm = (it, focus) => {
      const reason = textArea({
        name: "/reason",
        label: "Reason",
        rows: 3,
        hint: "Required to reject. Shown to the requester.",
      });
      const errorHost = h("div", { role: "alert" });
      const approveBtn = button({ label: "Approve", icon: "check", variant: "primary", type: "submit" });
      const rejectBtn = button({
        label: "Reject",
        icon: "x",
        variant: "danger",
        onClick: () => submit("reject"),
      });
      const text = () => reason.querySelector("textarea").value.trim();
      const setBusy = (on) => {
        for (const b of [approveBtn, rejectBtn]) {
          if (on) b.setAttribute("aria-busy", "true");
          else b.removeAttribute("aria-busy");
        }
      };
      const showErr = (msg, field) => {
        errorHost.replaceChildren(
          h(
            "div",
            { class: "rp-notice", "data-tone": "danger" },
            icon("alert", { size: 16 }),
            h("p", {}, msg),
          ),
        );
        if (field) reason.querySelector("textarea").setAttribute("aria-invalid", "true");
      };
      async function submit(decision) {
        errorHost.replaceChildren();
        reason.querySelector("textarea").removeAttribute("aria-invalid");
        if (decision === "reject" && !text()) {
          showErr("Give a reason before rejecting, so the requester knows what to change.", true);
          reason.querySelector("textarea").focus();
          return;
        }
        setBusy(true);
        busyKey = keyOf(it);
        try {
          const out = await api.call("approvals.decide", {
            type: it.type,
            id: it.id,
            decision,
            reason: text() || undefined,
          });
          replaceItem(out);
          ctx.toast({
            title: decision === "approve" ? `Approved: ${it.title}` : `Rejected: ${it.title}`,
            tone: decision === "approve" ? "success" : "neutral",
          });
          ctx.announce(decision === "approve" ? "Approved" : "Rejected");
        } catch (e) {
          const info = toErrorInfo(e);
          setBusy(false);
          if (info.details?.reason === "SELF_ACTION") showErr("You cannot decide your own request.");
          else if (info.details?.reason === "INVALID_TRANSITION") {
            showErr("Someone else already decided this. The list has been refreshed.");
            load({ silent: true });
          } else showErr(info.message ?? info.code);
        } finally {
          busyKey = null;
        }
      }
      const form = h(
        "form",
        {
          class: "rp-form",
          "aria-label": "Decision",
          novalidate: true,
          onsubmit: (e) => (e.preventDefault(), submit("approve")),
        },
        reason,
        errorHost,
        h("div", { class: "rp-detail__actions" }, approveBtn, rejectBtn),
      );
      if (focus === "reject") focusSoon(reason.querySelector("textarea"));
      return form;
    };

    const withdrawBlock = (it) =>
      button({
        label: "Withdraw request",
        icon: "x",
        variant: "danger",
        onClick: async () => {
          const yes = await ctx.confirm({
            title: "Withdraw this request?",
            message: `“${it.title}” will no longer wait for a decision. You can file it again later.`,
            confirmLabel: "Withdraw",
            tone: "danger",
          });
          if (!yes) return;
          try {
            const out = await api.call("approvals.withdraw", { type: it.type, id: it.id });
            replaceItem(out);
            ctx.toast({ title: "Request withdrawn", body: it.title, tone: "neutral" });
          } catch (e) {
            toastError(ctx.toast, e, "Could not withdraw");
          }
        },
      });

    function paintDetail(focus) {
      const it = st.items.find((x) => keyOf(x) === st.selected);
      if (!it) {
        pane.clearDetail();
        return;
      }
      const pending = it.status === "pending_approval";
      const head = h(
        "header",
        { class: "rp-detail__head" },
        h("h3", { class: "rp-detail__heading", tabindex: "-1", "data-focus": "" }, it.title),
        h(
          "div",
          { class: "rp-detail__pills" },
          statusPill("approval", it.status),
          pill({ label: TYPES[it.type]?.label ?? it.type, icon: TYPES[it.type]?.icon }),
          ...it.rule_id.map((r) => pill({ label: r })),
        ),
      );
      const facts = keyValues([
        ["Requested by", personChip(it.requested_by)],
        ["On behalf of", it.on_behalf_of ? personChip(it.on_behalf_of) : null],
        ["Requested", timeNode(it.requested_at)],
        ["Expires", it.expires_at ? timeNode(it.expires_at) : null],
        ["Approver permission", h("span", { class: "u-mono" }, it.approver_permission)],
        ["Decided by", it.decided_by ? personChip(it.decided_by) : null],
        ["Decided", it.decided_at ? timeNode(it.decided_at) : null],
        ["Reason", it.decision_reason],
      ]);
      const parts = [
        head,
        h("p", {}, inlineText(it.summary)),
        facts,
        pending && !it.can_decide
          ? h(
              "div",
              { class: "rp-notice", "data-tone": "warning" },
              icon("lock", { size: 16 }),
              h("p", {}, BLOCKED[it.blocked_reason] ?? it.blocked_reason ?? "You cannot decide this item."),
            )
          : null,
        it.link
          ? h("a", { class: "c-button c-button--secondary c-button--sm", href: it.link }, "Open the item")
          : null,
        detailSections(it.detail),
        pending && it.can_decide ? decideForm(it, focus) : null,
        pending && isMine(it) && (it.type === "change" || it.type === "action")
          ? h("div", { class: "rp-detail__actions" }, withdrawBlock(it))
          : null,
      ];
      pane.detail.replaceChildren(
        h("article", { class: "rp-detail", "aria-label": it.title }, ...parts.filter(Boolean)),
      );
    }

    function replaceItem(out) {
      const k = keyOf(out);
      const at = st.items.findIndex((x) => keyOf(x) === k);
      if (at >= 0) st.items[at] = { ...st.items[at], ...out };
      paintList();
      if (st.selected === k) paintDetail();
    }

    async function quickApprove(it, li) {
      const yes = await ctx.confirm({
        title: "Approve this?",
        message: it.summary,
        confirmLabel: "Approve",
      });
      if (!yes) return;
      li.setAttribute("aria-busy", "true");
      try {
        const out = await api.call("approvals.decide", { type: it.type, id: it.id, decision: "approve" });
        replaceItem(out);
        ctx.toast({ title: `Approved: ${it.title}`, tone: "success" });
        ctx.announce("Approved");
      } catch (e) {
        li.removeAttribute("aria-busy");
        const info = toErrorInfo(e);
        toastError(
          ctx.toast,
          e,
          info.details?.reason === "SELF_ACTION" ? "You cannot decide your own request" : "Could not approve",
        );
        if (info.details?.reason === "INVALID_TRANSITION") load({ silent: true });
      }
    }

    // ---- realtime ----
    const refresh = debounce(() => {
      if (st.cursor === null) load({ silent: true });
    }, 500);
    let batch = 0;
    let batchTimer = 0;
    const offs = [
      rt.on("approval.requested", (ev) => {
        const k = `${ev.payload.approval_type}:${ev.payload.id}`;
        if (!st.items.some((i) => keyOf(i) === k)) st.arrived.add(k);
        batch += 1;
        clearTimeout(batchTimer);
        batchTimer = setTimeout(() => {
          ctx.announce(batch === 1 ? "1 new approval request" : `${batch} new approval requests`);
          batch = 0;
        }, 800);
        refresh();
      }),
      rt.on("approval.decided", (ev) => {
        const k = `${ev.payload.approval_type}:${ev.payload.id}`;
        const it = st.items.find((i) => keyOf(i) === k);
        if (it && busyKey !== k) {
          it.status = ev.payload.status;
          it.can_decide = false;
          st.arrived.add(k);
          paintList();
          if (st.selected === k) paintDetail();
          const row = list.el.querySelector(`[data-key="${CSS.escape(k)}"]`);
          if (row) {
            row.classList.add("u-arrive");
            const t = setTimeout(() => (timers.delete(t), row.classList.remove("u-arrive")), 6000);
            timers.add(t);
          }
        }
        refresh();
      }),
    ];

    paintTools();
    load({ first: true });
    return () => {
      alive = false;
      refresh.cancel();
      clearTimeout(batchTimer);
      for (const t of timers) clearTimeout(t);
      for (const off of offs) off();
    };
  },
};
