// people.directory: searchable, filterable member directory as a grid or a table.
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { scoped } from "../reporting/_common.js";
import { button, linkButton } from "../../ds/js/button.js";
import { searchField, selectField } from "../../ds/js/field.js";
import { dataTable } from "../../ds/js/table.js";
import { emptyState, errorState } from "../../ds/js/states.js";
import { statusPill, pill } from "../../ds/js/pill.js";
import { avatar } from "../../ds/js/avatar.js";
import { icon } from "../../ds/js/icons.js";
import { toErrorInfo } from "../../core/api.js";
import { can } from "../../core/stores.js";
import {
  lifecycle,
  debounce,
  sequence,
  segmented,
  ago,
  when,
  errorText,
  link,
  arrive,
  plural,
} from "../../shell/kit.js";
import {
  REGIONS,
  TIERS,
  DEPARTMENTS,
  cap,
  handleOf,
  disabledPill,
  memberCardNode,
  quickView,
} from "./_parts.js";

const SORTS = [
  { value: "name", label: "Name" },
  { value: "tier", label: "Tier" },
  { value: "recent", label: "Recently active" },
  { value: "points", label: "Points" },
];
const COLUMN_SORT = { person: "name", tier: "tier", last_active_at: "recent" };

export default {
  id: "people.directory",
  domain: "people",
  title: "Directory",
  configSchema: schemaOf("people.directory"),
  sizes: ["l", "xl", "full"],
  mount(el, { config, size, api, rt, bus, ctx }) {
    const life = lifecycle();
    const seq = sequence();
    const pageSize = config.page_size ?? 24;
    const st = {
      q: "",
      region: config.region ?? "",
      tier: config.tier ?? "",
      department: "",
      group: config.group ?? "",
      sort: "name",
      view: config.view ?? "grid",
      items: [],
      next: null,
      total: 0,
      selected: null,
      loaded: false,
      busy: false,
      error: null,
    };
    const root = h("div", { class: "w-dir", "data-size": size });
    el.append(root);

    // ---- toolbar ----

    const search = searchField({
      name: "q",
      label: "Search members",
      placeholder: "Search name, handle or title",
      onInput: (v) => {
        st.q = v.trim();
        debounced();
      },
    });
    search.classList.add("w-bar__search");
    const select = (key, label, all, options, value) => {
      const f = selectField({
        name: key,
        label,
        value,
        options: [{ value: "", label: all }, ...options],
        onChange: (v) => {
          st[key] = v;
          fetchList();
        },
      });
      f.classList.add("w-bar__sel");
      return f;
    };
    const controls = {
      region: select(
        "region",
        "Region",
        "All regions",
        REGIONS.map((r) => ({ value: r, label: r })),
        st.region,
      ),
      tier: select(
        "tier",
        "Tier",
        "All tiers",
        TIERS.map((t) => ({ value: t, label: cap(t) })),
        st.tier,
      ),
      department: select(
        "department",
        "Department",
        "All departments",
        DEPARTMENTS.map((d) => ({ value: d, label: cap(d) })),
        st.department,
      ),
    };
    const sortField = selectField({
      name: "sort",
      label: "Sort by",
      value: st.sort,
      options: SORTS,
      onChange: (v) => {
        st.sort = v;
        fetchList();
      },
    });
    sortField.classList.add("w-bar__sel");
    const viewSeg = segmented({
      label: "Layout",
      options: [
        { value: "grid", label: "Grid" },
        { value: "table", label: "Table" },
      ],
      value: st.view,
      onChange: (v) => {
        st.view = v;
        paint();
      },
    });
    const debounced = debounce(() => fetchList(), 250);
    life.add(debounced.cancel);
    const chips = h("ul", { class: "w-chips", "aria-label": "Fixed filters" });
    const bar = h(
      "div",
      { class: "w-bar", role: "group", "aria-label": "Directory filters" },
      h("div", { class: "w-bar__row" }, search, viewSeg),
      h("div", { class: "w-bar__row" }, controls.region, controls.tier, controls.department, sortField),
      chips,
    );
    const summary = h("p", { class: "w-summary", role: "status" });
    const listHost = h("div", { class: "w-dir__list" });
    const more = h("div", { class: "w-more" });
    const selection = h("div", {
      class: "w-dir__sel",
      role: "region",
      "aria-label": "Selected member",
      hidden: true,
    });
    root.append(bar, summary, listHost, more, selection);

    const paintChips = () => {
      clear(chips);
      chips.hidden = !st.group;
      if (!st.group) return;
      chips.append(
        h(
          "li",
          { class: "c-chip" },
          h("span", {}, `Group: ${st.group}`),
          h(
            "button",
            {
              type: "button",
              class: "c-chip__remove",
              "aria-label": `Remove group filter ${st.group}`,
              onclick: () => {
                st.group = "";
                fetchList();
              },
            },
            icon("x", { size: 16 }),
          ),
        ),
      );
    };

    // ---- data ----

    const query = (extra = {}) => ({
      ...(st.q ? { q: st.q } : {}),
      ...(st.region ? { region: st.region } : {}),
      ...(st.tier ? { tier: st.tier } : {}),
      ...(st.department ? { department: st.department } : {}),
      ...(st.group ? { group: st.group } : {}),
      sort: st.sort,
      limit: pageSize,
      ...extra,
    });

    async function fetchList() {
      const mine = seq.next();
      st.busy = true;
      root.setAttribute("aria-busy", "true");
      try {
        const out = await api.call("people.directory", query());
        if (!seq.ok(mine) || life.dead) return;
        st.items = out.items;
        st.next = out.next_cursor;
        st.total = out.total;
        st.error = null;
        ctx.setCount(out.total);
      } catch (e) {
        if (!seq.ok(mine) || life.dead) return;
        st.error = e;
        if (!st.loaded) {
          ctx.setState("error", { error: toErrorInfo(e) });
          return;
        }
      } finally {
        if (seq.ok(mine)) {
          st.busy = false;
          root.removeAttribute("aria-busy");
        }
      }
      if (!st.loaded) {
        st.loaded = true;
        ctx.setState("ready");
      }
      paint();
    }

    async function loadMore() {
      if (!st.next || st.busy) return;
      const mine = seq.next();
      st.busy = true;
      paintMore();
      try {
        const out = await api.call("people.directory", query({ cursor: st.next }));
        if (!seq.ok(mine) || life.dead) return;
        const have = new Set(st.items.map(handleOf));
        st.items = [...st.items, ...out.items.filter((m) => !have.has(handleOf(m)))];
        st.next = out.next_cursor;
        st.total = out.total;
      } catch (e) {
        if (!seq.ok(mine) || life.dead) return;
        ctx.toast({ title: "Could not load more", body: errorText(e), tone: "danger" });
      } finally {
        if (seq.ok(mine)) st.busy = false;
      }
      paint();
    }

    /** Re-read what is loaded after member.updated or tier.changed and mark the rows that changed. */
    async function refreshLoaded(handle) {
      if (!st.items.some((m) => m.person.handle === handle)) return;
      const mine = seq.next();
      try {
        const out = await api.call(
          "people.directory",
          query({ limit: Math.min(200, Math.max(st.items.length, pageSize)) }),
        );
        if (!seq.ok(mine) || life.dead) return;
        const before = new Map(st.items.map((m) => [handleOf(m), JSON.stringify(m)]));
        const changed = out.items
          .filter((m) => before.has(handleOf(m)) && before.get(handleOf(m)) !== JSON.stringify(m))
          .map(handleOf);
        st.items = out.items;
        st.next = out.next_cursor;
        st.total = out.total;
        paint();
        for (const key of changed) {
          const node = listHost.querySelector(`[data-key="${CSS.escape(key)}"]`);
          if (node) {
            arrive(node, life);
            node.querySelector(".w-mcard__body, td")?.append(pill({ label: "Updated", tone: "signal" }));
          }
        }
      } catch {
        /* the next explicit refresh reports it */
      }
    }

    // ---- selection ----

    const quick = (m) => {
      const drawer = ctx.openDrawer({
        title: m.person.display_name,
        width: "sm",
        body: scoped("people", () => quickView(m, () => drawer.close())),
      });
    };

    function select_(m) {
      st.selected = handleOf(m);
      if (m.person.handle) bus.publish("member.selected", { id: m.person.handle });
      paintSelection();
      for (const node of listHost.querySelectorAll("[data-key]")) {
        const on = node.dataset.key === st.selected;
        node.classList.toggle("is-selected", on && node.matches("tr"));
        node.querySelector(".w-mcard__main")?.setAttribute("aria-pressed", String(on));
      }
      ctx.announce(`${m.person.display_name} selected`);
    }

    function paintSelection() {
      clear(selection);
      const m = st.items.find((x) => handleOf(x) === st.selected);
      selection.hidden = !m;
      if (!m) return;
      const p = m.person;
      selection.append(
        avatar({ name: p.display_name, avatar: p.avatar, size: "md" }),
        h("span", { class: "w-dir__selname" }, p.display_name, h("span", { class: "w-hint" }, ` ${m.title}`)),
        ...[
          p.handle
            ? linkButton({ href: link(`/people/${p.handle}`), label: "Profile", icon: "user", size: "sm" })
            : null,
        ].filter(Boolean),
        ...[
          p.handle
            ? linkButton({
                href: link("/messages/new", { to: `user:${p.handle}` }),
                label: "Message",
                icon: "send",
                size: "sm",
              })
            : null,
        ].filter(Boolean),
        ...[
          p.handle && can("points:award")
            ? linkButton({
                href: link("/points/award", { member: p.handle }),
                label: "Award",
                icon: "award",
                size: "sm",
              })
            : null,
        ].filter(Boolean),
        button({ label: "Details", icon: "eye", size: "sm", onClick: () => quick(m) }),
        button({
          label: "Clear",
          variant: "ghost",
          size: "sm",
          onClick: () => {
            st.selected = null;
            paint();
          },
        }),
      );
    }

    // ---- painting ----

    function paintMore() {
      clear(more);
      if (!st.next) return;
      more.append(
        button({
          label: st.busy ? "Loading" : "Load more",
          icon: "chevron-down",
          size: "sm",
          busy: st.busy,
          onClick: loadMore,
        }),
      );
    }

    const tableView = () =>
      dataTable({
        caption: "Members",
        rowKey: handleOf,
        rows: st.items,
        onRowClick: select_,
        sort: {
          key: Object.keys(COLUMN_SORT).find((k) => COLUMN_SORT[k] === st.sort) ?? "",
          dir: "ascending",
        },
        onSort: ({ key, dir }) => {
          st.sort = dir === null ? "name" : (COLUMN_SORT[key] ?? "name");
          sortField.querySelector("select").value = st.sort;
          fetchList();
        },
        columns: [
          {
            key: "person",
            label: "Member",
            sortable: true,
            render: (m) =>
              h(
                "span",
                { class: "w-person" },
                avatar({ name: m.person.display_name, avatar: m.person.avatar, size: "sm" }),
                m.person.handle
                  ? h(
                      "a",
                      { class: "w-person__name", href: link(`/people/${m.person.handle}`) },
                      m.person.display_name,
                    )
                  : h("span", { class: "w-person__name" }, m.person.display_name),
                disabledPill(m),
              ),
          },
          { key: "title", label: "Title" },
          { key: "department", label: "Department", render: (m) => cap(m.department) },
          { key: "region", label: "Region" },
          { key: "tier", label: "Tier", sortable: true, render: (m) => statusPill("tier", m.tier) },
          { key: "badges_count", label: "Badges", align: "end" },
          {
            key: "last_active_at",
            label: "Last active",
            sortable: true,
            render: (m) =>
              m.last_active_at
                ? h(
                    "time",
                    { datetime: m.last_active_at, title: when(m.last_active_at) },
                    ago(m.last_active_at),
                  )
                : "Not yet",
          },
        ],
      });

    function paint() {
      paintChips();
      clear(listHost);
      if (st.error && st.items.length === 0) {
        summary.textContent = "";
        listHost.append(
          errorState({
            error: { ...toErrorInfo(st.error), message: errorText(st.error) },
            retry: () => fetchList(),
          }),
        );
        paintMore();
        paintSelection();
        return;
      }
      if (st.items.length === 0) {
        summary.textContent = "No members";
        const filtered = st.q || st.region || st.tier || st.department || st.group;
        listHost.append(
          emptyState({
            icon: "users",
            title: filtered ? "No members match" : "No members yet",
            body: filtered
              ? "Try fewer filters or a different search."
              : "Members will be listed here once they are added.",
            action: filtered
              ? button({
                  label: "Clear filters",
                  onClick: () => {
                    st.q = st.region = st.tier = st.department = st.group = "";
                    search.querySelector("input").value = "";
                    for (const key of Object.keys(controls)) controls[key].querySelector("select").value = "";
                    fetchList();
                  },
                })
              : null,
          }),
        );
        paintMore();
        paintSelection();
        return;
      }
      summary.textContent = `${st.items.length} of ${plural(st.total, "member")}`;
      if (st.view === "table") {
        listHost.append(tableView());
        for (const tr of listHost.querySelectorAll("tr[data-key]"))
          tr.classList.toggle("is-selected", tr.dataset.key === st.selected);
      } else {
        listHost.append(
          h(
            "ul",
            { class: "w-mgrid", "aria-label": "Members" },
            ...st.items.map((m) =>
              memberCardNode(m, {
                selected: handleOf(m) === st.selected,
                onSelect: select_,
                onDetails: quick,
              }),
            ),
          ),
        );
      }
      paintMore();
      paintSelection();
    }

    // ---- realtime and bus ----

    life.add(rt.on("member.updated", (ev) => refreshLoaded(ev.payload.member)));
    life.add(rt.on("tier.changed", (ev) => refreshLoaded(ev.payload.member)));
    life.add(
      bus.subscribe("filter.changed", (p) => {
        if (!p?.key) return;
        const key = p.key;
        const value = p.value ?? "";
        if (key === "q") {
          st.q = String(value);
          search.querySelector("input").value = st.q;
        } else if (controls[key]) {
          st[key] = String(value);
          controls[key].querySelector("select").value = st[key];
        } else if (key === "group") st.group = String(value);
        else return;
        fetchList();
      }),
    );

    ctx.setState("loading");
    fetchList();
    return () => life.dispose();
  },
};
