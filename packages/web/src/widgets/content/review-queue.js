// content.review-queue: items waiting for the viewer's review, with the diff since the live version (or the first
// draft), and approve or request changes in place.
import { schemaOf } from "../../core/widgets.js";
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { artwork } from "../../ds/js/artwork.js";
import { personChip } from "../../ds/js/avatar.js";
import { pill } from "../../ds/js/pill.js";
import { emptyState, skeleton, errorState } from "../../ds/js/states.js";
import {
  lifecycle,
  debounce,
  banner,
  promptNote,
  failToast,
  kv,
  rel,
  when,
  arrive,
  reasonOf,
} from "../promotions/_kit.js";
import { TYPE_META, diffBlocks, diffFields } from "./_blocks.js";

export default {
  id: "content.review-queue",
  domain: "content",
  title: "Review queue",
  configSchema: schemaOf("content.review-queue"),
  sizes: ["m", "l", "xl"],
  mount(el, { size, api, rt, bus, nav, ctx }) {
    const life = lifecycle();
    const compact = size === "m";
    const me = ctx.memberHandle("$me");
    const st = {
      items: [],
      view: "queue",
      item: null,
      diff: null,
      diffError: null,
      fresh: new Set(),
      loaded: false,
    };
    const queue = h("div", { class: "wn-queue" });
    const review = h("div", { class: "wn-review", hidden: true });
    const live = h("p", { class: "sr-only", "aria-live": "polite" });
    el.append(h("div", { class: `wn wn-reviewq wn-reviewq--${size}` }, live, queue, review));

    const showView = (v) => {
      st.view = v;
      queue.hidden = v !== "queue";
      review.hidden = v !== "review";
    };

    // ---------- queue ----------
    let seq = 0;
    const loadQueue = async ({ quiet = false } = {}) => {
      const mine = ++seq;
      if (!st.loaded) queue.replaceChildren(skeleton({ shape: "text", lines: 4 }));
      try {
        const out = await api.call("content.list", {
          awaiting_my_review: true,
          status: ["in_review"],
          limit: 50,
        });
        if (life.dead || mine !== seq) return;
        const before = new Set(st.items.map((i) => i.node.slug));
        st.items = out.items;
        if (quiet && st.loaded)
          for (const i of out.items) if (!before.has(i.node.slug)) st.fresh.add(i.node.slug);
        st.loaded = true;
        paintQueue();
        if (st.view === "review" && st.item && !out.items.some((i) => i.node.slug === st.item.node.slug)) {
          // the open item left the queue: decided elsewhere
          review.prepend(
            banner({
              tone: "info",
              title: "This item is no longer waiting for you.",
              body: "It was decided or changed elsewhere.",
            }),
          );
        }
      } catch (e) {
        if (life.dead || mine !== seq) return;
        queue.replaceChildren(errorState({ error: e, retry: loadQueue }));
        ctx.setCount(0);
      }
    };

    function paintQueue() {
      queue.replaceChildren();
      ctx.setCount(st.items.length);
      if (st.items.length === 0) {
        queue.append(
          emptyState({
            icon: "check-circle",
            title: "Nothing to review",
            body: "When an author submits content that lists you as a reviewer, it appears here.",
          }),
        );
        return;
      }
      queue.append(
        h(
          "ul",
          { class: "wn-queue__list", role: "list", "aria-label": "Content awaiting your review" },
          ...st.items.map((i) =>
            h(
              "li",
              { "data-slug": i.node.slug },
              h(
                "button",
                { type: "button", class: "wn-qrow wk-row__main", onclick: () => openReview(i) },
                h("span", { class: "wn-qrow__art", "aria-hidden": "true" }, artwork(i.hero, { size: 24 })),
                h(
                  "span",
                  { class: "wn-qrow__text" },
                  h("strong", {}, i.node.title),
                  compact ? null : h("span", { class: "u-muted wn-qrow__summary" }, i.summary),
                  h(
                    "span",
                    { class: "u-muted wn-qrow__meta" },
                    `${i.author.display_name} · submitted ${rel(i.updated_at)}`,
                  ),
                ),
                h("span", { class: "wn-qrow__type" }, pill({ label: TYPE_META[i.type]?.label ?? i.type })),
              ),
            ),
          ),
        ),
      );
      for (const slug of st.fresh)
        arrive(life, queue.querySelector(`[data-slug="${CSS.escape(slug)}"]`), false);
      if (st.fresh.size)
        live.textContent = `${st.fresh.size} new item${st.fresh.size === 1 ? "" : "s"} to review`;
      st.fresh.clear();
    }

    // ---------- review ----------
    const closeReview = () => {
      showView("queue");
      st.item = null;
      paintQueue();
      queue.querySelector("button")?.focus();
    };

    const openReview = async (item) => {
      st.item = item;
      st.diff = null;
      st.diffError = null;
      bus.publish("content.selected", { id: item.node.slug });
      showView("review");
      paintReview();
      review.querySelector("button")?.focus();
      const to = item.node.revision;
      const from =
        item.published_revision !== null && item.published_revision < to
          ? item.published_revision
          : to > 1
            ? 1
            : null;
      if (from === null) return;
      try {
        const out = await api.call("content.diff", { slug: item.node.slug, from, to });
        if (life.dead || st.item?.node.slug !== item.node.slug) return;
        st.diff = {
          ...out,
          label: item.published_revision !== null ? "since the live version" : "since the first draft",
        };
      } catch (e) {
        if (life.dead) return;
        st.diffError = e;
      }
      paintReview();
    };

    const decide = async (action) => {
      const item = st.item;
      let note;
      if (action === "request_changes") {
        note = await promptNote(ctx, {
          title: `Request changes: ${item.node.title}`,
          label: "What should change?",
          hint: "The author sees this note.",
          required: true,
          submitLabel: "Send back",
        });
        if (note === null) return;
      } else if (
        !(await ctx.confirm({
          title: `Approve ${item.node.title}?`,
          message: "It moves to approved and can then be published.",
          confirmLabel: "Approve",
        }))
      )
        return;
      try {
        const out = await api.call("content.transition", {
          slug: item.node.slug,
          action,
          ...(note ? { note } : {}),
          base_revision: item.node.revision,
        });
        if (life.dead) return;
        ctx.toast({
          title:
            out.status === "pending_approval"
              ? "Sent for approval"
              : action === "approve"
                ? "Approved"
                : "Changes requested",
          body: item.node.title,
          tone: "success",
        });
        ctx.announce(action === "approve" ? "Approved" : "Changes requested");
        const left = st.items.filter((i) => i.node.slug !== item.node.slug);
        st.items = left;
        const next = left[0];
        if (next && !compact) {
          openReview(next);
        } else closeReview();
        loadQueue();
      } catch (e) {
        if (reasonOf(e) === "SELF_ACTION")
          ctx.toast({ title: "You cannot review your own content", tone: "warning" });
        else failToast(ctx, e, "Could not record your decision");
      }
    };

    function paintReview() {
      const i = st.item;
      if (!i) return;
      const own = me && i.author.handle === me;
      review.replaceChildren(
        h(
          "div",
          { class: "wn-review__top" },
          button({
            label: "Back to the queue",
            icon: "chevron-left",
            variant: "ghost",
            size: "sm",
            onClick: closeReview,
          }),
          h(
            "span",
            { class: "u-muted u-tabular" },
            st.items.length > 1
              ? `${st.items.findIndex((x) => x.node.slug === i.node.slug) + 1} of ${st.items.length}`
              : "",
          ),
        ),
        h(
          "div",
          { class: "wn-review__head" },
          h("div", { class: "wn-review__art", "aria-hidden": "true" }, artwork(i.hero, { size: 56 })),
          h(
            "div",
            {},
            h("h3", { class: "wn-review__title" }, i.node.title),
            h("p", { class: "u-muted" }, i.summary),
          ),
        ),
        kv([
          ["Type", TYPE_META[i.type]?.label ?? i.type],
          ["Author", personChip(i.author)],
          ["Submitted", `${when(i.updated_at)} (${rel(i.updated_at)})`],
          ["Revision", String(i.node.revision)],
          ["Tags", i.tags.length ? i.tags.join(", ") : null],
        ]),
        ...[
          own
            ? banner({
                tone: "warning",
                title: "You wrote this.",
                body: "Authors cannot approve or request changes on their own content.",
              })
            : null,
        ].filter(Boolean),
        h(
          "div",
          { class: "wk-actions wn-review__actions" },
          button({
            label: "Approve",
            icon: "check",
            variant: "primary",
            disabled: Boolean(own),
            onClick: () => decide("approve"),
          }),
          button({
            label: "Request changes",
            icon: "reply",
            disabled: Boolean(own),
            onClick: () => decide("request_changes"),
          }),
          nav
            ? button({
                label: "Open in the editor",
                icon: "edit",
                variant: "ghost",
                onClick: () => nav.go(`/content/${i.node.slug}`),
              })
            : null,
        ),
        h("h4", { class: "wk-caps" }, st.diff ? `Changes ${st.diff.label}` : "Changes"),
        st.diffError
          ? errorState({ error: st.diffError, retry: () => openReview(i) })
          : st.diff
            ? h(
                "div",
                { class: "wn-review__diff" },
                h("p", {}, st.diff.human_summary),
                diffFields(st.diff.fields),
                diffBlocks(st.diff.blocks),
              )
            : i.node.revision <= 1
              ? h(
                  "p",
                  { class: "u-muted" },
                  "This is the first revision, so there is nothing earlier to compare. Open it in the editor to read it in full.",
                )
              : skeleton({ shape: "text", lines: 3 }),
      );
    }

    showView("queue");
    loadQueue();

    life.add(
      rt.on(
        "content.state_changed",
        debounce(life, () => loadQueue({ quiet: true }), 500),
      ),
    );
    return () => life.dispose();
  },
};
