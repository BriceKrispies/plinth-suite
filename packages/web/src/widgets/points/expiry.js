// points.expiry: points expiring by date, from the member's remaining lots.
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { points, date, percent } from "../../ds/js/format.js";
import { pill } from "../../ds/js/pill.js";
import { progressBar } from "../../ds/js/progress.js";
import { miniBars } from "../../ds/js/chart.js";
import { emptyState, skeleton } from "../../ds/js/states.js";
import { icon } from "../../ds/js/icons.js";
import { personChip } from "../../ds/js/avatar.js";
import { disposer, resolveMember, reportLoadError, daysUntil, markArrived, kv, dl } from "./_kit.js";

const urgency = (days) =>
  days <= 7 ? ["Soon", "danger"] : days <= 30 ? ["This month", "warning"] : ["Later", "neutral"];
const dayText = (days) =>
  days < 0 ? "expired" : days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;

export default {
  id: "points.expiry",
  domain: "points",
  title: "Expiry schedule",
  configSchema: schemaOf("points.expiry"),
  sizes: ["s", "m", "l"],
  mount(el, { config, size, api, rt, ctx }) {
    const life = disposer();
    const root = h("div", { class: `w-points w-points-expiry w-points-expiry--${size}` });
    el.append(root);
    if (!ctx.me?.member) {
      root.append(
        emptyState({
          icon: "clock",
          title: "No points account",
          body: "Agents and services do not hold points.",
        }),
      );
      return () => {};
    }
    let who = resolveMember(ctx, config.member ?? "$me");
    let data = null;
    let seq = 0;

    const load = async ({ initial = false, arrive = false } = {}) => {
      const mine = ++seq;
      if (initial) {
        clear(root);
        root.append(skeleton({ lines: 3 }));
      }
      if (!who.handle) {
        clear(root);
        root.append(emptyState({ icon: "user", title: "No member selected" }));
        return;
      }
      try {
        const res = await api.call("points.expiry", who.arg ? { member: who.arg } : {});
        if (life.done || mine !== seq) return;
        const before = new Map((data?.buckets ?? []).map((b) => [b.expires_on, b.points]));
        data = res;
        ctx.setState("ready");
        ctx.setCount((res.buckets ?? []).length);
        draw(before, arrive);
      } catch (e) {
        if (life.done || mine !== seq) return;
        reportLoadError({
          ctx,
          host: root,
          error: e,
          retry: () => load({ initial: true }),
          initial: initial || !data,
        });
      }
    };

    function draw(before, arrive) {
      clear(root);
      const buckets = [...data.buckets].sort((a, b) => a.expires_on.localeCompare(b.expires_on));
      if (!who.mine) root.append(h("div", { class: "w-points-balance__who" }, personChip(data.member)));
      if (buckets.length === 0) {
        root.append(
          emptyState({
            icon: "check-circle",
            title: "Nothing is due to expire",
            body: "Every point you hold is safe for now.",
          }),
        );
        return;
      }
      const total = buckets.reduce((a, b) => a + b.points, 0);
      const next = data.next_warning ?? { on: buckets[0].expires_on, points: buckets[0].points };
      const days = daysUntil(next.on);
      const [urgLabel, urgTone] = urgency(days);
      const headline = h(
        "div",
        { class: `w-points-expiry__headline is-${urgTone}`, role: "group", "aria-label": "Next expiry" },
        icon("clock", { size: 24 }),
        h(
          "div",
          {},
          h("p", { class: "w-points-expiry__big u-tabular" }, points(next.points)),
          h("p", { class: "u-muted" }, `expire ${dayText(days)}, on ${date(next.on)}`),
        ),
        pill({ label: urgLabel, tone: urgTone }),
      );
      root.append(headline);
      if (arrive) markArrived(life, headline);
      if (size === "s") return;

      const max = Math.max(...buckets.map((b) => b.points), 1);
      const rows = buckets.map((b) => {
        const d = daysUntil(b.expires_on);
        const [lbl, tone] = urgency(d);
        const changed = before && before.size > 0 && before.get(b.expires_on) !== b.points;
        const li = h(
          "li",
          { class: "w-points-expiry__row", "data-expires": b.expires_on },
          h(
            "span",
            { class: "w-points-expiry__date" },
            date(b.expires_on),
            h("span", { class: "u-muted w-kit-small" }, ` ${dayText(d)}`),
          ),
          h("span", { class: "w-points-expiry__pts u-tabular" }, points(b.points)),
          h(
            "span",
            { class: "w-points-expiry__lots u-muted w-kit-small" },
            `${b.lots} ${b.lots === 1 ? "lot" : "lots"}`,
          ),
          pill({ label: lbl, tone }),
          progressBar({
            value: b.points,
            max,
            label: `${points(b.points)} on ${date(b.expires_on)}`,
            tone: tone === "neutral" ? "info" : tone,
          }),
        );
        if (changed) markArrived(life, li);
        return li;
      });
      root.append(h("ul", { class: "w-points-expiry__list", "aria-label": "Expiry dates" }, ...rows));
      if (size === "l") {
        root.append(
          dl([
            kv("Total at risk", points(total)),
            kv(
              "Share due within 30 days",
              percent(
                buckets.filter((b) => daysUntil(b.expires_on) <= 30).reduce((a, b) => a + b.points, 0) /
                  total,
              ),
            ),
            kv("Dates", String(buckets.length)),
          ]),
          h(
            "div",
            { class: "w-points-expiry__chart" },
            h("p", { class: "u-caps" }, "Points by expiry date"),
            miniBars(
              buckets.map((b) => b.points),
              {
                labels: buckets.map((b) => `${date(b.expires_on)}: ${points(b.points)}`),
                label: "Points by expiry date",
              },
            ),
          ),
        );
      }
      if (who.mine)
        root.append(h("p", { class: "u-muted w-kit-small" }, "Spending uses the points that expire first."));
    }

    const reread = life.debounce((arrive) => load({ arrive }), 400);
    life.add(
      rt.on("points.posted", (ev) => {
        const p = ev.payload;
        if (p.member && p.member === who.handle) reread(false);
      }),
    );
    life.add(
      rt.on("points.expiring", (ev) => {
        if (ev.payload.member === who.handle) reread(true);
      }),
    );
    load({ initial: true });
    return life.dispose;
  },
};
