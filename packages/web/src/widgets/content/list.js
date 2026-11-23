// content.list: all content by status, type, tag and author with engagement counts. Selecting a row publishes
// content.selected and opens a quick view.
import { schemaOf } from "../../core/widgets.js";
import { h } from "../../ds/js/dom.js";
import { button, linkButton } from "../../ds/js/button.js";
import { artwork } from "../../ds/js/artwork.js";
import { dataTable, pager } from "../../ds/js/table.js";
import { emptyState, skeleton, errorState } from "../../ds/js/states.js";
import { searchField, selectField } from "../../ds/js/field.js";
import { pill } from "../../ds/js/pill.js";
import { personChip, avatarStack } from "../../ds/js/avatar.js";
import { toolbar } from "../../ds/js/layout.js";
import { number } from "../../ds/js/format.js";
import {
  lifecycle,
  debounce,
  chipFilter,
  displayPill,
  arrive,
  kv,
  rel,
  when,
  enumLabel,
} from "../promotions/_kit.js";
import { TYPE_META } from "./_blocks.js";

const STATUSES = ["draft", "in_review", "approved", "published", "archived"];
const PAGE_LIMIT = 15;

export default {
  id: "content.list",
  domain: "content",
  title: "Content",
  configSchema: schemaOf("content.list"),
  sizes: ["l", "xl", "full"],
  mount(el, { config, size, api, rt, bus, nav, ctx }) {
    const life = lifecycle();
    const wide = size !== "l";
    const canAuthor = ctx.can("content:author");
    const st = {
      statuses: new Set(config.status ?? []),
      type: config.type ?? "",
      tag: "",
      author: "",
      q: "",
      items: [],
      counts: {},
      next: null,
      stack: [],
      cursor: null,
      selected: null,
      known: { tags: new Set(), authors: new Map() },
      fresh: new Set(),
    };
    const results = h("div", { class: "wn-results" });
    const live = h("p", { class: "sr-only", "aria-live": "polite" });

    let statusFilter = chipFilter({
      label: "Filter by status",
      value: [...st.statuses],
      options: STATUSES.map((s) => ({ value: s, label: enumLabel(s) })),
      onChange: (v) => {
        st.statuses = new Set(v);
        reset();
      },
    });
    const search = searchField({
      name: "q",
      label: "Search content",
      placeholder: "Search title or summary",
      onInput: debounce(
        life,
        (v) => {
          st.q = v.trim();
          reset();
        },
        300,
      ),
    });
    search.classList.add("wk-search");
    const typeSel = config.type
      ? null
      : selectField({
          name: "type",
          label: "Type",
          value: "",
          options: [
            { value: "", label: "Any type" },
            ...Object.entries(TYPE_META).map(([k, v]) => ({ value: k, label: v.label })),
          ],
          onChange: (v) => {
            st.type = v;
            reset();
          },
        });
    const filtersHost = h("div", { class: "wn-list__extra" });
    const bar = toolbar({
      label: "Content filters",
      children: [
        search,
        typeSel,
        canAuthor
          ? button({
              label: "New content",
              icon: "plus",
              variant: "primary",
              onClick: () => nav.go("/content/new"),
            })
          : null,
      ],
    });
    el.append(
      h("div", { class: `wn wn-list wn-list--${size}` }, bar, statusFilter, filtersHost, live, results),
    );

    const drawExtras = () => {
      filtersHost.replaceChildren();
      const tags = [...st.known.tags].sort();
      const authors = [...st.known.authors.entries()];
      if (tags.length)
        filtersHost.append(
          selectField({
            name: "tag",
            label: "Tag",
            value: st.tag,
            options: [{ value: "", label: "Any tag" }, ...tags.map((t) => ({ value: t, label: t }))],
            onChange: (v) => {
              st.tag = v;
              reset();
            },
          }),
        );
      if (authors.length > 1)
        filtersHost.append(
          selectField({
            name: "author",
            label: "Author",
            value: st.author,
            options: [
              { value: "", label: "Any author" },
              ...authors.map(([subject, name]) => ({ value: subject, label: name })),
            ],
            onChange: (v) => {
              st.author = v;
              reset();
            },
          }),
        );
    };

    // ---------- loading ----------
    let seq = 0;
    const load = async () => {
      const mine = ++seq;
      results.setAttribute("aria-busy", "true");
      if (st.items.length === 0) results.replaceChildren(skeleton({ shape: "table", lines: 5 }));
      try {
        const out = await api.call("content.list", {
          ...(st.statuses.size ? { status: [...st.statuses] } : {}),
          ...(st.type ? { type: st.type } : {}),
          ...(st.tag ? { tag: st.tag } : {}),
          ...(st.author ? { author: st.author } : {}),
          ...(st.q ? { q: st.q } : {}),
          limit: PAGE_LIMIT,
          ...(st.cursor ? { cursor: st.cursor } : {}),
        });
        if (life.dead || mine !== seq) return;
        st.items = out.items;
        st.next = out.next_cursor;
        st.counts = out.status_counts ?? {};
        for (const i of out.items) {
          for (const t of i.tags) st.known.tags.add(t);
          st.known.authors.set(i.author.subject, i.author.display_name);
        }
        results.removeAttribute("aria-busy");
        statusFilter.setCounts(st.counts);
        drawExtras();
        paint();
      } catch (e) {
        if (life.dead || mine !== seq) return;
        results.removeAttribute("aria-busy");
        results.replaceChildren(errorState({ error: e, retry: load }));
        ctx.setCount(0);
      }
    };
    const reset = () => {
      st.cursor = null;
      st.stack = [];
      st.items = [];
      load();
    };

    const pick = (item) => {
      st.selected = item.node.slug;
      bus.publish("content.selected", { id: item.node.slug });
      paint();
      openQuick(item);
    };

    function paint() {
      results.replaceChildren();
      ctx.setCount(st.items.length);
      const filtered = st.statuses.size || st.type || st.tag || st.author || st.q;
      if (st.items.length === 0) {
        results.append(
          emptyState({
            icon: "document",
            title: filtered ? "No content matches" : "No content yet",
            body: filtered
              ? "Try other filters or a different search."
              : "Pages, articles and announcements you write appear here.",
            action: filtered
              ? button({
                  label: "Clear filters",
                  onClick: () => {
                    st.statuses = new Set(config.status ?? []);
                    st.type = config.type ?? "";
                    st.tag = "";
                    st.author = "";
                    st.q = "";
                    search.querySelector("input").value = "";
                    const next = statusFilterRebuild();
                    statusFilter.replaceWith(next);
                    statusFilter = next;
                    const sel = typeSel?.querySelector("select");
                    if (sel) sel.value = "";
                    reset();
                  },
                })
              : canAuthor
                ? button({
                    label: "Write something",
                    icon: "plus",
                    variant: "primary",
                    onClick: () => nav.go("/content/new"),
                  })
                : null,
          }),
        );
        return;
      }
      const table = dataTable({
        caption: "Content",
        density: size === "l" ? "compact" : "default",
        rows: st.items,
        rowKey: (i) => i.node.slug,
        onRowClick: pick,
        columns: [
          {
            key: "title",
            label: "Title",
            render: (i) =>
              h(
                "span",
                { class: "wn-title wk-row__main" },
                h("span", { class: "wn-title__art", "aria-hidden": "true" }, artwork(i.hero, { size: 24 })),
                h("strong", {}, i.node.title),
              ),
          },
          { key: "type", label: "Type", render: (i) => TYPE_META[i.type]?.label ?? i.type },
          { key: "status", label: "Status", render: (i) => displayPill(i.display_status) },
          ...(wide ? [{ key: "author", label: "Author", render: (i) => personChip(i.author) }] : []),
          {
            key: "updated",
            label: "Updated",
            render: (i) => rel(i.updated_at),
          },
          { key: "views", label: "Views", align: "end", render: (i) => number(i.views) },
          { key: "reactions", label: "Reactions", align: "end", render: (i) => number(i.reactions) },
        ],
      });
      for (const tr of table.querySelectorAll("tbody tr")) {
        tr.tabIndex = 0;
        tr.addEventListener("keydown", (e) => {
          if (e.target === tr && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            tr.click();
          }
        });
        if (tr.dataset.key === st.selected) tr.classList.add("is-selected");
        const strong = tr.querySelector("strong");
        if (strong && canAuthor)
          strong.replaceChildren(
            h("a", { href: `/content/${tr.dataset.key}`, class: "wk-link" }, strong.textContent),
          );
      }
      results.append(table);
      if (st.next || st.stack.length)
        results.append(
          pager({
            label: "Content pages",
            nextCursor: st.next,
            onNext: (c) => {
              st.stack.push(st.cursor);
              st.cursor = c;
              load();
            },
            onPrev: st.stack.length
              ? () => {
                  st.cursor = st.stack.pop();
                  load();
                }
              : undefined,
          }),
        );
      for (const slug of st.fresh)
        arrive(life, results.querySelector(`tr[data-key="${CSS.escape(slug)}"]`), false);
      st.fresh.clear();
    }
    // chipFilter has no "set value" call; rebuild it when filters are cleared
    const statusFilterRebuild = () =>
      chipFilter({
        label: "Filter by status",
        value: [...st.statuses],
        options: STATUSES.map((s) => ({ value: s, label: enumLabel(s), count: st.counts[s] })),
        onChange: (v) => {
          st.statuses = new Set(v);
          reset();
        },
      });

    function openQuick(i) {
      const published = i.published_revision !== null && i.status !== "archived";
      ctx.openDrawer({
        title: i.node.title,
        width: "md",
        body: h(
          "div",
          { class: "wp-quick", "data-widget-domain": "content" },
          h("div", { class: "wn-quick__art" }, artwork(i.hero, { size: 96 })),
          h(
            "div",
            { class: "wp-quick__top" },
            displayPill(i.display_status),
            pill({ label: TYPE_META[i.type]?.label ?? i.type }),
          ),
          h("p", {}, i.summary),
          kv([
            ["Author", personChip(i.author)],
            ["Reviewers", i.reviewers.length ? avatarStack(i.reviewers) : "None yet"],
            ["Updated", when(i.updated_at)],
            ["Publishes", i.publish_at ? when(i.publish_at) : null],
            ["Revision live", i.published_revision !== null ? String(i.published_revision) : "Not published"],
            ["Tags", i.tags.length ? i.tags.join(", ") : null],
            ["Views", number(i.views)],
            ["Reactions", number(i.reactions)],
          ]),
          h(
            "div",
            { class: "wk-actions" },
            canAuthor
              ? linkButton({
                  href: `/content/${i.node.slug}`,
                  label: "Open editor",
                  icon: "edit",
                  variant: "primary",
                })
              : null,
            published
              ? linkButton({ href: `/read/${i.node.slug}`, label: "Read it", icon: "article" })
              : null,
          ),
        ),
      });
    }

    load();

    // ---------- realtime ----------
    const refresh = debounce(life, load, 500);
    life.add(rt.on("content.state_changed", refresh));
    life.add(rt.onNode("Content", refresh));
    life.add(
      rt.on("content.engaged", (ev) => {
        const p = ev.payload;
        const row = st.items.find((x) => x.node.slug === p.content);
        if (!row) return;
        row.views = p.views;
        row.reactions = p.reactions;
        st.fresh.add(row.node.slug);
        paint();
      }),
    );

    return () => life.dispose();
  },
};
