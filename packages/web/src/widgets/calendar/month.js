// calendar.month: month, week and day views of promotion windows, content schedules, cron fires, expiry and due
// dates. The month is an ARIA grid with a roving focus; selecting a day publishes date.selected.
import { schemaOf } from "../../core/widgets.js";
import { h } from "../../ds/js/dom.js";
import { button, iconButton, linkButton } from "../../ds/js/button.js";
import { emptyState, skeleton, errorState } from "../../ds/js/states.js";
import { toolbar } from "../../ds/js/layout.js";
import {
  kv,
  lifecycle,
  debounce,
  segmented,
  chipFilter,
  nowIso,
  when,
  enumLabel,
} from "../promotions/_kit.js";
import {
  TYPES,
  TYPE_META,
  rangeFor,
  groupByDay,
  phaseOn,
  addDaysKey,
  shiftMonth,
  ymd,
  weekdayIndex,
  monthKey,
  monthTitle,
  longDay,
  dayLabel,
  safeIcon,
  entryRow,
  entryStatus,
  busId,
  entryTime,
} from "./_model.js";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_CHIPS = 3;

export default {
  id: "calendar.month",
  domain: "calendar",
  title: "Calendar",
  configSchema: schemaOf("calendar.month"),
  sizes: ["l", "xl", "full"],
  mount(el, { config, size, api, rt, bus, ctx }) {
    const life = lifecycle();
    const startTypes = config.types?.length ? config.types : TYPES;
    const nowKey = () => ymd(nowIso());
    const st = {
      view: "month",
      cursor: nowKey(),
      selected: null,
      types: new Set(startTypes),
      entries: [],
      virtualNow: nowIso(),
      loaded: false,
    };
    let focusAfter = false;

    const label = h("h3", { class: "wc-label", "aria-live": "polite" });
    const grid = h("div", { class: "wc-body" });
    const detail = h("section", { class: "wc-detail", "aria-label": "Selected day" });
    const views = segmented({
      label: "Calendar view",
      value: st.view,
      options: [
        { value: "month", label: "Month" },
        { value: "week", label: "Week" },
        { value: "day", label: "Day" },
      ],
      onChange: (v) => {
        st.view = v;
        load();
      },
    });
    const typeFilter = chipFilter({
      label: "Show event types",
      value: [...st.types],
      options: TYPES.filter((t) => startTypes.includes(t)).map((t) => ({
        value: t,
        label: TYPE_META[t].label,
      })),
      onChange: (v) => {
        st.types = new Set(v);
        load();
      },
    });
    const nav = toolbar({
      label: "Calendar navigation",
      children: [
        iconButton({ icon: "chevron-left", label: "Previous", onClick: () => step(-1) }),
        button({ label: "Today", onClick: () => goto(nowKey()) }),
        iconButton({ icon: "chevron-right", label: "Next", onClick: () => step(1) }),
      ],
    });
    const root = h(
      "div",
      { class: `wc wc-month wc-month--${size}` },
      h("div", { class: "wc-head" }, h("div", { class: "wc-head__nav" }, nav, label), views),
      h("div", { class: "wc-types" }, typeFilter, h("span", { class: "u-muted wc-utc" }, "Dates in UTC")),
      grid,
      detail,
    );
    el.append(root);

    const step = (dir) => {
      const unit =
        st.view === "month"
          ? () => shiftMonth(st.cursor, dir)
          : () => addDaysKey(st.cursor, dir * (st.view === "week" ? 7 : 1));
      goto(unit());
    };

    const goto = (key, { focus = false } = {}) => {
      const before = rangeFor(st.view, st.cursor);
      st.cursor = key;
      focusAfter = focus;
      const after = rangeFor(st.view, st.cursor);
      if (before.from === after.from) {
        paint();
        if (focus) focusDay();
      } else load();
    };

    const focusDay = () => grid.querySelector(`[data-day="${st.cursor}"]`)?.focus();

    // ---------- loading ----------
    let seq = 0;
    const load = async () => {
      const mine = ++seq;
      const r = rangeFor(st.view, st.cursor);
      if (!st.loaded) grid.replaceChildren(skeleton({ shape: "card", lines: 4 }));
      else grid.setAttribute("aria-busy", "true");
      paintLabel();
      if (st.types.size === 0) {
        st.entries = [];
        grid.removeAttribute("aria-busy");
        paint();
        return;
      }
      try {
        const out = await api.call("calendar.range", { from: r.from, to: r.to, types: [...st.types] });
        if (life.dead || mine !== seq) return;
        st.entries = out.items;
        st.virtualNow = out.virtual_now ?? st.virtualNow;
        st.loaded = true;
        grid.removeAttribute("aria-busy");
        paint();
        if (focusAfter) focusDay();
        focusAfter = false;
      } catch (e) {
        if (life.dead || mine !== seq) return;
        grid.removeAttribute("aria-busy");
        grid.replaceChildren(errorState({ error: e, retry: load }));
      }
    };

    const paintLabel = () => {
      const r = rangeFor(st.view, st.cursor);
      if (st.view === "month") label.textContent = monthTitle(st.cursor);
      else if (st.view === "week")
        label.textContent = `${dayLabel(r.days[0], "0000-00-00").replace(/^Today, /, "")} to ${dayLabel(r.days[6], "0000-00-00")}`;
      else label.textContent = longDay(st.cursor);
      ctx.setTitle(st.view === "month" ? `Calendar: ${monthTitle(st.cursor)}` : "Calendar");
    };

    // ---------- entry detail ----------
    const openEntry = (e, key) => {
      const id = busId(e);
      if (e.type === "promotion" && id) bus.publish("promotion.selected", { id });
      if (e.type === "content" && id) bus.publish("content.selected", { id });
      ctx.openDrawer({
        title: e.title,
        width: "sm",
        body: h(
          "div",
          { class: "wc-drawer", "data-widget-domain": "calendar" },
          h(
            "p",
            { class: "wc-drawer__top" },
            safeIcon(e.icon, TYPE_META[e.type]?.icon),
            ` ${TYPE_META[e.type]?.one ?? e.type}`,
            entryStatus(e),
          ),
          kv([
            ["When", `${when(e.starts_at)}${e.ends_at ? ` to ${when(e.ends_at)}` : ""}`],
            ["Today in it", key ? entryTime(e, key) : null],
            ["Status", enumLabel(e.status)],
          ]),
          h(
            "div",
            { class: "wk-actions" },
            linkButton({ href: e.href, label: "Open", variant: "primary", icon: "external" }),
          ),
        ),
      });
    };

    const openDay = (key) => {
      st.selected = key;
      bus.publish("date.selected", { from: key, to: key });
      paintDetail();
      ctx.announce(`${longDay(key)}, ${groupByDay(st.entries, [key])[key].length} events`);
    };

    // ---------- painting ----------
    const chip = (e, key) => {
      const phase = phaseOn(e, key);
      return h(
        "button",
        {
          type: "button",
          class: `wc-chip wc-tone--${e.tone ?? "neutral"} wc-chip--${phase}`,
          tabindex: "-1",
          title: `${e.title} (${entryTime(e, key)})`,
          onclick: (ev) => {
            ev.stopPropagation();
            openEntry(e, key);
          },
        },
        safeIcon(e.icon, TYPE_META[e.type]?.icon, 16),
        h("span", { class: "wc-chip__text" }, phase === "middle" ? `${e.title}` : e.title),
        h("span", { class: "sr-only" }, `, ${entryTime(e, key)}`),
      );
    };

    const dayCell = (key, by, today, inMonth) => {
      const list = by[key] ?? [];
      const shown = list.slice(0, MAX_CHIPS);
      const rest = list.length - shown.length;
      const btn = h(
        "button",
        {
          type: "button",
          class: "wc-day__num",
          "data-day": key,
          tabindex: key === st.cursor ? "0" : "-1",
          "aria-label": `${longDay(key)}${list.length ? `, ${list.length} event${list.length === 1 ? "" : "s"}` : ""}${key === today ? ", today" : ""}`,
          "aria-pressed": String(st.selected === key),
          onclick: () => {
            st.cursor = key;
            openDay(key);
            paint();
            focusDay();
          },
        },
        Number(key.slice(8, 10)),
      );
      return h(
        "div",
        {
          role: "gridcell",
          class: `wc-day${key === today ? " is-today" : ""}${inMonth ? "" : " is-outside"}${st.selected === key ? " is-selected" : ""}`,
        },
        btn,
        h(
          "div",
          { class: "wc-day__chips" },
          ...shown.map((e) => chip(e, key)),
          rest > 0
            ? h(
                "button",
                {
                  type: "button",
                  class: "wc-more",
                  tabindex: "-1",
                  onclick: (ev) => (ev.stopPropagation(), openDay(key)),
                },
                `+${rest} more`,
              )
            : null,
        ),
        list.length
          ? h(
              "span",
              { class: "wc-dots", "aria-hidden": "true" },
              ...list.slice(0, 4).map((e) => h("span", { class: `wc-dot wc-tone--${e.tone ?? "neutral"}` })),
            )
          : null,
      );
    };

    const monthGrid = () => {
      const r = rangeFor("month", st.cursor);
      const by = groupByDay(st.entries, r.days);
      const today = ymd(st.virtualNow);
      const month = monthKey(st.cursor);
      const rows = [];
      for (let w = 0; w < 6; w++)
        rows.push(
          h(
            "div",
            { role: "row", class: "wc-week" },
            ...r.days.slice(w * 7, w * 7 + 7).map((k) => dayCell(k, by, today, monthKey(k) === month)),
          ),
        );
      const g = h(
        "div",
        { role: "grid", class: "wc-grid", "aria-label": `${monthTitle(st.cursor)} calendar` },
        h(
          "div",
          { role: "row", class: "wc-week wc-week--head" },
          ...WEEKDAYS.map((d) => h("div", { role: "columnheader", class: "wc-colhead" }, d)),
        ),
        ...rows,
      );
      g.addEventListener("keydown", (e) => {
        const day = e.target.closest?.("[data-day]")?.dataset.day;
        if (!day) return;
        let next = null;
        if (e.key === "ArrowRight") next = addDaysKey(day, 1);
        else if (e.key === "ArrowLeft") next = addDaysKey(day, -1);
        else if (e.key === "ArrowDown") next = addDaysKey(day, 7);
        else if (e.key === "ArrowUp") next = addDaysKey(day, -7);
        else if (e.key === "Home") next = addDaysKey(day, -weekdayIndex(day));
        else if (e.key === "End") next = addDaysKey(day, 6 - weekdayIndex(day));
        else if (e.key === "PageDown") next = shiftMonth(day, e.shiftKey ? 12 : 1);
        else if (e.key === "PageUp") next = shiftMonth(day, e.shiftKey ? -12 : -1);
        if (!next) return;
        e.preventDefault();
        goto(next, { focus: true });
      });
      return g;
    };

    const weekView = () => {
      const r = rangeFor("week", st.cursor);
      const by = groupByDay(st.entries, r.days);
      const today = ymd(st.virtualNow);
      return h(
        "div",
        { class: "wc-weekview" },
        ...r.days.map((k) =>
          h(
            "section",
            { class: `wc-col${k === today ? " is-today" : ""}`, "aria-label": longDay(k) },
            h(
              "button",
              {
                type: "button",
                class: "wc-col__head",
                "data-day": k,
                "aria-pressed": String(st.selected === k),
                onclick: () => ((st.cursor = k), openDay(k)),
              },
              dayLabel(k, today),
            ),
            by[k].length
              ? h(
                  "div",
                  { class: "wc-col__list" },
                  ...by[k].map((e) => entryRow(e, k, { onOpen: (x) => openEntry(x, k) })),
                )
              : h("p", { class: "u-muted wc-col__empty" }, "Nothing scheduled"),
          ),
        ),
      );
    };

    const dayView = () => {
      const key = st.cursor;
      const list = groupByDay(st.entries, [key])[key];
      if (list.length === 0)
        return emptyState({
          icon: "calendar",
          title: "Nothing on this day",
          body: "No promotion, content, automation, expiry or task falls on this date.",
        });
      return h(
        "div",
        { class: "wc-dayview" },
        ...list.map((e) => entryRow(e, key, { onOpen: (x) => openEntry(x, key) })),
      );
    };

    function paint() {
      grid.replaceChildren();
      paintLabel();
      if (st.types.size === 0) {
        grid.append(
          emptyState({
            icon: "filter",
            title: "No types selected",
            body: "Choose at least one event type to see the calendar.",
          }),
        );
        detail.replaceChildren();
        return;
      }
      grid.append(st.view === "month" ? monthGrid() : st.view === "week" ? weekView() : dayView());
      ctx.setCount(st.entries.length);
      paintDetail();
    }

    function paintDetail() {
      detail.replaceChildren();
      if (st.view !== "month") return;
      const key = st.selected;
      if (!key) {
        detail.append(h("p", { class: "u-muted" }, "Select a day to list everything on it."));
        return;
      }
      const list = groupByDay(st.entries, [key])[key] ?? [];
      detail.append(
        h("h3", { class: "wk-caps" }, longDay(key)),
        list.length
          ? h(
              "div",
              { class: "wc-dayview" },
              ...list.map((e) => entryRow(e, key, { onOpen: (x) => openEntry(x, key) })),
            )
          : h("p", { class: "u-muted" }, "Nothing on this day."),
      );
    }

    load();

    // ---------- realtime ----------
    const refresh = debounce(
      life,
      async () => {
        await load();
        ctx.announce("Calendar updated");
      },
      600,
    );
    life.add(rt.on("promotion.state_changed", refresh));
    life.add(rt.on("content.state_changed", refresh));
    life.add(rt.on("task.updated", refresh));

    return () => life.dispose();
  },
};
