// admin.members: every member with private fields, roles and status. List, member and create views: search and
// filters, a member view with sessions you can revoke and a disable or re-enable form (reason required), and a
// create form whose server errors land on their fields. Realtime keeps rows and sessions current.
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { icon } from "../../ds/js/icons.js";
import { pill } from "../../ds/js/pill.js";
import { personChip } from "../../ds/js/avatar.js";
import { emptyState } from "../../ds/js/states.js";
import { formErrors, searchField, selectField, textArea, textField } from "../../ds/js/field.js";
import { number } from "../../ds/js/format.js";
import { catalogEntry, schemaOf } from "../../core/widgets.js";
import {
  debounce,
  focusSoon,
  keyValues,
  latest,
  region,
  timeNode,
  toErrorInfo,
  toastError,
} from "../reporting/_common.js";
import { splitPane } from "../reporting/_split.js";
import { DEPARTMENTS, HANDLE, REGIONS, cap, heldNotice } from "./_admin.js";

const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/;
const PAGE = 30;

export default {
  id: "admin.members",
  domain: "admin",
  title: "Members",
  configSchema: schemaOf("admin.members"),
  sizes: catalogEntry("admin.members")?.sizes ?? [],
  mount(el, { size, api, rt, bus, nav, ctx }) {
    const st = {
      q: "",
      status: "any",
      role: "",
      items: [],
      total: 0,
      next: null,
      selected: null,
      mode: "list",
    };
    const next = latest();
    const nextSessions = latest();
    let alive = true;
    const timers = new Set();

    const list = region("rp-members__list");
    const tools = h("div", { class: "rp-tools" });
    const pane = splitPane({
      label: "Members",
      placeholder: emptyState({
        icon: "users",
        title: "Select a member",
        body: "Their private fields, roles and sessions appear here.",
      }),
    });
    pane.list.append(list.el);
    el.append(h("div", { class: `rp-app rp-members rp-members--${size}` }, tools, pane.el));

    // ---- toolbar ----
    const paintTools = () => {
      const search = searchField({
        name: "q",
        label: "Search members",
        value: st.q,
        placeholder: "Name, handle or email",
        onInput: debounce((v) => {
          st.q = v;
          reset();
        }, 300),
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
            { value: "active", label: "Active" },
            { value: "disabled", label: "Disabled" },
          ],
          onChange: (v) => ((st.status = v), reset()),
        }),
        textField({
          name: "role",
          label: "Role",
          value: st.role,
          placeholder: "e.g. manager",
          onChange: (v) => ((st.role = v.trim()), reset()),
        }),
        h(
          "p",
          { class: "rp-tools__count u-tabular" },
          st.total ? `${number(st.total)} ${st.total === 1 ? "member" : "members"}` : "",
        ),
        button({ label: "New member", icon: "plus", variant: "primary", onClick: () => showCreate() }),
      );
    };

    const reset = () => {
      st.next = null;
      load({ first: true });
    };

    // ---- loading ----
    async function load({ first = false, silent = false, more = false } = {}) {
      const ok = next();
      if (first) list.loading({ lines: 5 });
      else if (!silent) list.busy(true);
      try {
        const out = await api.call("admin.members", {
          q: st.q.trim() || undefined,
          status: st.status === "any" ? undefined : st.status,
          role: st.role || undefined,
          cursor: more ? (st.next ?? undefined) : undefined,
          limit: PAGE,
        });
        if (!ok() || !alive) return;
        st.items = more ? [...st.items, ...out.items] : out.items;
        st.next = out.next_cursor;
        st.total = out.total;
        list.busy(false);
        ctx.setCount(st.total);
        paintTools();
        paintList();
      } catch (e) {
        if (!ok() || !alive) return;
        list.busy(false);
        if (toErrorInfo(e).code === "FORBIDDEN") ctx.setState("unavailable", { reason: "forbidden" });
        else if (!silent) list.error(e, () => load({ first: true }));
      }
    }

    // ---- list ----
    const rowNode = (m) => {
      const handle = m.person.handle;
      return h(
        "li",
        {
          class: `rp-row${st.selected === handle ? " is-selected" : ""}${m.status === "disabled" ? " is-done" : ""}`,
          "data-key": handle,
        },
        h(
          "div",
          { class: "rp-row__main" },
          h(
            "button",
            {
              type: "button",
              class: "rp-row__title",
              "aria-current": st.selected === handle ? "true" : null,
              onclick: () => select(m),
            },
            m.person.display_name,
          ),
          h("p", { class: "rp-row__summary" }, `${m.title}, ${cap(m.department)}, ${m.region}`),
          h(
            "div",
            { class: "rp-row__meta" },
            ...m.roles.map((r) =>
              pill({ label: r.scope ? `${r.role} (${r.scope.region})` : r.role, tone: "info" }),
            ),
            h("span", {}, `${m.sessions_active} ${m.sessions_active === 1 ? "session" : "sessions"}`),
            m.last_active_at
              ? h("span", {}, "Active ", timeNode(m.last_active_at))
              : h("span", {}, "Never active"),
          ),
        ),
        h(
          "div",
          { class: "rp-row__side" },
          m.status === "active"
            ? pill({ label: "Active", tone: "success", icon: "check-circle" })
            : pill({ label: "Disabled", tone: "danger", icon: "lock" }),
        ),
      );
    };

    function paintList() {
      if (st.items.length === 0) {
        list.show(
          emptyState({
            icon: "users",
            title: st.q || st.role || st.status !== "any" ? "No members match" : "No members yet",
            body: "Loosen a filter, or create a member.",
          }),
        );
        return;
      }
      list.show(
        h("ul", { class: "rp-rows", "aria-label": "Members" }, ...st.items.map(rowNode)),
        st.next
          ? h(
              "div",
              { class: "rp-more" },
              button({
                label: "Load more",
                icon: "chevron-down",
                variant: "secondary",
                onClick: () => load({ more: true }),
              }),
            )
          : null,
      );
    }

    // ---- member view ----
    function select(m) {
      st.selected = m.person.handle;
      st.mode = "member";
      bus.publish("member.selected", { id: m.person.handle });
      paintList();
      paintMember(m);
      pane.showDetail();
    }

    function paintMember(m) {
      const sessions = region("rp-sessions");
      const holder = h("div", { class: "rp-detail" });
      const statusForm = statusFormNode(m);
      holder.append(
        h(
          "header",
          { class: "rp-detail__head" },
          h("h3", { class: "rp-detail__heading", tabindex: "-1", "data-focus": "" }, m.person.display_name),
          h(
            "div",
            { class: "rp-detail__pills" },
            m.status === "active"
              ? pill({ label: "Active", tone: "success", icon: "check-circle" })
              : pill({ label: "Disabled", tone: "danger", icon: "lock" }),
            ...m.roles.map((r) =>
              pill({ label: r.scope ? `${r.role} (${r.scope.region})` : r.role, tone: "info" }),
            ),
          ),
        ),
        keyValues([
          ["Handle", h("span", { class: "u-mono" }, `@${m.person.handle}`)],
          ["Email", m.email],
          ["Title", m.title],
          ["Department", cap(m.department)],
          ["Region", m.region],
          ["Joined", timeNode(m.joined_at)],
          ["Last active", m.last_active_at ? timeNode(m.last_active_at) : "Never"],
        ]),
        h(
          "div",
          { class: "rp-detail__actions" },
          h(
            "a",
            {
              class: "c-button c-button--secondary c-button--sm",
              href: nav.href(`/people/${m.person.handle}`),
            },
            "Public profile",
          ),
        ),
        h(
          "section",
          { class: "rp-detail__section" },
          h("h4", { class: "rp-detail__title" }, "Sessions"),
          sessions.el,
        ),
        statusForm,
      );
      pane.detail.replaceChildren(holder);
      loadSessions(m, sessions);
    }

    async function loadSessions(m, host, { activeOnly = true } = {}) {
      const ok = nextSessions();
      host.loading({ lines: 2 });
      try {
        const out = await api.call("admin.sessions", {
          member: m.person.handle,
          active_only: activeOnly,
          limit: 20,
        });
        if (!ok() || !alive) return;
        const rows = out.items;
        const toggle = button({
          label: activeOnly ? "Show revoked sessions too" : "Show active only",
          variant: "ghost",
          size: "sm",
          onClick: () => loadSessions(m, host, { activeOnly: !activeOnly }),
        });
        host.show(
          rows.length === 0
            ? h("p", { class: "u-muted" }, activeOnly ? "No active sessions." : "No sessions.")
            : h(
                "ul",
                { class: "rp-rows", "aria-label": `Sessions of ${m.person.display_name}` },
                ...rows.map((s) =>
                  h(
                    "li",
                    { class: `rp-row${s.revoked_at ? " is-done" : ""}`, "data-key": s.session_id },
                    h(
                      "div",
                      { class: "rp-row__main" },
                      h("span", { class: "rp-row__title" }, s.label || "Session"),
                      h(
                        "div",
                        { class: "rp-row__meta" },
                        pill({ label: s.surface }),
                        s.current ? pill({ label: "This tab", tone: "info" }) : null,
                        h("span", {}, "Last seen ", timeNode(s.last_seen_at)),
                        s.revoked_at ? pill({ label: "Revoked", tone: "neutral" }) : null,
                      ),
                    ),
                    h(
                      "div",
                      { class: "rp-row__side" },
                      s.revoked_at
                        ? null
                        : button({
                            label: "Revoke",
                            icon: "x",
                            size: "sm",
                            variant: "danger",
                            onClick: async () => {
                              const yes = await ctx.confirm({
                                title: "Revoke this session?",
                                message: `${m.person.display_name} is signed out of that tab straight away.`,
                                confirmLabel: "Revoke session",
                                tone: "danger",
                              });
                              if (!yes) return;
                              try {
                                await api.call("admin.session_revoke", { session_id: s.session_id });
                                ctx.toast({ title: "Session revoked", tone: "success" });
                                ctx.announce("Session revoked");
                                loadSessions(m, host, { activeOnly });
                                load({ silent: true });
                              } catch (e) {
                                toastError(ctx.toast, e, "Could not revoke the session");
                              }
                            },
                          }),
                    ),
                  ),
                ),
              ),
          toggle,
        );
      } catch (e) {
        if (!ok() || !alive) return;
        host.error(e, () => loadSessions(m, host, { activeOnly }));
      }
    }

    const statusFormNode = (m) => {
      const disabling = m.status === "active";
      const reason = textArea({
        name: "/reason",
        label: disabling ? "Reason for disabling" : "Reason for re-enabling",
        rows: 2,
        required: true,
        hint: disabling ? "Disabling signs every session out." : "The member can sign in again.",
      });
      const out = h("div", { role: "alert" });
      const submit = button({
        label: disabling ? "Disable member" : "Re-enable member",
        icon: disabling ? "lock" : "check",
        variant: disabling ? "danger" : "secondary",
        type: "submit",
      });
      return h(
        "form",
        {
          class: "rp-form",
          "aria-label": disabling ? "Disable member" : "Re-enable member",
          novalidate: true,
          onsubmit: async (e) => {
            e.preventDefault();
            const text = reason.querySelector("textarea").value.trim();
            formErrors(null, { form: e.currentTarget });
            out.replaceChildren();
            if (!text) {
              formErrors(
                {
                  code: "VALIDATION_FAILED",
                  path: "/reason",
                  message: "Give a reason. It is kept in the audit log.",
                },
                { form: e.currentTarget },
              );
              reason.querySelector("textarea").focus();
              return;
            }
            if (disabling) {
              const yes = await ctx.confirm({
                title: `Disable ${m.person.display_name}?`,
                message: "All their sessions are revoked and they cannot sign in until re-enabled.",
                confirmLabel: "Disable",
                tone: "danger",
              });
              if (!yes) return;
            }
            submit.setAttribute("aria-busy", "true");
            try {
              const res = await api.call("admin.member_status", {
                handle: m.person.handle,
                status: disabling ? "disabled" : "active",
                reason: text,
              });
              ctx.toast({
                title: disabling
                  ? `${m.person.display_name} disabled`
                  : `${m.person.display_name} re-enabled`,
                body: disabling ? `${res.sessions_revoked} sessions revoked` : undefined,
                tone: "success",
              });
              ctx.announce(disabling ? "Member disabled" : "Member re-enabled");
              await load({ silent: true });
              const fresh = st.items.find((x) => x.person.handle === m.person.handle);
              if (fresh) paintMember(fresh);
            } catch (err) {
              submit.removeAttribute("aria-busy");
              const info = toErrorInfo(err);
              out.replaceChildren(
                h(
                  "div",
                  { class: "rp-notice", "data-tone": "danger" },
                  icon("alert", { size: 16 }),
                  h(
                    "p",
                    {},
                    info.details?.reason === "SELF_ACTION"
                      ? "You cannot disable yourself."
                      : (info.message ?? info.code),
                  ),
                ),
              );
            }
          },
        },
        reason,
        out,
        h("div", { class: "rp-form__actions" }, submit),
      );
    };

    // ---- create view ----
    function showCreate() {
      st.mode = "create";
      st.selected = null;
      paintList();
      const f = {
        handle: textField({
          name: "/handle",
          label: "Handle",
          required: true,
          placeholder: "maya-ortiz",
          hint: "Lowercase letters, digits and hyphens, 2 to 40 characters.",
        }),
        display_name: textField({ name: "/display_name", label: "Display name", required: true }),
        email: textField({
          name: "/email",
          label: "Email",
          required: true,
          placeholder: "name@northwind.example",
        }),
        title: textField({ name: "/title", label: "Job title", required: true }),
        department: selectField({
          name: "/department",
          label: "Department",
          value: DEPARTMENTS[0],
          options: DEPARTMENTS.map((d) => ({ value: d, label: cap(d) })),
        }),
        region: selectField({
          name: "/region",
          label: "Region",
          value: "EMEA",
          options: REGIONS.map((r) => ({ value: r, label: r })),
        }),
        location: textField({
          name: "/location",
          label: "Location",
          required: true,
          placeholder: "Rotterdam",
        }),
      };
      const result = h("div", { role: "status" });
      const submit = button({ label: "Create member", icon: "plus", variant: "primary", type: "submit" });
      const form = h(
        "form",
        {
          class: "rp-form",
          "aria-label": "New member",
          novalidate: true,
          onsubmit: async (e) => {
            e.preventDefault();
            formErrors(null, { form });
            result.replaceChildren();
            const v = (k) => form.querySelector(`[name="/${k}"]`).value.trim();
            const body = {
              handle: v("handle"),
              display_name: v("display_name"),
              email: v("email"),
              title: v("title"),
              department: v("department"),
              region: v("region"),
              location: v("location"),
            };
            const bad = !HANDLE.test(body.handle)
              ? ["/handle", "Use 2 to 40 lowercase letters, digits or hyphens, starting with a letter."]
              : !body.display_name
                ? ["/display_name", "Enter a name."]
                : !EMAIL.test(body.email)
                  ? ["/email", "Enter a valid email address."]
                  : !body.title
                    ? ["/title", "Enter a job title."]
                    : !body.location
                      ? ["/location", "Enter a location."]
                      : null;
            if (bad) {
              formErrors({ code: "VALIDATION_FAILED", path: bad[0], message: bad[1] }, { form })?.focus();
              return;
            }
            submit.setAttribute("aria-busy", "true");
            try {
              const out = await api.call("admin.member_create", body);
              ctx.toast({ title: `${out.person.display_name} created`, tone: "success" });
              ctx.announce("Member created");
              result.replaceChildren(heldNotice(out.role_change, "Adding them to the member role", nav));
              form.reset();
              load({ silent: true });
            } catch (err) {
              const info = toErrorInfo(err);
              const exists = info.details?.reason === "ALREADY_EXISTS";
              formErrors(
                {
                  code: info.code,
                  path: exists ? "/handle" : info.path,
                  message: exists ? "That handle is already taken." : (info.message ?? info.code),
                },
                { form },
              )?.focus();
            } finally {
              submit.removeAttribute("aria-busy");
            }
          },
        },
        h("p", { class: "rp-form__note" }, "Fields marked * are required."),
        f.handle,
        f.display_name,
        f.email,
        f.title,
        h("div", { class: "rp-form__row" }, f.department, f.region),
        f.location,
        h(
          "div",
          { class: "rp-form__actions" },
          button({
            label: "Cancel",
            variant: "ghost",
            onClick: () => ((st.mode = "list"), pane.clearDetail()),
          }),
          submit,
        ),
        result,
      );
      pane.detail.replaceChildren(
        h(
          "article",
          { class: "rp-detail", "aria-label": "New member" },
          h("h3", { class: "rp-detail__heading", tabindex: "-1", "data-focus": "" }, "New member"),
          form,
        ),
      );
      pane.showDetail();
      focusSoon(form.querySelector("input"));
    }

    // ---- realtime ----
    const refresh = debounce(() => load({ silent: true }), 600);
    const offs = [
      rt.on("member.updated", (ev) => {
        refresh();
        if (st.selected === ev.payload.member && st.mode === "member")
          setTimeout(() => {
            const fresh = st.items.find((x) => x.person.handle === st.selected);
            if (fresh && alive) paintMember(fresh);
          }, 900);
      }),
      rt.on("session.revoked", () => {
        refresh();
        if (st.selected && st.mode === "member") {
          const m = st.items.find((x) => x.person.handle === st.selected);
          const host = pane.detail.querySelector(".rp-sessions");
          if (m && host) paintMember(m);
        }
      }),
    ];

    paintTools();
    load({ first: true });
    return () => {
      alive = false;
      refresh.cancel();
      for (const t of timers) clearTimeout(t);
      for (const off of offs) off();
    };
  },
};
