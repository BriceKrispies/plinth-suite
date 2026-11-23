// points.tiers: the tier ladder with perks, member counts and the viewer's position.
import { schemaOf } from "../../core/widgets.js";
import { h, clear, uid } from "../../ds/js/dom.js";
import { points, percent, number } from "../../ds/js/format.js";
import { statusPill, pill } from "../../ds/js/pill.js";
import { progressBar } from "../../ds/js/progress.js";
import { icon } from "../../ds/js/icons.js";
import { skeleton, emptyState } from "../../ds/js/states.js";
import { disposer, reportLoadError, markArrived, myHandle } from "./_kit.js";

const cap = (t) => `${t[0].toUpperCase()}${t.slice(1)}`;

export default {
  id: "points.tiers",
  domain: "points",
  title: "Tiers",
  configSchema: schemaOf("points.tiers"),
  sizes: ["m", "l", "xl"],
  mount(el, { size, api, rt, ctx }) {
    const life = disposer();
    const root = h("div", { class: `w-points w-points-tiers w-points-tiers--${size}` });
    el.append(root);
    let tiers = null;
    let me = null;
    let selected = null;
    let seq = 0;
    const hasMember = Boolean(ctx.me?.member);
    const detailId = uid("tier-detail");

    const load = async ({ initial = false, arrive = false } = {}) => {
      const mine = ++seq;
      if (initial) {
        clear(root);
        root.append(skeleton({ shape: "card", lines: 3 }));
      }
      try {
        const [t, s] = await Promise.all([
          api.call("points.tiers", {}),
          hasMember ? api.call("points.summary", {}).catch(() => null) : null,
        ]);
        if (life.done || mine !== seq) return;
        tiers = [...t.tiers].sort((a, b) => a.min_lifetime_points - b.min_lifetime_points);
        me = s?.tier ?? null;
        if (!selected || !tiers.some((x) => x.tier === selected))
          selected = me?.tier ?? tiers[0]?.tier ?? null;
        ctx.setState("ready");
        draw(arrive);
      } catch (e) {
        if (life.done || mine !== seq) return;
        reportLoadError({
          ctx,
          host: root,
          error: e,
          retry: () => load({ initial: true }),
          initial: initial || !tiers,
        });
      }
    };

    function detail(t, index) {
      const box = h("div", { class: "w-points-tiers__detail", "aria-live": "polite" });
      box.append(h("p", { class: "u-caps" }, `${cap(t.tier)} perks`));
      box.append(
        t.perks.length
          ? h(
              "ul",
              { class: "w-points-tiers__perks" },
              ...t.perks.map((p) => h("li", {}, icon("check", { size: 16 }), h("span", {}, p))),
            )
          : h("p", { class: "u-muted" }, "No extra perks at this tier."),
      );
      if (me) {
        const cur = tiers.findIndex((x) => x.tier === me.tier);
        if (index === cur)
          box.append(
            h(
              "p",
              { class: "w-kit-note w-kit-note--success" },
              icon("check-circle", { size: 16 }),
              " This is your tier.",
            ),
          );
        else if (index < cur) box.append(h("p", { class: "u-muted" }, "You have already passed this tier."));
        else
          box.append(
            h(
              "p",
              {},
              `You need ${points(Math.max(0, t.min_lifetime_points - me.lifetime_points))} more lifetime points to reach ${cap(t.tier)}.`,
            ),
            progressBar({
              value: Math.min(me.lifetime_points, t.min_lifetime_points),
              max: Math.max(1, t.min_lifetime_points),
              label: `Progress to ${cap(t.tier)}`,
              tone: "info",
            }),
          );
      }
      return box;
    }

    function draw(arrive) {
      clear(root);
      if (!tiers.length) {
        root.append(emptyState({ icon: "crown", title: "No tiers are defined" }));
        return;
      }
      const totalMembers = Math.max(
        1,
        tiers.reduce((a, t) => a + t.members, 0),
      );
      const cur = me ? tiers.findIndex((x) => x.tier === me.tier) : -1;
      if (me) {
        const next = me.next_tier;
        root.append(
          h(
            "div",
            { class: "w-points-tiers__you" },
            h("span", { class: "u-caps" }, "You"),
            statusPill("tier", me.tier),
            h(
              "span",
              { class: "u-muted" },
              next
                ? `${points(Math.max(0, (me.next_tier_at ?? 0) - me.lifetime_points))} to ${cap(next)}`
                : "Top tier",
            ),
          ),
        );
        if (next)
          root.append(
            progressBar({
              value: Math.round(me.progress * 1000),
              max: 1000,
              label: `Progress to ${cap(next)}`,
              tone: "info",
            }),
          );
      }
      const ladder = h("ol", { class: "w-points-tiers__ladder", "aria-label": "Tier ladder, lowest first" });
      tiers.forEach((t, i) => {
        const isSel = t.tier === selected;
        const btn = h(
          "button",
          {
            type: "button",
            class: `w-points-tiers__tier w-points-tiers__tier--${t.tier}`,
            "aria-expanded": String(isSel),
            "aria-controls": detailId,
            onclick: () => {
              selected = isSel ? null : t.tier;
              draw(false);
              root.querySelector(`[data-tier="${t.tier}"] button`)?.focus();
            },
          },
          h(
            "span",
            { class: "w-points-tiers__name" },
            statusPill("tier", t.tier),
            i === cur ? pill({ label: "You are here", tone: "signal", icon: "star" }) : null,
          ),
          h(
            "span",
            { class: "w-points-tiers__min u-tabular" },
            t.min_lifetime_points === 0 ? "From the start" : `From ${points(t.min_lifetime_points)}`,
          ),
          h(
            "span",
            { class: "w-points-tiers__members u-tabular" },
            `${number(t.members)} ${t.members === 1 ? "member" : "members"} · ${percent(t.members / totalMembers)}`,
          ),
          h(
            "span",
            { class: "w-points-tiers__share", "aria-hidden": "true" },
            h("span", { style: `--_w:${Math.round((t.members / totalMembers) * 100)}%` }),
          ),
        );
        const li = h(
          "li",
          { "data-tier": t.tier, class: i === cur ? "is-current" : i < cur ? "is-passed" : "" },
          btn,
        );
        if (arrive && i === cur) markArrived(life, li);
        ladder.append(li);
      });
      root.append(ladder);
      const idx = tiers.findIndex((x) => x.tier === selected);
      if (idx >= 0) {
        const d = detail(tiers[idx], idx);
        d.id = detailId;
        root.append(d);
      }
    }

    life.add(
      rt.on("tier.changed", (ev) => {
        const mineEvent = ev.payload.member === myHandle();
        load({ arrive: mineEvent });
      }),
    );
    load({ initial: true });
    return life.dispose;
  },
};
