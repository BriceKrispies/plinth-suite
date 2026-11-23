// content.feed: published content targeted to the viewer, pinned first, reactions inline, with the reading view
// inside the widget. New publications arrive live.
import { schemaOf } from "../../core/widgets.js";
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { artwork } from "../../ds/js/artwork.js";
import { personChip } from "../../ds/js/avatar.js";
import { pill } from "../../ds/js/pill.js";
import { emptyState, skeleton, errorState } from "../../ds/js/states.js";
import { number } from "../../ds/js/format.js";
import {
  lifecycle,
  debounce,
  segmented,
  chipFilter,
  arrive,
  rel,
  when,
  failToast,
} from "../promotions/_kit.js";
import { TYPE_META, reactionBar, totalReactions } from "./_blocks.js";
import { mountReader } from "./_reader.js";

export default {
  id: "content.feed",
  domain: "content",
  title: "News feed",
  configSchema: schemaOf("content.feed"),
  sizes: ["m", "l", "xl", "full"],
  mount(el, { config, size, api, rt, bus, nav, ctx }) {
    const life = lifecycle();
    const compact = size === "m";
    const limit = config.limit ?? 10;
    const st = {
      items: [],
      cursor: null,
      loadingMore: false,
      layout: config.layout ?? (size === "m" ? "list" : "cards"),
      type: config.type ?? "all",
      tag: config.tag ?? null,
      view: "feed",
      fresh: new Set(),
      loaded: false,
    };

    const controls = h("div", { class: "wn-feed__controls" });
    const list = h("div", { class: "wn-feed__list", "aria-live": "off" });
    const more = h("div", { class: "wn-feed__more" });
    const live = h("p", { class: "sr-only", "aria-live": "polite" });
    const feedView = h("div", { class: "wn-feed__view" }, controls, list, more);
    const readerHost = h("div", { class: "wn-feed__reader", hidden: true });
    el.append(h("div", { class: `wn wn-feed wn-feed--${size}` }, live, feedView, readerHost));

    const reader = mountReader(readerHost, {
      api,
      rt,
      ctx,
      life,
      nav,
      toc: size === "xl" || size === "full",
      idPrefix: "feed-rd",
      onBack: () => closeReader(),
      onLoaded: (item) => {
        const row = st.items.find((x) => x.slug === item.slug);
        if (row) row.seen = true;
      },
    });

    const showView = (v) => {
      st.view = v;
      feedView.hidden = v !== "feed";
      readerHost.hidden = v !== "reader";
    };
    const openReader = (item) => {
      showView("reader");
      reader.load(item.slug);
      bus.publish("content.selected", { id: item.slug });
      readerHost.querySelector("button")?.focus();
    };
    const closeReader = () => {
      showView("feed");
      paint();
      list.querySelector(`[data-slug="${CSS.escape(reader.current() ?? "")}"] .wn-item__open`)?.focus();
    };

    // ---------- controls ----------
    const drawControls = () => {
      controls.replaceChildren();
      if (!compact) {
        if (!config.type)
          controls.append(
            segmented({
              label: "Filter by type",
              value: st.type,
              options: [
                { value: "all", label: "All" },
                ...Object.entries(TYPE_META).map(([k, v]) => ({ value: k, label: `${v.label}s` })),
              ],
              onChange: (v) => {
                st.type = v;
                load();
              },
            }),
          );
        const tags = [...new Set(st.items.flatMap((i) => i.tags))].slice(0, 8);
        if (tags.length && !config.tag)
          controls.append(
            chipFilter({
              label: "Filter by tag",
              value: st.tag ? [st.tag] : [],
              options: tags.map((t) => ({ value: t, label: t })),
              onChange: (v) => {
                st.tag = v[v.length - 1] ?? null;
                load();
              },
            }),
          );
        if (!config.layout)
          controls.append(
            segmented({
              label: "Layout",
              value: st.layout,
              options: [
                { value: "cards", label: "Cards" },
                { value: "list", label: "List" },
              ],
              onChange: (v) => {
                st.layout = v;
                paint();
              },
            }),
          );
      }
    };

    // ---------- items ----------
    const react = async (item, bar, reaction) => {
      try {
        const out = await api.call("content.engage", { slug: item.slug, reaction });
        if (life.dead) return;
        item.views = out.views;
        item.reactions = out.reactions;
        item.my_reaction = out.my_reaction;
        bar.update({ counts: out.reactions, mine: out.my_reaction });
        ctx.announce(out.my_reaction ? `Reacted: ${out.my_reaction}` : "Reaction removed");
      } catch (e) {
        failToast(ctx, e, "Could not save your reaction");
      }
    };

    const itemNode = (item) => {
      const meta = TYPE_META[item.type];
      const bar = reactionBar({
        counts: item.reactions,
        mine: item.my_reaction,
        compact: true,
        onPick: (r) => react(item, bar, r),
      });
      const open = h(
        "button",
        { type: "button", class: "wn-item__open", onclick: () => openReader(item) },
        h("span", { class: "wn-item__title" }, item.title),
        item.seen ? null : h("span", { class: "sr-only" }, " (unread)"),
      );
      return h(
        "article",
        {
          class: `wn-item wn-item--${st.layout}${item.pinned ? " is-pinned" : ""}${item.seen ? "" : " is-unseen"}`,
          "data-slug": item.slug,
        },
        h("div", { class: "wn-item__art", "aria-hidden": "true" }, artwork(item.hero, { size: 96 })),
        h(
          "div",
          { class: "wn-item__body wk-row__main" },
          h(
            "p",
            { class: "wn-item__eyebrow" },
            pill({
              label: meta.label,
              tone: item.type === "announcement" ? "signal" : "neutral",
              icon: meta.icon,
            }),
            item.pinned ? pill({ label: "Pinned", tone: "info", icon: "star" }) : null,
            item.seen ? null : pill({ label: "New", tone: "signal" }),
          ),
          h("h3", { class: "wn-item__heading" }, open),
          compact ? null : h("p", { class: "wn-item__summary" }, item.summary),
          h(
            "p",
            { class: "wn-item__meta u-muted" },
            compact ? item.author.display_name : personChip(item.author),
            h(
              "time",
              { datetime: item.published_at, title: when(item.published_at) },
              ` · ${rel(item.published_at)}`,
            ),
            compact ? null : ` · ${number(item.views)} views`,
          ),
          compact
            ? h(
                "p",
                { class: "wn-item__meta u-muted" },
                `${number(totalReactions(item.reactions))} reactions`,
              )
            : bar,
        ),
      );
    };

    function paint() {
      drawControls();
      list.replaceChildren();
      more.replaceChildren();
      ctx.setCount(st.items.length);
      if (st.items.length === 0) {
        list.append(
          emptyState({
            icon: "article",
            title:
              st.type !== "all" || st.tag ? "Nothing matches these filters" : "Nothing published for you yet",
            body:
              st.type !== "all" || st.tag
                ? "Try another type or tag."
                : "News and announcements for your audience appear here.",
            action:
              st.type !== "all" || st.tag
                ? button({
                    label: "Clear filters",
                    onClick: () => {
                      st.type = config.type ?? "all";
                      st.tag = config.tag ?? null;
                      load();
                    },
                  })
                : null,
          }),
        );
        return;
      }
      list.append(...st.items.map(itemNode));
      list.className = `wn-feed__list wn-feed__list--${st.layout}`;
      for (const slug of st.fresh)
        arrive(life, list.querySelector(`[data-slug="${CSS.escape(slug)}"]`), false);
      st.fresh.clear();
      if (st.cursor)
        more.append(
          button({
            label: st.loadingMore ? "Loading" : "Load more",
            busy: st.loadingMore,
            onClick: () => load({ append: true }),
          }),
        );
    }

    // ---------- loading ----------
    let seq = 0;
    const load = async ({ append = false, quiet = false } = {}) => {
      const mine = ++seq;
      if (!append && !quiet && !st.loaded) list.replaceChildren(skeleton({ shape: "card", lines: 3 }));
      if (append) {
        st.loadingMore = true;
        paint();
      } else if (st.loaded) list.setAttribute("aria-busy", "true");
      try {
        const out = await api.call("content.feed", {
          ...(st.type !== "all" ? { type: st.type } : {}),
          ...(st.tag ? { tag: st.tag } : {}),
          limit,
          ...(append && st.cursor ? { cursor: st.cursor } : {}),
        });
        if (life.dead || mine !== seq) return;
        const before = new Set(st.items.map((i) => i.slug));
        st.items = append ? [...st.items, ...out.items] : out.items;
        st.cursor = out.next_cursor;
        st.loadingMore = false;
        if (quiet) for (const i of out.items) if (!before.has(i.slug)) st.fresh.add(i.slug);
        st.loaded = true;
        list.removeAttribute("aria-busy");
        paint();
        if (quiet && st.fresh.size === 0) return;
      } catch (e) {
        if (life.dead || mine !== seq) return;
        st.loadingMore = false;
        list.removeAttribute("aria-busy");
        list.replaceChildren(errorState({ error: e, retry: () => load({ append }) }));
        ctx.setCount(0);
      }
    };

    load();

    // ---------- realtime ----------
    life.add(
      rt.on(
        "content.published",
        debounce(
          life,
          async () => {
            const knownBefore = st.items.length;
            await load({ quiet: true });
            if (st.items.length > knownBefore || st.fresh.size) live.textContent = "New content published";
          },
          500,
        ),
      ),
    );
    life.add(
      rt.on("content.engaged", (ev) => {
        const p = ev.payload;
        const row = st.items.find((x) => x.slug === p.content);
        if (!row || st.view !== "feed") return;
        row.views = p.views;
        const node = list.querySelector(`[data-slug="${CSS.escape(p.content)}"] .wn-item__meta`);
        if (node && compact) node.textContent = `${number(p.reactions)} reactions`;
        else if (node) {
          const text = node.lastChild;
          if (text && text.nodeType === 3) text.textContent = ` · ${number(p.views)} views`;
        }
      }),
    );

    return () => life.dispose();
  },
};
