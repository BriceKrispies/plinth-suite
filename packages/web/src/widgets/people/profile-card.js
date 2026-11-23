// people.profile-card: identity, tier, groups, roles and contact actions; own profile can be edited in place.
import { schemaOf } from "../../core/widgets.js";
import { h, clear, uid } from "../../ds/js/dom.js";
import { button, linkButton } from "../../ds/js/button.js";
import { textField, textArea, formErrors } from "../../ds/js/field.js";
import { emptyState } from "../../ds/js/states.js";
import { statusPill, pill } from "../../ds/js/pill.js";
import { avatar } from "../../ds/js/avatar.js";
import { badgeArt } from "../../ds/js/artwork.js";
import { progressBar } from "../../ds/js/progress.js";
import { statTile } from "../../ds/js/stat.js";
import { iconButton } from "../../ds/js/button.js";
import { inlineText } from "../../ds/js/richtext.js";
import { menuButton } from "../../ds/js/menu.js";
import { number, points } from "../../ds/js/format.js";
import { toErrorInfo } from "../../core/api.js";
import { can } from "../../core/stores.js";
import {
  lifecycle,
  sequence,
  when,
  ago,
  errorText,
  link,
  arrive,
  charCounter,
  safeIcon,
  plural,
} from "../../shell/kit.js";
import { cap } from "./_parts.js";

const SHAPE = { circle: "disc", ribbon: "diamond" };

