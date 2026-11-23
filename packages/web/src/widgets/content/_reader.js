// The reading view shared by content.reader and the reader view inside content.feed: one published item rendered
// from its blocks, with reactions, a table of contents and live engagement counts.
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { artwork } from "../../ds/js/artwork.js";
import { personChip } from "../../ds/js/avatar.js";
import { pill } from "../../ds/js/pill.js";
import { emptyState, skeleton, errorState } from "../../ds/js/states.js";
import { number } from "../../ds/js/format.js";
import { icon } from "../../ds/js/icons.js";
import { debounce, rel, when, reasonOf, failToast, toErrorInfo } from "../promotions/_kit.js";
import { renderBlocks, reactionBar, headingsOf, readMinutes, TYPE_META, totalReactions } from "./_blocks.js";

/**
 * Mount a reader into `host`. Returns `{ load(slug), current() }`. `onBack` adds a back button; `onLoaded(item)`
 * reports the item so the feed can mark it seen.
 */
export const mountReader = (
  host,
  { api, rt, ctx, life, nav, toc = false, onBack, onLoaded, idPrefix = "rd" },
) => {
  let slug = null;
  let data = null;
  let bar = null;
  let seq = 0;
  const refreshCounts = debounce(life, () => silentRefresh(), 1200);

  const frame = (...kids) => host.replaceChildren(...kids.filter(Boolean));

  const backRow = () =>
    onBack
      ? button({
          label: "Back to the feed",
          icon: "chevron-left",
          variant: "ghost",
          size: "sm",
          onClick: onBack,
        })
      : null;

  const paint = () => {
    const { item, blocks } = data;
    const meta = TYPE_META[item.type];
    const heads = headingsOf(blocks);
    const article = h(
      "article",
      { class: "wn-article" },
      h(
        "header",
        { class: "wn-article__head" },
        h("div", { class: "wn-article__hero" }, artwork(item.hero, { size: 96 })),
        h(
          "div",
          { class: "wn-article__titles" },
          h(
            "p",
            { class: "wn-article__eyebrow" },
            pill({
              label: meta.label,
              tone: item.type === "announcement" ? "signal" : "neutral",
              icon: meta.icon,
            }),
            item.pinned ? pill({ label: "Pinned", tone: "info", icon: "star" }) : null,
          ),
          h("h2", { class: "wn-article__title" }, item.title),
          item.summary ? h("p", { class: "wn-article__summary" }, item.summary) : null,
          h(
            "p",
            { class: "wn-article__meta" },
            personChip(item.author),
            h(
              "time",
              { datetime: item.published_at, title: when(item.published_at) },
              ` ${rel(item.published_at)}`,
            ),
            ` · ${readMinutes(blocks)} min read · ${number(item.views)} views`,
          ),
        ),
      ),
      renderBlocks(blocks, { idPrefix }),
      item.tags.length
        ? h(
            "ul",
            { class: "wn-tags", role: "list", "aria-label": "Tags" },
            ...item.tags.map((t) => h("li", {}, pill({ label: t }))),
          )
        : null,
    );
    bar = reactionBar({
      counts: item.reactions,
      mine: item.my_reaction,
      onPick: async (reaction) => {
        try {
          const out = await api.call("content.engage", { slug, reaction });
          if (life.dead) return;
          data.item.views = out.views;
          data.item.reactions = out.reactions;
          data.item.my_reaction = out.my_reaction;
          bar.update({ counts: out.reactions, mine: out.my_reaction });
          ctx.announce(out.my_reaction ? `Reacted: ${out.my_reaction}` : "Reaction removed");
        } catch (e) {
          failToast(ctx, e, "Could not save your reaction");
        }
      },
    });
    const side =
      toc && heads.length >= 3
        ? h(
            "nav",
            { class: "wn-toc", "aria-label": "In this article" },
            h("p", { class: "wk-caps" }, "In this article"),
            h(
              "ol",
              {},
              ...heads.map(({ b, i }) =>
                h(
                  "li",
                  { class: b.level === 3 ? "is-sub" : null },
                  h(
                    "button",
                    {
                      type: "button",
                      onclick: () =>
                        host.querySelector(`#${idPrefix}-${i}`)?.scrollIntoView({
                          block: "start",
                          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                            ? "auto"
                            : "smooth",
                        }),
                    },
                    b.text,
                  ),
                ),
              ),
            ),
          )
        : null;
    frame(
      h(
        "div",
        { class: "wn-reader__top" },
        backRow(),
        h(
          "div",
          { class: "wk-actions" },
          button({
            label: "Copy link",
            icon: "link",
            size: "sm",
            variant: "ghost",
            onClick: async () => {
              const url = `${location.origin}${nav.href(`/read/${slug}`)}`;
              try {
                await navigator.clipboard.writeText(url);
                ctx.toast({ title: "Link copied", tone: "neutral", timeout: 2500 });
              } catch {
                ctx.toast({ title: url, body: "Copy this link.", tone: "neutral" });
              }
            },
          }),
        ),
      ),
      h(
        "div",
        { class: `wn-reader${side ? " has-toc" : ""}` },
        h("div", { class: "wn-reader__main" }, article, h("div", { class: "wn-reader__react" }, bar)),
        side,
      ),
    );
  };

  const silentRefresh = async () => {
    if (!slug || !data) return;
    try {
      const out = await api.call("content.published", { slug });
      if (life.dead || out.item.slug !== slug) return;
      data.item = {
        ...data.item,
        views: out.item.views,
        reactions: out.item.reactions,
        my_reaction: out.item.my_reaction,
      };
      bar?.update({ counts: out.item.reactions, mine: out.item.my_reaction });
      const meta = host.querySelector(".wn-article__meta");
      if (meta)
        meta.lastChild.textContent = ` · ${readMinutes(data.blocks)} min read · ${number(out.item.views)} views`;
    } catch {
      /* counts catch up on the next read */
    }
  };

  const load = async (nextSlug) => {
    slug = nextSlug;
    data = null;
    const mine = ++seq;
    if (!slug) {
      frame(
        backRow(),
        emptyState({
          icon: "article",
          title: "Nothing to read yet",
          body: "Choose an article in the news feed to read it here.",
        }),
      );
      return;
    }
    frame(backRow(), skeleton({ shape: "card", lines: 5 }));
    try {
      const out = await api.call("content.published", { slug });
      if (life.dead || mine !== seq) return;
      data = out;
      onLoaded?.(out.item);
      paint();
      // record the view once per opening; the counts in the response are the server's
      api
        .call("content.engage", { slug, view: true })
        .then((e) => {
          if (life.dead || mine !== seq || !data) return;
          data.item.views = e.views;
          bar?.update({ counts: e.reactions, mine: e.my_reaction });
          const meta = host.querySelector(".wn-article__meta");
          if (meta)
            meta.lastChild.textContent = ` · ${readMinutes(data.blocks)} min read · ${number(e.views)} views`;
        })
        .catch(() => {});
    } catch (e) {
      if (life.dead || mine !== seq) return;
      if (reasonOf(e) === "NOT_ELIGIBLE")
        frame(
          backRow(),
          emptyState({
            icon: "lock",
            title: "Not available to you",
            body: "This item is published to a different audience.",
          }),
        );
      else frame(backRow(), errorState({ error: toErrorInfo(e), retry: () => load(slug) }));
    }
  };

  life.add(
    rt.on("content.engaged", (ev) => {
      if (ev.payload.content === slug) refreshCounts();
    }),
  );

  return { load, current: () => slug, data: () => data, totalReactions };
};
