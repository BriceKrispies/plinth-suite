// people.activity: a member's activity timeline (own: everything; others: public events).
import { schemaOf } from "../../core/widgets.js";
import { h, clear, uid } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { emptyState, errorState } from "../../ds/js/states.js";
import { ICON_PATHS } from "../../ds/js/icons.js";
import { timeline } from "../../ds/js/timeline.js";
import { pill } from "../../ds/js/pill.js";
import { toErrorInfo } from "../../core/api.js";
import { clockStore } from "../../core/stores.js";
import {
  lifecycle,
  debounce,
  sequence,
  errorText,
  link,
  myHandle,
  dayBucket,
  plural,
} from "../../shell/kit.js";

const CATEGORIES = [
  { id: "points", label: "Points", types: ["points.posted", "points.expiring", "tier.changed"] },
  { id: "badges", label: "Badges", types: ["badge.awarded", "badge.revoked", "badge.progress"] },
  { id: "store", label: "Store", types: ["order.placed", "order.status_changed", "review.created"] },
  { id: "content", label: "Content", types: ["content.published", "content.engaged"] },
  {
    id: "work",
    label: "Work",
    types: ["task.assigned", "task.updated", "approval.requested", "approval.decided"],
  },
];
const TONE = {
  "badge.awarded": "success",
  "tier.changed": "signal",
  "points.expiring": "warning",
  "approval.requested": "warning",
  "order.placed": "info",
  "points.posted": "info",
};
const BUCKETS = ["Today", "Yesterday", "This week", "Earlier"];

