// badges.recent: the organisation-wide ticker of badge awards. Reads recent awards through the audit events and
// then follows badge.awarded live.
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { points } from "../../ds/js/format.js";
import { avatar } from "../../ds/js/avatar.js";
import { emptyState, skeleton } from "../../ds/js/states.js";
import { icon } from "../../ds/js/icons.js";
import { disposer, reportLoadError, markArrived, batchAnnouncer, timeEl, when } from "../points/_kit.js";
import { badgeArtFor, derivedArt, rarityPill } from "./_badge.js";

export default {
  id: "badges.recent",
  domain: "badges",
  title: "Recent awards",
  configSchema: schemaOf("badges.recent"),
  sizes: ["m", "l"],
  mount(el, { config, size, api, rt, bus, ctx }) {
    const life = disposer();
    const root = h("div", { class: `w-badges w-badges-recent w-badges-recent--${size}` });
    el.append(root);
    const limit = config.limit ?? (size === "l" ? 12 : 8);
    let items = [];
    let liveOnly = false;
    let loaded = false;
    let seq = 0;
    const arrived = new Set();
    const note = batchAnnouncer(life, (n) => `${n} new badge ${n === 1 ? "award" : "awards"}`);

    // An award is `{ id, at, member (PersonRef), badge, title, rarity, reward }`.
    const fromEvent = (ev) => ({
      id: ev.payload.award_id,
      at: ev.occurred_at,
      member: ev.payload.member,
      badge: ev.payload.badge,
      title: ev.payload.title,
      rarity: ev.payload.rarity,
      reward: ev.payload.points_reward,
    });

    const load = async ({ initial = false } = {}) => {
      const mine = ++seq;
      if (!loaded) {
        clear(root);
        root.append(skeleton({ lines: 4 }));
      }
      try {
        const res = await api.call("audit.events", { types: ["badge.awarded"], limit });
        if (life.done || mine !== seq) return;
        items = res.items.filter((e) => e.type === "badge.awarded").map(fromEvent);
        liveOnly = false;
        loaded = true;
        ctx.setState("ready");
        ctx.setCount(items.length);
        draw();
      } catch (e) {
        if (life.done || mine !== seq) return;
        if (e?.status === 403 || e?.code === "FORBIDDEN") {
          // Without audit access the ticker still follows live awards (their audience is everyone).
          liveOnly = true;
          loaded = true;
          ctx.setState("ready");
          draw();
          return;
        }
        reportLoadError({
          ctx,
          host: root,
          error: e,
          retry: () => load({ initial: true }),
          initial: initial || !loaded,
        });
      }
    };

    const row = (a) => {
      const art = derivedArt(a.badge, a.rarity);
      const name = a.member.display_name;
      const li = h(
        "li",
        { class: "w-badges-recent__item", "data-award": a.id },
        h("span", { class: "w-badges-recent__art" }, badgeArtFor(art, size === "l" ? 44 : 36)),
        h(
          "span",
          { class: "w-badges-recent__text" },
          h(
            "span",
            {},
            a.member.handle
              ? h(
                  "a",
                  {
                    class: "w-badges-recent__who",
                    href: `/people/${encodeURIComponent(a.member.handle)}`,
                    onclick: () => bus.publish("member.selected", { id: a.member.handle }),
                  },
                  name,
                )
              : h("strong", {}, name),
            " earned ",
            h("strong", {}, a.title),
          ),
          h(
            "span",
            { class: "w-badges-recent__meta" },
            rarityPill(a.rarity),
            a.reward ? h("span", { class: "u-muted w-kit-small u-tabular" }, `+${points(a.reward)}`) : null,
            h("span", { class: "u-muted w-kit-small" }, timeEl(a.at)),
          ),
        ),
        size === "l" && a.member.avatar
          ? h(
              "span",
              { class: "w-badges-recent__avatar" },
              avatar({ name, avatar: a.member.avatar, size: "sm" }),
            )
          : null,
        h("span", { class: "w-kit-new-slot" }),
      );
      if (arrived.has(a.id)) markArrived(life, li, li.querySelector(".w-kit-new-slot"));
      return li;
    };

    function draw() {
      clear(root);
      if (items.length === 0) {
        root.append(
          emptyState({
            icon: "trophy",
            title: liveOnly ? "Waiting for the next award" : "No awards yet",
            body: liveOnly
              ? "The list of past awards needs audit access. New awards will appear here as they happen."
              : "Badge awards across the organisation will appear here.",
          }),
        );
        return;
      }
      root.append(
        h("ul", { class: "w-badges-recent__list", "aria-label": "Recent badge awards" }, ...items.map(row)),
      );
      if (liveOnly)
        root.append(
          h(
            "p",
            { class: "u-muted w-kit-small" },
            icon("info", { size: 16 }),
            " Showing awards since you opened this page.",
          ),
        );
    }

    // Relative times drift; refresh them every 30 seconds without re-rendering the rows.
    const tick = () => {
      for (const t of root.querySelectorAll("time[datetime]"))
        t.textContent = when(t.getAttribute("datetime"));
      life.timeout(tick, 30000);
    };
    life.timeout(tick, 30000);

    life.add(
      rt.on("badge.awarded", (ev) => {
        const a = fromEvent(ev);
        if (items.some((x) => x.id === a.id)) return;
        items = [a, ...items].slice(0, limit);
        arrived.add(a.id);
        ctx.setCount(items.length);
        draw();
        note();
      }),
    );
    load({ initial: true });
    return life.dispose;
  },
};
