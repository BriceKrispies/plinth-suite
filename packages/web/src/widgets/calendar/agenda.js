// calendar.agenda: the next N days as a list grouped by day. Publishes date.selected when a day heading is chosen
// and follows date.selected from a month calendar on the same page.
import { schemaOf } from "../../core/widgets.js";
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { emptyState, skeleton, errorState } from "../../ds/js/states.js";
import { lifecycle, debounce, nowIso, chipFilter, arrive } from "../promotions/_kit.js";
import {
  TYPES,
  TYPE_META,
  ymd,
  addDaysKey,
  groupByDay,
  dayLabel,
  entryRow,
  safeIcon,
  entryTime,
  busId,
} from "./_model.js";

const LIMIT = { s: 4, m: 12, l: 40 };

export default {
  id: "calendar.agenda",
  domain: "calendar",
  title: "Agenda",
  configSchema: schemaOf("calendar.agenda"),
  sizes: ["s", "m", "l"],
  mount(el, { config, size, api, rt, bus, ctx }) {
    const life = lifecycle();
    const days = Math.max(1, Math.min(31, config.days ?? 7));
    const baseTypes = config.types?.length ? config.types : TYPES;
    const st = {
      types: new Set(baseTypes),
      entries: [],
      virtualNow: nowIso(),
      focus: null, // { from, to } day keys from date.selected
      known: new Set(),
      loaded: false,
    };
    const head = h("div", { class: "wc-agenda__head" });
    const body = h("div", { class: "wc-agenda__body" });
    el.append(h("div", { class: `wc wc-agenda wc-agenda--${size}` }, head, body));

    const filter =
      size === "l" && baseTypes.length > 1
        ? chipFilter({
            label: "Show event types",
            value: [...st.types],
            options: baseTypes.map((t) => ({ value: t, label: TYPE_META[t].label })),
            onChange: (v) => {
              st.types = new Set(v);
              load();
            },
          })
        : null;

    const range = () => {
      const start = ymd(st.virtualNow);
      return { from: `${start}T00:00:00.000Z`, to: `${addDaysKey(start, days)}T00:00:00.000Z`, start };
    };

    let seq = 0;
    const load = async ({ fresh = false } = {}) => {
      const mine = ++seq;
      const r = range();
      if (!st.loaded) body.replaceChildren(skeleton({ shape: "text", lines: 4 }));
      else body.setAttribute("aria-busy", "true");
      if (st.types.size === 0) {
        st.entries = [];
        body.removeAttribute("aria-busy");
        paint();
        return;
      }
      try {
        const out = await api.call("calendar.range", { from: r.from, to: r.to, types: [...st.types] });
        if (life.dead || mine !== seq) return;
        const before = st.known;
        st.entries = out.items;
        st.virtualNow = out.virtual_now ?? st.virtualNow;
        st.known = new Set(out.items.map((e) => e.id));
        const added = st.loaded && fresh ? out.items.filter((e) => !before.has(e.id)).map((e) => e.id) : [];
        st.loaded = true;
        body.removeAttribute("aria-busy");
        paint();
        for (const id of added) arrive(life, body.querySelector(`[data-entry="${CSS.escape(id)}"]`), false);
        if (added.length) ctx.announce(`${added.length} new on the agenda`);
      } catch (e) {
        if (life.dead || mine !== seq) return;
        body.removeAttribute("aria-busy");
        body.replaceChildren(errorState({ error: e, retry: load }));
      }
    };

    const open = (e) => {
      const id = busId(e);
      if (e.type === "promotion" && id) bus.publish("promotion.selected", { id });
    };

    function paint() {
      const r = range();
      const keys = Array.from({ length: days }, (_, i) => addDaysKey(r.start, i));
      const showKeys = st.focus ? keys.filter((k) => k >= st.focus.from && k <= st.focus.to) : keys;
      // a multi-day window is listed once, on the first visible day it covers
      const by = groupByDay(st.entries, showKeys, { once: true });
      const total = showKeys.reduce((n, k) => n + by[k].length, 0);
      ctx.setCount(st.focus ? total : st.entries.length);
      head.replaceChildren();
      if (filter) head.append(filter);
      if (st.focus)
        head.append(
          h(
            "p",
            { class: "wc-agenda__focus" },
            `Showing ${st.focus.from === st.focus.to ? dayLabel(st.focus.from, r.start) : `${dayLabel(st.focus.from, r.start)} to ${dayLabel(st.focus.to, r.start)}`}`,
            button({
              label: "Show all",
              size: "sm",
              variant: "ghost",
              onClick: () => {
                st.focus = null;
                paint();
              },
            }),
          ),
        );
      body.replaceChildren();
      if (st.types.size === 0) {
        body.append(
          emptyState({ icon: "filter", title: "No types selected", body: "Choose at least one event type." }),
        );
        return;
      }
      if (total === 0) {
        body.append(
          emptyState({
            icon: "calendar",
            title: st.focus
              ? "Nothing on those days"
              : `Nothing in the next ${days} day${days === 1 ? "" : "s"}`,
            body: st.focus
              ? undefined
              : "Promotion windows, content schedules, cron fires, expiry and due dates appear here.",
          }),
        );
        return;
      }
      if (size === "s") {
        const flat = showKeys.flatMap((k) => by[k].map((e) => ({ e, k }))).slice(0, LIMIT.s);
        body.append(
          h(
            "ul",
            { class: "wc-agenda__compact", role: "list" },
            ...flat.map(({ e, k }) =>
              h(
                "li",
                {},
                h(
                  "a",
                  {
                    class: `wc-mini wc-tone--${e.tone ?? "neutral"}`,
                    href: e.href,
                    "data-entry": e.id,
                    onclick: () => open(e),
                  },
                  safeIcon(e.icon, TYPE_META[e.type]?.icon),
                  h("span", { class: "wc-mini__title" }, e.title),
                  h(
                    "span",
                    { class: "wc-mini__when u-muted" },
                    `${dayLabel(k, r.start).split(",")[0]} ${entryTime(e, k).replace(" UTC", "")}`,
                  ),
                ),
              ),
            ),
          ),
        );
        const hidden = total - flat.length;
        if (hidden > 0) body.append(h("p", { class: "u-muted" }, `and ${hidden} more`));
        return;
      }
      let shown = 0;
      for (const k of showKeys) {
        if (by[k].length === 0) continue;
        const list = by[k].slice(0, Math.max(0, LIMIT[size] - shown));
        shown += list.length;
        if (list.length === 0) break;
        body.append(
          h(
            "section",
            { class: "wc-agenda__day", "aria-label": dayLabel(k, r.start) },
            h(
              "h3",
              { class: "wc-agenda__dayhead" },
              h(
                "button",
                {
                  type: "button",
                  class: "wc-agenda__daybtn",
                  "aria-label": `Focus ${dayLabel(k, r.start)}`,
                  onclick: () => {
                    bus.publish("date.selected", { from: k, to: k });
                  },
                },
                dayLabel(k, r.start),
              ),
              h("span", { class: "u-muted u-tabular" }, ` ${by[k].length}`),
            ),
            h(
              "div",
              { class: "wc-agenda__list" },
              ...list.map((e) => {
                const row = entryRow(e, k, { onOpen: open });
                row.dataset.entry = e.id;
                return row;
              }),
            ),
          ),
        );
      }
      if (shown < total) body.append(h("p", { class: "u-muted" }, `and ${total - shown} more`));
    }

    load();

    // follow a date chosen on a month calendar
    life.add(
      bus.subscribe("date.selected", (p) => {
        if (!p?.from) return;
        st.focus = { from: String(p.from).slice(0, 10), to: String(p.to ?? p.from).slice(0, 10) };
        paint();
      }),
    );
    const latest = bus.latest?.("date.selected");
    if (latest?.from)
      st.focus = {
        from: String(latest.from).slice(0, 10),
        to: String(latest.to ?? latest.from).slice(0, 10),
      };

    const refresh = debounce(life, () => load({ fresh: true }), 600);
    life.add(rt.on("promotion.state_changed", refresh));
    life.add(rt.on("content.state_changed", refresh));

    return () => life.dispose();
  },
};
