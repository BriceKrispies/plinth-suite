// segments.members: the members matching a saved segment right now. Follows segment.selected from the list or the
// builder, publishes member.selected when a row is chosen.
import { schemaOf } from "../../core/widgets.js";
import { h } from "../../ds/js/dom.js";
import { button, linkButton } from "../../ds/js/button.js";
import { avatar, personChip } from "../../ds/js/avatar.js";
import { searchField } from "../../ds/js/field.js";
import { dataTable } from "../../ds/js/table.js";
import { emptyState, skeleton, errorState } from "../../ds/js/states.js";
import { statusPill } from "../../ds/js/pill.js";
import { number, relativeTime } from "../../ds/js/format.js";
import { lifecycle, debounce, arrive, nowIso } from "../promotions/_kit.js";

const PAGE = 25;

export default {
  id: "segments.members",
  domain: "segments",
  title: "Segment members",
  configSchema: schemaOf("segments.members"),
  sizes: ["m", "l", "xl"],
  mount(el, { config, size, api, rt, bus, ctx }) {
    const life = lifecycle();
    const compact = size === "m";
    const st = {
      slug:
        typeof config.segment === "string" ? config.segment : (bus.latest?.("segment.selected")?.id ?? null),
      items: [],
      cursor: null,
      count: 0,
      q: "",
      selected: null,
      loadingMore: false,
      fresh: new Set(),
    };
    const head = h("div", { class: "ws-members__head" });
    const body = h("div", { class: "ws-members__body", "aria-live": "off" });
    const more = h("div", { class: "ws-members__more" });
    const search = searchField({
      name: "q",
      label: "Filter loaded members",
      placeholder: "Filter by name, title or region",
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
    el.append(h("div", { class: `ws ws-members ws-members--${size}` }, head, body, more));

    let seq = 0;
    const load = async ({ append = false } = {}) => {
      if (!st.slug) {
        paint();
        return;
      }
      const mine = ++seq;
      if (!append) {
        body.replaceChildren(skeleton({ shape: "text", lines: 5 }));
        st.items = [];
        st.cursor = null;
      } else st.loadingMore = true;
      try {
        const out = await api.call("segments.members", {
          slug: st.slug,
          limit: PAGE,
          ...(append && st.cursor ? { cursor: st.cursor } : {}),
        });
        if (life.dead || mine !== seq) return;
        st.items = append ? [...st.items, ...out.items] : out.items;
        st.cursor = out.next_cursor;
        st.count = out.count;
        st.loadingMore = false;
        paint();
      } catch (e) {
        if (life.dead || mine !== seq) return;
        st.loadingMore = false;
        body.replaceChildren(errorState({ error: e, retry: () => load({ append }) }));
        ctx.setCount(0);
      }
    };

    const rows = () =>
      st.items.filter(
        (m) =>
          !st.q ||
          `${m.person.display_name} ${m.person.handle} ${m.title} ${m.department} ${m.region} ${m.tier}`
            .toLowerCase()
            .includes(st.q),
      );

    const pick = (m) => {
      st.selected = m.person.handle;
      bus.publish("member.selected", { id: m.person.handle });
      paint();
      ctx.announce(`${m.person.display_name} selected`);
    };

    function paint() {
      head.replaceChildren();
      body.replaceChildren();
      more.replaceChildren();
      if (!st.slug) {
        ctx.setCount(0);
        body.append(
          emptyState({
            icon: "segment",
            title: "Pick a segment",
            body: "Choose a segment in the list to see who matches it right now.",
          }),
        );
        return;
      }
      ctx.setCount(st.count);
      head.append(
        h(
          "p",
          { class: "ws-members__count" },
          h("strong", { class: "u-tabular" }, number(st.count)),
          ` member${st.count === 1 ? "" : "s"} in ${st.slug}`,
        ),
        ...[compact ? null : search].filter(Boolean),
      );
      const list = rows();
      if (st.items.length === 0) {
        body.append(
          emptyState({
            icon: "users",
            title: "Nobody matches yet",
            body: "No member satisfies this segment's rule right now.",
          }),
        );
        return;
      }
      if (list.length === 0) {
        body.append(
          emptyState({
            icon: "search",
            title: "No loaded member matches",
            body: `Nothing found for ‘${st.q}’ among the ${st.items.length} loaded.`,
          }),
        );
      } else if (compact) {
        body.append(
          h(
            "ul",
            { class: "ws-members__list", role: "list" },
            ...list.map((m) =>
              h(
                "li",
                {},
                h(
                  "button",
                  {
                    type: "button",
                    class: "ws-member",
                    "aria-pressed": String(st.selected === m.person.handle),
                    "data-handle": m.person.handle,
                    onclick: () => pick(m),
                  },
                  avatar({ name: m.person.display_name, avatar: m.person.avatar, size: "sm" }),
                  h("span", { class: "ws-member__name" }, m.person.display_name),
                  statusPill("tier", m.tier),
                ),
              ),
            ),
          ),
        );
      } else {
        const t = dataTable({
          caption: `Members of ${st.slug}`,
          density: size === "l" ? "compact" : "default",
          rows: list,
          rowKey: (m) => m.person.handle,
          onRowClick: pick,
          columns: [
            {
              key: "person",
              label: "Member",
              render: (m) => h("span", { class: "ws-member__cell" }, personChip(m.person)),
            },
            {
              key: "title",
              label: "Title",
              render: (m) => `${m.title}${m.department ? `, ${m.department}` : ""}`,
            },
            { key: "region", label: "Region", render: (m) => m.region },
            { key: "tier", label: "Tier", render: (m) => statusPill("tier", m.tier) },
            { key: "badges_count", label: "Badges", align: "end", render: (m) => number(m.badges_count) },
            {
              key: "last",
              label: "Last active",
              render: (m) => (m.last_active_at ? relativeTime(m.last_active_at, nowIso()) : "never"),
            },
          ],
        });
        for (const tr of t.querySelectorAll("tbody tr")) {
          tr.dataset.handle = tr.dataset.key;
          tr.tabIndex = 0;
          if (tr.dataset.key === st.selected) tr.classList.add("is-selected");
          tr.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              pick(st.items.find((m) => m.person.handle === tr.dataset.key));
            }
          });
        }
        body.append(t);
      }
      for (const handle of st.fresh)
        arrive(life, body.querySelector(`[data-handle="${CSS.escape(handle)}"]`), false);
      st.fresh.clear();
      if (st.cursor)
        more.append(
          button({
            label: st.loadingMore ? "Loading" : `Load more (${number(st.count - st.items.length)} left)`,
            busy: st.loadingMore,
            onClick: () => load({ append: true }),
          }),
        );
      more.append(
        linkButton({
          href: `/segments/${st.slug}`,
          label: "Edit this segment",
          icon: "edit",
          variant: "ghost",
          size: "sm",
        }),
      );
    }

    paint();
    if (st.slug) load();

    life.add(
      bus.subscribe("segment.selected", ({ id }) => {
        if (!id || typeof config.segment === "string" || id === st.slug) return;
        st.slug = id;
        st.selected = null;
        load();
      }),
    );
    // a tier change can move a member in or out of a tier-based segment
    life.add(
      rt.on(
        "tier.changed",
        debounce(
          life,
          async () => {
            if (!st.slug) return;
            const before = new Set(st.items.map((m) => m.person.handle));
            try {
              const out = await api.call("segments.members", {
                slug: st.slug,
                limit: Math.max(PAGE, st.items.length),
              });
              if (life.dead) return;
              for (const m of out.items) if (!before.has(m.person.handle)) st.fresh.add(m.person.handle);
              st.items = out.items;
              st.cursor = out.next_cursor;
              st.count = out.count;
              paint();
              ctx.announce("Segment membership updated");
            } catch {
              /* the next event or a refresh retries */
            }
          },
          600,
        ),
      ),
    );

    return () => life.dispose();
  },
};
