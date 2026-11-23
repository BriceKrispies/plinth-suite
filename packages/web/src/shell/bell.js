// The bell: an unread count and a popover with the latest notifications, live while it is open.
import { h, clear, announce } from "../ds/js/dom.js";
import { iconButton, button, linkButton } from "../ds/js/button.js";
import { countBadge, updateCount } from "../ds/js/count-badge.js";
import { popover } from "../ds/js/popover.js";
import { emptyState } from "../ds/js/states.js";
import { toast } from "../ds/js/toast.js";
import * as api from "../core/api.js";
import * as rt from "../core/rt.js";
import * as router from "../core/router.js";
import { countsStore, clockStore } from "../core/stores.js";
import { notificationRow, errorText, arrive, plural } from "./kit.js";

const LIMIT = 8;

export const createBell = () => {
  const trigger = iconButton({ icon: "bell", label: "Notifications" });
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  const badge = countBadge(countsStore.get().notifications_unread ?? 0, { label: "unread" });
  countsStore.subscribe((c) => updateCount(badge, c.notifications_unread ?? 0));
  const el = h("span", { class: "app__badged" }, trigger, badge);

  let handle = null;
  let closedAt = 0;
  trigger.addEventListener("click", () => {
    if (handle) {
      handle.close();
      return;
    }
    // A press on the trigger light-dismisses the popover first; do not reopen it from the same click.
    if (performance.now() - closedAt < 250) return;
    handle = open();
  });

  function open() {
    const st = { items: [], unread: countsStore.get().notifications_unread ?? 0, loaded: false, error: null };
    const offs = [];
    const list = h("ul", { class: "w-bell__list", "aria-label": "Latest notifications" });
    const count = h("span", { class: "w-bell__count u-tabular" });
    const markAll = button({
      label: "Mark all read",
      icon: "check",
      size: "sm",
      variant: "ghost",
      onClick: () => markAllRead(),
    });
    const body = h(
      "div",
      { class: "w-bell", "aria-label": "Notifications" },
      h(
        "header",
        { class: "w-bell__head" },
        h("h2", { class: "w-bell__title" }, "Notifications"),
        count,
        markAll,
      ),
      list,
      h(
        "footer",
        { class: "w-bell__foot" },
        linkButton({
          href: router.href("/notifications"),
          label: "Open all",
          icon: "bell",
          variant: "secondary",
          size: "sm",
        }),
        linkButton({
          href: router.href("/settings"),
          label: "Preferences",
          icon: "settings",
          variant: "ghost",
          size: "sm",
        }),
      ),
    );
    const pop = popover(trigger, body, {
      placement: "bottom-end",
      label: "Notifications",
      onClose: () => {
        offs.forEach((off) => off());
        handle = null;
        closedAt = performance.now();
      },
    });
    body.addEventListener("click", (e) => {
      if (e.target.closest("a[href]")) setTimeout(() => pop.close(), 0);
    });

    const paintHead = () => {
      count.textContent = st.unread ? `${st.unread} unread` : "All read";
      markAll.disabled = st.unread === 0;
    };

    const paint = (arrivedId) => {
      clear(list);
      paintHead();
      if (!st.loaded) {
        list.append(h("li", { class: "c-state c-state--loading", role: "status" }, "Loading notifications"));
        return;
      }
      if (st.error) {
        list.append(
          h(
            "li",
            { class: "w-bell__empty" },
            h("p", { class: "w-hint w-hint--error" }, errorText(st.error)),
            button({ label: "Try again", size: "sm", onClick: load }),
          ),
        );
        return;
      }
      if (st.items.length === 0) {
        list.append(
          h(
            "li",
            { class: "w-bell__empty" },
            emptyState({ icon: "bell", title: "Nothing yet", body: "New notifications show up here." }),
          ),
        );
        return;
      }
      const now = clockStore.get().virtual_now;
      for (const n of st.items) {
        const unread = !n.read_at;
        const main = n.link
          ? h(
              "a",
              {
                class: "w-bell__main",
                href: router.href(n.link),
                onclick: () => setTimeout(() => markRead(n), 0),
              },
              notificationRow(n, { compact: true, now }),
            )
          : h(
              "button",
              { type: "button", class: "w-bell__main", onclick: () => markRead(n) },
              notificationRow(n, { compact: true, now }),
            );
        const li = h(
          "li",
          { class: `w-bell__item${unread ? " w-bell__item--unread" : ""}`, "data-id": n.notification_id },
          unread
            ? h("span", { class: "w-nrow__dot", role: "img", "aria-label": "Unread" })
            : h("span", { class: "w-nrow__dot w-nrow__dot--read", "aria-hidden": "true" }),
          main,
        );
        if (arrivedId === n.notification_id) arrive(li);
        list.append(li);
      }
    };

    async function load() {
      st.loaded = false;
      st.error = null;
      paint();
      try {
        const out = await api.call("notifications.list", { limit: LIMIT });
        st.items = out.items;
        st.unread = out.unread_count;
      } catch (e) {
        st.error = e;
      }
      st.loaded = true;
      if (handle) paint();
    }

    async function markRead(n) {
      if (n.read_at) return;
      n.read_at = clockStore.get().virtual_now;
      st.unread = Math.max(0, st.unread - 1);
      if (handle) paint();
      try {
        const out = await api.call("notifications.read", { ids: [n.notification_id] });
        st.unread = out.unread_count;
        if (handle) paintHead();
      } catch (e) {
        n.read_at = null;
        st.unread += 1;
        if (handle) paint();
        toast({ title: "Could not mark as read", body: errorText(e), tone: "danger" });
      }
    }

    async function markAllRead() {
      const stamp = clockStore.get().virtual_now;
      const before = st.items.map((n) => n.read_at);
      for (const n of st.items) n.read_at ??= stamp;
      st.unread = 0;
      paint();
      try {
        const out = await api.call("notifications.read_all", {});
        st.unread = out.unread_count;
        if (handle) paintHead();
        announce(out.marked ? `${plural(out.marked, "notification")} marked read` : "Nothing to mark");
      } catch (e) {
        st.items.forEach((n, i) => (n.read_at = before[i]));
        st.unread = st.items.filter((n) => !n.read_at).length;
        if (handle) paint();
        toast({ title: "Could not mark all read", body: errorText(e), tone: "danger" });
      }
    }

    offs.push(
      rt.on("notification.created", (ev) => {
        const n = ev.payload.notification;
        if (st.items.some((x) => x.notification_id === n.notification_id)) return;
        st.items = [n, ...st.items].slice(0, LIMIT);
        if (!n.read_at) st.unread += 1;
        paint(n.notification_id);
      }),
      rt.on("notification.read", (ev) => {
        const { ids, unread_count } = ev.payload;
        const stamp = clockStore.get().virtual_now;
        for (const n of st.items)
          if (!n.read_at && (ids === null || ids.includes(n.notification_id))) n.read_at = stamp;
        st.unread = unread_count;
        paint();
      }),
    );

    list.addEventListener("keydown", (e) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const rows = [...list.querySelectorAll(".w-bell__main")];
      const i = rows.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const n =
        e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : i + (e.key === "ArrowDown" ? 1 : -1);
      rows[Math.max(0, Math.min(rows.length - 1, n))]?.focus();
    });

    load();
    return pop;
  }

  return el;
};
