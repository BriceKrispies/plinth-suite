// admin.grants: the Grant nodes (kernel node API). A list with filters and a grant view; a propose form with
// client-side validation of the grant grammar, a duplicate check against the grants already loaded, and a
// review step before the Grant node is created (held under R-GRANT). Revoking is proposed as a node change.
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { icon } from "../../ds/js/icons.js";
import { pill } from "../../ds/js/pill.js";
import { emptyState } from "../../ds/js/states.js";
import {
  checkboxField,
  dateTimeField,
  formErrors,
  searchField,
  selectField,
  textArea,
  textField,
} from "../../ds/js/field.js";
import { dateTime } from "../../ds/js/format.js";
import { catalogEntry, schemaOf } from "../../core/widgets.js";
import {
  debounce,
  focusSoon,
  keyValues,
  latest,
  localInputToIso,
  region,
  timeNode,
  toErrorInfo,
} from "../reporting/_common.js";
import { splitPane } from "../reporting/_split.js";
import { heldNotice } from "./_admin.js";

const KERNEL = [
  "node:read",
  "node:write",
  "node:delete",
  "query:run",
  "source:write",
  "workflow:read",
  "workflow:acknowledge",
  "approval:decide",
  "grant:propose",
  "grant:write",
  "grant:inspect",
  "ui:present",
];
const SUITE = [
  "suite:use",
  "messages:use",
  "messages:broadcast",
  "notifications:use",
  "notifications:send",
  "points:use",
  "points:transfer",
  "points:award",
  "points:adjust",
  "points:view-all",
  "points:ledger",
  "store:shop",
  "store:orders",
  "store:approve",
  "store:refund",
  "store:inventory",
  "store:moderate",
  "badges:award",
  "badges:revoke",
  "promotions:simulate",
  "promotions:manage",
  "promotions:approve",
  "automation:manage",
  "content:author",
  "content:review",
  "content:publish",
  "people:view-private",
  "segments:preview",
  "tasks:use",
  "tasks:manage",
  "audit:view",
  "admin:members",
  "admin:roles",
  "admin:settings",
];
const PRINCIPAL = /^((user|agent|service):[a-z0-9][a-z0-9._-]*|role:[a-z][a-z0-9-]*)$/;
const STATUS_TONE = {
  active: "success",
  pending_approval: "warning",
  rejected: "danger",
  revoked: "neutral",
  expired: "neutral",
};
const STATUS_LABEL = {
  active: "Active",
  pending_approval: "Awaiting approval",
  rejected: "Rejected",
  revoked: "Revoked",
  expired: "Expired",
};

const statusOf = (g) => g.body?.spec?.status ?? "active";

