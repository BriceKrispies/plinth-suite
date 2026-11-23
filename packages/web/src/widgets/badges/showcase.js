// badges.showcase: up to three pinned badges plus the earned count; the owner can re-pick and order the showcase.
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { date, number } from "../../ds/js/format.js";
import { button, iconButton, linkButton } from "../../ds/js/button.js";
import { emptyState, skeleton } from "../../ds/js/states.js";
import { personChip } from "../../ds/js/avatar.js";
import {
  disposer,
  resolveMember,
  reportLoadError,
  markArrived,
  messageOf,
  withBusy,
  myHandle,
} from "../points/_kit.js";
import { badgeArtFor, openBadge } from "./_badge.js";

const MAX = 3;

export default {
  id: "badges.showcase",
  domain: "badges",
  title: "Badge showcase",
  configSchema: schemaOf("badges.showcase"),
  sizes: ["s", "m", "l"],
  mount(el, { config, size, api, rt, bus, nav, ctx }) {
    const life = disposer();
    const root = h("div", { class: `w-badges w-badges-showcase w-badges-showcase--${size}` });
    el.append(root);
    let who = resolveMember(ctx, config.member ?? "$me");
    let data = null;
    let view = "showcase";
    let picked = [];
    let seq = 0;
    let newSlugs = new Set();

    const earned = () => (data?.awards ?? []).filter((a) => !a.revoked_at);
    const bySlug = () => new Map(earned().map((a) => [a.badge, a]));
    const pinned = () => {
      const map = bySlug();
      return (data?.showcase ?? [])
        .map((s) => map.get(s))
        .filter(Boolean)
        .slice(0, MAX);
    };
    const editable = () => who.mine && who.handle === myHandle();

    const load = async ({ initial = false, silent = false } = {}) => {
      if (!who.handle) {
        clear(root);
        root.append(emptyState({ icon: "user", title: "No member selected" }));
        return;
      }
      const mine = ++seq;
      if (!silent) {
        clear(root);
        root.append(skeleton({ shape: size === "s" ? "tile" : "card", lines: 2 }));
      }
      try {
        const res = await api.call("badges.member", { handle: who.handle });
        if (life.done || mine !== seq) return;
        const before = new Set(earned().map((a) => a.award_id));
        data = res;
        newSlugs = silent
          ? new Set(
              earned()
                .filter((a) => !before.has(a.award_id))
                .map((a) => a.badge),
            )
          : new Set();
        ctx.setState("ready");
        ctx.setCount(earned().length);
        if (view === "pick") drawPick();
        else drawShowcase();
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

    const badgeButton = (a, px, withText) => {
      const b = h(
        "button",
        {
          type: "button",
          class: "w-badges-pinned",
          "data-slug": a.badge,
          "aria-label": `${a.badge_title}, earned ${date(a.awarded_at)}`,
          onclick: () => openBadge({ slug: a.badge, ctx, bus, nav }),
        },
        badgeArtFor(a.artwork, px),
        withText ? h("span", { class: "w-badges-pinned__title" }, a.badge_title) : null,
        withText ? h("span", { class: "u-muted w-kit-small" }, date(a.awarded_at)) : null,
        h("span", { class: "w-kit-new-slot" }),
      );
      if (newSlugs.has(a.badge)) markArrived(life, b, b.querySelector(".w-kit-new-slot"));
      return b;
    };

    function drawShowcase() {
      clear(root);
      view = "showcase";
      const list = pinned();
      const total = earned().length;
      if (!editable() && data)
        root.append(h("div", { class: "w-points-balance__who" }, personChip(data.member)));
      if (total === 0) {
        root.append(
          emptyState({
            icon: "trophy",
            title: editable() ? "No badges yet" : "No badges earned yet",
            body: editable() ? "Badges you earn will appear here." : undefined,
            action: editable()
              ? linkButton({ href: nav.href("/badges"), label: "See all badges", variant: "secondary" })
              : null,
          }),
        );
        return;
      }
      root.append(
        h(
          "p",
          { class: "w-badges-showcase__count" },
          h("strong", { class: "u-tabular" }, number(total)),
          ` ${total === 1 ? "badge" : "badges"} earned`,
        ),
      );
      if (list.length === 0) {
        root.append(
          h(
            "p",
            { class: "u-muted" },
            editable() ? "You have not pinned any badges yet." : "Nothing is pinned yet.",
          ),
        );
      } else {
        root.append(
          h(
            "ul",
            { class: "w-badges-showcase__pins", "aria-label": "Pinned badges" },
            ...list.map((a) => h("li", {}, badgeButton(a, size === "s" ? 40 : 72, size !== "s"))),
          ),
        );
      }
      if (size === "l") {
        const rest = earned()
          .filter((a) => !list.some((p) => p.badge === a.badge))
          .slice(0, 8);
        if (rest.length)
          root.append(
            h("p", { class: "u-caps" }, "Also earned"),
            h(
              "ul",
              { class: "w-badges-showcase__more", "aria-label": "Other earned badges" },
              ...rest.map((a) => h("li", {}, badgeButton(a, 40, false))),
            ),
          );
      }
      const actions = h("div", { class: "w-kit-actions" });
      if (editable() && size !== "s")
        actions.append(
          button({
            label: "Edit showcase",
            icon: "edit",
            variant: "secondary",
            size: "sm",
            onClick: startPick,
          }),
        );
      if (size !== "s" || editable())
        actions.append(
          linkButton({ href: nav.href("/badges"), label: "All badges", variant: "ghost", size: "sm" }),
        );
      if (actions.children.length) root.append(actions);
    }

    // ---- pick view ----
    function startPick() {
      picked = pinned().map((a) => a.badge);
      view = "pick";
      drawPick(true);
    }

    function drawPick(focus = false) {
      clear(root);
      const list = earned();
      const map = bySlug();
      const same =
        JSON.stringify(picked) ===
        JSON.stringify((data?.showcase ?? []).filter((s) => map.has(s)).slice(0, MAX));
      const save = button({
        label: "Save showcase",
        icon: "check",
        variant: "primary",
        size: "sm",
        disabled: same,
      });
      save.addEventListener("click", () =>
        withBusy(save, async () => {
          try {
            await api.call("me.profile.update", { showcase: picked });
            if (life.done) return;
            ctx.toast({ title: "Showcase saved", tone: "success" });
            ctx.announce("Showcase saved");
            view = "showcase";
            await load({ silent: true });
            root.querySelector(".w-badges-pinned")?.focus();
          } catch (e) {
            ctx.toast({ title: "Showcase not saved", body: messageOf(e), tone: "danger" });
          }
        }),
      );
      const move = (slug, dir) => {
        const i = picked.indexOf(slug);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= picked.length) return;
        [picked[i], picked[j]] = [picked[j], picked[i]];
        drawPick();
        root.querySelector(`[data-pos="${slug}"] [data-dir="${dir}"]`)?.focus();
        ctx.announce(`${map.get(slug).badge_title} is now number ${j + 1}`);
      };
      const orderControls = (a, pos) => {
        const up = iconButton({
          icon: "chevron-up",
          label: `Move ${a.badge_title} earlier`,
          size: "sm",
          variant: "ghost",
          disabled: pos === 0,
          onClick: () => move(a.badge, -1),
        });
        const down = iconButton({
          icon: "chevron-down",
          label: `Move ${a.badge_title} later`,
          size: "sm",
          variant: "ghost",
          disabled: pos === picked.length - 1,
          onClick: () => move(a.badge, 1),
        });
        up.setAttribute("data-dir", "-1");
        down.setAttribute("data-dir", "1");
        return h(
          "span",
          { class: "w-badges-pick__order" },
          h("span", { class: "u-tabular" }, `#${pos + 1}`),
          up,
          down,
        );
      };
      const full = picked.length >= MAX;
      root.append(
        h("h3", { class: "w-kit-title", tabindex: "-1", "data-focus": "" }, "Choose up to three"),
        h(
          "p",
          { class: "u-muted w-kit-small", role: "status" },
          `${picked.length} of ${MAX} chosen. The order here is the order shown.`,
        ),
        h(
          "ul",
          { class: "w-badges-pick", "aria-label": "Your earned badges" },
          ...list.map((a) => {
            const on = picked.includes(a.badge);
            const id = `pick-${a.award_id}`;
            const pos = picked.indexOf(a.badge);
            return h(
              "li",
              { "data-pos": a.badge },
              h("input", {
                type: "checkbox",
                id,
                checked: on ? true : null,
                disabled: !on && full ? true : null,
                onchange: (e) => {
                  if (e.target.checked) picked = [...picked, a.badge];
                  else picked = picked.filter((s) => s !== a.badge);
                  drawPick();
                  root.querySelector(`#${CSS.escape(id)}`)?.focus();
                },
              }),
              h(
                "label",
                { for: id },
                badgeArtFor(a.artwork, 40),
                h(
                  "span",
                  {},
                  a.badge_title,
                  h("span", { class: "u-muted w-kit-small" }, ` earned ${date(a.awarded_at)}`),
                ),
              ),
              on ? orderControls(a, pos) : null,
            );
          }),
        ),
        h(
          "div",
          { class: "w-kit-actions" },
          button({
            label: "Cancel",
            variant: "secondary",
            size: "sm",
            onClick: () => ((view = "showcase"), drawShowcase(), root.querySelector("button")?.focus()),
          }),
          save,
        ),
      );
      if (focus) root.querySelector("[data-focus]")?.focus();
    }

    // ---- realtime and bus ----
    const handleOf = (m) => (typeof m === "string" ? m : m?.handle);
    life.add(
      rt.on("badge.awarded", (ev) => {
        if (handleOf(ev.payload.member) === who.handle) load({ silent: true });
      }),
    );
    life.add(
      rt.on("badge.revoked", (ev) => {
        if (handleOf(ev.payload.member) === who.handle) load({ silent: true });
      }),
    );
    life.add(
      bus.subscribe("member.selected", (p) => {
        if (!p?.id || p.id === who.handle) return;
        who = resolveMember(ctx, p.id);
        data = null;
        view = "showcase";
        load({ initial: true });
      }),
    );
    load({ initial: true });
    return life.dispose;
  },
};
