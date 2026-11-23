// segments.list: segments with live member counts and where they are used. Selecting one publishes
// segment.selected for the builder and the members widgets on the same page.
import { schemaOf } from "../../core/widgets.js";
import { h } from "../../ds/js/dom.js";
import { button, linkButton } from "../../ds/js/button.js";
import { searchField, selectField } from "../../ds/js/field.js";
import { emptyState } from "../../ds/js/states.js";
import { pill } from "../../ds/js/pill.js";
import { toolbar } from "../../ds/js/layout.js";
import { number } from "../../ds/js/format.js";
import { icon } from "../../ds/js/icons.js";
import { lifecycle, debounce, asyncRegion, arrive } from "../promotions/_kit.js";

const SORTS = {
  name: (a, b) => a.node.title.localeCompare(b.node.title),
  count: (a, b) => b.count - a.count,
  used: (a, b) => b.used_by - a.used_by || a.node.title.localeCompare(b.node.title),
};

export default {
  id: "segments.list",
  domain: "segments",
  title: "Segments",
  configSchema: schemaOf("segments.list"),
  sizes: ["m", "l", "xl"],
  mount(el, { size, api, rt, bus, nav, ctx }) {
    const life = lifecycle();
    const compact = size === "m";
    const st = {
      items: [],
      q: "",
      sort: "name",
      selected: bus.latest?.("segment.selected")?.id ?? null,
      fresh: new Set(),
    };
    const results = h("div", { class: "ws-results" });
    const search = searchField({
      name: "q",
      label: "Search segments",
      placeholder: "Search segments",
      onInput: debounce(
        life,
        (v) => {
          st.q = v.trim().toLowerCase();
          paint();
        },
        150,
      ),
    });
    search.classList.add("wk-search");
    const sort = selectField({
      name: "sort",
      label: "Sort by",
      value: st.sort,
      options: [
        { value: "name", label: "Name" },
        { value: "count", label: "Most members" },
        { value: "used", label: "Most used" },
      ],
      onChange: (v) => {
        st.sort = v;
        paint();
      },
    });
    const bar = toolbar({
      label: "Segment filters",
      children: [
        search,
        compact ? null : sort,
        button({
          label: "New segment",
          icon: "plus",
          variant: "primary",
          size: compact ? "sm" : "md",
          onClick: () => nav.go("/segments/new"),
        }),
      ],
    });
    const root = h("div", { class: `ws ws-list ws-list--${size}` }, bar, results);
    el.append(root);

    const select = (item) => {
      st.selected = item.node.slug;
      bus.publish("segment.selected", { id: item.node.slug });
      paint();
      ctx.announce(`${item.node.title} selected, ${item.count} members`);
    };

    function paint() {
      results.replaceChildren();
      ctx.setCount(st.items.length);
      if (st.items.length === 0) {
        results.append(
          emptyState({
            icon: "segment",
            title: "No segments yet",
            body: "Segments group members by rules over their facts, such as tier, region or recent activity.",
            action: button({
              label: "Create a segment",
              icon: "plus",
              variant: "primary",
              onClick: () => nav.go("/segments/new"),
            }),
          }),
        );
        return;
      }
      const rows = st.items
        .filter((s) => !st.q || `${s.node.title} ${s.description} ${s.owner}`.toLowerCase().includes(st.q))
        .sort(SORTS[st.sort]);
      if (rows.length === 0) {
        results.append(
          emptyState({
            icon: "search",
            title: "No segments match",
            body: `Nothing found for ‘${st.q}’.`,
            action: button({
              label: "Clear search",
              onClick: () => {
                st.q = "";
                search.querySelector("input").value = "";
                paint();
              },
            }),
          }),
        );
        return;
      }
      const max = Math.max(1, ...st.items.map((s) => s.count));
      results.append(
        h(
          "ul",
          { class: "ws-list__items", role: "list" },
          ...rows.map((s) => {
            const selected = st.selected === s.node.slug;
            const row = h(
              "li",
              { class: "ws-row", "data-slug": s.node.slug },
              h(
                "button",
                {
                  type: "button",
                  class: "ws-row__main wk-row__main",
                  "aria-pressed": String(selected),
                  onclick: () => select(s),
                },
                h(
                  "span",
                  { class: "ws-row__text" },
                  h("strong", {}, s.node.title),
                  compact || !s.description ? null : h("span", { class: "ws-row__desc" }, s.description),
                ),
                h(
                  "span",
                  { class: "ws-row__count u-tabular" },
                  icon("users", { size: 16 }),
                  number(s.count),
                  h("progress", { class: "ws-row__bar", value: s.count, max, "aria-hidden": "true" }),
                ),
              ),
              h(
                "span",
                { class: "ws-row__meta" },
                s.used_by > 0
                  ? pill({ label: `Used by ${s.used_by}`, tone: "info" })
                  : pill({ label: "Unused", tone: "neutral" }),
                compact ? null : h("span", { class: "u-muted" }, s.owner),
                linkButton({
                  href: `/segments/${s.node.slug}`,
                  label: compact ? "Edit" : "Open builder",
                  size: "sm",
                  variant: "ghost",
                  icon: "edit",
                }),
              ),
            );
            return row;
          }),
        ),
      );
      for (const slug of st.fresh) {
        arrive(life, results.querySelector(`[data-slug="${CSS.escape(slug)}"]`), false);
      }
      st.fresh.clear();
    }

    const region = asyncRegion(results, life, {
      skeleton: { shape: "text", lines: 4 },
      load: () => api.call("segments.list", {}),
      render: (_host, data) => {
        st.items = data.items;
        paint();
      },
      onError: () => ctx.setCount(0),
    });

    // realtime: any Segment change (a rule edit changes the live count)
    const reload = debounce(
      life,
      async () => {
        try {
          const before = new Map(st.items.map((s) => [s.node.slug, s.count]));
          const data = await api.call("segments.list", {});
          if (life.dead) return;
          st.items = data.items;
          for (const s of data.items)
            if (before.has(s.node.slug) && before.get(s.node.slug) !== s.count) st.fresh.add(s.node.slug);
          paint();
        } catch {
          region.reload();
        }
      },
      400,
    );
    life.add(rt.onNode("Segment", reload));

    return () => life.dispose();
  },
};
