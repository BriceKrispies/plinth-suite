// Timeline. DESIGN-SYSTEM 6.18.
import { h } from "./dom.js";
import { icon } from "./icons.js";
import { relativeTime, dateTime } from "./format.js";
import { personChip } from "./avatar.js";

export const timeline = ({ label, items, now = new Date().toISOString() }) =>
  h(
    "ol",
    { class: "c-timeline", "aria-label": label },
    ...items.map((it) =>
      h(
        "li",
        { class: `c-timeline__item c-timeline__item--${it.tone ?? "neutral"}` },
        h(
          "span",
          { class: "c-timeline__marker", "aria-hidden": "true" },
          it.icon ? icon(it.icon, { size: 16 }) : null,
        ),
        h(
          "div",
          { class: "c-timeline__content" },
          h("p", { class: "c-timeline__title" }, it.href ? h("a", { href: it.href }, it.title) : it.title),
          it.body ? h("div", { class: "c-timeline__text" }, it.body) : null,
          h(
            "p",
            { class: "c-timeline__meta" },
            h(
              "time",
              { class: "c-timeline__time", datetime: it.at, title: dateTime(it.at) },
              relativeTime(it.at, now),
            ),
            it.actor ? personChip(it.actor) : null,
          ),
        ),
      ),
    ),
  );
