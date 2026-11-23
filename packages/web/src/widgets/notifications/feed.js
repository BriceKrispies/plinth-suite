// notifications.feed: the member's notifications with type filters, mark read and mark all read.
import { schemaOf } from "../../core/widgets.js";
import { h, clear, uid } from "../../ds/js/dom.js";
import { button, iconButton } from "../../ds/js/button.js";
import { emptyState, errorState } from "../../ds/js/states.js";
import { popover } from "../../ds/js/popover.js";
import { icon } from "../../ds/js/icons.js";
import { toErrorInfo } from "../../core/api.js";
import { clockStore } from "../../core/stores.js";
import {
  lifecycle,
  debounce,
  sequence,
  segmented,
  errorText,
  link,
  markArrived,
  batchAnnouncer,
  plural,
  notificationRow,
  typeInfo,
  NOTIFICATION_TYPES,
  dayBucket,
} from "../../shell/kit.js";

const BUCKETS = ["Today", "Yesterday", "This week", "Earlier"];

export default {
  id: "notifications.feed",
  domain: "notifications",
  title: "Notifications",
  configSchema: schemaOf("notifications.feed"),
  sizes: ["m", "l", "xl", "full"],
  mount(el, { config, size, api, rt, ctx }) {
    const life = lifecycle();
    const seq = sequence();
    const pageSize = config.page_size ?? 20;
    const st = {
      filter: config.filter ?? "all",
      types: new Set(config.types ?? []),
      items: [],
      next: null,
      unread: 0,
      loaded: false,
      busy: false,
      error: null,
    };
    const announceNew = batchAnnouncer(ctx, life, (n) => `${plural(n, "new notification")}`);
    const root = h("div", { class: "w-feed", "data-size": size });
    el.append(root);

    // ---- toolbar ----

    const filterSeg = segmented({
      label: "Show",
      options: [
        { value: "all", label: "All" },
        { value: "unread", label: "Unread", count: 0 },
      ],
      value: st.filter,
      onChange: (v) => {
        st.filter = v;
        fetchList();
      },
    });
    const typesBtn = button({ label: "Types", icon: "filter", size: "sm" });
    typesBtn.setAttribute("aria-haspopup", "dialog");
    typesBtn.addEventListener("click", () => openTypes());
    const markAll = button({
      label: "Mark all read",
      icon: "check",
      size: "sm",
      onClick: () => markAllRead(),
    });
    const refresh = iconButton({
      icon: "history",
      label: "Refresh notifications",
      size: "sm",
      onClick: () => fetchList(),
    });
    const chips = h("ul", { class: "w-chips", "aria-label": "Active type filters" });
    const bar = h(
      "div",
      { class: "w-bar", role: "group", "aria-label": "Notification filters" },
      h(
        "div",
        { class: "w-bar__row" },
        filterSeg,
        typesBtn,
        h("span", { class: "w-bar__spacer" }),
        markAll,
        refresh,
      ),
      chips,
    );
    const status = h("p", { class: "w-summary", role: "status" });
    const listHost = h("div", { class: "w-feed__list" });
    const more = h("div", { class: "w-more" });
    root.append(bar, status, listHost, more);

    function openTypes() {
      const boxes = new Map();
      const apply = debounce(() => {
        st.types = new Set([...boxes].filter(([, b]) => b.checked).map(([t]) => t));
        fetchList();
      }, 200);
      life.add(apply.cancel);
      const groups = new Map();
      for (const [type, info] of Object.entries(NOTIFICATION_TYPES)) {
        if (!groups.has(info.group)) groups.set(info.group, []);
        groups.get(info.group).push(type);
      }
      const body = h("div", {
        class: "w-typepop",
        "data-widget-domain": "notifications",
        "aria-label": "Filter by type",
      });
      for (const [group, types] of groups) {
        body.append(
          h(
            "fieldset",
            { class: "w-typepop__group" },
            h("legend", { class: "w-typepop__legend" }, group),
            ...types.map((type) => {
              const id = `nt-${type}`;
              const box = h("input", { type: "checkbox", id, checked: st.types.has(type) ? true : null });
              box.addEventListener("change", apply);
              boxes.set(type, box);
              return h(
                "div",
                { class: "w-typepop__row" },
                box,
                h("label", { for: id }, typeInfo(type).label),
              );
            }),
          ),
        );
      }
      body.append(
        button({
          label: "Clear",
          variant: "ghost",
          size: "sm",
          onClick: () => {
            for (const b of boxes.values()) b.checked = false;
            apply();
          },
        }),
      );
      popover(typesBtn, body, { label: "Filter by type" });
    }

    // ---- data ----

    const query = (extra = {}) => ({
      filter: st.filter,
      ...(st.types.size ? { types: [...st.types] } : {}),
      limit: pageSize,
      ...extra,
    });

    const setUnread = (n) => {
      st.unread = n;
      filterSeg.setCount("unread", n);
      ctx.setCount(n);
      markAll.disabled = n === 0;
    };

    async function fetchList() {
      const mine = seq.next();
      st.busy = true;
      root.setAttribute("aria-busy", "true");
      try {
        const out = await api.call("notifications.list", query());
        if (!seq.ok(mine) || life.dead) return;
        st.items = out.items;
        st.next = out.next_cursor;
        st.error = null;
        setUnread(out.unread_count);
      } catch (e) {
        if (!seq.ok(mine) || life.dead) return;
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
      paint();
    }

    async function loadMore() {
      if (!st.next || st.busy) return;
      const mine = seq.next();
      st.busy = true;
      paintMore();
      try {
        const out = await api.call("notifications.list", query({ cursor: st.next }));
        if (!seq.ok(mine) || life.dead) return;
        const have = new Set(st.items.map((n) => n.notification_id));
        st.items = [...st.items, ...out.items.filter((n) => !have.has(n.notification_id))];
        st.next = out.next_cursor;
        setUnread(out.unread_count);
      } catch (e) {
        if (!seq.ok(mine) || life.dead) return;
        ctx.toast({ title: "Could not load more", body: errorText(e), tone: "danger" });
      } finally {
        if (seq.ok(mine)) st.busy = false;
      }
      paint();
    }

    // ---- read state (optimistic, with rollback) ----

    async function markRead(ids) {
      const targets = st.items.filter((n) => ids.includes(n.notification_id) && !n.read_at);
      if (targets.length === 0) return;
      const stamp = clockStore.get().virtual_now;
      for (const n of targets) n.read_at = stamp;
      setUnread(Math.max(0, st.unread - targets.length));
      paint();
      try {
        const out = await api.call("notifications.read", { ids: targets.map((n) => n.notification_id) });
        if (!life.dead) setUnread(out.unread_count);
      } catch (e) {
        if (life.dead) return;
        for (const n of targets) n.read_at = null;
        setUnread(st.unread + targets.length);
        paint();
        ctx.toast({ title: "Could not mark as read", body: errorText(e), tone: "danger" });
      }
    }

    async function markAllRead() {
      const filtered = st.types.size > 0;
      const previous = st.items.map((n) => n.read_at);
      const stamp = clockStore.get().virtual_now;
      for (const n of st.items) if (!n.read_at && (!filtered || st.types.has(n.type))) n.read_at = stamp;
      paint();
      markAll.setAttribute("aria-busy", "true");
      try {
        const out = await api.call("notifications.read_all", filtered ? { types: [...st.types] } : {});
        if (life.dead) return;
        setUnread(out.unread_count);
        ctx.announce(out.marked ? `${plural(out.marked, "notification")} marked read` : "Nothing to mark");
      } catch (e) {
        if (life.dead) return;
        st.items.forEach((n, i) => (n.read_at = previous[i]));
        paint();
        ctx.toast({ title: "Could not mark all read", body: errorText(e), tone: "danger" });
      } finally {
        markAll.removeAttribute("aria-busy");
      }
    }

    // ---- painting ----

    const rowNode = (n, arrivedIds, now) => {
      const unread = !n.read_at;
      const body = notificationRow(n, { compact: size === "m", now });
      const href = n.link ? link(n.link) : null;
      const main = href
        ? h(
            "a",
            {
              class: "w-nrow__main",
              href,
              onclick: () => setTimeout(() => markRead([n.notification_id]), 0),
            },
            body,
          )
        : h(
            "button",
            { type: "button", class: "w-nrow__main", onclick: () => markRead([n.notification_id]) },
            body,
          );
      const li = h(
        "li",
        { class: `w-nrow${unread ? " w-nrow--unread" : ""}`, "data-id": n.notification_id },
        unread
          ? h("span", { class: "w-nrow__dot", role: "img", "aria-label": "Unread" })
          : h("span", { class: "w-nrow__dot w-nrow__dot--read", "aria-hidden": "true" }),
        main,
        unread
          ? iconButton({
              icon: "check",
              label: `Mark “${n.title}” as read`,
              size: "sm",
              onClick: () => markRead([n.notification_id]),
            })
          : null,
      );
      if (arrivedIds.includes(n.notification_id)) markArrived(li, life, ".w-note__meta");
      return li;
    };

    function paintChips() {
      clear(chips);
      chips.hidden = st.types.size === 0;
      for (const t of st.types) {
        chips.append(
          h(
            "li",
            { class: "c-chip" },
            h("span", {}, typeInfo(t).label),
            h(
              "button",
              {
                type: "button",
                class: "c-chip__remove",
                "aria-label": `Remove ${typeInfo(t).label} filter`,
                onclick: () => {
                  st.types.delete(t);
                  fetchList();
                },
              },
              icon("x", { size: 16 }),
            ),
          ),
        );
      }
      typesBtn.querySelector(".c-button__label").textContent = st.types.size
        ? `Types (${st.types.size})`
        : "Types";
    }

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

    function paint(arrived = []) {
      paintChips();
      clear(listHost);
      if (st.error && st.items.length === 0) {
        status.textContent = "";
        listHost.append(
          errorState({
            error: { ...toErrorInfo(st.error), message: errorText(st.error) },
            retry: () => fetchList(),
          }),
        );
        paintMore();
        return;
      }
      if (st.items.length === 0) {
        status.textContent = "";
        const filtered = st.filter === "unread" || st.types.size > 0;
        listHost.append(
          filtered
            ? emptyState({
                icon: "check-circle",
                title: st.filter === "unread" ? "No unread notifications" : "No notifications of these types",
                body: "You are all caught up.",
                action: button({
                  label: "Show everything",
                  onClick: () => {
                    st.filter = "all";
                    st.types.clear();
                    filterSeg.set("all");
                    fetchList();
                  },
                }),
              })
            : emptyState({
                icon: "bell",
                title: "No notifications yet",
                body: "Points, orders, approvals and mentions will show up here.",
              }),
        );
        paintMore();
        return;
      }
      status.textContent = st.unread ? `${st.unread} unread` : "All read";
      const now = clockStore.get().virtual_now;
      const by = new Map();
      for (const n of st.items) {
        const b = dayBucket(n.created_at);
        if (!by.has(b)) by.set(b, []);
        by.get(b).push(n);
      }
      for (const b of BUCKETS) {
        const group = by.get(b);
        if (!group) continue;
        const id = uid("fd");
        listHost.append(
          h(
            "section",
            { class: "w-feed__day", "aria-labelledby": id },
            h("h3", { class: "w-feed__daytitle", id }, b),
            h("ul", { class: "w-nlist" }, ...group.map((n) => rowNode(n, arrived, now))),
          ),
        );
      }
      paintMore();
    }

    // ---- realtime ----

    life.add(
      rt.on("notification.created", (ev) => {
        const n = ev.payload.notification;
        if (st.types.size && !st.types.has(n.type)) return;
        if (st.items.some((x) => x.notification_id === n.notification_id)) return;
        st.items = [n, ...st.items];
        if (!n.read_at) setUnread(st.unread + 1);
        paint([n.notification_id]);
        announceNew();
      }),
    );
    life.add(
      rt.on("notification.read", (ev) => {
        const { ids, unread_count } = ev.payload;
        const stamp = clockStore.get().virtual_now;
        for (const n of st.items)
          if (!n.read_at && (ids === null || ids.includes(n.notification_id))) n.read_at = stamp;
        setUnread(unread_count);
        paint();
      }),
    );
    ctx.setState("loading");
    fetchList();
    return () => life.dispose();
  },
};
