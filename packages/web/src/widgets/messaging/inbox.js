// messaging.inbox: folders, thread list, search, bulk actions; opens a thread through the page bus or inside itself.
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { button, iconButton, linkButton } from "../../ds/js/button.js";
import { searchField } from "../../ds/js/field.js";
import { emptyState, errorState } from "../../ds/js/states.js";
import { countBadge } from "../../ds/js/count-badge.js";
import { avatar } from "../../ds/js/avatar.js";
import { toErrorInfo } from "../../core/api.js";
import {
  lifecycle,
  debounce,
  sequence,
  segmented,
  ago,
  when,
  safeIcon,
  errorText,
  myHandle,
  link,
  highlight,
  markArrived,
  batchAnnouncer,
  plural,
} from "../../shell/kit.js";
import { createThreadView } from "./_thread-view.js";

const FOLDERS = [
  ["inbox", "Inbox"],
  ["sent", "Sent"],
  ["starred", "Starred"],
  ["archived", "Archived"],
];

const EMPTY = {
  inbox: ["inbox", "You are all caught up", "New conversations will appear here."],
  sent: ["send", "Nothing sent yet", "Conversations you start or reply to are listed here."],
  starred: ["star", "No starred conversations", "Star a conversation to keep it close."],
  archived: ["archive", "Nothing archived", "Archived conversations are kept here."],
};

const belongs = (folder, t) => {
  if (folder === "inbox") return !t.archived;
  if (folder === "starred") return t.starred;
  if (folder === "archived") return t.archived;
  return true;
};

