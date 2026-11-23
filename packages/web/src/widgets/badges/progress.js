// badges.progress: the badges a member is working towards, with rings and what is left.
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { points } from "../../ds/js/format.js";
import { linkButton } from "../../ds/js/button.js";
import { emptyState, skeleton } from "../../ds/js/states.js";
import { disposer, resolveMember, reportLoadError, markArrived } from "../points/_kit.js";
import { badgeArtFor, ring, rarityPill, remainingText, openBadge } from "./_badge.js";

const DEFAULT_LIMIT = { s: 3, m: 4, l: 6 };

export default {
  id: "badges.progress",
  domain: "badges",
  title: "Next badges",
  configSchema: schemaOf("badges.progress"),
  sizes: ["s", "m", "l"],
  mount(el, { config, size, api, rt, bus, nav, ctx }) {
    const life = disposer();
    const root = h("div", { class: `w-badges w-badges-progress w-badges-progress--${size}` });
    el.append(root);
    const limit = config.limit ?? DEFAULT_LIMIT[size] ?? 4;
    const who = resolveMember(ctx, config.member ?? "$me");
    let items = [];
    let fallback = false;
    let loaded = false;
    let seq = 0;
    let arrived = new Set();

    const ratio = (c) =>
      c.progress ? (c.progress.ratio ?? c.progress.current / Math.max(1, c.progress.target)) : 0;

    const load = async ({ initial = false, silent = false } = {}) => {
      if (!who.handle) {
        root.append(emptyState({ icon: "user", title: "No member selected" }));
        return;
      }
      const mine = ++seq;
      if (!silent && !loaded) {
        clear(root);
        root.append(skeleton({ lines: 3 }));
      }
      try {
        const res = await api.call("badges.catalog", {
          filter: "in_progress",
          ...(who.arg ? { member: who.arg } : {}),
        });
        if (life.done || mine !== seq) return;
        const known = new Map(items.map((c) => [c.slug, c.progress?.current]));
        const list = res.items.filter((c) => !c.awarded_at);
        fallback = list.length === 0 && (res.next_up ?? []).length > 0;
        items = (fallback ? res.next_up : list).sort((a, b) => ratio(b) - ratio(a));
        arrived = silent
          ? new Set(items.filter((c) => known.get(c.slug) !== c.progress?.current).map((c) => c.slug))
          : new Set();
        loaded = true;
        ctx.setState("ready");
        ctx.setCount(items.length);
        draw();
      } catch (e) {
        if (life.done || mine !== seq) return;
        reportLoadError({
          ctx,
          host: root,
          error: e,
          retry: () => load({ initial: true }),
          initial: initial || !loaded,
        });
      }
    };

    function draw() {
      clear(root);
      if (items.length === 0) {
        root.append(
          emptyState({
            icon: "target",
            title: who.mine ? "Nothing in progress" : "No badges in progress",
            body: who.mine ? "Take part in the programme and your next badges will show up here." : undefined,
            action: who.mine
              ? linkButton({ href: nav.href("/badges"), label: "See all badges", variant: "secondary" })
              : null,
          }),
        );
        return;
      }
      const shown = items.slice(0, limit);
      if (fallback) root.append(h("p", { class: "u-muted w-kit-small" }, "Closest to unlocking"));
      const ul = h(
        "ul",
        { class: "w-badges-progress__list", "aria-label": "Badges in progress" },
        ...shown.map((c) => {
          const p = c.progress ?? { current: 0, target: 1, label: "" };
          const btn = h(
            "button",
            {
              type: "button",
              class: "w-badges-progress__item",
              "data-slug": c.slug,
              onclick: () => openBadge({ slug: c.slug, ctx, bus, nav }),
              "aria-label": `${c.title}: ${p.label || `${p.current} of ${p.target}`}, ${remainingText(p)}`,
            },
            h(
              "span",
              { class: "w-badges-progress__ring" },
              ring(p, `${c.title} progress`, size === "s" ? 40 : 52),
            ),
            size === "s" ? null : h("span", { class: "w-badges-progress__art" }, badgeArtFor(c.artwork, 40)),
            h(
              "span",
              { class: "w-badges-progress__text" },
              h("span", { class: "w-badges-progress__title" }, c.title),
              h(
                "span",
                { class: "u-muted w-kit-small u-tabular" },
                p.label || `${p.current} of ${p.target}`,
                " · ",
                remainingText(p),
              ),
              size === "l" && c.criteria_type !== "hidden"
                ? h("span", { class: "u-muted w-kit-small" }, c.description)
                : null,
            ),
            size === "s"
              ? null
              : h(
                  "span",
                  { class: "w-badges-progress__side" },
                  rarityPill(c.rarity),
                  c.points_reward
                    ? h("span", { class: "u-muted w-kit-small u-tabular" }, `+${points(c.points_reward)}`)
                    : null,
                ),
            h("span", { class: "w-kit-new-slot" }),
          );
          if (arrived.has(c.slug)) markArrived(life, btn, btn.querySelector(".w-kit-new-slot"));
          return h("li", {}, btn);
        }),
      );
      root.append(ul);
      if (items.length > shown.length)
        root.append(
          h("p", { class: "u-muted w-kit-small" }, `${items.length - shown.length} more in progress`),
        );
      if (size !== "s" || items.length)
        root.append(
          h(
            "div",
            { class: "w-kit-actions" },
            linkButton({ href: nav.href("/badges"), label: "All badges", variant: "ghost", size: "sm" }),
          ),
        );
      if (arrived.size)
        ctx.announce(`${arrived.size} ${arrived.size === 1 ? "badge" : "badges"} moved forward`);
    }

    const reread = life.debounce(() => load({ silent: true }), 400);
    life.add(
      rt.on("badge.progress", (ev) => {
        const p = ev.payload;
        if (p.member !== who.handle) return;
        const i = items.findIndex((c) => c.slug === p.badge);
        if (i < 0) return reread();
        items[i] = {
          ...items[i],
          progress: {
            ...items[i].progress,
            current: p.current,
            target: p.target,
            ratio: p.current / Math.max(1, p.target),
            label: `${p.current} of ${p.target}`,
          },
        };
        items.sort((a, b) => ratio(b) - ratio(a));
        arrived = new Set([p.badge]);
        draw();
        reread();
      }),
    );
    life.add(
      rt.on("badge.awarded", (ev) => {
        const p = ev.payload;
        if (p.member?.handle !== who.handle) return;
        ctx.announce(`Badge earned: ${p.title}`);
        reread();
      }),
    );
    load({ initial: true });
    return life.dispose;
  },
};
