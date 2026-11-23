// admin.program: the Program node (slug rewards) as a form: general, tiers, limits and notification defaults.
// Edits stay in a draft; "Review changes" lists exactly what changes, asks for a reason, and proposes the change
// (every Program change is held under R-PROGRAM). A history view lists revisions and diffs any revision with
// the one before it.
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { icon } from "../../ds/js/icons.js";
import { pill } from "../../ds/js/pill.js";
import { emptyState } from "../../ds/js/states.js";
import { dataTable } from "../../ds/js/table.js";
import { tabs } from "../../ds/js/tabs.js";
import { formErrors, numberField, selectField, switchField, textArea, textField } from "../../ds/js/field.js";
import { points } from "../../ds/js/format.js";
import { catalogEntry, schemaOf } from "../../core/widgets.js";
import { debounce, latest, region, timeNode, toErrorInfo } from "../reporting/_common.js";
import { actorLabel } from "../reporting/_events.js";
import { opLine } from "../reporting/_detail.js";
import { cap, heldNotice } from "./_admin.js";
import { kernelDiff } from "../audit/_audit.js";

const SECTIONS = [
  "name",
  "currency_label",
  "tiers",
  "expiry",
  "transfer",
  "awards",
  "store",
  "messaging",
  "notification_defaults",
  "digest_default",
];

const getPath = (o, path) => path.reduce((a, k) => (a === undefined || a === null ? a : a[k]), o);
const setPath = (o, path, value) => {
  let cur = o;
  for (const k of path.slice(0, -1)) cur = cur[k];
  cur[path.at(-1)] = value;
};
const pointer = (path) => `/spec/${path.join("/")}`;

const RANGES = {
  "expiry/months": [1, 60],
  "awards/max_recipients": [1, 50],
  "store/cancel_window_minutes": [0, 10080],
  "store/max_cart_lines": [1, 50],
  "store/max_qty_per_line": [1, 10],
  "messaging/broadcast_min_recipients": [2, 1000],
  "messaging/max_recipients": [1, 1000],
  "digest_default/hour_utc": [0, 23],
};