export default {
  id: "messaging.inbox",
  domain: "messaging",
  title: "Inbox",
  configSchema: schemaOf("messaging.inbox"),
  sizes: ["m", "l", "xl", "full"],
  mount(el, { config, size, api, rt, bus, ctx }) {
    const life = lifecycle();
    const pageSize = config.page_size ?? 25;
    const mode = config.open_in === "widget" ? "widget" : "bus";
    const st = {
      folder: config.folder ?? "inbox",
      unreadOnly: Boolean(config.unread_only),
      q: "",
      items: [],
      next: null,
      counts: { inbox_unread: 0, starred: 0, archived: 0 },
      selected: new Set(),
      active: ctx.params?.thread ?? bus.latest?.("thread.selected")?.id ?? null,
      loaded: false,
      error: null,
      busy: false,
    };
    const seq = sequence();
    const announceNew = batchAnnouncer(ctx, life, (n) => `${plural(n, "new message")} in your inbox`);

    const root = h("div", { class: "w-inbox", "data-size": size, "data-mode": mode });
    const listPane = h("div", { class: "w-inbox__list" });
    const threadPane = h("div", { class: "w-inbox__thread" });
    root.append(listPane);

    let view = null;
    if (mode === "widget") {
      view = createThreadView({
        api,
        rt,
        ctx,
        life,
        allowAddPeople: false,
        listenSent: true,
        onBack: () => closeThread(),
        emptyBody: "Choose a conversation from the list.",
      });
      threadPane.append(view.el);
      root.append(threadPane);
    }

    // ---- toolbar ----

    const folderSeg = segmented({
      label: "Folder",
      options: FOLDERS.map(([value, label]) => ({ value, label })),
      value: st.folder,
      onChange: (v) => {
        st.folder = v;
        st.selected.clear();
        fetchList();
      },
    });
    const search = searchField({
      name: "q",
      label: "Search conversations",
      placeholder: "Search subject and messages",
      onInput: (v) => {
        st.q = v.trim();
        debouncedFetch();
      },
    });
    search.classList.add("w-bar__search");
    const unreadBtn = button({
      label: "Unread only",
      icon: "filter",
      size: "sm",
      pressed: st.unreadOnly,
      onClick: () => {
        st.unreadOnly = !st.unreadOnly;
        unreadBtn.setAttribute("aria-pressed", String(st.unreadOnly));
        fetchList();
      },
    });
    const refreshBtn = iconButton({
      icon: "history",
      label: "Refresh inbox",
      size: "sm",
      onClick: () => fetchList(),
    });
    const compose = linkButton({
      href: link("/messages/new"),
      label: "New message",
      icon: "plus",
      variant: "primary",
      size: "sm",
    });
    const bar = h(
      "div",
      { class: "w-bar", role: "group", "aria-label": "Inbox filters" },
      h(
        "div",
        { class: "w-bar__row" },
        folderSeg,
        h("span", { class: "w-bar__spacer" }),
        refreshBtn,
        compose,
      ),
      h("div", { class: "w-bar__row" }, search, unreadBtn),
    );
    const debouncedFetch = debounce(() => fetchList(), 250);
    life.add(debouncedFetch.cancel);

    const selectAll = h("input", {
      type: "checkbox",
      class: "w-bulk__all",
      "aria-label": "Select all conversations",
    });
    selectAll.addEventListener("change", () => {
      if (selectAll.checked) for (const t of st.items) st.selected.add(t.thread_id);
      else st.selected.clear();
      paintList();
    });
    const bulk = h("div", { class: "w-bulk", role: "group", "aria-label": "Bulk actions" });
    const summary = h("p", { class: "w-summary", role: "status" });
    const listHost = h("ul", { class: "w-threads", "aria-label": "Conversations" });
    const more = h("div", { class: "w-more" });
    listPane.append(bar, h("div", { class: "w-listhead" }, selectAll, summary), listHost, more, bulk);

    // ---- data ----

    const applyCounts = (c) => {
      st.counts = c;
      folderSeg.setCount("inbox", c.inbox_unread);
      folderSeg.setCount("starred", c.starred);
      folderSeg.setCount("archived", c.archived);
      ctx.setCount(c.inbox_unread);
    };

    const query = (extra = {}) => ({
      folder: st.folder,
      ...(st.q ? { q: st.q } : {}),
      ...(st.unreadOnly ? { unread_only: true } : {}),
      limit: pageSize,
      ...extra,
    });

    async function fetchList() {
      const mine = seq.next();
      st.busy = true;
      listPane.setAttribute("aria-busy", "true");
      try {
        const out = await api.call("messages.list", query());
        if (!seq.ok(mine) || life.dead) return;
        st.items = out.items;
        st.next = out.next_cursor;
        st.error = null;
        applyCounts(out.folder_counts);
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
          listPane.removeAttribute("aria-busy");
        }
      }
      if (!st.loaded) {
        st.loaded = true;
        ctx.setState("ready");
      }
      st.selected = new Set([...st.selected].filter((id) => st.items.some((t) => t.thread_id === id)));
      paintList();
    }

    async function loadMore() {
      if (!st.next || st.busy) return;
      const mine = seq.next();
      st.busy = true;
      paintMore();
      try {
        const out = await api.call("messages.list", query({ cursor: st.next }));
        if (!seq.ok(mine) || life.dead) return;
        const have = new Set(st.items.map((t) => t.thread_id));
        st.items = [...st.items, ...out.items.filter((t) => !have.has(t.thread_id))];
        st.next = out.next_cursor;
        applyCounts(out.folder_counts);
      } catch (e) {
        if (!seq.ok(mine) || life.dead) return;
        ctx.toast({ title: "Could not load more", body: errorText(e), tone: "danger" });
      } finally {
        if (seq.ok(mine)) st.busy = false;
      }
      paintList({ keepFocus: true });
    }

    /** Re-read the first page and merge it in, marking what a realtime event changed. */
    async function refreshHead({ arriveNew = false } = {}) {
      const mine = seq.next();
      let out;
      try {
        out = await api.call("messages.list", query());
      } catch {
        return;
      }
      if (!seq.ok(mine) || life.dead) return;
      const before = new Map(st.items.map((t) => [t.thread_id, t]));
      const arrived = [];
      for (const t of out.items) {
        const old = before.get(t.thread_id);
        if (arriveNew && (!old || old.last_message_at !== t.last_message_at)) arrived.push(t.thread_id);
      }
      const ids = new Set(out.items.map((t) => t.thread_id));
      let tail = [];
      let next = out.next_cursor;
      if (out.next_cursor !== null && st.items.length > out.items.length) {
        const oldest = out.items[out.items.length - 1]?.last_message_at ?? "";
        tail = st.items.filter((t) => !ids.has(t.thread_id) && t.last_message_at < oldest);
        if (tail.length) next = st.next;
      }
      st.items = [...out.items, ...tail];
      st.next = next;
      applyCounts(out.folder_counts);
      paintList({ keepFocus: true, arrived });
      if (arrived.length) for (let i = 0; i < arrived.length; i += 1) announceNew();
    }
    const debouncedHead = debounce(refreshHead, 300);
    life.add(debouncedHead.cancel);

    // ---- state changes: optimistic with rollback ----

    async function applyState(ids, patch, doneText) {
      if (ids.length === 0) return;
      const snapshot = st.items.map((t) => ({ ...t }));
      const removed = [];
      st.items = st.items.flatMap((t) => {
        if (!ids.includes(t.thread_id)) return [t];
        const next = { ...t, ...patch };
        if (patch.read === true) next.unread_count = 0;
        if (patch.read === false) next.unread_count = Math.max(1, t.unread_count);
        delete next.read;
        if (!belongs(st.folder, next)) {
          removed.push(t.thread_id);
          return [];
        }
        return [next];
      });
      for (const id of ids) st.selected.delete(id);
      paintList({ keepFocus: true });
      try {
        if (ids.length === 1) await api.call("messages.state", { thread_id: ids[0], ...patch });
        else await api.call("messages.bulk_state", { thread_ids: ids, ...patch });
        if (doneText) ctx.announce(doneText);
        debouncedHead();
      } catch (e) {
        if (life.dead) return;
        st.items = snapshot;
        paintList({ keepFocus: true });
        ctx.toast({ title: "Could not update conversations", body: errorText(e), tone: "danger" });
      }
    }

    // ---- selecting a thread ----

    function openThread(t) {
      st.active = t.thread_id;
      if (mode === "widget") {
        root.dataset.open = "true";
        view.open(t.thread_id);
      } else {
        bus.publish("thread.selected", { id: t.thread_id });
      }
      paintList({ keepFocus: true });
    }
    function closeThread() {
      root.removeAttribute("data-open");
      st.active = null;
      view?.clear();
      paintList({ keepFocus: true });
    }

    // ---- painting ----

    const names = (t) => {
      const me = myHandle();
      const others = t.participants.filter((p) => p.handle !== me);
      if (others.length === 0) return "Only you";
      const shown = others.slice(0, 2).map((p) => p.display_name.split(" ")[0]);
      const rest = t.participant_count - 1 - shown.length;
      return `${shown.join(", ")}${rest > 0 ? ` +${rest}` : ""}`;
    };

    const rowNode = (t, arrivedIds) => {
      const unread = t.unread_count > 0;
      const sender = t.last_sender;
      const li = h("li", {
        class: `w-trow${unread ? " w-trow--unread" : ""}${st.active === t.thread_id ? " w-trow--active" : ""}`,
        "data-id": t.thread_id,
      });
      const check = h("input", {
        type: "checkbox",
        class: "w-trow__check",
        checked: st.selected.has(t.thread_id) ? true : null,
        "aria-label": `Select ${t.subject}`,
      });
      check.addEventListener("change", () => {
        if (check.checked) st.selected.add(t.thread_id);
        else st.selected.delete(t.thread_id);
        paintBulk();
      });
      const star = iconButton({
        icon: "star",
        label: t.starred ? `Unstar ${t.subject}` : `Star ${t.subject}`,
        size: "sm",
        pressed: t.starred,
        onClick: () =>
          applyState([t.thread_id], { starred: !t.starred }, t.starred ? "Star removed" : "Starred"),
      });
      star.classList.add("w-trow__star");
      const main = h(
        "button",
        {
          type: "button",
          class: "w-trow__main",
          "aria-current": st.active === t.thread_id ? "true" : null,
          "aria-keyshortcuts": "S E U",
          onclick: () => openThread(t),
        },
        avatar({ name: sender.display_name, avatar: sender.avatar, size: "md" }),
        h(
          "span",
          { class: "w-trow__text" },
          h(
            "span",
            { class: "w-trow__line" },
            h("span", { class: "w-trow__who" }, names(t)),
            h(
              "time",
              { class: "w-trow__time", datetime: t.last_message_at, title: when(t.last_message_at) },
              ago(t.last_message_at),
            ),
          ),
          h(
            "span",
            { class: "w-trow__line" },
            h("span", { class: "w-trow__subject" }, ...highlight(t.subject, st.q)),
            t.has_attachments ? safeIcon("attachment", "link", { size: 16 }) : null,
            t.mentioned ? safeIcon("mention", "info", { size: 16 }) : null,
            t.muted ? safeIcon("eye-off", "eye", { size: 16 }) : null,
          ),
          h(
            "span",
            { class: "w-trow__preview" },
            sender.handle === myHandle() ? "You: " : "",
            ...highlight(t.preview, st.q),
          ),
        ),
        unread ? countBadge(t.unread_count, { label: "unread messages" }) : null,
      );
      main.addEventListener("keydown", (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const k = e.key.toLowerCase();
        if (k === "s") applyState([t.thread_id], { starred: !t.starred });
        else if (k === "e") applyState([t.thread_id], { archived: !t.archived });
        else if (k === "u") applyState([t.thread_id], { read: unread });
        else return;
        e.preventDefault();
      });
      li.append(check, star, main);
      if (arrivedIds.includes(t.thread_id)) markArrived(li, life, ".w-trow__line");
      return li;
    };

    listHost.addEventListener("keydown", (e) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const mains = [...listHost.querySelectorAll(".w-trow__main")];
      const i = mains.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const n =
        e.key === "Home" ? 0 : e.key === "End" ? mains.length - 1 : i + (e.key === "ArrowDown" ? 1 : -1);
      mains[Math.max(0, Math.min(mains.length - 1, n))]?.focus();
    });

    function paintBulk() {
      clear(bulk);
      const ids = [...st.selected];
      bulk.hidden = ids.length === 0;
      selectAll.checked = st.items.length > 0 && ids.length === st.items.length;
      selectAll.indeterminate = ids.length > 0 && ids.length < st.items.length;
      if (ids.length === 0) return;
      const picked = st.items.filter((t) => st.selected.has(t.thread_id));
      const allStarred = picked.every((t) => t.starred);
      const anyUnread = picked.some((t) => t.unread_count > 0);
      bulk.append(
        h("span", { class: "w-bulk__count u-tabular" }, `${ids.length} selected`),
        button({
          label: anyUnread ? "Mark read" : "Mark unread",
          icon: "check",
          size: "sm",
          onClick: () => applyState(ids, { read: anyUnread }, anyUnread ? "Marked read" : "Marked unread"),
        }),
        button({
          label: allStarred ? "Unstar" : "Star",
          icon: "star",
          size: "sm",
          onClick: () => applyState(ids, { starred: !allStarred }, allStarred ? "Stars removed" : "Starred"),
        }),
        button({
          label: st.folder === "archived" ? "Move to inbox" : "Archive",
          icon: "archive",
          size: "sm",
          onClick: () =>
            applyState(
              ids,
              { archived: st.folder !== "archived" },
              st.folder === "archived" ? "Moved to inbox" : "Archived",
            ),
        }),
        button({
          label: "Clear",
          variant: "ghost",
          size: "sm",
          onClick: () => {
            st.selected.clear();
            paintList({ keepFocus: true });
          },
        }),
      );
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

    function paintList({ keepFocus = false, arrived = [] } = {}) {
      const focusId = keepFocus ? document.activeElement?.closest?.(".w-trow")?.dataset.id : null;
      const hadFocusInList = keepFocus && listHost.contains(document.activeElement);
      clear(listHost);
      const unreadTotal = st.counts.inbox_unread;
      if (st.error && st.items.length === 0) {
        summary.textContent = "";
        listHost.append(
          h(
            "li",
            { class: "w-empty" },
            errorState({
              error: { ...toErrorInfo(st.error), message: errorText(st.error) },
              retry: () => fetchList(),
            }),
          ),
        );
      } else if (st.items.length === 0) {
        summary.textContent = "";
        const filtered = st.q || st.unreadOnly;
        const [ic, title, body] = EMPTY[st.folder];
        listHost.append(
          h(
            "li",
            { class: "w-empty" },
            filtered
              ? emptyState({
                  icon: "search",
                  title: st.q ? `No results for ‘${st.q}’` : "No unread conversations",
                  body: "Try a different search or clear the filters.",
                  action: button({
                    label: "Clear filters",
                    onClick: () => {
                      st.q = "";
                      st.unreadOnly = false;
                      unreadBtn.setAttribute("aria-pressed", "false");
                      const input = search.querySelector("input");
                      if (input) input.value = "";
                      fetchList();
                    },
                  }),
                })
              : emptyState({
                  icon: ic,
                  title,
                  body,
                  action:
                    st.folder === "inbox"
                      ? linkButton({
                          href: link("/messages/new"),
                          label: "Write a message",
                          icon: "plus",
                          variant: "primary",
                        })
                      : null,
                }),
          ),
        );
      } else {
        summary.textContent = st.q
          ? `${plural(st.items.length, "conversation")}${st.next ? " so far" : ""} for ‘${st.q}’`
          : st.folder === "inbox"
            ? unreadTotal
              ? `${unreadTotal} unread`
              : "All read"
            : plural(st.items.length, "conversation") + (st.next ? "+" : "");
        for (const t of st.items) listHost.append(rowNode(t, arrived));
      }
      paintBulk();
      paintMore();
      if (focusId && hadFocusInList)
        listHost.querySelector(`[data-id="${CSS.escape(focusId)}"] .w-trow__main`)?.focus();
    }

    // ---- realtime and bus ----

    life.add(
      rt.on("message.received", () => {
        debouncedHead.cancel();
        refreshHead({ arriveNew: true });
      }),
    );
    life.add(rt.on("message.sent", () => debouncedHead()));
    life.add(
      rt.on("message.state_changed", (ev) => {
        const p = ev.payload;
        let changed = false;
        st.items = st.items.flatMap((t) => {
          if (!p.thread_ids.includes(t.thread_id)) return [t];
          const next = { ...t };
          for (const k of ["starred", "archived", "muted"]) if (typeof p[k] === "boolean") next[k] = p[k];
          if (p.read === true) next.unread_count = 0;
          if (p.read === false) next.unread_count = Math.max(1, t.unread_count);
          changed = true;
          return belongs(st.folder, next) ? [next] : [];
        });
        if (changed) paintList({ keepFocus: true });
        debouncedHead();
      }),
    );
    life.add(
      bus.subscribe("thread.selected", (payload) => {
        if (!payload?.id || payload.id === st.active) return;
        st.active = payload.id;
        paintList({ keepFocus: true });
      }),
    );

    el.append(root);
    ctx.setState("loading");
    fetchList();
    if (mode === "widget" && st.active) {
      root.dataset.open = "true";
      view.open(st.active);
    }
    return () => life.dispose();
  },
};
