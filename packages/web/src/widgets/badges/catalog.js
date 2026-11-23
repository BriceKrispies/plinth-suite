// badges.catalog: every badge with earned, in progress and locked filters; badge detail inside the widget;
// manual award and revoke for managers.
import { schemaOf } from "../../core/widgets.js";
import { current as currentRoute } from "../../core/router.js";
import { h, clear } from "../../ds/js/dom.js";
import { points, number, date, percent } from "../../ds/js/format.js";
import { button } from "../../ds/js/button.js";
import { searchField, selectField, textArea, formErrors } from "../../ds/js/field.js";
import { combobox } from "../../ds/js/combobox.js";
import { progressBar } from "../../ds/js/progress.js";
import { personChip } from "../../ds/js/avatar.js";
import { pill } from "../../ds/js/pill.js";
import { emptyState, skeleton } from "../../ds/js/states.js";
import { icon } from "../../ds/js/icons.js";
import {
  disposer,
  resolveMember,
  reportLoadError,
  inlineError,
  markArrived,
  messageOf,
  withBusy,
  peopleSearch,
  myHandle,
  kv,
  dl,
  sectionHead,
  timeEl,
} from "../points/_kit.js";
import {
  badgeArtFor,
  badgeTile,
  rarityPill,
  STATE_PILL,
  stateOf,
  criteriaText,
  ring,
  remainingText,
  RARITY_ORDER,
} from "./_badge.js";

const FILTERS = [
  ["all", "All"],
  ["earned", "Earned"],
  ["in_progress", "In progress"],
  ["locked", "Locked"],
];
const SORTS = [
  { value: "rarity", label: "Rarity, rarest first" },
  { value: "title", label: "Title" },
  { value: "progress", label: "Closest to earning" },
  { value: "holders", label: "Most held" },
  { value: "reward", label: "Biggest reward" },
];

