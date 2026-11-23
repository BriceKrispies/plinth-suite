// admin.matrix: the role by permission matrix with the agent ceiling, and the effective permissions of one
// principal (where each comes from). The matrix filters by text and by module and can highlight one role; a
// cell names the resources it covers. The principal view follows member.selected from the page bus.
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { icon } from "../../ds/js/icons.js";
import { pill } from "../../ds/js/pill.js";
import { personChip } from "../../ds/js/avatar.js";
import { emptyState } from "../../ds/js/states.js";
import { dataTable } from "../../ds/js/table.js";
import { searchField, selectField, textField } from "../../ds/js/field.js";
import { catalogEntry, schemaOf } from "../../core/widgets.js";
import { debounce, latest, region, toErrorInfo } from "../reporting/_common.js";
import { SUBJECT, cap } from "./_admin.js";

const moduleOf = (permission) => String(permission).split(":")[0];

export default {
  id: "admin.matrix",
  domain: "admin",
  title: "Permission matrix",
  configSchema: schemaOf("admin.matrix"),
  sizes: catalogEntry("admin.matrix")?.sizes ?? [],
  mount(el, { size, api, rt, bus, ctx }) {
    const st = {
      view: "matrix",
      q: "",
      module: "any",
      role: "any",
      matrix: null,
      principal: "",
      result: null,
      loadingPrincipal: false,
    };
    const next = latest();
    const nextPrincipal = latest();
    let alive = true;

    const stage = region("rp-matrix__stage");
    const tools = h("div", { class: "rp-tools" });
    el.append(h("div", { class: `rp-app rp-matrix rp-matrix--${size}` }, tools, stage.el));

    // ---- tools ----
    const paintTools = () => {
      const switcher = h(
        "div",
        { class: "rp-segment", role: "group", "aria-label": "View" },
        button({
          label: "Matrix",
          icon: "list",
          size: "sm",
          variant: "secondary",
          pressed: st.view === "matrix",
          onClick: () => ((st.view = "matrix"), paintTools(), paint()),
        }),
        button({
          label: "Principal",
          icon: "user",
          size: "sm",
          variant: "secondary",
          pressed: st.view === "principal",
          onClick: () => ((st.view = "principal"), paintTools(), paint()),
        }),
      );
      if (st.view === "matrix") {
        const modules = st.matrix ? [...new Set(st.matrix.permissions.map(moduleOf))].sort() : [];
        const search = searchField({
          name: "q",
          label: "Filter permissions",
          value: st.q,
          placeholder: "e.g. store",
          onInput: debounce((v) => {
            st.q = v;
            paint();
          }, 150),
        });
        search.classList.add("c-field--grow");
        tools.replaceChildren(
          switcher,
          search,
          selectField({
            name: "module",
            label: "Module",
            value: st.module,
            options: [
              { value: "any", label: "All modules" },
              ...modules.map((m) => ({ value: m, label: m })),
            ],
            onChange: (v) => ((st.module = v), paint()),
          }),
          selectField({
            name: "role",
            label: "Highlight role",
            value: st.role,
            options: [
              { value: "any", label: "None" },
              ...(st.matrix?.roles ?? []).map((r) => ({ value: r, label: r })),
            ],
            onChange: (v) => ((st.role = v), paint()),
          }),
        );
      } else {
        const field = textField({
          name: "principal",
          label: "Principal",
          value: st.principal,
          placeholder: "user:maya-ortiz",
          hint: "Leave empty for yourself",
        });
        const form = h(
          "form",
          {
            class: "rp-tools",
            onsubmit: (e) => {
              e.preventDefault();
              const v = field.querySelector("input").value.trim();
              if (v && !SUBJECT.test(v)) {
                ctx.toast({
                  title: "Not a subject",
                  body: "Use user:handle, agent:name or service:name.",
                  tone: "warning",
                });
                return;
              }
              st.principal = v;
              loadPrincipal();
            },
          },
          field,
          button({ label: "Show permissions", icon: "search", variant: "secondary", type: "submit" }),
        );
        tools.replaceChildren(switcher, form);
      }
    };

    // ---- loading ----
    async function load({ first = false } = {}) {
      const ok = next();
      if (first) stage.loading({ lines: 6, shape: "table" });
      try {
        const out = await api.call("admin.matrix");
        if (!ok() || !alive) return;
        st.matrix = out;
        ctx.setCount(out.permissions.length);
        paintTools();
        paint();
      } catch (e) {
        if (!ok() || !alive) return;
        if (toErrorInfo(e).code === "FORBIDDEN") ctx.setState("unavailable", { reason: "forbidden" });
        else if (!st.matrix) stage.error(e, () => load({ first: true }));
      }
    }

    async function loadPrincipal() {
      const ok = nextPrincipal();
      st.loadingPrincipal = true;
      paint();
      try {
        const out = await api.call("admin.permissions", { principal: st.principal || undefined });
        if (!ok() || !alive) return;
        st.result = out;
        st.loadingPrincipal = false;
        paint();
        ctx.announce(`${out.permissions.length} effective permissions for ${out.principal.display_name}`);
      } catch (e) {
        if (!ok() || !alive) return;
        st.loadingPrincipal = false;
        st.result = { error: toErrorInfo(e) };
        paint();
      }
    }

    // ---- painting ----
    function paint() {
      if (st.view === "principal") return paintPrincipal();
      const m = st.matrix;
      if (!m) return;
      const q = st.q.trim().toLowerCase();
      const perms = m.permissions.filter(
        (p) => (st.module === "any" || moduleOf(p) === st.module) && (!q || p.toLowerCase().includes(q)),
      );
      if (perms.length === 0) {
        stage.show(
          emptyState({
            icon: "shield",
            title: "No permissions match",
            body: "Clear the filter to see the whole matrix.",
          }),
        );
        return;
      }
      const ceiling = new Set(m.agent_ceiling);
      const head = h(
        "tr",
        {},
        h("th", { scope: "col", class: "rp-matrix__corner" }, "Permission"),
        ...m.roles.map((r) => h("th", { scope: "col", class: st.role === r ? "is-hl" : null }, r)),
        h("th", { scope: "col", class: "rp-matrix__ceiling" }, "Agent ceiling"),
      );
      const body = perms.map((p) =>
        h(
          "tr",
          {},
          h("th", { scope: "row", class: "rp-matrix__perm" }, h("code", {}, p)),
          ...m.roles.map((r) => {
            const resources = m.cells[p]?.[r] ?? [];
            const on = resources.length > 0;
            return h(
              "td",
              {
                class: `rp-matrix__cell${on ? " is-on" : ""}${st.role === r ? " is-hl" : ""}`,
                title: on ? resources.join("\n") : "Not granted",
              },
              on ? icon("check", { size: 16 }) : h("span", { "aria-hidden": "true" }, "–"),
              h("span", { class: "sr-only" }, on ? `Granted on ${resources.join(", ")}` : "Not granted"),
              on && size === "full"
                ? h(
                    "span",
                    { class: "rp-matrix__res" },
                    resources.length === 1
                      ? resources[0].replace("plinth://northwind/", "")
                      : `${resources.length} resources`,
                  )
                : null,
            );
          }),
          h(
            "td",
            { class: `rp-matrix__cell rp-matrix__ceiling${ceiling.has(p) ? " is-on" : ""}` },
            ceiling.has(p) ? icon("bolt", { size: 16 }) : h("span", { "aria-hidden": "true" }, "–"),
            h(
              "span",
              { class: "sr-only" },
              ceiling.has(p) ? "Agents may hold this" : "Agents may not hold this",
            ),
          ),
        ),
      );
      stage.show(
        h(
          "p",
          { class: "rp-hint" },
          `${perms.length} of ${m.permissions.length} permissions. A check means the role holds the permission; the lightning mark means an agent acting for a person may hold it too.`,
        ),
        h(
          "div",
          {
            class: "rp-matrix__scroll",
            role: "region",
            "aria-label": "Role by permission matrix",
            tabindex: "0",
          },
          h(
            "table",
            { class: "rp-matrix__table" },
            h("caption", { class: "sr-only" }, "Roles by permission"),
            h("thead", {}, head),
            h("tbody", {}, ...body),
          ),
        ),
      );
    }

    function paintPrincipal() {
      if (st.loadingPrincipal) {
        stage.show(h("p", { class: "u-muted", role: "status" }, "Loading permissions."));
        return;
      }
      const r = st.result;
      if (!r) {
        stage.show(
          emptyState({
            icon: "user",
            title: "Choose a principal",
            body: "Enter a subject above, select a member elsewhere on the page, or press Show permissions to see your own.",
          }),
        );
        return;
      }
      if (r.error) {
        stage.show(
          h(
            "div",
            { class: "rp-notice", "data-tone": "danger", role: "alert" },
            icon("alert", { size: 16 }),
            h("p", {}, r.error.message ?? r.error.code),
          ),
        );
        return;
      }
      const via = (p) =>
        "direct" in p.via
          ? "Direct grant"
          : `Role ${p.via.role}${p.via.scope ? ` (region ${p.via.scope.region})` : ""}`;
      stage.show(
        h(
          "header",
          { class: "rp-detail__head" },
          h(
            "div",
            { class: "rp-detail__pills" },
            personChip(r.principal),
            ...r.roles.map((x) => pill({ label: x, tone: "info" })),
          ),
          r.delegator ? h("p", {}, "Acts on behalf of ", personChip(r.delegator)) : null,
          r.ceiling
            ? h(
                "p",
                { class: "rp-notice", "data-tone": "info" },
                icon("bolt", { size: 16 }),
                `Agent ceiling: only ${r.ceiling.length} permissions can be exercised, whatever the grants say.`,
              )
            : null,
        ),
        r.permissions.length
          ? dataTable({
              caption: `Effective permissions of ${r.principal.display_name}`,
              density: "compact",
              rowKey: (x) => `${x.permission}|${x.resource}|${x.grant.slug}`,
              rows: r.permissions,
              columns: [
                { key: "permission", label: "Permission", render: (x) => h("code", {}, x.permission) },
                {
                  key: "resource",
                  label: "Resource",
                  render: (x) => h("span", { class: "u-mono" }, x.resource),
                },
                { key: "row_predicate", label: "Row predicate", render: (x) => x.row_predicate ?? "None" },
                { key: "via", label: "Via", render: via },
                { key: "grant", label: "Grant", render: (x) => x.grant.title || x.grant.slug },
                { key: "owner_only", label: "Owner only", render: (x) => (x.owner_only ? "Yes" : "No") },
              ],
            })
          : emptyState({
              icon: "lock",
              title: "No permissions",
              body: `${cap(r.principal.display_name)} holds no permissions.`,
            }),
      );
    }

    // ---- bus and realtime ----
    const offs = [
      bus.subscribe("member.selected", (p) => {
        if (!p?.id) return;
        st.principal = String(p.id).includes(":") ? String(p.id) : `user:${p.id}`;
        st.view = "principal";
        paintTools();
        loadPrincipal();
      }),
    ];
    const refresh = debounce(() => {
      load();
      if (st.view === "principal" && st.result) loadPrincipal();
    }, 600);
    offs.push(
      rt.onNode("Grant", () => refresh()),
      rt.onNode("Role", () => refresh()),
    );

    const initial = bus.latest?.("member.selected");
    if (initial?.id) {
      st.principal = String(initial.id).includes(":") ? String(initial.id) : `user:${initial.id}`;
      st.view = "principal";
      paintTools();
      loadPrincipal();
    }
    paintTools();
    load({ first: true });
    return () => {
      alive = false;
      refresh.cancel();
      for (const off of offs) off();
    };
  },
};