export default {
  id: "admin.program",
  domain: "admin",
  title: "Programme settings",
  configSchema: schemaOf("admin.program"),
  sizes: catalogEntry("admin.program")?.sizes ?? [],
  mount(el, { size, api, rt, nav, ctx }) {
    const st = {
      node: null,
      draft: null,
      view: "form",
      errors: new Map(),
      pending: null,
      history: null,
      tab: "general",
    };
    const next = latest();
    let alive = true;

    const stage = region("rp-program__stage");
    el.append(h("div", { class: `rp-app rp-program rp-program--${size}` }, stage.el));

    const spec = () => st.node.body.spec;
    const dirty = () => JSON.stringify(st.draft) !== JSON.stringify(spec());

    async function load({ first = false, silent = false } = {}) {
      const ok = next();
      if (first) stage.loading({ lines: 6 });
      try {
        const node = await api.nodes.get("program:rewards");
        if (!ok() || !alive) return;
        const keep = st.draft && st.node && dirty() && silent;
        st.node = node;
        if (!keep) st.draft = structuredClone(node.body.spec);
        ctx.setTitle(`Programme: ${node.body.spec.name}`);
        paint();
      } catch (e) {
        if (!ok() || !alive) return;
        if (toErrorInfo(e).code === "FORBIDDEN") ctx.setState("unavailable", { reason: "forbidden" });
        else if (!silent || !st.node) stage.error(e, () => load({ first: true }));
      }
    }

    // ---- field helpers: every field writes into the draft ----
    const num = (path, label, opts = {}) => {
      const key = path.join("/");
      const [min, max] = RANGES[key] ?? [opts.min ?? 0, opts.max];
      return numberField({
        name: pointer(path),
        label,
        value: getPath(st.draft, path),
        min,
        max,
        step: 1,
        required: true,
        hint: opts.hint ?? (max !== undefined ? `${min} to ${max}` : undefined),
        error: st.errors.get(pointer(path)),
        onChange: (v) => {
          setPath(st.draft, path, v);
          st.errors.delete(pointer(path));
          touch();
        },
      });
    };
    const text = (path, label, opts = {}) =>
      textField({
        name: pointer(path),
        label,
        value: getPath(st.draft, path),
        required: true,
        hint: opts.hint,
        error: st.errors.get(pointer(path)),
        onChange: (v) => {
          setPath(st.draft, path, v);
          touch();
        },
      });

    let reviewBtn;
    let discardBtn;
    const touch = () => {
      const d = dirty();
      if (reviewBtn) reviewBtn.disabled = !d;
      if (discardBtn) discardBtn.disabled = !d;
    };

    // ---- sections ----
    const generalPanel = () =>
      h(
        "div",
        { class: "rp-form" },
        text(["name"], "Programme name"),
        text(["currency_label"], "Points label", {
          hint: "At most 20 characters, shown next to point values.",
        }),
        h(
          "div",
          { class: "rp-form__row" },
          num(["expiry", "months"], "Points expire after (months)"),
          textField({
            name: "/spec/expiry/warn_days",
            label: "Warn before expiry (days)",
            value: st.draft.expiry.warn_days.join(", "),
            hint: "Up to 3 whole numbers from 1 to 90, separated by commas.",
            error: st.errors.get("/spec/expiry/warn_days"),
            onChange: (v) => {
              const parts = v
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean)
                .map(Number);
              st.draft.expiry.warn_days = parts;
              st.errors.delete("/spec/expiry/warn_days");
              touch();
            },
          }),
        ),
        h(
          "div",
          { class: "rp-form__row" },
          selectField({
            name: "/spec/digest_default/frequency",
            label: "Default digest",
            value: st.draft.digest_default.frequency,
            options: [
              { value: "off", label: "Off" },
              { value: "daily", label: "Daily" },
              { value: "weekly", label: "Weekly" },
            ],
            onChange: (v) => {
              st.draft.digest_default.frequency = v;
              if (v === "weekly" && st.draft.digest_default.weekday === undefined)
                st.draft.digest_default.weekday = 1;
              touch();
              paintPanels();
            },
          }),
          num(["digest_default", "hour_utc"], "Digest hour (UTC)"),
        ),
        st.draft.digest_default.frequency === "weekly"
          ? num(["digest_default", "weekday"], "Digest weekday", { min: 0, max: 6, hint: "0 is Sunday" })
          : null,
      );

    const tiersPanel = () =>
      h(
        "div",
        { class: "rp-form" },
        h("p", { class: "u-muted" }, "Thresholds must rise from one tier to the next."),
        ...st.draft.tiers.map((t, i) =>
          h(
            "fieldset",
            { class: "c-fieldset" },
            h("legend", { class: "c-fieldset__legend" }, cap(t.tier)),
            num(["tiers", i, "min_lifetime_points"], "Lifetime points to reach this tier", {
              hint: points(t.min_lifetime_points),
            }),
            textArea({
              name: `/spec/tiers/${i}/perks`,
              label: "Perks",
              rows: 3,
              value: t.perks.join("\n"),
              hint: "One per line, up to 6, at most 120 characters each.",
              error: st.errors.get(`/spec/tiers/${i}/perks`),
              onChange: (v) => {
                t.perks = v
                  .split("\n")
                  .map((x) => x.trim())
                  .filter(Boolean);
                st.errors.delete(`/spec/tiers/${i}/perks`);
                touch();
              },
            }),
          ),
        ),
      );

    const limitsPanel = () =>
      h(
        "div",
        { class: "rp-form" },
        h(
          "fieldset",
          { class: "c-fieldset" },
          h("legend", { class: "c-fieldset__legend" }, "Transfers"),
          switchField({
            name: "/spec/transfer/enabled",
            label: "Members may transfer points",
            value: st.draft.transfer.enabled,
            onChange: (v) => ((st.draft.transfer.enabled = v), touch()),
          }),
          h(
            "div",
            { class: "rp-form__row" },
            num(["transfer", "min_points"], "Minimum per transfer", { min: 1 }),
            num(["transfer", "max_per_transfer"], "Maximum per transfer", { min: 1 }),
          ),
          num(["transfer", "max_per_day"], "Maximum per day", { min: 1 }),
        ),
        h(
          "fieldset",
          { class: "c-fieldset" },
          h("legend", { class: "c-fieldset__legend" }, "Awards"),
          h(
            "div",
            { class: "rp-form__row" },
            num(["awards", "manager_max_per_award"], "Manager limit per award", {
              min: 1,
              hint: "Above this a manager award is held for finance",
            }),
            num(["awards", "max_recipients"], "Most recipients per award"),
          ),
        ),
        h(
          "fieldset",
          { class: "c-fieldset" },
          h("legend", { class: "c-fieldset__legend" }, "Store"),
          h(
            "div",
            { class: "rp-form__row" },
            num(["store", "high_value_threshold_points"], "High-value order threshold", {
              min: 1,
              hint: "Orders at or above this need approval",
            }),
            num(["store", "cancel_window_minutes"], "Cancel window (minutes)"),
          ),
          h(
            "div",
            { class: "rp-form__row" },
            num(["store", "max_cart_lines"], "Most cart lines"),
            num(["store", "max_qty_per_line"], "Most per line"),
          ),
        ),
        h(
          "fieldset",
          { class: "c-fieldset" },
          h("legend", { class: "c-fieldset__legend" }, "Messaging"),
          h(
            "div",
            { class: "rp-form__row" },
            num(["messaging", "broadcast_min_recipients"], "Broadcast from (recipients)"),
            num(["messaging", "max_recipients"], "Most recipients"),
          ),
        ),
      );

    const notificationsPanel = () => {
      const types = Object.keys(st.draft.notification_defaults);
      const box = (type, channel) => {
        const input = h("input", {
          type: "checkbox",
          checked: st.draft.notification_defaults[type][channel] ? true : null,
          "aria-label": `${cap(type.replace(/_/g, " "))}, ${channel.replace("_", "-")}`,
          onchange: (e) => {
            st.draft.notification_defaults[type][channel] = e.target.checked;
            touch();
          },
        });
        return input;
      };
      return h(
        "div",
        { class: "rp-form" },
        h("p", { class: "u-muted" }, "What a new member receives until they choose otherwise."),
        dataTable({
          caption: "Notification defaults by type and channel",
          density: "compact",
          rowKey: (t) => t,
          rows: types,
          columns: [
            { key: "type", label: "Type", render: (t) => cap(t.replace(/_/g, " ")) },
            { key: "in_app", label: "In app", render: (t) => box(t, "in_app") },
            { key: "email", label: "Email", render: (t) => box(t, "email") },
            { key: "digest", label: "Digest", render: (t) => box(t, "digest") },
          ],
        }),
      );
    };

    let panelHost;
    const paintPanels = () => {
      panelHost.replaceChildren(
        tabs({
          label: "Programme settings",
          selected: st.tab,
          onChange: (id) => (st.tab = id),
          items: [
            { id: "general", label: "General", panel: generalPanel },
            { id: "tiers", label: "Tiers", panel: tiersPanel },
            { id: "limits", label: "Limits", panel: limitsPanel },
            { id: "notifications", label: "Notifications", panel: notificationsPanel },
          ],
        }),
      );
    };

    // ---- validation ----
    const validate = () => {
      const d = st.draft;
      const errs = new Map();
      if (!d.name.trim() || d.name.length > 80)
        errs.set("/spec/name", "Enter a name of at most 80 characters.");
      if (d.currency_label.length > 20) errs.set("/spec/currency_label", "At most 20 characters.");
      for (const [key, [min, max]] of Object.entries(RANGES)) {
        const v = getPath(d, key.split("/"));
        if (v === undefined) continue;
        if (!Number.isInteger(v) || v < min || v > max)
          errs.set(`/spec/${key}`, `Enter a whole number from ${min} to ${max}.`);
      }
      const wd = d.expiry.warn_days;
      if (wd.length > 3 || wd.some((n) => !Number.isInteger(n) || n < 1 || n > 90))
        errs.set("/spec/expiry/warn_days", "Up to 3 whole numbers from 1 to 90.");
      d.tiers.forEach((t, i) => {
        if (!Number.isFinite(t.min_lifetime_points) || t.min_lifetime_points < 0)
          errs.set(`/spec/tiers/${i}/min_lifetime_points`, "Enter 0 or more.");
        else if (i > 0 && t.min_lifetime_points <= d.tiers[i - 1].min_lifetime_points)
          errs.set(`/spec/tiers/${i}/min_lifetime_points`, `Must be above ${cap(d.tiers[i - 1].tier)}.`);
        if (t.perks.length > 6 || t.perks.some((p) => p.length > 120))
          errs.set(`/spec/tiers/${i}/perks`, "At most 6 perks of 120 characters.");
      });
      for (const k of ["min_points", "max_per_transfer", "max_per_day"])
        if (!(d.transfer[k] >= 1)) errs.set(`/spec/transfer/${k}`, "Enter 1 or more.");
      if (d.transfer.min_points > d.transfer.max_per_transfer)
        errs.set("/spec/transfer/min_points", "Cannot exceed the maximum per transfer.");
      if (d.transfer.max_per_transfer > d.transfer.max_per_day)
        errs.set("/spec/transfer/max_per_transfer", "Cannot exceed the maximum per day.");
      if (!(d.awards.manager_max_per_award >= 1))
        errs.set("/spec/awards/manager_max_per_award", "Enter 1 or more.");
      if (!(d.store.high_value_threshold_points >= 1))
        errs.set("/spec/store/high_value_threshold_points", "Enter 1 or more.");
      if (d.messaging.broadcast_min_recipients > d.messaging.max_recipients)
        errs.set("/spec/messaging/broadcast_min_recipients", "Cannot exceed the most recipients.");
      return errs;
    };

    // ---- review and propose ----
    async function review(formEl) {
      formErrors(null, { form: formEl });
      st.errors = validate();
      if (st.errors.size) {
        paintPanels();
        const [path, message] = st.errors.entries().next().value;
        const summary = formErrors({ code: "VALIDATION_FAILED", path, message }, { form: formEl });
        summary?.focus();
        return;
      }
      const changed = SECTIONS.filter((k) => JSON.stringify(st.draft[k]) !== JSON.stringify(spec()[k]));
      const rows = api.nodes.diff(spec(), st.draft);
      const reason = textArea({
        name: "/reason",
        label: "Reason",
        rows: 2,
        required: true,
        hint: "Kept with the approval request.",
      });
      const error = h("p", { class: "rp-form__error", role: "alert", hidden: true });
      const body = h(
        "div",
        { class: "rp-form", "data-widget-domain": "admin" },
        h(
          "p",
          {},
          `${rows.length} ${rows.length === 1 ? "value changes" : "values change"} in ${changed.length} ${changed.length === 1 ? "section" : "sections"}:`,
        ),
        h(
          "ul",
          { class: "rp-ops" },
          ...rows
            .slice(0, 40)
            .map((r) =>
              h(
                "li",
                { class: "u-mono" },
                `${r.path}: ${JSON.stringify(r.before)} to ${JSON.stringify(r.after)}`,
              ),
            ),
          rows.length > 40 ? h("li", {}, `and ${rows.length - 40} more`) : null,
        ),
        h("p", { class: "u-muted" }, "Programme changes are held until a second admin approves them."),
        reason,
        error,
      );
      for (;;) {
        const answer = await ctx.openDialog({
          title: "Review the programme changes",
          size: "lg",
          body,
          actions: [
            { label: "Back", value: false, variant: "secondary", autofocus: true },
            { label: "Propose changes", value: true, variant: "primary" },
          ],
        });
        if (answer !== true) return;
        const why = reason.querySelector("textarea").value.trim();
        if (!why) {
          error.textContent = "Give a reason before proposing the change.";
          error.hidden = false;
          continue;
        }
        return submit(changed, why);
      }
    }

    async function submit(changed, reason) {
      try {
        const ops = changed.map((k) => ({ op: "set", path: `/spec/${k}`, value: st.draft[k] }));
        const res = await api.nodes.patch(st.node.uri, st.node.revision, ops, { reason });
        st.pending = heldNotice(res, "The programme change", nav);
        ctx.announce(res.status === "pending_approval" ? "Change held for approval" : "Change committed");
        await load({ silent: false });
      } catch (e) {
        const info = toErrorInfo(e);
        if (info.code === "CONFLICT") {
          st.pending = h(
            "div",
            { class: "rp-notice", "data-tone": "warning", role: "alert" },
            icon("alert", { size: 16 }),
            h(
              "p",
              {},
              "The programme changed while you were editing. Your draft was kept; review it against the latest values.",
            ),
          );
          await load({ silent: true });
          paint();
          return;
        }
        const summary = formErrors(
          { code: info.code, path: info.path, message: info.message ?? info.code },
          { form: stage.el.querySelector("form") },
        );
        summary?.focus();
      }
    }

    // ---- painting ----
    function paintForm() {
      panelHost = h("div", { class: "rp-program__panels" });
      reviewBtn = button({
        label: "Review changes",
        icon: "chevron-right",
        variant: "primary",
        type: "submit",
        disabled: !dirty(),
      });
      discardBtn = button({
        label: "Discard changes",
        variant: "ghost",
        disabled: !dirty(),
        onClick: () => {
          st.draft = structuredClone(spec());
          st.errors = new Map();
          paintPanels();
          touch();
        },
      });
      const form = h(
        "form",
        {
          class: "rp-form rp-program__form",
          "aria-label": "Programme settings",
          novalidate: true,
          onsubmit: (e) => (e.preventDefault(), review(form)),
        },
        st.pending,
        panelHost,
        h("div", { class: "rp-form__actions" }, discardBtn, reviewBtn),
      );
      stage.show(toolbar(), form);
      paintPanels();
    }

    const toolbar = () =>
      h(
        "div",
        { class: "rp-tools" },
        h(
          "div",
          { class: "rp-segment", role: "group", "aria-label": "View" },
          button({
            label: "Settings",
            icon: "sliders",
            size: "sm",
            variant: "secondary",
            pressed: st.view === "form",
            onClick: () => ((st.view = "form"), paint()),
          }),
          button({
            label: "History",
            icon: "history",
            size: "sm",
            variant: "secondary",
            pressed: st.view === "history",
            onClick: () => ((st.view = "history"), paint()),
          }),
        ),
        h("span", { class: "rp-tools__spacer" }),
        pill({ label: `Revision ${st.node.revision}`, tone: "info" }),
      );

    async function paintHistory() {
      stage.show(toolbar(), h("p", { class: "u-muted", role: "status" }, "Loading history."));
      const ok = next();
      try {
        const items = await api.nodes.history({ uri: st.node.uri, limit: 50 });
        if (!ok() || !alive || st.view !== "history") return;
        const rows = items.map((it, i) => ({ ...it, revision: st.node.revision - i }));
        const diffHost = h("div", { class: "rp-program__diff", role: "status" });
        stage.show(
          toolbar(),
          rows.length
            ? h(
                "ol",
                { class: "rp-rows", "aria-label": "Revisions, newest first" },
                ...rows.map((r) =>
                  h(
                    "li",
                    { class: "rp-row" },
                    h(
                      "div",
                      { class: "rp-row__main" },
                      h("span", { class: "rp-row__title" }, `Revision ${r.revision}`),
                      h("p", { class: "rp-row__summary" }, r.ops_summary),
                      h(
                        "div",
                        { class: "rp-row__meta" },
                        h("span", {}, actorLabel(r.actor)),
                        timeNode(r.at),
                        r.approved_by
                          ? pill({ label: `Approved by ${actorLabel(r.approved_by)}`, tone: "success" })
                          : null,
                        r.reason ? h("span", {}, `“${r.reason}”`) : null,
                      ),
                    ),
                    h(
                      "div",
                      { class: "rp-row__side" },
                      r.revision > 1
                        ? button({
                            label: "Diff with previous",
                            icon: "sort",
                            size: "sm",
                            variant: "secondary",
                            onClick: async () => {
                              diffHost.replaceChildren(h("p", { class: "u-muted" }, "Comparing."));
                              try {
                                const d = await kernelDiff("program:rewards", r.revision - 1, r.revision);
                                diffHost.replaceChildren(
                                  h("p", { class: "rp-notice", "data-tone": "info" }, d.human_summary),
                                  h(
                                    "ul",
                                    { class: "rp-ops" },
                                    ...d.ops.map((o) => h("li", { class: "u-mono" }, opLine(o))),
                                  ),
                                );
                              } catch (e) {
                                diffHost.replaceChildren(
                                  h(
                                    "p",
                                    { class: "rp-form__error" },
                                    toErrorInfo(e).message ?? "Could not compare.",
                                  ),
                                );
                              }
                            },
                          })
                        : null,
                    ),
                  ),
                ),
              )
            : emptyState({
                icon: "history",
                title: "No history",
                body: "Revisions are recorded as the programme changes.",
              }),
          diffHost,
        );
      } catch (e) {
        if (!ok() || !alive) return;
        stage.error(e, () => paintHistory());
      }
    }

    function paint() {
      if (!st.node) return;
      if (st.view === "history") paintHistory();
      else paintForm();
    }

    // ---- realtime ----
    const refresh = debounce(() => {
      st.pending = null;
      load({ silent: true });
    }, 500);
    const offs = [
      rt.on("approval.decided", () => refresh()),
      rt.onChange(
        (c) => String(c.node).includes("/Program/"),
        () => refresh(),
      ),
    ];

    load({ first: true });
    return () => {
      alive = false;
      refresh.cancel();
      for (const off of offs) off();
    };
  },
};