export default {
  id: "people.activity",
  domain: "people",
  title: "Activity",
  configSchema: schemaOf("people.activity"),
  sizes: ["m", "l", "xl"],
  mount(el, { config, size, api, rt, bus, ctx }) {
    const life = lifecycle();
    const seq = sequence();
    const pageSize = config.page_size ?? 20;
    const defaultHandle = ctx.memberHandle(config.member);
    const fixedTypes = config.types ?? [];
    const st = {
      handle: defaultHandle,
      cats: new Set(),
      items: [],
      next: null,
      loaded: false,
      busy: false,
      error: null,
    };
    const root = h("div", { class: "w-act", "data-size": size });
    el.append(root);

    const strip = h("p", { class: "w-pcard__strip", hidden: true });
    const catButtons = new Map();
    const filterRow = h("div", { class: "w-seg", role: "group", "aria-label": "Activity types" });
    const allBtn = button({
      label: "Everything",
      size: "sm",
      pressed: true,
      onClick: () => setCats(new Set()),
    });
    filterRow.append(allBtn);
    for (const c of CATEGORIES) {
      const b = button({
        label: c.label,
        size: "sm",
        pressed: false,
        onClick: () => {
          const next = new Set(st.cats);
          if (next.has(c.id)) next.delete(c.id);
          else next.add(c.id);
          setCats(next);
        },
      });
      catButtons.set(c.id, b);
      filterRow.append(b);
    }
    const bar = h(
      "div",
      { class: "w-bar", role: "group", "aria-label": "Activity filters" },
      h("div", { class: "w-bar__row" }, filterRow),
    );
    const summary = h("p", { class: "w-summary", role: "status" });
    const listHost = h("div", { class: "w-act__list" });
    const more = h("div", { class: "w-more" });
    root.append(strip, bar, summary, listHost, more);
    if (fixedTypes.length) bar.hidden = true;

    function setCats(next) {
      st.cats = next;
      allBtn.setAttribute("aria-pressed", String(next.size === 0));
      for (const [id, b] of catButtons) b.setAttribute("aria-pressed", String(next.has(id)));
      fetchList();
    }

    const types = () => {
      if (fixedTypes.length) return fixedTypes;
      if (st.cats.size === 0) return null;
      return CATEGORIES.filter((c) => st.cats.has(c.id)).flatMap((c) => c.types);
    };
    const isSelf = () => st.handle && st.handle === myHandle();
    const call = (extra = {}) => {
      const t = types();
      const input = { limit: pageSize, ...(t ? { types: t } : {}), ...extra };
      return isSelf()
        ? api.call("me.activity", input)
        : api.call("people.activity", { handle: st.handle, ...input });
    };

    async function fetchList({ live = false } = {}) {
      if (!st.handle) {
        ctx.setState("ready");
        paint();
        return;
      }
      const mine = seq.next();
      st.busy = true;
      root.setAttribute("aria-busy", "true");
      let arrived = [];
      try {
        const out = await call();
        if (!seq.ok(mine) || life.dead) return;
        if (live) {
          const had = new Set(st.items.map((i) => i.seq));
          arrived = out.items.filter((i) => !had.has(i.seq)).map((i) => i.seq);
          const oldest = out.items.at(-1)?.seq ?? 0;
          const tail = out.next_cursor ? st.items.filter((i) => i.seq < oldest) : [];
          st.items = [...out.items, ...tail];
          if (!tail.length) st.next = out.next_cursor;
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
          const info = toErrorInfo(e);
          if (info.code === "UNKNOWN_REFERENCE") ctx.setState("unavailable", { reason: "missing" });
          else ctx.setState("error", { error: info });
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
      paint(arrived);
      if (arrived.length) ctx.announce(`${plural(arrived.length, "new activity", "new activities")}`);
    }

    async function loadMore() {
      if (!st.next || st.busy) return;
      const mine = seq.next();
      st.busy = true;
      paintMore();
      try {
        const out = await call({ cursor: st.next });
        if (!seq.ok(mine) || life.dead) return;
        const have = new Set(st.items.map((i) => i.seq));
        st.items = [...st.items, ...out.items.filter((i) => !have.has(i.seq))];
        st.next = out.next_cursor;
      } catch (e) {
        if (!seq.ok(mine) || life.dead) return;
        ctx.toast({ title: "Could not load more", body: errorText(e), tone: "danger" });
      } finally {
        if (seq.ok(mine)) st.busy = false;
      }
      paint();
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

    function paintStrip() {
      clear(strip);
      strip.hidden = st.handle === defaultHandle;
      if (strip.hidden) return;
      strip.append(
        `Showing @${st.handle}`,
        button({
          label: "Back",
          size: "sm",
          variant: "ghost",
          onClick: () => {
            st.handle = defaultHandle;
            st.items = [];
            fetchList();
          },
        }),
      );
    }

    function paint(arrived = []) {
      paintStrip();
      clear(listHost);
      if (!st.handle) {
        summary.textContent = "";
        listHost.append(
          emptyState({
            icon: "user",
            title: "No member selected",
            body: "Choose a person to see their activity.",
          }),
        );
        paintMore();
        return;
      }
      if (st.error && st.items.length === 0) {
        summary.textContent = "";
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
        summary.textContent = "";
        listHost.append(
          st.cats.size
            ? emptyState({
                icon: "filter",
                title: "Nothing in these categories",
                body: "Try another category.",
                action: button({ label: "Show everything", onClick: () => setCats(new Set()) }),
              })
            : emptyState({
                icon: "history",
                title: "No activity yet",
                body: isSelf()
                  ? "Things you do and earn will be recorded here."
                  : "Public activity will be recorded here.",
              }),
        );
        paintMore();
        return;
      }
      summary.textContent = `${plural(st.items.length, "event")}${st.next ? " so far" : ""}`;
      const now = clockStore.get().virtual_now;
      const by = new Map();
      for (const item of st.items) {
        const b = dayBucket(item.occurred_at);
        if (!by.has(b)) by.set(b, []);
        by.get(b).push(item);
      }
      for (const b of BUCKETS) {
        const group = by.get(b);
        if (!group) continue;
        const id = uid("ah");
        const tl = timeline({
          label: `${b} activity`,
          now,
          items: group.map((i) => ({
            title: i.summary,
            icon: ICON_PATHS[i.icon] ? i.icon : "info",
            tone: TONE[i.type] ?? "neutral",
            at: i.occurred_at,
            href: i.link ? link(i.link) : undefined,
            actor: size === "m" || i.actor.handle === st.handle ? undefined : i.actor,
            body: arrived.includes(i.seq) ? pill({ label: "New", tone: "signal" }) : undefined,
          })),
        });
        tl.querySelectorAll(".c-timeline__item").forEach((node, k) => {
          if (arrived.includes(group[k].seq)) {
            node.classList.add("u-arrive");
            life.timeout(() => node.classList.remove("u-arrive"), 6000);
          }
        });
        listHost.append(
          h(
            "section",
            { class: "w-act__day", "aria-labelledby": id },
            h("h3", { class: "w-feed__daytitle", id }, b),
            tl,
          ),
        );
      }
      paintMore();
    }

    // ---- realtime and bus ----

    const refresh = debounce(() => fetchList({ live: true }), 500);
    life.add(refresh.cancel);
    const about = (member) => {
      const handle = typeof member === "string" ? member : member?.handle;
      return !handle || handle === st.handle;
    };
    for (const type of [
      "badge.awarded",
      "points.posted",
      "content.published",
      "review.created",
      "order.placed",
    ]) {
      life.add(rt.on(type, (ev) => about(ev.payload.member) && refresh()));
    }
    life.add(
      bus.subscribe("member.selected", (p) => {
        if (!p?.id || p.id === st.handle) return;
        st.handle = p.id;
        st.items = [];
        st.next = null;
        fetchList();
      }),
    );

    ctx.setState("loading");
    fetchList();
    return () => life.dispose();
  },
};
