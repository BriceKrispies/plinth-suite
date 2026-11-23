// points.balance: the balance with live animation, tier and progress to the next tier, what is expiring.
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { points, signedPoints, date } from "../../ds/js/format.js";
import { statusPill } from "../../ds/js/pill.js";
import { progressBar } from "../../ds/js/progress.js";
import { sparkline } from "../../ds/js/chart.js";
import { popover } from "../../ds/js/popover.js";
import { button, linkButton } from "../../ds/js/button.js";
import { icon } from "../../ds/js/icons.js";
import { emptyState, skeleton } from "../../ds/js/states.js";
import { personChip } from "../../ds/js/avatar.js";
import {
  disposer,
  resolveMember,
  reportLoadError,
  countTo,
  markArrived,
  txnPill,
  amount,
  timeEl,
  daysUntil,
  kv,
  dl,
} from "./_kit.js";

export default {
  id: "points.balance",
  domain: "points",
  title: "Points balance",
  configSchema: schemaOf("points.balance"),
  sizes: ["s", "m", "l"],
  mount(el, { config, size, api, rt, bus, nav, ctx }) {
    const life = disposer();
    const root = h("div", { class: `w-points w-points-balance w-points-balance--${size}` });
    el.append(root);
    const showTier = config.show_tier !== false;
    const showExpiring = config.show_expiring !== false;

    let target = config.member ?? "$me";
    let who = resolveMember(ctx, target);
    let data = null;
    let loadSeq = 0;
    let balanceEl = null;

    if (!ctx.me?.member) {
      root.append(
        emptyState({
          icon: "coins",
          title: "No points account",
          body: "Agents and services do not hold points.",
        }),
      );
      return () => {};
    }

    const load = async ({ initial = false, arrive = null } = {}) => {
      const mine = ++loadSeq;
      if (initial) {
        clear(root);
        root.append(skeleton({ shape: "tile" }));
      }
      if (!who.handle) {
        clear(root);
        root.append(
          emptyState({
            icon: "user",
            title: "No member selected",
            body: "Pick a member to see their balance.",
          }),
        );
        return;
      }
      try {
        const res = await api.call("points.summary", who.arg ? { member: who.arg } : {});
        if (life.done || mine !== loadSeq) return;
        const before = data?.balance ?? null;
        data = res;
        draw(before, arrive);
      } catch (e) {
        if (life.done || mine !== loadSeq) return;
        if (!who.mine && (e?.status === 403 || e?.code === "FORBIDDEN")) {
          // Other members' balances need points:view-all; say so instead of showing an error.
          ctx.setState("ready");
          clear(root);
          root.append(
            emptyState({
              icon: "lock",
              title: "This balance is private",
              body: "Only the member and finance can see it.",
              action: button({
                label: "Show my balance",
                variant: "secondary",
                onClick: () => {
                  target = "$me";
                  who = resolveMember(ctx, target);
                  data = null;
                  load({ initial: true });
                },
              }),
            }),
          );
          return;
        }
        reportLoadError({
          ctx,
          host: root,
          error: e,
          retry: () => load({ initial: true }),
          initial: initial || !data,
        });
      }
    };

    const tierBlock = (tier) => {
      const next = tier.next_tier;
      const bar = next
        ? progressBar({
            value: Math.round(tier.progress * 1000),
            max: 1000,
            label: `Progress to ${next}`,
            tone: "info",
          })
        : null;
      const toGo =
        next && tier.next_tier_at !== null ? Math.max(0, tier.next_tier_at - tier.lifetime_points) : null;
      return h(
        "div",
        { class: "w-points-balance__tier" },
        h(
          "div",
          { class: "w-points-balance__tierrow" },
          statusPill("tier", tier.tier),
          next
            ? h("span", { class: "u-muted" }, `${points(toGo)} to ${next[0].toUpperCase()}${next.slice(1)}`)
            : h("span", { class: "u-muted" }, "Top tier reached"),
        ),
        bar,
        h("p", { class: "u-muted w-kit-small" }, `${points(tier.lifetime_points)} earned in total`),
      );
    };

    const expiringBlock = () => {
      const buckets = data.expiring_soon ?? [];
      if (buckets.length === 0) return null;
      const total = buckets.reduce((a, b) => a + b.points, 0);
      const first = buckets[0];
      const days = daysUntil(first.expires_on);
      const trigger = button({
        label: "Details",
        icon: "clock",
        variant: "ghost",
        size: "sm",
        onClick: () => {
          const list = h(
            "div",
            {
              class: "w-points-balance__pop",
              "data-widget-domain": "points",
              "aria-label": "Points expiring soon",
            },
            h("p", { class: "u-caps" }, "Expiring soon"),
            dl(
              buckets.map((b) =>
                kv(date(b.expires_on), `${points(b.points)} · ${b.lots} ${b.lots === 1 ? "lot" : "lots"}`),
              ),
            ),
            linkButton({
              href: nav.href("/points"),
              label: "Open the points page",
              variant: "secondary",
              size: "sm",
            }),
          );
          popover(trigger, list, { placement: "bottom-end", label: "Points expiring soon" });
        },
      });
      return h(
        "div",
        { class: `w-points-balance__expiring ${days <= 14 ? "is-soon" : ""}`.trim() },
        icon("clock", { size: 16 }),
        h(
          "span",
          {},
          `${points(total)} expire`,
          days <= 0 ? " today" : ` within ${days} ${days === 1 ? "day" : "days"}`,
          days <= 14 ? " (soon)" : "",
        ),
        size === "s" ? null : trigger,
      );
    };

    const recentList = () => {
      const lines = (data.recent ?? []).slice(0, size === "l" ? 5 : 3);
      if (lines.length === 0) return null;
      return h(
        "ul",
        { class: "w-points-balance__recent", "aria-label": "Recent activity" },
        ...lines.map((l) =>
          h(
            "li",
            { "data-txn": l.txn_id },
            h(
              "span",
              { class: "w-points-balance__memo" },
              txnPill(l.txn_type),
              h("span", {}, l.memo || "No memo"),
            ),
            amount(l.amount),
            h("span", { class: "u-muted w-kit-small" }, timeEl(l.occurred_at)),
          ),
        ),
      );
    };

    function draw(before, arrive) {
      ctx.setState("ready");
      clear(root);
      if (!who.mine) root.append(h("div", { class: "w-points-balance__who" }, personChip(data.member)));
      balanceEl = h(
        "span",
        { class: "w-points-balance__value u-tabular", "data-balance": "" },
        points(data.balance),
      );
      const deltaSlot = h("span", { class: "w-points-balance__delta", "aria-hidden": "true" });
      root.append(
        h(
          "div",
          { class: "w-points-balance__hero" },
          h("p", { class: "w-points-balance__label u-caps" }, who.mine ? "Your balance" : "Balance"),
          h("p", { class: "w-points-balance__amount" }, balanceEl, deltaSlot),
          // The visible number animates; the live value for assistive tech is announced once per event.
          showTier && size === "s" ? statusPill("tier", data.tier.tier) : null,
        ),
      );
      if (before !== null && before !== data.balance) {
        countTo(life, balanceEl, before, data.balance, points);
        const d = data.balance - before;
        deltaSlot.textContent = signedPoints(d);
        deltaSlot.classList.add(d > 0 ? "is-up" : "is-down");
        life.timeout(() => (deltaSlot.textContent = ""), 6000);
        markArrived(life, root.querySelector(".w-points-balance__hero"));
      } else if (arrive) markArrived(life, root.querySelector(".w-points-balance__hero"));

      if (size === "s") {
        const exp = showExpiring ? expiringBlock() : null;
        if (exp) root.append(exp);
        return;
      }
      if (showTier) root.append(tierBlock(data.tier));
      const stats = h(
        "div",
        { class: "w-points-balance__stats" },
        h(
          "div",
          {},
          h("p", { class: "u-caps" }, "Earned, 30 days"),
          h("p", { class: "w-points-balance__stat u-tabular" }, points(data.earned_30d)),
        ),
        h(
          "div",
          {},
          h("p", { class: "u-caps" }, "Redeemed, 30 days"),
          h("p", { class: "w-points-balance__stat u-tabular" }, points(data.redeemed_30d)),
        ),
      );
      root.append(stats);
      if (showExpiring) {
        const exp = expiringBlock();
        if (exp) root.append(exp);
      }
      if (size === "l") {
        const recent = data.recent ?? [];
        if (recent.length > 2) {
          const series = [...recent].reverse().map((l) => l.balance_after);
          root.append(
            h(
              "div",
              { class: "w-points-balance__spark" },
              h("p", { class: "u-caps" }, "Balance after recent transactions"),
              sparkline(series, { label: "Balance after recent transactions" }),
            ),
          );
        }
        if (who.mine)
          root.append(
            h(
              "p",
              { class: "u-muted w-kit-small" },
              `You can still send ${points(data.transfer_remaining_today)} today.`,
            ),
          );
      }
      const list = recentList();
      if (list) root.append(list);
      if (who.mine && ctx.can("points:use")) {
        root.append(
          h(
            "div",
            { class: "w-kit-actions" },
            linkButton({
              href: nav.href("/points"),
              label: "Statement",
              icon: "list",
              variant: "secondary",
              size: "sm",
            }),
            linkButton({
              href: nav.href("/store"),
              label: "Spend points",
              icon: "store",
              variant: "ghost",
              size: "sm",
            }),
          ),
        );
      }
    }

    // ---- realtime: update the number from the payload, then re-read for the tier and flows ----
    const reread = life.debounce(() => load({ arrive: true }), 400);
    life.add(
      rt.on("points.posted", (ev) => {
        const p = ev.payload;
        if (!data || !p.member || p.member !== who.handle) return;
        if (balanceEl && p.balance !== data.balance) {
          const before = data.balance;
          data = { ...data, balance: p.balance };
          countTo(life, balanceEl, before, p.balance, points);
          const slot = root.querySelector(".w-points-balance__delta");
          if (slot) {
            slot.textContent = signedPoints(p.delta);
            slot.classList.remove("is-up", "is-down");
            slot.classList.add(p.delta > 0 ? "is-up" : "is-down");
            life.timeout(() => (slot.textContent = ""), 6000);
          }
          markArrived(life, root.querySelector(".w-points-balance__hero"));
          ctx.announce(`Balance ${points(p.balance)}`);
        }
        // `before` was already applied above, so the re-read only refreshes the rest.
        reread();
      }),
    );
    life.add(
      rt.on("tier.changed", (ev) => {
        if (ev.payload.member === who.handle) reread();
      }),
    );
    life.add(
      bus.subscribe("member.selected", (p) => {
        const handle = p?.id;
        if (!handle || handle === who.handle) return;
        target = handle;
        who = resolveMember(ctx, target);
        data = null;
        load({ initial: true });
      }),
    );
    life.add(() => (balanceEl = null));

    load({ initial: true });
    return life.dispose;
  },
};
