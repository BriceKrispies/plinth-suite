// notifications.deliveries: what the email stub and the digest worker sent, with suppression reasons.
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { button, iconButton, linkButton } from "../../ds/js/button.js";
import { pill } from "../../ds/js/pill.js";
import { emptyState, errorState } from "../../ds/js/states.js";
import { icon } from "../../ds/js/icons.js";
import { toErrorInfo } from "../../core/api.js";
import {
  lifecycle,
  debounce,
  sequence,
  segmented,
  ago,
  when,
  errorText,
  link,
  markArrived,
  plural,
  safeIcon,
  clip,
} from "../../shell/kit.js";

const STATUS = {
  queued: { label: "Queued", tone: "info", icon: "clock" },
  sent: { label: "Sent", tone: "success", icon: "check-circle" },
  suppressed: { label: "Suppressed", tone: "warning", icon: "eye-off" },
};
const REASON = {
  preference_off: "Every channel for this notification type was off in the member's preferences.",
  quiet_hours: "It would have arrived during the member's quiet hours.",
  member_disabled: "The member's account is disabled.",
};
const statusPill = (s) => pill({ label: STATUS[s].label, tone: STATUS[s].tone, icon: STATUS[s].icon });

export default {
  id: "notifications.deliveries",
  domain: "notifications",
  title: "Email and digest log",
  configSchema: schemaOf("notifications.deliveries"),
  sizes: ["l", "xl"],
  mount(el, { config, size, api, rt, bus, ctx }) {
    const life = lifecycle();
    const seq = sequence();
    const st = {
      channel: config.channel ?? "all",
      status: "all",
      member: config.member ?? null,
      items: [],
      next: null,
      loaded: false,
      busy: false,
      error: null,
      detail: null,
    };
    const root = h("div", { class: "w-deliv", "data-size": size });
    el.append(root);
    const listView = h("div", { class: "w-deliv__list" });
    const detailView = h("div", { class: "w-deliv__detail", hidden: true });
    root.append(listView, detailView);

    // ---- toolbar ----

    const channelSeg = segmented({
      label: "Channel",
      options: [
        { value: "all", label: "All" },
        { value: "email", label: "Email" },
        { value: "digest", label: "Digest" },
      ],
      value: st.channel,
      onChange: (v) => {
        st.channel = v;
        fetchList();
      },
    });
    const statusSeg = segmented({
      label: "Status",
      options: [
        { value: "all", label: "Any status" },
        { value: "queued", label: "Queued" },
        { value: "sent", label: "Sent" },
        { value: "suppressed", label: "Suppressed" },
      ],
      value: st.status,
      onChange: (v) => {
        st.status = v;
        paintList();
      },
    });
    const refresh = iconButton({
      icon: "history",
      label: "Refresh log",
      size: "sm",
      onClick: () => fetchList(),
    });
    const memberChip = h("p", { class: "w-deliv__member", hidden: true });
    const bar = h(
      "div",
      { class: "w-bar", role: "group", "aria-label": "Delivery filters" },
      h("div", { class: "w-bar__row" }, channelSeg, h("span", { class: "w-bar__spacer" }), refresh),
      h("div", { class: "w-bar__row" }, statusSeg),
      memberChip,
    );
    const summary = h("p", { class: "w-summary", role: "status" });
    const listHost = h("ul", { class: "w-dlist", "aria-label": "Deliveries" });
    const more = h("div", { class: "w-more" });
    listView.append(bar, summary, listHost, more);

    const paintMember = () => {
      clear(memberChip);
      memberChip.hidden = !st.member;
      if (!st.member) return;
      memberChip.append(
        safeIcon("user", "user", { size: 16 }),
        h("span", {}, `Showing the log for @${st.member}`),
        button({
          label: "Show my log",
          variant: "ghost",
          size: "sm",
          onClick: () => {
            st.member = null;
            fetchList();
          },
        }),
      );
    };

    // ---- data ----

    const query = (extra = {}) => ({
      ...(st.channel !== "all" ? { channel: st.channel } : {}),
      ...(st.member ? { member: st.member } : {}),
      limit: 25,
      ...extra,
    });

    async function fetchList({ live = false } = {}) {
      const mine = seq.next();
      st.busy = true;
      root.setAttribute("aria-busy", "true");
      let arrived = [];
      try {
        const out = await api.call("notifications.deliveries", query());
        if (!seq.ok(mine) || life.dead) return;
        if (live) {
          const had = new Set(st.items.map((d) => d.delivery_id));
          arrived = out.items.filter((d) => !had.has(d.delivery_id)).map((d) => d.delivery_id);
          const tail = st.items.filter(
            (d) =>
              !out.items.some((x) => x.delivery_id === d.delivery_id) &&
              d.created_at < (out.items.at(-1)?.created_at ?? ""),
          );
          st.items = [...out.items, ...(out.next_cursor ? tail : [])];
          if (!out.next_cursor || !tail.length) st.next = out.next_cursor;
        } else {
          st.items = out.items;
          st.next = out.next_cursor;
        }
        st.error = null;
      } catch (e) {
        if (!seq.ok(mine) || life.dead) return;
        if (live) return;
        st.error = e;
        if (!st.loaded) {
          ctx.setState("error", { error: toErrorInfo(e) });
          return;
        }
      } finally {
        if (seq.ok(mine)) {
          st.busy = false;
          root.removeAttribute("aria-busy");
        }
      }
      if (!st.loaded) {
        st.loaded = true;
        ctx.setState("ready");
      }
      paintMember();
      paintList(arrived);
    }

    async function loadMore() {
      if (!st.next || st.busy) return;
      const mine = seq.next();
      st.busy = true;
      paintMore();
      try {
        const out = await api.call("notifications.deliveries", query({ cursor: st.next }));
        if (!seq.ok(mine) || life.dead) return;
        const had = new Set(st.items.map((d) => d.delivery_id));
        st.items = [...st.items, ...out.items.filter((d) => !had.has(d.delivery_id))];
        st.next = out.next_cursor;
      } catch (e) {
        if (!seq.ok(mine) || life.dead) return;
        ctx.toast({ title: "Could not load more", body: errorText(e), tone: "danger" });
      } finally {
        if (seq.ok(mine)) st.busy = false;
      }
      paintList();
    }

    // ---- painting ----

    function paintMore() {
      clear(more);
      if (!st.next) return;
      more.append(
        button({
          label: st.busy ? "Loading" : "Load more",
          icon: "chevron-down",
          size: "sm",
          busy: st.busy,
          onClick: loadMore,
        }),
      );
    }

    function paintList(arrived = []) {
      clear(listHost);
      if (st.error && st.items.length === 0) {
        summary.textContent = "";
        const info = toErrorInfo(st.error);
        listHost.append(
          h(
            "li",
            { class: "w-empty" },
            errorState({
              error: {
                ...info,
                message:
                  info.code === "FORBIDDEN" && st.member
                    ? "Only people with access to private member data can read another member's log."
                    : errorText(st.error),
              },
              retry: () => fetchList(),
            }),
          ),
        );
        paintMore();
        return;
      }
      const rows = st.items.filter((d) => st.status === "all" || d.status === st.status);
      if (rows.length === 0) {
        summary.textContent = "";
        listHost.append(
          h(
            "li",
            { class: "w-empty" },
            st.items.length
              ? emptyState({
                  icon: "filter",
                  title: "Nothing with that status",
                  body: "Try another status or load more rows.",
                  action: button({
                    label: "Show any status",
                    onClick: () => ((st.status = "all"), statusSeg.set("all"), paintList()),
                  }),
                })
              : emptyState({
                  icon: "send",
                  title: "No deliveries yet",
                  body: "Emails and digests appear here after a notification reaches a channel beyond the app.",
                }),
          ),
        );
        paintMore();
        return;
      }
      summary.textContent = `${plural(rows.length, "delivery", "deliveries")}${st.next ? " so far" : ""}`;
      for (const d of rows) {
        const li = h(
          "li",
          { class: "w-drow", "data-id": d.delivery_id },
          h(
            "button",
            { type: "button", class: "w-drow__main", onclick: () => openDetail(d) },
            h("span", { class: "w-drow__icon" }, safeIcon(d.channel === "email" ? "send" : "list", "send")),
            h(
              "span",
              { class: "w-drow__text" },
              h("span", { class: "w-drow__subject" }, d.subject),
              h("span", { class: "w-drow__preview" }, clip(d.body, 100)),
              d.suppressed_reason
                ? h("span", { class: "w-drow__reason" }, REASON[d.suppressed_reason])
                : null,
            ),
            h(
              "span",
              { class: "w-drow__side" },
              statusPill(d.status),
              h("time", { datetime: d.created_at, title: when(d.created_at) }, ago(d.created_at)),
            ),
            icon("chevron-right", { size: 16 }),
          ),
        );
        if (arrived.includes(d.delivery_id)) markArrived(li, life, ".w-drow__subject");
        listHost.append(li);
      }
      paintMore();
    }

    // ---- detail view ----

    function openDetail(d) {
      st.detail = d.delivery_id;
      listView.hidden = true;
      detailView.hidden = false;
      clear(detailView);
      const back = button({
        label: "Back to log",
        icon: "chevron-left",
        variant: "ghost",
        size: "sm",
        onClick: closeDetail,
      });
      const heading = h("h3", { class: "w-deliv__title", tabindex: "-1" }, d.subject);
      detailView.append(
        h("div", { class: "w-bar" }, back),
        h(
          "article",
          { class: "w-deliv__card", "aria-labelledby": "dv-title" },
          heading,
          h(
            "dl",
            { class: "w-dl" },
            h("dt", {}, "Channel"),
            h("dd", {}, d.channel === "email" ? "Email" : "Digest"),
            h("dt", {}, "Status"),
            h("dd", {}, statusPill(d.status)),
            h("dt", {}, "Created"),
            h("dd", {}, when(d.created_at)),
            h("dt", {}, "Sent"),
            h("dd", {}, d.sent_at ? when(d.sent_at) : "Not sent"),
            d.suppressed_reason ? h("dt", {}, "Why it was held") : null,
            d.suppressed_reason ? h("dd", {}, REASON[d.suppressed_reason]) : null,
            h("dt", {}, "Notifications"),
            h("dd", {}, `${plural(d.notification_ids.length, "notification")} in this ${d.channel}`),
          ),
          h("h4", { class: "w-deliv__sub" }, "Message"),
          h("pre", { class: "w-deliv__body" }, d.body),
          h(
            "div",
            { class: "w-deliv__actions" },
            linkButton({
              href: link("/notifications"),
              label: "Open notifications",
              icon: "bell",
              size: "sm",
            }),
          ),
        ),
      );
      heading.id = "dv-title";
      heading.focus();
    }
    function closeDetail() {
      const id = st.detail;
      st.detail = null;
      detailView.hidden = true;
      listView.hidden = false;
      listHost.querySelector(`[data-id="${CSS.escape(id ?? "")}"] .w-drow__main`)?.focus();
    }
    detailView.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeDetail();
      }
    });

    // ---- realtime and bus ----

    const live = debounce(() => fetchList({ live: true }), 600);
    life.add(live.cancel);
    life.add(rt.on("notification.created", live));
    life.add(
      bus.subscribe("member.selected", (p) => {
        if (!p?.id || p.id === st.member) return;
        st.member = p.id;
        if (st.detail) closeDetail();
        fetchList();
        ctx.announce(`Showing the log for @${p.id}`);
      }),
    );

    ctx.setState("loading");
    paintMember();
    fetchList();
    return () => life.dispose();
  },
};
