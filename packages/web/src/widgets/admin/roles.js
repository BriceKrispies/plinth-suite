// admin.roles: roles with their members, grants and pending changes. A role view proposes membership changes
// (add with an optional region scope, remove several at once) after a review step; every proposal is a Role
// node change that is held for approval (R-ROLE), and the outcome is shown as such.
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { icon } from "../../ds/js/icons.js";
import { pill } from "../../ds/js/pill.js";
import { personChip } from "../../ds/js/avatar.js";
import { emptyState } from "../../ds/js/states.js";
import { formErrors, selectField, textArea, textField } from "../../ds/js/field.js";
import { catalogEntry, schemaOf } from "../../core/widgets.js";
import { debounce, latest, region, toErrorInfo } from "../reporting/_common.js";
import { splitPane } from "../reporting/_split.js";
import { REGIONS, SUBJECT, heldNotice } from "./_admin.js";

export default {
  id: "admin.roles",
  domain: "admin",
  title: "Roles",
  configSchema: schemaOf("admin.roles"),
  sizes: catalogEntry("admin.roles")?.sizes ?? [],
  mount(el, { size, api, rt, bus, nav, ctx }) {
    const st = { roles: [], selected: null, remove: new Set(), outcome: null };
    const next = latest();
    let alive = true;

    const list = region("rp-roles__list");
    const pane = splitPane({
      label: "Roles",
      placeholder: emptyState({
        icon: "shield",
        title: "Select a role",
        body: "Its members, grants and pending changes appear here.",
      }),
    });
    pane.list.append(list.el);
    el.append(h("div", { class: `rp-app rp-roles rp-roles--${size}` }, pane.el));

    const slugOf = (r) => r.node.slug;
    const current = () => st.roles.find((r) => slugOf(r) === st.selected);

    async function load({ first = false, silent = false } = {}) {
      const ok = next();
      if (first) list.loading({ lines: 4 });
      try {
        const out = await api.call("admin.roles");
        if (!ok() || !alive) return;
        st.roles = out.items;
        ctx.setCount(st.roles.length);
        paintList();
        if (st.selected && current()) paintRole(true);
      } catch (e) {
        if (!ok() || !alive) return;
        if (toErrorInfo(e).code === "FORBIDDEN") ctx.setState("unavailable", { reason: "forbidden" });
        else if (!silent) list.error(e, () => load({ first: true }));
      }
    }

    function paintList() {
      if (st.roles.length === 0) {
        list.show(
          emptyState({
            icon: "shield",
            title: "No roles",
            body: "Roles are Role nodes. Ask an agent to propose one.",
          }),
        );
        return;
      }
      list.show(
        h(
          "ul",
          { class: "rp-rows", "aria-label": "Roles" },
          ...st.roles.map((r) =>
            h(
              "li",
              { class: `rp-row${st.selected === slugOf(r) ? " is-selected" : ""}`, "data-key": slugOf(r) },
              h(
                "div",
                { class: "rp-row__main" },
                h(
                  "button",
                  {
                    type: "button",
                    class: "rp-row__title",
                    "aria-current": st.selected === slugOf(r) ? "true" : null,
                    onclick: () => select(r),
                  },
                  r.node.title || slugOf(r),
                ),
                h("p", { class: "rp-row__summary" }, r.description),
                h(
                  "div",
                  { class: "rp-row__meta" },
                  h("span", {}, `${r.members.length} members`),
                  h("span", {}, `${r.grants.length} grants`),
                ),
              ),
              h(
                "div",
                { class: "rp-row__side" },
                r.system ? pill({ label: "System" }) : null,
                r.pending.length
                  ? pill({ label: `${r.pending.length} pending`, tone: "warning", icon: "clock" })
                  : null,
              ),
            ),
          ),
        ),
      );
    }

    function select(r) {
      st.selected = slugOf(r);
      st.remove = new Set();
      st.outcome = null;
      paintList();
      paintRole();
      pane.showDetail();
    }

    // ---- role view ----
    function paintRole(keepOutcome = false) {
      const r = current();
      if (!r) return;
      if (!keepOutcome) st.outcome = null;
      const removeCount = st.remove.size;
      const members = r.members.length
        ? h(
            "ul",
            { class: "rp-rows", "aria-label": `Members of ${r.node.title}` },
            ...r.members.map((m) => {
              const subj = m.person.subject;
              const id = `rm-${slugOf(r)}-${subj}`;
              return h(
                "li",
                { class: `rp-row${st.remove.has(subj) ? " is-selected" : ""}` },
                h(
                  "div",
                  { class: "rp-row__main" },
                  h(
                    "div",
                    { class: "rp-row__meta" },
                    personChip(m.person, { href: nav.href(`/people/${m.person.handle}`) }),
                    m.scope ? pill({ label: `Region ${m.scope.region}`, tone: "info" }) : null,
                  ),
                ),
                h(
                  "div",
                  { class: "rp-row__side" },
                  h(
                    "label",
                    { class: "rp-check", for: id },
                    h("input", {
                      id,
                      type: "checkbox",
                      checked: st.remove.has(subj) ? true : null,
                      onchange: (e) => {
                        if (e.target.checked) st.remove.add(subj);
                        else st.remove.delete(subj);
                        paintRole(true);
                        document.getElementById(id)?.focus();
                      },
                    }),
                    "Remove",
                  ),
                  button({
                    label: `Show ${m.person.display_name}`,
                    icon: "user",
                    iconOnly: true,
                    size: "sm",
                    variant: "ghost",
                    onClick: () => bus.publish("member.selected", { id: m.person.handle }),
                  }),
                ),
              );
            }),
          )
        : h("p", { class: "u-muted" }, "No members.");

      const grants = r.grants.length
        ? h(
            "ul",
            { class: "rp-rows", "aria-label": "Grants of this role" },
            ...r.grants.map((g) =>
              h(
                "li",
                { class: "rp-row" },
                h(
                  "div",
                  { class: "rp-row__main" },
                  h("span", { class: "rp-row__title" }, g.grant.title || g.grant.slug),
                  h(
                    "div",
                    { class: "rp-row__meta" },
                    ...g.actions.map((a) => pill({ label: a })),
                    h("span", { class: "u-mono" }, g.resource),
                    g.owner_only ? pill({ label: "Owner only", tone: "info" }) : null,
                  ),
                ),
              ),
            ),
          )
        : h("p", { class: "u-muted" }, "No grants.");

      const pending = r.pending.length
        ? h(
            "ul",
            { class: "rp-rows", "aria-label": "Pending changes" },
            ...r.pending.map((p) =>
              h(
                "li",
                { class: "rp-row" },
                h(
                  "div",
                  { class: "rp-row__main" },
                  h("span", { class: "rp-row__title" }, p.summary),
                  h("div", { class: "rp-row__meta" }, "Requested by ", personChip(p.requested_by)),
                ),
                h(
                  "div",
                  { class: "rp-row__side" },
                  h("a", { href: nav.href("/approvals") }, "Open approvals"),
                ),
              ),
            ),
          )
        : null;

      pane.detail.replaceChildren(
        h(
          "article",
          { class: "rp-detail", "aria-label": r.node.title },
          h(
            "header",
            { class: "rp-detail__head" },
            h(
              "h3",
              { class: "rp-detail__heading", tabindex: "-1", "data-focus": "" },
              r.node.title || slugOf(r),
            ),
            h("p", {}, r.description),
            h(
              "div",
              { class: "rp-detail__pills" },
              r.system ? pill({ label: "System role" }) : null,
              pill({ label: `Revision ${r.node.revision}`, tone: "info" }),
            ),
          ),
          st.outcome,
          h(
            "section",
            { class: "rp-detail__section" },
            h("h4", { class: "rp-detail__title" }, `Members (${r.members.length})`),
            members,
            removeCount
              ? h(
                  "div",
                  { class: "rp-detail__actions" },
                  button({
                    label: `Propose removing ${removeCount}`,
                    icon: "minus",
                    variant: "danger",
                    onClick: () => review({ remove: [...st.remove], add: [] }),
                  }),
                  button({
                    label: "Clear selection",
                    variant: "ghost",
                    onClick: () => ((st.remove = new Set()), paintRole(true)),
                  }),
                )
              : null,
          ),
          addForm(r),
          h(
            "section",
            { class: "rp-detail__section" },
            h("h4", { class: "rp-detail__title" }, `Grants (${r.grants.length})`),
            grants,
          ),
          pending
            ? h(
                "section",
                { class: "rp-detail__section" },
                h("h4", { class: "rp-detail__title" }, "Pending changes"),
                pending,
              )
            : null,
        ),
      );
    }

    function addForm(r) {
      const who = textField({
        name: "/add/0/subject",
        label: "Subject to add",
        placeholder: "user:maya-ortiz",
        hint: "user:handle, agent:name or service:name",
      });
      const scope = selectField({
        name: "/add/0/scope",
        label: "Region scope",
        value: "",
        options: [
          { value: "", label: "No scope (every region)" },
          ...REGIONS.map((x) => ({ value: x, label: x })),
        ],
      });
      const form = h(
        "form",
        {
          class: "rp-form",
          "aria-label": "Propose adding a member",
          novalidate: true,
          onsubmit: (e) => {
            e.preventDefault();
            formErrors(null, { form });
            const subject = who.querySelector("input").value.trim();
            if (!SUBJECT.test(subject)) {
              formErrors(
                {
                  code: "VALIDATION_FAILED",
                  path: "/add/0/subject",
                  message: "Use user:handle, agent:name or service:name.",
                },
                { form },
              )?.focus();
              return;
            }
            if (r.members.some((m) => m.person.subject === subject)) {
              formErrors(
                {
                  code: "VALIDATION_FAILED",
                  path: "/add/0/subject",
                  message: "They are already in this role.",
                },
                { form },
              )?.focus();
              return;
            }
            const sc = scope.querySelector("select").value;
            review({ add: [{ subject, ...(sc ? { scope: { region: sc } } : {}) }], remove: [] });
          },
        },
        h("h4", { class: "rp-detail__title" }, "Propose adding a member"),
        h("div", { class: "rp-form__row" }, who, scope),
        h(
          "div",
          { class: "rp-form__actions" },
          button({ label: "Review the change", icon: "chevron-right", variant: "secondary", type: "submit" }),
        ),
      );
      return form;
    }

    // ---- review and submit ----
    async function review({ add, remove }) {
      const r = current();
      if (!r) return;
      const reason = textArea({
        name: "/reason",
        label: "Reason",
        rows: 2,
        required: true,
        hint: "Kept with the approval request.",
      });
      const lines = [
        ...add.map((a) => `Add ${a.subject}${a.scope ? ` (region ${a.scope.region})` : ""}`),
        ...remove.map((s) => `Remove ${s}`),
      ];
      const error = h("p", { class: "rp-form__error", role: "alert", hidden: true });
      const body = h(
        "div",
        { class: "rp-form" },
        h("p", {}, `Proposed change to the ${r.node.title || slugOf(r)} role:`),
        h("ul", {}, ...lines.map((l) => h("li", {}, l))),
        h("p", { class: "u-muted" }, "Role changes are held until a second admin approves them."),
        reason,
        error,
      );
      // The dialog resolves when an action is chosen, so ask for the reason in a loop until it is given or cancelled.
      for (;;) {
        const answer = await ctx.openDialog({
          title: "Review the role change",
          size: "md",
          body,
          actions: [
            { label: "Cancel", value: false, variant: "secondary", autofocus: true },
            { label: "Propose change", value: true, variant: "primary" },
          ],
        });
        if (answer !== true) return;
        const text = reason.querySelector("textarea").value.trim();
        if (text) {
          await submit(r, add, remove, text);
          return;
        }
        error.textContent = "Give a reason before proposing the change.";
        error.hidden = false;
      }
    }

    async function submit(r, add, remove, reason) {
      try {
        const out = await api.call("admin.role_members", {
          slug: slugOf(r),
          add: add.length ? add : undefined,
          remove: remove.length ? remove : undefined,
          base_revision: r.node.revision,
          reason,
        });
        st.remove = new Set();
        st.outcome = heldNotice(out, "The role change", nav);
        ctx.announce(
          out.status === "pending_approval" ? "Role change held for approval" : "Role change committed",
        );
        await load({ silent: true });
      } catch (e) {
        const info = toErrorInfo(e);
        const stale = info.code === "CONFLICT";
        st.outcome = h(
          "div",
          { class: "rp-notice", "data-tone": "danger", role: "alert" },
          icon("alert", { size: 16 }),
          h(
            "p",
            {},
            info.details?.reason === "SELF_ACTION"
              ? "You cannot change your own role membership."
              : stale
                ? "This role changed while you were editing. The latest version has been loaded; review and try again."
                : (info.message ?? info.code),
          ),
        );
        if (stale) await load({ silent: true });
        else paintRole(true);
      }
    }

    // ---- realtime ----
    const refresh = debounce(() => load({ silent: true }), 500);
    const offs = [rt.on("approval.decided", () => refresh()), rt.onNode("Role", () => refresh())];

    load({ first: true });
    return () => {
      alive = false;
      refresh.cancel();
      for (const off of offs) off();
    };
  },
};