export default {
  id: "people.profile-card",
  domain: "people",
  title: "Profile card",
  configSchema: schemaOf("people.profile-card"),
  sizes: ["s", "m", "l"],
  mount(el, { config, size, api, rt, bus, nav, ctx }) {
    const life = lifecycle();
    const seq = sequence();
    const defaultHandle = ctx.memberHandle(config.member);
    const st = { handle: defaultHandle, data: null, mode: "card", loaded: false, busy: false };
    const root = h("div", { class: "w-pcard", "data-size": size });
    el.append(root);

    // ---- data ----

    async function load({ live = false } = {}) {
      if (!st.handle) {
        ctx.setState("ready");
        paint();
        return;
      }
      const mine = seq.next();
      try {
        const out = await api.call("people.profile", { handle: st.handle });
        if (!seq.ok(mine) || life.dead) return;
        const tierBefore = st.data?.tier.tier;
        st.data = out;
        if (!st.loaded) {
          st.loaded = true;
          ctx.setState("ready");
        }
        if (st.mode === "card") {
          paint();
          if (live) {
            arrive(root, life);
            if (tierBefore && tierBefore !== out.tier.tier)
              ctx.announce(`${out.member.display_name} is now ${cap(out.tier.tier)}`);
          }
        }
      } catch (e) {
        if (!seq.ok(mine) || life.dead) return;
        const info = toErrorInfo(e);
        if (live) return;
        if (info.code === "UNKNOWN_REFERENCE") ctx.setState("unavailable", { reason: "missing" });
        else if (info.code === "FORBIDDEN") ctx.setState("unavailable", { reason: "forbidden" });
        else ctx.setState("error", { error: info });
      }
    }

    // ---- card view ----

    const badge = (b, px) => {
      const art = b.artwork;
      return h(
        "li",
        { class: "w-pcard__badge", title: `${b.title}: ${b.description}` },
        badgeArt(
          { shape: SHAPE[art.shape] ?? art.shape, icon: art.icon, hue: art.hue, ring: art.ring ?? null },
          { size: px, label: b.title },
        ),
        size === "l" ? h("span", { class: "w-pcard__badgename" }, b.title) : null,
      );
    };

    const actions = (d) => {
      const list = [];
      if (d.is_self) {
        list.push(
          button({
            label: "Edit profile",
            icon: "edit",
            size: "sm",
            onClick: () => ((st.mode = "edit"), paintEdit()),
          }),
        );
      } else if (d.member.status === "active") {
        list.push(
          linkButton({
            href: link("/messages/new", { to: `user:${d.member.handle}` }),
            label: "Message",
            icon: "send",
            size: "sm",
            variant: "primary",
          }),
        );
        if (can("points:award")) {
          list.push(
            linkButton({
              href: link("/points/award", { member: d.member.handle }),
              label: "Award points",
              icon: "award",
              size: "sm",
            }),
          );
        }
      }
      if (size !== "s") {
        list.push(
          menuButton({
            label: "More actions",
            icon: "more",
            iconOnly: true,
            variant: "ghost",
            size: "sm",
            items: [
              {
                label: "Show on this page",
                icon: "target",
                onSelect: () => {
                  bus.publish("member.selected", { id: d.member.handle });
                  ctx.announce(`${d.member.display_name} selected`);
                },
              },
              {
                label: "Open profile page",
                icon: "external",
                onSelect: () => nav.go(`/people/${d.member.handle}`),
              },
            ],
          }),
        );
      }
      return h("div", { class: "w-pcard__actions" }, ...list);
    };

    function paint() {
      clear(root);
      if (!st.handle || (!st.data && st.loaded)) {
        root.append(
          emptyState({
            icon: "user",
            title: "No member selected",
            body: "Choose a person to see their profile here.",
          }),
        );
        return;
      }
      const d = st.data;
      if (!d) return;
      const m = d.member;
      const strip =
        st.handle !== defaultHandle
          ? h(
              "p",
              { class: "w-pcard__strip" },
              `Showing @${st.handle}`,
              button({
                label: "Back",
                size: "sm",
                variant: "ghost",
                onClick: () => {
                  st.handle = defaultHandle;
                  st.data = null;
                  load();
                },
              }),
            )
          : null;
      const head = h(
        "header",
        { class: "w-pcard__head" },
        avatar({ name: m.display_name, avatar: m.avatar, size: "xl" }),
        h(
          "div",
          { class: "w-pcard__id" },
          h(
            "h3",
            { class: "w-pcard__name" },
            m.display_name,
            d.is_self ? pill({ label: "You" }) : null,
            m.status === "disabled" ? pill({ label: "Disabled", tone: "warning" }) : null,
          ),
          h("p", { class: "w-pcard__title" }, m.title || "No title"),
          h(
            "p",
            { class: "w-pcard__meta" },
            `${cap(m.department)} · ${m.region}${m.location ? ` · ${m.location}` : ""}`,
          ),
          h("p", { class: "w-pcard__pills" }, statusPill("tier", d.tier.tier)),
        ),
      );
      root.append(...[strip, head].filter(Boolean));
      if (size === "s") {
        root.append(actions(d));
        return;
      }
      if (d.bio) root.append(h("p", { class: "w-pcard__bio" }, inlineText(d.bio)));
      root.append(tierBlock(d));
      if (d.showcase.length) {
        root.append(
          h(
            "section",
            { class: "w-pcard__sec", "aria-label": "Badge showcase" },
            h(
              "h4",
              { class: "w-pcard__h" },
              "Showcase",
              h("span", { class: "w-hint" }, ` ${plural(d.badges_count, "badge")} earned`),
            ),
            h("ul", { class: "w-pcard__badges" }, ...d.showcase.map((b) => badge(b, size === "l" ? 56 : 40))),
          ),
        );
      }
      if (d.groups.length) {
        root.append(
          h(
            "section",
            { class: "w-pcard__sec", "aria-label": "Groups" },
            h("h4", { class: "w-pcard__h" }, "Groups"),
            h(
              "ul",
              { class: "w-chips" },
              ...d.groups.map((g) =>
                h("li", { class: "c-chip" }, h("a", { href: link(`/groups/${g.slug}`) }, g.title)),
              ),
            ),
          ),
        );
      }
      if (size === "l") {
        if (d.roles.length) {
          root.append(
            h(
              "section",
              { class: "w-pcard__sec", "aria-label": "Roles" },
              h("h4", { class: "w-pcard__h" }, "Roles"),
              h("p", { class: "w-pcard__pills" }, ...d.roles.map((r) => pill({ label: r, icon: "shield" }))),
            ),
          );
        }
        root.append(
          h(
            "section",
            { class: "w-pcard__sec", "aria-label": "Activity in numbers" },
            h("h4", { class: "w-pcard__h" }, "The last 30 days and overall"),
            h(
              "div",
              { class: "w-pcard__stats" },
              statTile({ label: "Earned, 30 days", value: number(d.stats.points_earned_30d), unit: "pts" }),
              statTile({ label: "Orders", value: d.stats.orders_total }),
              statTile({ label: "Reviews", value: d.stats.reviews }),
              statTile({ label: "Content published", value: d.stats.content_published }),
              statTile({ label: "Awards given, 30 days", value: d.stats.awards_given_30d }),
            ),
          ),
        );
        if (d.private) {
          root.append(
            h(
              "section",
              { class: "w-pcard__sec", "aria-label": "Private details" },
              h("h4", { class: "w-pcard__h" }, safeIcon("lock", "lock", { size: 16 }), " Private"),
              h(
                "dl",
                { class: "w-dl" },
                h("dt", {}, "Email"),
                h("dd", {}, d.private.email),
                h("dt", {}, "Active sessions"),
                h("dd", {}, String(d.private.sessions_active)),
                h("dt", {}, "Last active"),
                h(
                  "dd",
                  {},
                  d.private.last_active_at
                    ? `${ago(d.private.last_active_at)} (${when(d.private.last_active_at)})`
                    : "Not yet",
                ),
                d.balance !== null ? h("dt", {}, "Balance") : null,
                d.balance !== null ? h("dd", {}, points(d.balance)) : null,
              ),
            ),
          );
        } else if (d.balance !== null) {
          root.append(h("p", { class: "w-hint" }, `Balance ${points(d.balance)}`));
        }
        root.append(h("p", { class: "w-hint" }, `Joined ${when(m.joined_at)}`));
      }
      root.append(actions(d));
    }

    const tierBlock = (d) => {
      const t = d.tier;
      const left =
        t.next_tier && t.next_tier_at !== null ? Math.max(0, t.next_tier_at - t.lifetime_points) : 0;
      return h(
        "section",
        { class: "w-pcard__sec", "aria-label": "Tier progress" },
        h(
          "p",
          { class: "w-pcard__tier" },
          statusPill("tier", t.tier),
          h(
            "span",
            { class: "w-hint" },
            t.next_tier ? `${points(left)} to ${cap(t.next_tier)}` : "Highest tier",
          ),
        ),
        t.next_tier
          ? progressBar({
              value: Math.round(t.progress * 100),
              max: 100,
              label: `Progress to ${cap(t.next_tier)}`,
              tone: "info",
            })
          : null,
      );
    };

    // ---- edit view ----

    function paintEdit() {
      const d = st.data;
      clear(root);
      const m = d.member;
      let showcase = d.showcase.map((b) => ({ slug: b.slug, title: b.title }));
      const startShowcase = showcase.map((b) => b.slug);
      const name = textField({
        name: "/display_name",
        label: "Display name",
        value: m.display_name,
        required: true,
      });
      const title = textField({ name: "/title", label: "Title", value: m.title });
      const location = textField({ name: "/location", label: "Location", value: m.location });
      const bio = textArea({
        name: "/bio",
        label: "Bio",
        rows: 4,
        value: d.bio,
        hint: "Up to 500 characters. **bold**, _emphasis_ and @handle work.",
      });
      const bioEl = bio.querySelector("textarea");
      const bioCount = charCounter(500);
      bioCount.update(bioEl.value.length);
      bioEl.addEventListener("input", () => bioCount.update(bioEl.value.length));
      let hue = m.avatar.hue;
      const preview = h(
        "span",
        { class: "w-pcard__huepreview" },
        avatar({ name: m.display_name, avatar: { initials: m.avatar.initials, hue }, size: "xl" }),
      );
      const hueId = uid("hue");
      const range = h("input", {
        type: "range",
        id: hueId,
        name: "/avatar_hue",
        min: 0,
        max: 359,
        value: hue,
        class: "w-pcard__hue",
      });
      range.addEventListener("input", () => {
        hue = Number(range.value);
        clear(preview);
        preview.append(
          avatar({ name: m.display_name, avatar: { initials: m.avatar.initials, hue }, size: "xl" }),
        );
      });
      const hueField = h(
        "div",
        { class: "c-field" },
        h("label", { class: "c-field__label", for: hueId }, "Avatar colour"),
        h("div", { class: "w-pcard__hueRow" }, preview, range),
      );
      const showHost = h("ul", { class: "w-pcard__showcase" });
      const paintShowcase = () => {
        clear(showHost);
        if (showcase.length === 0) showHost.append(h("li", { class: "w-hint" }, "No badges showcased."));
        showcase.forEach((b, i) => {
          showHost.append(
            h(
              "li",
              { class: "w-pcard__showrow" },
              h("span", {}, b.title),
              iconButton({
                icon: "chevron-up",
                label: `Move ${b.title} up`,
                size: "sm",
                disabled: i === 0,
                onClick: () => {
                  [showcase[i - 1], showcase[i]] = [showcase[i], showcase[i - 1]];
                  paintShowcase();
                },
              }),
              iconButton({
                icon: "chevron-down",
                label: `Move ${b.title} down`,
                size: "sm",
                disabled: i === showcase.length - 1,
                onClick: () => {
                  [showcase[i + 1], showcase[i]] = [showcase[i], showcase[i + 1]];
                  paintShowcase();
                },
              }),
              iconButton({
                icon: "x",
                label: `Remove ${b.title} from showcase`,
                size: "sm",
                onClick: () => {
                  showcase = showcase.filter((_, k) => k !== i);
                  paintShowcase();
                },
              }),
            ),
          );
        });
      };
      paintShowcase();
      const status = h("p", { class: "w-hint", role: "status" });
      const save = button({ label: "Save profile", icon: "check", variant: "primary", type: "submit" });
      const form = h(
        "form",
        { class: "c-form w-pcard__form", novalidate: true, "aria-label": "Edit your profile" },
        h("h3", { class: "w-pcard__name" }, "Edit your profile"),
        h("p", { class: "w-hint" }, "Fields marked * are required"),
        name,
        title,
        location,
        bio,
        bioCount,
        hueField,
        h(
          "fieldset",
          { class: "c-fieldset" },
          h("legend", { class: "c-fieldset__legend" }, "Badge showcase"),
          showHost,
          h("p", { class: "w-hint" }, "Up to three badges you have earned. Earn more to add them."),
        ),
        h(
          "div",
          { class: "w-send__foot" },
          status,
          button({ label: "Cancel", variant: "ghost", onClick: () => ((st.mode = "card"), paint()) }),
          save,
        ),
      );
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (st.busy) return;
        formErrors(null, { form });
        const input = {};
        const val = (f) => f.querySelector("[name]").value;
        if (val(name).trim() !== m.display_name) input.display_name = val(name).trim();
        if (val(title) !== m.title) input.title = val(title);
        if (val(location) !== m.location) input.location = val(location);
        if (bioEl.value !== d.bio) input.bio = bioEl.value;
        if (hue !== m.avatar.hue) input.avatar_hue = hue;
        const slugs = showcase.map((b) => b.slug);
        if (JSON.stringify(slugs) !== JSON.stringify(startShowcase)) input.showcase = slugs;
        if (input.display_name === "") {
          formErrors(
            { code: "VALIDATION_FAILED", path: "/display_name", message: "Enter a display name" },
            { form },
          );
          return;
        }
        if (bioEl.value.length > 500) {
          formErrors(
            { code: "VALIDATION_FAILED", path: "/bio", message: "The bio can be up to 500 characters" },
            { form },
          );
          return;
        }
        if (Object.keys(input).length === 0) {
          st.mode = "card";
          paint();
          return;
        }
        st.busy = true;
        save.setAttribute("aria-busy", "true");
        try {
          await api.call("me.profile.update", input);
          if (life.dead) return;
          st.mode = "card";
          ctx.announce("Profile saved");
          ctx.toast({ title: "Profile saved", tone: "success" });
          await load({ live: true });
        } catch (err) {
          const info = toErrorInfo(err);
          if (info.path) formErrors({ ...info, message: errorText(err) }, { form });
          else {
            status.textContent = errorText(err);
            status.classList.add("w-hint--error");
          }
        } finally {
          st.busy = false;
          save.removeAttribute("aria-busy");
        }
      });
      root.append(form);
      name.querySelector("input").focus();
    }

    // ---- realtime and bus ----

    const mine = (member) => member === st.handle;
    life.add(
      rt.on("member.updated", (ev) => mine(ev.payload.member) && st.mode === "card" && load({ live: true })),
    );
    life.add(
      rt.on("tier.changed", (ev) => mine(ev.payload.member) && st.mode === "card" && load({ live: true })),
    );
    life.add(
      bus.subscribe("member.selected", (p) => {
        if (!p?.id || p.id === st.handle || st.mode === "edit") return;
        st.handle = p.id;
        st.data = null;
        load();
      }),
    );

    ctx.setState("loading");
    load();
    return () => life.dispose();
  },
};
