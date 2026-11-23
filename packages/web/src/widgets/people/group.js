// people.group: a group's description, managers and members.
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { button, linkButton } from "../../ds/js/button.js";
import { searchField, selectField } from "../../ds/js/field.js";
import { emptyState } from "../../ds/js/states.js";
import { pill, statusPill } from "../../ds/js/pill.js";
import { artwork } from "../../ds/js/artwork.js";
import { avatar } from "../../ds/js/avatar.js";
import { toErrorInfo } from "../../core/api.js";
import { lifecycle, debounce, sequence, link, plural, safeIcon, highlight, arrive } from "../../shell/kit.js";
import { cap, handleOf } from "./_parts.js";

const TYPE = { team: "Team", region: "Region", interest: "Interest", distribution: "Distribution list" };
const SORTS = [
  { value: "name", label: "Name" },
  { value: "tier", label: "Tier" },
  { value: "region", label: "Region" },
];
const TIER_ORDER = { platinum: 0, gold: 1, silver: 2, bronze: 3 };

export default {
  id: "people.group",
  domain: "people",
  title: "Group",
  configSchema: schemaOf("people.group"),
  sizes: ["m", "l", "xl"],
  mount(el, { config, size, api, rt, bus, ctx }) {
    const life = lifecycle();
    const seq = sequence();
    const slug = typeof config.group === "string" ? config.group : null;
    const st = { data: null, q: "", sort: "name", selected: null, loaded: false };
    const root = h("div", { class: "w-group", "data-size": size });
    el.append(root);
    const head = h("header", { class: "w-group__head" });
    const search = searchField({
      name: "q",
      label: "Filter members",
      placeholder: "Filter by name, title or region",
      onInput: (v) => {
        st.q = v.trim();
        debounced();
      },
    });
    search.classList.add("w-bar__search");
    const sort = selectField({
      name: "sort",
      label: "Sort members by",
      value: st.sort,
      options: SORTS,
      onChange: (v) => {
        st.sort = v;
        paintMembers();
      },
    });
    sort.classList.add("w-bar__sel");
    const debounced = debounce(() => paintMembers(), 150);
    life.add(debounced.cancel);
    const bar = h(
      "div",
      { class: "w-bar", role: "group", "aria-label": "Member filters" },
      h("div", { class: "w-bar__row" }, search, sort),
    );
    const summary = h("p", { class: "w-summary", role: "status" });
    const members = h("ul", { class: "w-mlist", "aria-label": "Members" });
    root.append(head, bar, summary, members);

    async function load({ live = false } = {}) {
      if (!slug) {
        ctx.setState("unavailable", { reason: "missing" });
        return;
      }
      const mine = seq.next();
      try {
        const out = await api.call("groups.get", { slug });
        if (!seq.ok(mine) || life.dead) return;
        const before = st.data ? new Set(st.data.members.map(handleOf)) : null;
        st.data = out;
        ctx.setTitle(out.summary.node.title);
        ctx.setCount(out.summary.member_count);
        if (!st.loaded) {
          st.loaded = true;
          ctx.setState("ready");
        }
        paintHead();
        paintMembers(before && live ? out.members.map(handleOf).filter((k) => !before.has(k)) : []);
        if (before && live) ctx.announce("Group updated");
      } catch (e) {
        if (!seq.ok(mine) || life.dead) return;
        if (live) return;
        const info = toErrorInfo(e);
        if (info.code === "UNKNOWN_REFERENCE") ctx.setState("unavailable", { reason: "missing" });
        else if (info.code === "FORBIDDEN") ctx.setState("unavailable", { reason: "forbidden" });
        else ctx.setState("error", { error: info });
      }
    }

    function paintHead() {
      clear(head);
      const { summary: s, spec, managers } = st.data;
      head.append(
        h("span", { class: "w-group__art" }, artwork(s.artwork, { size: size === "m" ? 48 : 72 })),
        h(
          "div",
          { class: "w-group__id" },
          h("h3", { class: "w-group__name" }, s.node.title),
          h(
            "p",
            { class: "w-pcard__pills" },
            pill({ label: TYPE[s.type] ?? cap(s.type), icon: "group" }),
            pill({ label: plural(s.member_count, "member"), icon: "users" }),
            s.is_manager
              ? pill({ label: "You manage this group", tone: "info" })
              : s.is_member
                ? pill({ label: "You are a member", tone: "success" })
                : null,
            pill({
              label: spec.open_posting ? "Anyone can message" : "Managers only",
              tone: spec.open_posting ? "neutral" : "warning",
              icon: spec.open_posting ? "send" : "lock",
            }),
          ),
          spec.description ? h("p", { class: "w-group__desc" }, spec.description) : null,
          managers.length
            ? h(
                "p",
                { class: "w-group__mgrs" },
                h("span", { class: "w-hint" }, plural(managers.length, "manager") + ": "),
                ...managers.flatMap((m, i) => [
                  i ? ", " : null,
                  m.handle ? h("a", { href: link(`/people/${m.handle}`) }, m.display_name) : m.display_name,
                ]),
              )
            : null,
          spec.open_posting || s.is_manager
            ? linkButton({
                href: link("/messages/new", { to: `group:${s.node.slug}` }),
                label: "Message the group",
                icon: "send",
                size: "sm",
              })
            : null,
        ),
      );
    }

    function paintMembers(arrived = []) {
      clear(members);
      const d = st.data;
      if (!d) return;
      const managerHandles = new Set(d.managers.map((m) => m.handle));
      const q = st.q.toLowerCase();
      let rows = d.members.filter(
        (m) =>
          !q || `${m.person.display_name} ${m.title} ${m.region} ${m.department}`.toLowerCase().includes(q),
      );
      rows = [...rows].sort((a, b) => {
        if (st.sort === "tier")
          return (
            TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
            a.person.display_name.localeCompare(b.person.display_name)
          );
        if (st.sort === "region")
          return (
            a.region.localeCompare(b.region) || a.person.display_name.localeCompare(b.person.display_name)
          );
        return a.person.display_name.localeCompare(b.person.display_name);
      });
      summary.textContent = q
        ? `${rows.length} of ${plural(d.members.length, "member")}`
        : plural(d.members.length, "member");
      if (rows.length === 0) {
        members.append(
          h(
            "li",
            { class: "w-empty" },
            q
              ? emptyState({
                  icon: "search",
                  title: `No members match ‘${st.q}’`,
                  action: button({
                    label: "Clear filter",
                    onClick: () => {
                      st.q = "";
                      search.querySelector("input").value = "";
                      paintMembers();
                    },
                  }),
                })
              : emptyState({
                  icon: "users",
                  title: "No members yet",
                  body: "People added to this group are listed here.",
                }),
          ),
        );
        return;
      }
      for (const m of rows) {
        const key = handleOf(m);
        const sel = st.selected === key;
        const nameNode = m.person.handle
          ? h(
              "a",
              { class: "w-person__name", href: link(`/people/${m.person.handle}`) },
              ...highlight(m.person.display_name, st.q),
            )
          : h("span", { class: "w-person__name" }, m.person.display_name);
        const li = h(
          "li",
          { class: "w-mrow", "data-key": key },
          h(
            "button",
            {
              type: "button",
              class: "w-mrow__pick",
              "aria-pressed": String(sel),
              "aria-label": `Select ${m.person.display_name}`,
              onclick: () => {
                st.selected = key;
                if (m.person.handle) bus.publish("member.selected", { id: m.person.handle });
                ctx.announce(`${m.person.display_name} selected`);
                paintMembers();
              },
            },
            avatar({ name: m.person.display_name, avatar: m.person.avatar, size: "md" }),
          ),
          h(
            "div",
            { class: "w-mrow__text" },
            h(
              "span",
              { class: "w-mrow__line" },
              nameNode,
              managerHandles.has(m.person.handle)
                ? pill({ label: "Manager", tone: "info", icon: "key" })
                : null,
              m.status === "disabled" ? pill({ label: "Disabled", tone: "warning" }) : null,
            ),
            h("span", { class: "w-mrow__sub" }, `${m.title} · ${cap(m.department)} · ${m.region}`),
          ),
          statusPill("tier", m.tier),
          m.badges_count
            ? h(
                "span",
                { class: "w-mcard__badges", title: plural(m.badges_count, "badge") },
                safeIcon("award", "star", { size: 16 }),
                String(m.badges_count),
              )
            : null,
        );
        if (arrived.includes(key)) {
          arrive(li, life);
          li.querySelector(".w-mrow__line")?.append(pill({ label: "New", tone: "signal" }));
        }
        members.append(li);
      }
    }

    life.add(rt.onNode("Group", () => refresh()));
    const refresh = debounce(() => load({ live: true }), 400);
    life.add(refresh.cancel);

    ctx.setState("loading");
    load();
    return () => life.dispose();
  },
};
