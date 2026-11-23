// Pieces shared by the people widgets: a member card, the quick-view drawer body and filter vocabularies.
import { h } from "../../ds/js/dom.js";
import { avatar } from "../../ds/js/avatar.js";
import { statusPill, pill } from "../../ds/js/pill.js";
import { iconButton, linkButton } from "../../ds/js/button.js";
import { can } from "../../core/stores.js";
import { ago, when, link, safeIcon, plural } from "../../shell/kit.js";

export const REGIONS = ["NA", "EMEA", "APAC", "LATAM", "ANZ"];
export const TIERS = ["bronze", "silver", "gold", "platinum"];
export const DEPARTMENTS = ["operations", "fulfilment", "finance", "marketing", "technology", "people"];
export const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

export const handleOf = (m) => m.person.handle ?? m.person.subject;

/** Pill for a member that is not active. */
export const disabledPill = (m) =>
  m.status === "disabled" ? pill({ label: "Disabled", tone: "warning" }) : null;

/**
 * One member as a card. `onSelect(m)` runs on activation of the main button; `onDetails(m)` opens the quick view.
 * The name is a link to the profile.
 */
export const memberCardNode = (m, { selected = false, onSelect, onDetails } = {}) => {
  const p = m.person;
  const main = h(
    "button",
    {
      type: "button",
      class: "w-mcard__main",
      "aria-pressed": String(selected),
      "aria-label": `Select ${p.display_name}`,
      onclick: () => onSelect?.(m),
    },
    avatar({ name: p.display_name, avatar: p.avatar, size: "xl" }),
  );
  const name = p.handle
    ? h("a", { class: "w-mcard__name", href: link(`/people/${p.handle}`) }, p.display_name)
    : h("span", { class: "w-mcard__name" }, p.display_name);
  return h(
    "li",
    { class: "w-mcard", "data-key": handleOf(m) },
    main,
    h(
      "div",
      { class: "w-mcard__body" },
      name,
      h("p", { class: "w-mcard__title" }, m.title),
      h("p", { class: "w-mcard__meta" }, `${cap(m.department)} · ${m.region}`),
      h(
        "p",
        { class: "w-mcard__pills" },
        statusPill("tier", m.tier),
        m.badges_count
          ? h(
              "span",
              { class: "w-mcard__badges", title: plural(m.badges_count, "badge") },
              safeIcon("award", "star", { size: 16 }),
              String(m.badges_count),
            )
          : null,
        disabledPill(m),
      ),
    ),
    onDetails
      ? iconButton({
          icon: "eye",
          label: `Quick view of ${p.display_name}`,
          size: "sm",
          onClick: () => onDetails(m),
        })
      : null,
  );
};

/** The quick-view drawer body for a member card. `close()` is called when a link inside is followed. */
export const quickView = (m, close) => {
  const p = m.person;
  const actions = [];
  if (p.handle) {
    actions.push(
      linkButton({
        href: link(`/people/${p.handle}`),
        label: "View profile",
        icon: "user",
        variant: "primary",
      }),
      linkButton({ href: link("/messages/new", { to: `user:${p.handle}` }), label: "Message", icon: "send" }),
    );
    if (can("points:award")) {
      actions.push(
        linkButton({
          href: link("/points/award", { member: p.handle }),
          label: "Award points",
          icon: "award",
        }),
      );
    }
  }
  const body = h(
    "div",
    { class: "w-qv" },
    h(
      "div",
      { class: "w-qv__head" },
      avatar({ name: p.display_name, avatar: p.avatar, size: "xl" }),
      h(
        "div",
        {},
        h("h3", { class: "w-qv__name" }, p.display_name),
        h("p", { class: "w-qv__title" }, m.title),
      ),
    ),
    h(
      "dl",
      { class: "w-dl" },
      h("dt", {}, "Department"),
      h("dd", {}, cap(m.department)),
      h("dt", {}, "Region"),
      h("dd", {}, m.region),
      h("dt", {}, "Tier"),
      h("dd", {}, statusPill("tier", m.tier)),
      h("dt", {}, "Badges"),
      h("dd", {}, String(m.badges_count)),
      h("dt", {}, "Last active"),
      h("dd", {}, m.last_active_at ? `${ago(m.last_active_at)} (${when(m.last_active_at)})` : "Not yet"),
      h("dt", {}, "Status"),
      h("dd", {}, m.status === "active" ? "Active" : "Disabled"),
    ),
    h("div", { class: "w-qv__actions" }, ...actions),
  );
  body.addEventListener("click", (e) => {
    if (e.target.closest("a[href]")) setTimeout(() => close?.(), 0);
  });
  return body;
};
