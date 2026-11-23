// people.groups: every group with membership markers; opens a group page.
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { searchField, selectField } from "../../ds/js/field.js";
import { emptyState } from "../../ds/js/states.js";
import { pill } from "../../ds/js/pill.js";
import { artwork } from "../../ds/js/artwork.js";
import { toErrorInfo } from "../../core/api.js";
import {
  lifecycle,
  debounce,
  sequence,
  segmented,
  link,
  plural,
  highlight,
  arrive,
} from "../../shell/kit.js";

const TYPES = [
  { value: "", label: "All types" },
  { value: "team", label: "Teams" },
  { value: "region", label: "Regions" },
  { value: "interest", label: "Interests" },
  { value: "distribution", label: "Distribution lists" },
];

const fingerprint = (g) => `${g.member_count}:${g.is_member}:${g.is_manager}`;

export default {
  id: "people.groups",
  domain: "people",
  title: "Groups",
  configSchema: schemaOf("people.groups"),
  sizes: ["m", "l"],
  mount(el, { size, api, rt, ctx }) {
    const life = lifecycle();
    const seq = sequence();
    const st = { items: [], scope: "all", type: "", q: "", loaded: false };
    const root = h("div", { class: "w-groups", "data-size": size });
    el.append(root);

    const scope = segmented({
      label: "Show",
      options: [
        { value: "all", label: "All" },
        { value: "mine", label: "Mine" },
        { value: "managed", label: "Managed by me" },
      ],
      value: st.scope,
      onChange: (v) => {
        st.scope = v;
        paint();
      },
    });
    const type = selectField({
      name: "type",
      label: "Group type",
      value: st.type,
      options: TYPES,
      onChange: (v) => {
        st.type = v;
        paint();
      },
    });
    type.classList.add("w-bar__sel");
    const debounced = debounce(() => paint(), 150);
    life.add(debounced.cancel);
    const search = searchField({
      name: "q",
      label: "Search groups",
      placeholder: "Search groups",
      onInput: (v) => {
        st.q = v.trim();
        debounced();
      },
    });
    search.classList.add("w-bar__search");
    const bar = h(
      "div",
      { class: "w-bar", role: "group", "aria-label": "Group filters" },
      h("div", { class: "w-bar__row" }, scope, type),
      h("div", { class: "w-bar__row" }, search),
    );
    const summary = h("p", { class: "w-summary", role: "status" });
    const list = h("ul", { class: "w-glist", "aria-label": "Groups" });
    root.append(bar, summary, list);

    async function load({ live = false } = {}) {
      const mine = seq.next();
      try {
        const out = await api.call("groups.list");
        if (!seq.ok(mine) || life.dead) return;
        const before = new Map(st.items.map((g) => [g.node.slug, fingerprint(g)]));
        st.items = out.items;
        ctx.setCount(out.items.length);
        if (!st.loaded) {
          st.loaded = true;
          ctx.setState("ready");
        }
        const changed = live
          ? out.items
              .filter((g) => before.has(g.node.slug) && before.get(g.node.slug) !== fingerprint(g))
              .map((g) => g.node.slug)
          : [];
        paint(changed);
      } catch (e) {
        if (!seq.ok(mine) || life.dead || live) return;
        if (!st.loaded) ctx.setState("error", { error: toErrorInfo(e) });
      }
    }

    function paint(changed = []) {
      clear(list);
      const q = st.q.toLowerCase();
      const rows = st.items.filter(
        (g) =>
          (st.scope === "all" ||
            (st.scope === "mine" && g.is_member) ||
            (st.scope === "managed" && g.is_manager)) &&
          (!st.type || g.type === st.type) &&
          (!q || `${g.node.title} ${g.description}`.toLowerCase().includes(q)),
      );
      summary.textContent = `${rows.length} of ${plural(st.items.length, "group")}`;
      if (rows.length === 0) {
        list.append(
          h(
            "li",
            { class: "w-empty" },
            st.items.length
              ? emptyState({
                  icon: "group",
                  title: "No groups match",
                  body: "Try another filter.",
                  action: button({
                    label: "Show all groups",
                    onClick: () => {
                      st.scope = "all";
                      st.type = "";
                      st.q = "";
                      scope.set("all");
                      type.querySelector("select").value = "";
                      search.querySelector("input").value = "";
                      paint();
                    },
                  }),
                })
              : emptyState({
                  icon: "group",
                  title: "No groups yet",
                  body: "Groups appear here once they are created.",
                }),
          ),
        );
        return;
      }
      for (const g of rows) {
        const li = h(
          "li",
          { class: "w-grow", "data-key": g.node.slug },
          h("span", { class: "w-grow__art" }, artwork(g.artwork, { size: size === "m" ? 40 : 48 })),
          h(
            "div",
            { class: "w-grow__text" },
            h(
              "a",
              { class: "w-grow__name", href: link(`/groups/${g.node.slug}`) },
              ...highlight(g.node.title, st.q),
            ),
            size === "l" && g.description ? h("span", { class: "w-grow__desc" }, g.description) : null,
            h(
              "span",
              { class: "w-pcard__pills" },
              pill({ label: plural(g.member_count, "member") }),
              g.is_manager
                ? pill({ label: "Manager", tone: "info", icon: "key" })
                : g.is_member
                  ? pill({ label: "Member", tone: "success", icon: "check" })
                  : null,
            ),
          ),
        );
        if (changed.includes(g.node.slug)) {
          arrive(li, life);
          li.querySelector(".w-pcard__pills")?.append(pill({ label: "Updated", tone: "signal" }));
        }
        list.append(li);
      }
    }

    const refresh = debounce(() => load({ live: true }), 400);
    life.add(refresh.cancel);
    life.add(rt.onNode("Group", refresh));

    ctx.setState("loading");
    load();
    return () => life.dispose();
  },
};
