import { h } from "./dom.js";
import { avatarArt } from "./artwork.js";
import { pill } from "./pill.js";
import { meStore } from "../../core/stores.js";
import { PElement, define, reflect, swapClass } from "./element-base.js";

const PX = { xs: 20, sm: 24, md: 32, lg: 40, xl: 56 };

const initialsOf = (name) =>
  String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

/**
 * `<p-avatar name handle size presence href src initials hue>`: generated art by default (initials on a hue),
 * or an image when `src` is set. With `href` the art sits inside one link whose accessible name is the person.
 */
export class PAvatar extends PElement {
  static observedAttributes = ["name", "handle", "size", "presence", "href", "src", "initials", "hue"];
  #size = null;

  render() {
    const size = this.size in PX ? this.size : "md";
    this.classList.add("c-avatar");
    this.#size = swapClass(this, this.#size, `c-avatar--${size}`);
    const name = this.name ?? this.handle ?? "";
    const presence = this.presence;
    const state = presence ? `${name}, ${presence}` : name;
    const art = this.src
      ? h("img", { class: "c-avatar__img", src: this.src, alt: "", width: PX[size], height: PX[size] })
      : avatarArt(
          { initials: this.initials ?? initialsOf(name), hue: Number(this.getAttribute("hue")) || 0 },
          { size: PX[size] },
        );
    const dot = presence
      ? h("span", { class: `c-avatar__presence c-avatar__presence--${presence}`, "aria-hidden": "true" })
      : null;
    if (this.href) {
      this.removeAttribute("role");
      this.removeAttribute("aria-label");
      this.replaceChildren(
        h(
          "a",
          { class: "c-avatar__link", href: this.href },
          art,
          dot,
          h("span", { class: "sr-only" }, state),
        ),
      );
    } else {
      this.setAttribute("role", "img");
      this.setAttribute("aria-label", state);
      this.replaceChildren(...[art, dot].filter(Boolean));
    }
  }
}
reflect(PAvatar, {
  name: ["name", "string"],
  handle: ["handle", "string"],
  size: ["size", "string", "md"],
  presence: ["presence", "string"],
  href: ["href", "string"],
  src: ["src", "string"],
  initials: ["initials", "string"],
  hue: ["hue", "number", 0],
});
define("p-avatar", PAvatar);

export const avatar = ({ name, avatar: art, size = "md", presence = null, href } = {}) => {
  const el = document.createElement("p-avatar");
  return el.configure({
    name,
    size,
    presence,
    href: href ?? null,
    initials: art?.initials ?? "?",
    hue: art?.hue ?? 0,
  });
};

export const avatarStack = (people, { max = 4 } = {}) => {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return h(
    "span",
    { class: "c-avatar-stack" },
    ...shown.map((p) => avatar({ name: p.display_name ?? p.name, avatar: p.avatar, size: "sm" })),
    extra > 0
      ? h(
          "span",
          { class: "c-avatar c-avatar--sm c-avatar--more", role: "img", "aria-label": `and ${extra} more` },
          h("span", { "aria-hidden": "true" }, `+${extra}`),
        )
      : null,
  );
};

/** True when `person` is the signed-in viewer (matched by subject, then by handle). */
export const isViewer = (person) => {
  const me = meStore.get();
  if (!me || !person) return false;
  const subject = me.principal?.subject;
  if (subject && person.subject) return person.subject === subject;
  const handle = me.member?.handle;
  return Boolean(handle && person.handle && person.handle === handle);
};

/**
 * `<p-person name handle subject kind href show-handle>`: a person as avatar and name. Dense by default: the viewer
 * reads "You" and the @handle moves into a tooltip and an accessible name (it never disappears for assistive
 * technology). `show-handle` draws it as text, for roomy detail views. The avatar art comes from the `art`
 * property ({ initials, hue }) or the `person` property, which sets everything at once.
 */
export class PPerson extends PElement {
  static observedAttributes = ["name", "handle", "subject", "kind", "href", "show-handle"];
  /** @type {{ initials?: string, hue?: number } | null} */
  #art = null;
  #me = false;

  get art() {
    return this.#art;
  }

  set art(v) {
    this.#art = v ?? null;
    this.requestRender();
  }

  /** A person record as the API returns it. */
  set person(p) {
    this.configure({
      name: p?.display_name ?? null,
      handle: p?.handle ?? null,
      subject: p?.subject ?? null,
      kind: p?.kind ?? null,
      art: p?.avatar ?? null,
    });
  }

  render() {
    const name = this.name ?? "";
    const showHandle = this.showHandle;
    const me = isViewer({ subject: this.subject, handle: this.handle });
    const handle = this.handle ? `@${this.handle}` : "";
    const kids = [me ? "You" : name];
    if (me) kids.push(h("span", { class: "sr-only" }, ` (${name}${handle ? `, ${handle}` : ""})`));
    else if (handle && !showHandle) kids.push(h("span", { class: "sr-only" }, ` ${handle}`));
    const nameNode = this.href
      ? h("a", { class: "c-person__name", href: this.href }, ...kids)
      : h("span", { class: "c-person__name" }, ...kids);
    this.classList.add("c-person");
    this.classList.toggle("c-person--me", me);
    this.#me = me;
    if (name || handle) this.title = handle ? `${name} ${handle}` : name;
    this.replaceChildren(
      ...[
        avatar({ name, avatar: this.#art ?? undefined, size: "xs" }),
        nameNode,
        this.kind === "agent"
          ? pill({ label: "Agent" })
          : this.kind === "service"
            ? pill({ label: "Service" })
            : null,
        handle && showHandle ? h("span", { class: "c-person__handle" }, handle) : null,
      ].filter(Boolean),
    );
  }

  connected() {
    // The viewer can change between draws (sign-in), so a connected chip re-checks it.
    if (isViewer({ subject: this.subject, handle: this.handle }) !== this.#me) this.requestRender();
  }
}
reflect(PPerson, {
  name: ["name", "string"],
  handle: ["handle", "string"],
  subject: ["subject", "string"],
  kind: ["kind", "string"],
  href: ["href", "string"],
  showHandle: ["show-handle", "bool"],
});
define("p-person", PPerson);

export const personChip = (person, { href, showHandle = false } = {}) => {
  const el = document.createElement("p-person");
  return el.configure({
    name: person.display_name,
    handle: person.handle ?? null,
    subject: person.subject ?? null,
    kind: person.kind ?? null,
    href: href ?? null,
    showHandle,
    art: person.avatar ?? null,
  });
};