export default {
  id: "admin.grants",
  domain: "admin",
  title: "Grants",
  configSchema: schemaOf("admin.grants"),
  sizes: catalogEntry("admin.grants")?.sizes ?? [],
  mount(el, { size, api, rt, nav, ctx }) {
    const st = { items: [], q: "", status: "any", selected: null };
    const next = latest();
    let alive = true;

    const list = region("rp-grants__list");
    const tools = h("div", { class: "rp-tools" });
    const pane = splitPane({
      label: "Grants",
      placeholder: emptyState({
        icon: "key",
        title: "Select a grant",
        body: "Its principal, actions and resource appear here.",
      }),
    });
    pane.list.append(list.el);
    el.append(h("div", { class: `rp-app rp-grants rp-grants--${size}` }, tools, pane.el));

    const paintTools = () => {
      const search = searchField({
        name: "q",
        label: "Search grants",
        value: st.q,
        placeholder: "Principal, action or resource",
        onInput: debounce((v) => {
          st.q = v;
          paintList();
        }, 150),
      });
      search.classList.add("c-field--grow");
      tools.replaceChildren(
        search,
        selectField({
          name: "status",
          label: "Status",
          value: st.status,
          options: [
            { value: "any", label: "Any status" },
            ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
          ],
          onChange: (v) => ((st.status = v), paintList()),
        }),
        button({ label: "Propose a grant", icon: "plus", variant: "primary", onClick: () => showPropose() }),
      );
    };

    async function load({ first = false, silent = false } = {}) {
      const ok = next();
      if (first) list.loading({ lines: 5 });
      try {
        const items = await api.nodes.list("Grant");
        if (!ok() || !alive) return;
        st.items = [...items].sort((a, b) => a.slug.localeCompare(b.slug));
        ctx.setCount(st.items.length);
        paintList();
        if (st.selected) {
          const g = st.items.find((x) => x.slug === st.selected);
          if (g && pane.view === "detail") paintGrant(g);
        }
      } catch (e) {
        if (!ok() || !alive) return;
        if (toErrorInfo(e).code === "FORBIDDEN") ctx.setState("unavailable", { reason: "forbidden" });
        else if (!silent) list.error(e, () => load({ first: true }));
      }
    }

    const visible = () => {
      const q = st.q.trim().toLowerCase();
      return st.items.filter((g) => {
        const s = g.body?.spec ?? {};
        if (st.status !== "any" && statusOf(g) !== st.status) return false;
        return (
          !q ||
          `${s.principal} ${s.resource} ${(s.actions ?? []).join(" ")} ${g.slug}`.toLowerCase().includes(q)
        );
      });
    };

    function paintList() {
      const rows = visible();
      if (rows.length === 0) {
        list.show(
          emptyState({
            icon: "key",
            title: st.items.length ? "No grants match" : "No grants yet",
            body: st.items.length
              ? "Loosen the filters to see more."
              : "Propose a grant to give a principal access.",
          }),
        );
        return;
      }
      list.show(
        h(
          "ul",
          { class: "rp-rows", "aria-label": "Grants" },
          ...rows.map((g) => {
            const s = g.body.spec;
            const status = statusOf(g);
            return h(
              "li",
              {
                class: `rp-row${st.selected === g.slug ? " is-selected" : ""}${status !== "active" ? " is-done" : ""}`,
                "data-key": g.slug,
              },
              h(
                "div",
                { class: "rp-row__main" },
                h(
                  "button",
                  {
                    type: "button",
                    class: "rp-row__title",
                    "aria-current": st.selected === g.slug ? "true" : null,
                    onclick: () => select(g),
                  },
                  s.principal,
                ),
                h("p", { class: "rp-row__summary u-mono" }, s.resource),
                h(
                  "div",
                  { class: "rp-row__meta" },
                  ...(s.actions ?? []).slice(0, 4).map((a) => pill({ label: a })),
                  (s.actions?.length ?? 0) > 4 ? pill({ label: `+${s.actions.length - 4}` }) : null,
                ),
              ),
              h(
                "div",
                { class: "rp-row__side" },
                s.effect === "deny" ? pill({ label: "Deny", tone: "danger", icon: "lock" }) : null,
                pill({ label: STATUS_LABEL[status] ?? status, tone: STATUS_TONE[status] ?? "neutral" }),
              ),
            );
          }),
        ),
      );
    }

    function select(g) {
      st.selected = g.slug;
      paintList();
      paintGrant(g);
      pane.showDetail();
    }

    // ---- grant view ----
    function paintGrant(g) {
      const s = g.body.spec;
      const status = statusOf(g);
      const out = h("div", { role: "status" });
      const revoke =
        status === "active" || status === "pending_approval"
          ? button({
              label: "Propose revoking this grant",
              icon: "x",
              variant: "danger",
              onClick: async () => {
                const yes = await ctx.confirm({
                  title: "Propose revoking this grant?",
                  message: `${s.principal} would lose ${s.actions.join(", ")} on ${s.resource}. The revoke is held for approval.`,
                  confirmLabel: "Propose revoke",
                  tone: "danger",
                });
                if (!yes) return;
                try {
                  const res = await api.nodes.patch(
                    g.uri,
                    g.revision,
                    [{ op: "set", path: "/spec/status", value: "revoked" }],
                    { reason: "Revoke grant" },
                  );
                  out.replaceChildren(heldNotice(res, "The revoke", nav));
                  load({ silent: true });
                } catch (e) {
                  const info = toErrorInfo(e);
                  out.replaceChildren(
                    h(
                      "div",
                      { class: "rp-notice", "data-tone": "danger", role: "alert" },
                      icon("alert", { size: 16 }),
                      h("p", {}, info.message ?? info.code),
                    ),
                  );
                }
              },
            })
          : null;
      pane.detail.replaceChildren(
        h(
          "article",
          { class: "rp-detail", "aria-label": s.principal },
          h(
            "header",
            { class: "rp-detail__head" },
            h("h3", { class: "rp-detail__heading", tabindex: "-1", "data-focus": "" }, s.principal),
            h(
              "div",
              { class: "rp-detail__pills" },
              pill({ label: STATUS_LABEL[status] ?? status, tone: STATUS_TONE[status] ?? "neutral" }),
              pill({
                label: s.effect === "deny" ? "Deny" : "Allow",
                tone: s.effect === "deny" ? "danger" : "success",
              }),
              s.owner_only ? pill({ label: "Owner only", tone: "info" }) : null,
            ),
          ),
          keyValues([
            ["Slug", h("span", { class: "u-mono" }, g.slug)],
            ["Resource", h("span", { class: "u-mono" }, s.resource)],
            [
              "Actions",
              h("span", { class: "rp-detail__pills" }, ...(s.actions ?? []).map((a) => pill({ label: a }))),
            ],
            ["Row predicate", s.row_predicate ? h("code", {}, s.row_predicate) : null],
            ["Column mask", s.column_mask?.length ? s.column_mask.join(", ") : null],
            ["Expires", s.expires_at ? h("time", { datetime: s.expires_at }, dateTime(s.expires_at)) : null],
            ["Revision", String(g.revision)],
          ]),
          h("div", { class: "rp-detail__actions" }, revoke),
          out,
        ),
      );
    }

    // ---- propose view ----
    function showPropose() {
      st.selected = null;
      paintList();
      const principal = textField({
        name: "/spec/principal",
        label: "Principal",
        required: true,
        placeholder: "role:manager",
        hint: "user:handle, agent:name, service:name or role:slug",
      });
      const effect = selectField({
        name: "/spec/effect",
        label: "Effect",
        value: "allow",
        options: [
          { value: "allow", label: "Allow" },
          { value: "deny", label: "Deny" },
        ],
      });
      const resource = textField({
        name: "/spec/resource",
        label: "Resource",
        required: true,
        placeholder: "plinth://northwind/suite/store",
        hint: "A node URI, a URI prefix ending in /, or a source slug",
      });
      const actions = checkboxField({
        name: "/spec/actions",
        label: "Actions",
        required: true,
        hint: "Choose 1 to 16.",
        options: [...KERNEL, ...SUITE].map((a) => ({ value: a, label: a })),
      });
      actions.classList.add("rp-actions-group");
      const predicate = textField({
        name: "/spec/row_predicate",
        label: "Row predicate",
        placeholder: "region = 'EMEA'",
        hint: "Optional. Literal values only, at most 512 characters.",
      });
      const expires = dateTimeField({ name: "/spec/expires_at", label: "Expires" });
      const ownerOnly = checkboxField({
        name: "/spec/owner_only",
        label: "Owner only (matches nodes the principal owns)",
      });
      const reason = textArea({
        name: "/reason",
        label: "Reason",
        rows: 2,
        required: true,
        hint: "Kept with the approval request.",
      });
      const similar = h("div", { role: "status" });
      const out = h("div", { role: "status" });
      const submit = button({
        label: "Review and propose",
        icon: "chevron-right",
        variant: "primary",
        type: "submit",
      });

      const read = () => {
        const picked = [...actions.querySelectorAll("input:checked")].map((i) => i.value);
        return {
          principal: principal.querySelector("input").value.trim(),
          effect: effect.querySelector("select").value,
          resource: resource.querySelector("input").value.trim(),
          actions: picked,
          row_predicate: predicate.querySelector("input").value.trim(),
          expires_at: localInputToIso(expires.querySelector("input").value),
          owner_only: ownerOnly.querySelector("input").checked,
          reason: reason.querySelector("textarea").value.trim(),
        };
      };

      const checkSimilar = debounce(() => {
        const v = read();
        const dupes = st.items.filter((g) => {
          const s = g.body.spec;
          return (
            statusOf(g) !== "revoked" &&
            s.principal === v.principal &&
            s.resource === v.resource &&
            v.actions.some((a) => s.actions.includes(a))
          );
        });
        similar.replaceChildren(
          ...(dupes.length
            ? [
                h(
                  "div",
                  { class: "rp-notice", "data-tone": "info" },
                  icon("info", { size: 16 }),
                  h(
                    "p",
                    {},
                    `${dupes.length === 1 ? "A grant" : `${dupes.length} grants`} for this principal already cover${dupes.length === 1 ? "s" : ""} some of these actions on this resource: ${dupes.map((d) => d.slug).join(", ")}.`,
                  ),
                ),
              ]
            : []),
        );
      }, 250);

      const form = h(
        "form",
        {
          class: "rp-form",
          "aria-label": "Propose a grant",
          novalidate: true,
          oninput: checkSimilar,
          onsubmit: async (e) => {
            e.preventDefault();
            formErrors(null, { form });
            out.replaceChildren();
            const v = read();
            const bad = !PRINCIPAL.test(v.principal)
              ? ["/spec/principal", "Use user:handle, agent:name, service:name or role:slug."]
              : !v.resource || v.resource.length > 300
                ? ["/spec/resource", "Enter a resource of at most 300 characters."]
                : v.actions.length < 1 || v.actions.length > 16
                  ? ["/spec/actions", "Choose between 1 and 16 actions."]
                  : v.row_predicate.length > 512
                    ? ["/spec/row_predicate", "A row predicate is at most 512 characters."]
                    : !v.reason
                      ? ["/reason", "Give a reason so approvers know why."]
                      : null;
            if (bad) {
              formErrors({ code: "VALIDATION_FAILED", path: bad[0], message: bad[1] }, { form })?.focus();
              return;
            }
            const yes = await ctx.openDialog({
              title: "Propose this grant?",
              size: "md",
              body: h(
                "div",
                { class: "rp-form" },
                h("p", {}, `${v.effect === "deny" ? "Deny" : "Allow"} ${v.principal}:`),
                h("ul", {}, ...v.actions.map((a) => h("li", {}, a))),
                h(
                  "p",
                  {},
                  "on ",
                  h("span", { class: "u-mono" }, v.resource),
                  v.row_predicate ? ` where ${v.row_predicate}` : "",
                ),
                h("p", { class: "u-muted" }, "A grant is held until a second person approves it."),
              ),
              actions: [
                { label: "Back", value: false, variant: "secondary", autofocus: true },
                { label: "Propose grant", value: true, variant: "primary" },
              ],
            });
            if (yes !== true) return;
            submit.setAttribute("aria-busy", "true");
            const slug =
              `grant-${v.principal.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${Date.now().toString(36)}`.slice(
                0,
                63,
              );
            const spec = {
              principal: v.principal,
              effect: v.effect,
              actions: v.actions,
              resource: v.resource,
              ...(v.row_predicate ? { row_predicate: v.row_predicate } : {}),
              ...(v.expires_at ? { expires_at: v.expires_at } : {}),
              ...(v.owner_only ? { owner_only: true } : {}),
            };
            try {
              const res = await api.nodes.create(
                "Grant",
                slug,
                {
                  apiVersion: "plinth/v1",
                  kind: "Grant",
                  metadata: { slug, title: `Grant to ${v.principal}`.slice(0, 120) },
                  spec,
                },
                { reason: v.reason },
              );
              out.replaceChildren(heldNotice(res, "The grant", nav));
              ctx.announce(res.status === "pending_approval" ? "Grant held for approval" : "Grant committed");
              load({ silent: true });
            } catch (err) {
              const info = toErrorInfo(err);
              formErrors(
                { code: info.code, path: info.path, message: info.message ?? info.code },
                { form },
              )?.focus();
            } finally {
              submit.removeAttribute("aria-busy");
            }
          },
        },
        h("p", { class: "rp-form__note" }, "Fields marked * are required."),
        h("div", { class: "rp-form__row" }, principal, effect),
        resource,
        actions,
        predicate,
        h("div", { class: "rp-form__row" }, expires, ownerOnly),
        reason,
        similar,
        h(
          "div",
          { class: "rp-form__actions" },
          button({ label: "Cancel", variant: "ghost", onClick: () => pane.clearDetail() }),
          submit,
        ),
        out,
      );
      pane.detail.replaceChildren(
        h(
          "article",
          { class: "rp-detail", "aria-label": "Propose a grant" },
          h("h3", { class: "rp-detail__heading", tabindex: "-1", "data-focus": "" }, "Propose a grant"),
          form,
        ),
      );
      pane.showDetail();
      focusSoon(principal.querySelector("input"));
    }

    const refresh = debounce(() => load({ silent: true }), 500);
    const offs = [rt.onNode("Grant", () => refresh())];
    paintTools();
    load({ first: true });
    return () => {
      alive = false;
      refresh.cancel();
      for (const off of offs) off();
    };
  },
};