export default {
  id: "badges.catalog",
  domain: "badges",
  title: "All badges",
  configSchema: schemaOf("badges.catalog"),
  sizes: ["l", "xl", "full"],
  mount(el, { config, size, api, rt, bus, nav, ctx }) {
    const life = disposer();
    const root = h("div", { class: `w-badges w-badges-catalog w-badges-catalog--${size}` });
    el.append(root);
    const who = resolveMember(ctx, config.member ?? "$me");
    if (!who.handle) {
      root.append(
        emptyState({
          icon: "user",
          title: "No member selected",
          body: "Choose a member to see their badges.",
        }),
      );
      return () => {};
    }
    const canAward = ctx.can("badges:award");
    const canRevoke = ctx.can("badges:revoke");
    const state = {
      filter: config.filter ?? "all",
      q: "",
      rarity: "all",
      sort: "rarity",
      data: null,
      loaded: false,
      view: "grid",
      slug: null,
      detail: null,
    };
    let seq = 0;
    let arrived = new Set();

    const gridView = h("div", { class: "w-badges-catalog__grid" });
    const detailView = h("div", { class: "w-badges-catalog__detail", hidden: true });
    root.append(gridView, detailView);

    // ---- catalogue ----
    const load = async ({ initial = false, silent = false } = {}) => {
      const mine = ++seq;
      if (!silent && !state.loaded) {
        clear(gridView);
        gridView.append(skeleton({ shape: "card", lines: 3 }));
      }
      try {
        const res = await api.call("badges.catalog", {
          filter: "all",
          ...(who.arg ? { member: who.arg } : {}),
        });
        if (life.done || mine !== seq) return;
        const before = new Map(
          (state.data?.items ?? []).map((c) => [
            c.slug,
            `${c.awarded_at ?? ""}|${c.progress?.current ?? ""}`,
          ]),
        );
        state.data = res;
        arrived = silent
          ? new Set(
              res.items
                .filter(
                  (c) =>
                    before.has(c.slug) &&
                    before.get(c.slug) !== `${c.awarded_at ?? ""}|${c.progress?.current ?? ""}`,
                )
                .map((c) => c.slug),
            )
          : new Set();
        state.loaded = true;
        ctx.setState("ready");
        ctx.setCount(res.total);
        if (state.view === "grid") drawGrid();
        if (initial) openFromHints();
      } catch (e) {
        if (life.done || mine !== seq) return;
        reportLoadError({
          ctx,
          host: gridView,
          error: e,
          retry: () => load({ initial: true }),
          initial: initial || !state.loaded,
        });
      }
    };

    const ratio = (c) =>
      c.awarded_at
        ? 2
        : c.progress
          ? (c.progress.ratio ?? c.progress.current / Math.max(1, c.progress.target))
          : 0;
    const visible = () => {
      let rows = state.data.items;
      if (state.filter !== "all") rows = rows.filter((c) => stateOf(c) === state.filter);
      if (state.rarity !== "all") rows = rows.filter((c) => c.rarity === state.rarity);
      if (state.q) {
        const q = state.q.toLowerCase();
        rows = rows.filter((c) =>
          `${c.title} ${c.criteria_type === "hidden" && !c.awarded_at ? "" : c.description}`
            .toLowerCase()
            .includes(q),
        );
      }
      const sorters = {
        rarity: (a, b) =>
          RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity) || a.title.localeCompare(b.title),
        title: (a, b) => a.title.localeCompare(b.title),
        progress: (a, b) => ratio(b) - ratio(a),
        holders: (a, b) => b.holders - a.holders,
        reward: (a, b) => b.points_reward - a.points_reward,
      };
      return [...rows].sort(sorters[state.sort]);
    };

    function drawGrid() {
      const searchHadFocus =
        gridView.contains(document.activeElement) && document.activeElement.type === "search";
      clear(gridView);
      const d = state.data;
      const counts = { all: d.items.length, earned: 0, in_progress: 0, locked: 0 };
      for (const c of d.items) counts[stateOf(c)] += 1;
      const rows = visible();
      gridView.append(
        h(
          "div",
          { class: "w-badges-catalog__summary" },
          h(
            "p",
            { class: "w-badges-catalog__count" },
            h("strong", { class: "u-tabular" }, `${number(d.earned)} of ${number(d.total)}`),
            who.mine ? " badges earned" : ` badges earned by ${d.member.display_name}`,
          ),
          progressBar({
            value: d.earned,
            max: Math.max(1, d.total),
            label: "Badges earned",
            tone: "success",
          }),
        ),
        h(
          "div",
          { class: "w-kit-toolbar w-badges-catalog__toolbar", role: "group", "aria-label": "Badge filters" },
          searchField({
            name: "q",
            label: "Search badges",
            placeholder: "Title or description",
            value: state.q,
            onInput: (v) => ((state.q = v.trim()), soon()),
          }),
          selectField({
            name: "rarity",
            label: "Rarity",
            value: state.rarity,
            options: [
              { value: "all", label: "Any rarity" },
              ...RARITY_ORDER.map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) })),
            ],
            onChange: (v) => ((state.rarity = v), drawGrid()),
          }),
          selectField({
            name: "sort",
            label: "Sort by",
            value: state.sort,
            options: SORTS,
            onChange: (v) => ((state.sort = v), drawGrid()),
          }),
        ),
        h(
          "div",
          { class: "w-store-catalog__chiprow", role: "group", "aria-label": "Show badges" },
          ...FILTERS.map(([v, label]) =>
            button({
              label: `${label} (${counts[v]})`,
              variant: "secondary",
              size: "sm",
              pressed: state.filter === v,
              onClick: () => {
                state.filter = v;
                drawGrid();
              },
            }),
          ),
        ),
      );
      if (rows.length === 0) {
        gridView.append(
          emptyState({
            icon: state.filter === "earned" ? "trophy" : "search",
            title:
              state.q || state.rarity !== "all"
                ? "No badges match"
                : state.filter === "earned"
                  ? "No badges earned yet"
                  : "Nothing here",
            body: state.q || state.rarity !== "all" ? "Try another search or rarity." : undefined,
            action:
              state.q || state.rarity !== "all" || state.filter !== "all"
                ? button({
                    label: "Show all badges",
                    variant: "secondary",
                    onClick: () => (
                      (state.q = ""),
                      (state.rarity = "all"),
                      (state.filter = "all"),
                      drawGrid()
                    ),
                  })
                : null,
          }),
        );
      } else {
        const ul = h(
          "ul",
          { class: "w-badges-catalog__tiles", "aria-label": "Badges" },
          ...rows.map((c) => h("li", {}, badgeTile(c, { onOpen: (card) => openBadge(card.slug) }))),
        );
        gridView.append(ul);
        for (const slug of arrived) {
          const tile = ul.querySelector(`[data-slug="${slug}"]`);
          if (tile) markArrived(life, tile);
        }
        if (arrived.size) ctx.announce(`${arrived.size} ${arrived.size === 1 ? "badge" : "badges"} updated`);
      }
      if (searchHadFocus) gridView.querySelector('input[type="search"]')?.focus();
    }
    const soon = life.debounce(() => drawGrid(), 200);

    // ---- badge view ----
    async function openBadge(slug, { fromBus = false, silent = false } = {}) {
      state.view = "badge";
      state.slug = slug;
      gridView.hidden = true;
      detailView.hidden = false;
      if (!silent) {
        clear(detailView);
        detailView.append(backBar("Back to all badges"), skeleton({ shape: "card", lines: 3 }));
        if (!fromBus) bus.publish("badge.selected", { id: slug });
      }
      try {
        const d = await api.call("badges.get", { slug });
        if (life.done || state.slug !== slug) return;
        state.detail = d;
        drawBadge({ focus: !silent });
      } catch (e) {
        if (life.done) return;
        clear(detailView);
        inlineError(detailView, e, () => openBadge(slug));
        detailView.prepend(backBar("Back to all badges"));
      }
    }

    const backBar = (label, onClick = backToGrid) =>
      h(
        "div",
        { class: "w-kit-head" },
        button({ label, icon: "chevron-left", variant: "ghost", size: "sm", onClick }),
      );

    function backToGrid() {
      const slug = state.slug;
      state.view = "grid";
      state.slug = null;
      state.detail = null;
      detailView.hidden = true;
      gridView.hidden = false;
      drawGrid();
      gridView.querySelector(`[data-slug="${slug}"]`)?.focus();
    }

    function drawBadge({ focus = false, arrive = false } = {}) {
      clear(detailView);
      const d = state.detail;
      const c = d.card;
      const st = stateOf(c);
      const mine = state.data?.items.find((x) => x.slug === c.slug) ?? c;
      detailView.append(
        backBar("Back to all badges"),
        h(
          "div",
          { class: "w-badges-detail__head" },
          h("span", { class: "w-badges-detail__art" }, badgeArtFor(c.artwork, 112, `${c.title} badge`)),
          h(
            "div",
            { class: "w-badges-detail__info" },
            h("h3", { class: "w-kit-title", tabindex: "-1", "data-focus": "" }, c.title),
            h(
              "div",
              { class: "w-kit-pills" },
              rarityPill(c.rarity),
              STATE_PILL[st](),
              c.points_reward
                ? pill({ label: `+${points(c.points_reward)} reward`, tone: "signal", icon: "coins" })
                : null,
            ),
            h(
              "p",
              { class: "w-badges-detail__desc" },
              c.criteria_type === "hidden" && !c.awarded_at ? "A hidden badge." : c.description,
            ),
            h("p", {}, icon("target", { size: 16 }), " ", criteriaText(d.criteria)),
          ),
        ),
      );
      if (mine.progress && st !== "earned" && d.criteria) {
        detailView.append(
          h(
            "div",
            { class: "w-badges-detail__progress" },
            ring(mine.progress, `${c.title} progress`, 56),
            h(
              "p",
              {},
              h(
                "strong",
                { class: "u-tabular" },
                mine.progress.label || `${mine.progress.current} of ${mine.progress.target}`,
              ),
              h("span", { class: "u-muted" }, ` · ${remainingText(mine.progress)}`),
            ),
          ),
        );
      }
      detailView.append(
        dl(
          [
            c.awarded_at ? kv("Earned", date(c.awarded_at)) : null,
            kv("Held by", `${number(c.holders)} ${c.holders === 1 ? "member" : "members"}`),
            kv("Revision", String(d.revision)),
          ].filter(Boolean),
        ),
      );
      if (canAward)
        detailView.append(
          h(
            "div",
            { class: "w-kit-actions" },
            button({
              label: "Award this badge",
              icon: "award",
              variant: "primary",
              onClick: () => openAward(),
            }),
          ),
        );

      const regions = Object.entries(d.holders_by_region ?? {}).sort((a, b) => b[1] - a[1]);
      if (regions.length) {
        const max = Math.max(...regions.map((r) => r[1]), 1);
        const total = regions.reduce((a, r) => a + r[1], 0);
        detailView.append(
          sectionHead("Holders by region"),
          h(
            "ul",
            { class: "w-store-histogram", "aria-label": "Holders by region" },
            ...regions.map(([region, n]) =>
              h(
                "li",
                {},
                h("span", {}, region),
                h(
                  "span",
                  { class: "w-store-histogram__bar", "aria-hidden": "true" },
                  h("span", { style: `--_w:${Math.round((n / max) * 100)}%` }),
                ),
                h("span", { class: "u-tabular u-muted" }, `${number(n)} · ${percent(n / total)}`),
              ),
            ),
          ),
        );
      }

      detailView.append(sectionHead("Recent awards"));
      const awards = d.recent_awards ?? [];
      if (awards.length === 0) detailView.append(h("p", { class: "u-muted" }, "Nobody has earned this yet."));
      else
        detailView.append(
          h(
            "ul",
            { class: "w-badges-detail__awards", "aria-label": "Recent awards" },
            ...awards.map((a) => {
              const li = h(
                "li",
                { "data-award": a.award_id, class: a.revoked_at ? "is-revoked" : "" },
                personChip(a.member),
                h("span", { class: "u-muted w-kit-small" }, timeEl(a.awarded_at)),
                a.reason ? h("span", { class: "w-kit-small" }, a.reason) : null,
                a.revoked_at ? pill({ label: "Revoked", tone: "warning" }) : null,
                canRevoke && !a.revoked_at
                  ? button({
                      label: "Revoke",
                      icon: "x",
                      variant: "danger",
                      size: "sm",
                      onClick: () => openRevoke(a),
                    })
                  : null,
                h("span", { class: "w-kit-new-slot" }),
              );
              return li;
            }),
          ),
        );
      if (arrive)
        markArrived(
          life,
          detailView.querySelector(".w-badges-detail__awards li"),
          detailView.querySelector(".w-badges-detail__awards li .w-kit-new-slot"),
        );
      if (focus) detailView.querySelector("[data-focus]")?.focus();
    }

    // ---- award view ----
    function openAward() {
      state.view = "award";
      const c = state.detail.card;
      const form = h("form", { class: "w-kit-form", novalidate: true });
      let member = null;
      let reason = "";
      let key = null;
      let lastBody = null;
      const submit = button({ label: "Award badge", type: "submit", variant: "primary", icon: "award" });
      form.append(
        h("p", { class: "u-muted w-kit-small" }, "Fields marked * are required"),
        combobox({
          label: "Member",
          name: "/member",
          required: true,
          placeholder: "Search by name",
          search: peopleSearch(api, { exclude: [myHandle()].filter(Boolean) }),
          onChange: (opt) => (member = opt),
        }),
        textArea({
          name: "/reason",
          label: "Reason",
          required: true,
          rows: 3,
          hint: "Shown on the badge and in the audit trail (up to 280 characters).",
          onInput: (v) => (reason = v),
        }),
        ...[
          c.points_reward
            ? h("p", { class: "u-muted w-kit-small" }, `The member also receives ${points(c.points_reward)}.`)
            : null,
        ].filter(Boolean),
        h(
          "div",
          { class: "w-kit-actions" },
          button({ label: "Cancel", variant: "secondary", onClick: () => cancel() }),
          submit,
        ),
      );
      const cancel = () => {
        state.view = "badge";
        drawBadge({ focus: true });
      };
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const text = reason.trim();
        if (!member)
          return formErrors(
            { code: "VALIDATION_FAILED", path: "/member", message: "Choose a member" },
            { form },
          )?.focus();
        if (!text || text.length > 280)
          return formErrors(
            {
              code: "VALIDATION_FAILED",
              path: "/reason",
              message: text ? "Use at most 280 characters" : "Give a reason",
            },
            { form },
          )?.focus();
        const body = JSON.stringify([c.slug, member.value, text]);
        if (body !== lastBody || !key) key = api.idempotencyKey("badge-award");
        lastBody = body;
        await withBusy(submit, async () => {
          try {
            await api.call("badges.award", {
              slug: c.slug,
              member: member.value,
              reason: text,
              idempotency_key: key,
            });
            if (life.done) return;
            ctx.toast({ title: "Badge awarded", body: `${c.title} to ${member.label}`, tone: "success" });
            ctx.announce(`${c.title} awarded to ${member.label}`);
            state.view = "badge";
            await openBadge(c.slug, { silent: true });
            drawBadge({ focus: true, arrive: true });
            load({ silent: true });
          } catch (err) {
            const reasonCode = err?.details?.reason;
            const path =
              err.path ??
              (["ALREADY_EXISTS", "SELF_ACTION", "MEMBER_DISABLED"].includes(reasonCode) ? "/member" : null);
            formErrors(
              {
                code: err.code ?? "ERROR",
                path,
                message:
                  reasonCode === "ALREADY_EXISTS"
                    ? `${member.label} already has this badge.`
                    : messageOf(err),
              },
              { form },
            )?.focus();
          }
        });
      });
      clear(detailView);
      detailView.append(
        backBar("Back to badge", cancel),
        h("h3", { class: "w-kit-title", tabindex: "-1", "data-focus": "" }, `Award ${c.title}`),
        h("div", { class: "w-badges-detail__awardart" }, badgeArtFor(c.artwork, 56)),
        form,
      );
      detailView.querySelector("[data-focus]")?.focus();
    }

    // ---- revoke (a drawer) ----
    function openRevoke(a) {
      let reason = "";
      const form = h("form", { class: "w-kit-form", novalidate: true });
      const go = button({ label: "Revoke badge", variant: "danger", icon: "x", type: "submit" });
      form.append(
        h(
          "p",
          {},
          `Revoke ${a.badge_title} from ${a.member.display_name}? A points reward is reversed only if they still hold those points.`,
        ),
        textArea({
          name: "/reason",
          label: "Reason",
          required: true,
          rows: 3,
          hint: "Kept in the audit trail (up to 280 characters).",
          onInput: (v) => (reason = v),
        }),
      );
      const submit = async (e) => {
        e?.preventDefault();
        const text = reason.trim();
        if (!text || text.length > 280)
          return formErrors(
            {
              code: "VALIDATION_FAILED",
              path: "/reason",
              message: text ? "Use at most 280 characters" : "Give a reason",
            },
            { form },
          )?.focus();
        await withBusy(go, async () => {
          try {
            await api.call("badges.revoke", { award_id: a.award_id, reason: text });
            if (life.done) return;
            drawer.close();
            ctx.toast({
              title: "Badge revoked",
              body: `${a.badge_title} from ${a.member.display_name}`,
              tone: "success",
            });
            ctx.announce("Badge revoked");
            await openBadge(state.slug, { silent: true });
            load({ silent: true });
          } catch (err) {
            formErrors(
              { code: err.code ?? "ERROR", path: err.path ?? "/reason", message: messageOf(err) },
              { form },
            )?.focus();
          }
        });
      };
      form.addEventListener("submit", submit);
      go.addEventListener("click", (e) => {
        if (go.getAttribute("aria-busy") !== "true") submit(e);
      });
      const drawer = ctx.openDrawer({
        title: "Revoke badge",
        width: "sm",
        body: form,
        footer: h(
          "div",
          { class: "w-kit-actions" },
          button({ label: "Cancel", variant: "secondary", onClick: () => drawer.close() }),
          go,
        ),
      });
      life.add(() => drawer.close());
    }

    // ---- entering with a badge in mind ----
    function openFromHints() {
      const wanted = currentRoute().query?.badge ?? bus.latest?.("badge.selected")?.id;
      if (wanted && state.data.items.some((c) => c.slug === wanted)) openBadge(wanted, { fromBus: true });
    }

    // ---- realtime and bus ----
    const handleOf = (m) => (typeof m === "string" ? m : m?.handle);
    const reread = life.debounce(() => {
      load({ silent: true });
      if (state.view === "badge" && state.slug) openBadge(state.slug, { silent: true });
    }, 500);
    life.add(rt.on("badge.awarded", () => reread()));
    life.add(
      rt.on("badge.revoked", (ev) => {
        if (handleOf(ev.payload.member) === who.handle || canRevoke) reread();
      }),
    );
    life.add(
      rt.on("badge.progress", (ev) => {
        const p = ev.payload;
        if (p.member !== who.handle || !state.data) return;
        state.data = {
          ...state.data,
          items: state.data.items.map((c) =>
            c.slug === p.badge
              ? {
                  ...c,
                  progress: {
                    ...(c.progress ?? {}),
                    current: p.current,
                    target: p.target,
                    ratio: p.current / Math.max(1, p.target),
                    label: `${p.current} of ${p.target}`,
                  },
                }
              : c,
          ),
        };
        arrived = new Set([p.badge]);
        if (state.view === "grid") drawGrid();
        reread();
      }),
    );
    life.add(rt.onNode("Badge", () => reread()));
    life.add(
      bus.subscribe("badge.selected", (p) => {
        if (!p?.id || !state.data) return;
        if (state.view === "badge" && state.slug === p.id) return;
        if (state.data.items.some((c) => c.slug === p.id)) openBadge(p.id, { fromBus: true });
      }),
    );
    load({ initial: true });
    return life.dispose;
  },
};
