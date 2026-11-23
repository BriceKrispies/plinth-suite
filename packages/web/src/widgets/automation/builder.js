// automation.builder: trigger (event, schedule or metric), conditions, steps, dry run, run now and enable, with
// history. Drafts are saved through the kernel node API; enable goes through automation.set_enabled.
import { schemaOf } from "../../core/widgets.js";
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { card } from "../../ds/js/card.js";
import { textField, textArea, numberField, selectField, switchField, formErrors } from "../../ds/js/field.js";
import { ruleBuilder, stepList } from "../../ds/js/builder.js";
import { pill } from "../../ds/js/pill.js";
import { tabs } from "../../ds/js/tabs.js";
import { emptyState, skeleton, errorState } from "../../ds/js/states.js";
import { statusPill } from "../../ds/js/pill.js";
import { icon } from "../../ds/js/icons.js";
import { number } from "../../ds/js/format.js";
import {
  lifecycle,
  clone,
  same,
  slugify,
  SLUG_RE,
  userSubject,
  readNode,
  listNodes,
  saveNode,
  historyList,
  banner,
  staleBanner,
  isStale,
  failToast,
  enumLabel,
  toErrorInfo,
  jsonBlock,
  nowIso,
  when,
  rel,
  csv,
  invalid,
} from "../promotions/_kit.js";
import { STEP_META, STEP_ORDER, CRON_PRESETS, describeCron, stepIcon, errorLine } from "./_auto.js";

const TARGET_RE =
  /^(\$member|\$actor|\$owner|(user|agent|service):[a-z0-9][a-z0-9._-]*|group:[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*)$/;
const SUBJECT_RE = /^(user|agent|service):[a-z0-9][a-z0-9._-]*$/;
const STEP_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const LINK_RE = /^\/[A-Za-z0-9/_.:?=&%{}-]*$/;

const defaultStep = (type, id) => {
  const base = { id, on_error: "stop", type };
  switch (type) {
    case "award_points":
      return { ...base, to: "$member", points: 50, memo: "" };
    case "notify":
      return { ...base, to: ["$member"], notification_type: "system", title: "", body: "" };
    case "send_message":
      return { ...base, to: ["$member"], subject: "", body: "" };
    case "apply_promotion":
      return { ...base, promotion: "", to: "$member", expires_in_days: 30 };
    case "create_task":
      return { ...base, title: "", assignee: "$owner", priority: "normal" };
    default:
      return { ...base, type: "webhook", target_label: "", payload: {} };
  }
};

const sampleValue = (f) => {
  switch (f.type) {
    case "int":
      return 1;
    case "float":
      return 1.5;
    case "bool":
      return true;
    case "timestamp":
      return nowIso();
    case "enum":
      return f.values?.[0] ?? "";
    case "string[]":
      return [];
    default:
      return "sample";
  }
};

const setPath = (obj, path, value) => {
  const parts = path.split(".");
  let cur = obj;
  parts.slice(0, -1).forEach((k) => {
    cur[k] = cur[k] && typeof cur[k] === "object" ? cur[k] : {};
    cur = cur[k];
  });
  cur[parts[parts.length - 1]] = value;
};

export default {
  id: "automation.builder",
  domain: "automation",
  title: "Automation builder",
  configSchema: schemaOf("automation.builder"),
  sizes: ["xl", "full"],
  mount(el, { config, size, api, rt, bus, nav, ctx }) {
    const life = lifecycle();
    const root = h("div", { class: `wa wa-builder wa-builder--${size}` });
    el.append(root);

    let current = typeof config.automation === "string" ? config.automation : null;
    let model = null;
    let catalog = { member_facts: [], events: [], step_types: [], notification_types: [], sources: [] };
    let promotions = [];
    let slugTouched = false;
    let saving = false;
    let saveBtn = null;
    let latestRun = null;
    let external = null;
    const sample = { text: "", member: ctx.memberHandle("$me") ?? "", seq: null, result: null, busy: false };
    const dirtyMark = h("span", { hidden: true }, pill({ label: "Unsaved changes", tone: "warning" }));
    const problems = h("div", { class: "wa-builder__problems", "aria-live": "polite" });

    const strip = (d) => JSON.parse(JSON.stringify(d, (k, v) => (k.startsWith("_") ? undefined : v)));
    const dirty = () => model && !same(strip(model.draft), strip(model.base));
    const touch = () => {
      dirtyMark.hidden = !dirty();
      refreshProblems();
    };

    // ---------- facts for the rule builders ----------
    const eventDef = () => catalog.events.find((e) => e.type === model.draft.spec.trigger.event);
    const factsFor = () => {
      const t = model.draft.spec.trigger;
      if (t.type !== "event")
        return [
          { path: "now", label: "Now (UTC)", type: "timestamp", ops: ["lt", "lte", "gt", "gte", "between"] },
        ];
      const ev = eventDef();
      const own = (ev?.fields ?? []).map((f) => ({
        ...f,
        path: f.path.startsWith("event.") ? f.path : `event.${f.path}`,
      }));
      const mem =
        ev?.has_member === false
          ? []
          : (catalog.member_facts ?? []).map((f) => ({
              ...f,
              path: f.path.startsWith("member.") ? f.path : `member.${f.path}`,
              label: `Member: ${String(f.label).toLowerCase()}`,
            }));
      return [...own, ...mem];
    };

    // ---------- load ----------
    const blankSpec = () => ({
      enabled: false,
      description: "",
      trigger: { type: "event", event: catalog.events[0]?.type ?? "points.posted" },
      steps: [],
      limits: {},
      owner: userSubject(ctx),
    });

    let seq = 0;
    const load = async () => {
      const mine = ++seq;
      root.replaceChildren(skeleton({ shape: "card", lines: 4 }));
      try {
        const [existing, cat, promos] = await Promise.all([
          current ? readNode(api, `automation:${current}`) : null,
          api.call("catalog.get", {}),
          listNodes(api, "Promotion").catch(() => []),
        ]);
        if (life.dead || mine !== seq) return;
        catalog = cat;
        promotions = promos;
        const draft = existing
          ? { title: existing.title, slug: existing.slug, spec: clone(existing.spec) }
          : { title: "", slug: "", spec: blankSpec() };
        model = { existing, draft, base: clone(draft) };
        slugTouched = Boolean(existing);
        external = null;
        sample.result = null;
        sample.text = "";
        ctx.setTitle(existing ? `Automation: ${existing.title}` : "New automation");
        build();
      } catch (e) {
        if (life.dead || mine !== seq) return;
        root.replaceChildren(errorState({ error: e, retry: load }));
      }
    };

    // ---------- validation ----------
    const validate = () => {
      const { draft } = model;
      const s = draft.spec;
      const t = s.trigger;
      const errs = [];
      const add = (tab, path, message) => errs.push({ tab, path, message });
      if (!draft.title.trim()) add("trigger", "/metadata/title", "Give the automation a title");
      if (!model.existing && !SLUG_RE.test(draft.slug))
        add("trigger", "/metadata/slug", "Use a lowercase slug such as welcome-new-members");
      if (s.description.length > 500)
        add("trigger", "/spec/description", "Keep the description under 500 characters");
      if (t.type === "schedule" && !/^(\S+\s+){4}\S+$/.test((t.cron ?? "").trim()))
        add("trigger", "/spec/trigger/cron", "A cron has five fields: minute hour day month weekday");
      if (t.type === "metric") {
        if (t._queryError || !t.query) add("trigger", "/spec/trigger/query", t._queryError ?? "Add a query");
        if (!t.value_column) add("trigger", "/spec/trigger/value_column", "Name the column to compare");
        if (typeof t.threshold !== "number" || Number.isNaN(t.threshold))
          add("trigger", "/spec/trigger/threshold", "Set a threshold");
      }
      if (s.steps.length === 0) add("steps", "/spec/steps", "Add at least one step");
      const ids = new Set();
      s.steps.forEach((st, i) => {
        const p = `/spec/steps/${i}`;
        if (!STEP_ID_RE.test(st.id)) add("steps", `${p}/id`, `Step ${i + 1}: use a short lowercase id`);
        else if (ids.has(st.id)) add("steps", `${p}/id`, `Step ${i + 1}: the id ${st.id} is used twice`);
        ids.add(st.id);
        const targets = (v) =>
          Array.isArray(v) && v.length > 0 && v.length <= 20 && v.every((x) => TARGET_RE.test(x));
        switch (st.type) {
          case "award_points":
            if (!(Number.isInteger(st.points) && st.points > 0))
              add("steps", `${p}/points`, `Step ${i + 1}: points must be a whole number above 0`);
            if (!(st.to === "$member" || st.to === "$actor" || SUBJECT_RE.test(st.to)))
              add("steps", `${p}/to`, `Step ${i + 1}: choose who receives the points`);
            break;
          case "notify":
            if (!targets(st.to))
              add(
                "steps",
                `${p}/to`,
                `Step ${i + 1}: recipients are $member, $actor, $owner, user:handle or group:slug`,
              );
            if (!st.title.trim()) add("steps", `${p}/title`, `Step ${i + 1}: add a title`);
            if (st.link && !LINK_RE.test(st.link))
              add("steps", `${p}/link`, `Step ${i + 1}: a link is an app route such as /points`);
            break;
          case "send_message":
            if (!targets(st.to))
              add(
                "steps",
                `${p}/to`,
                `Step ${i + 1}: recipients are $member, $actor, $owner, user:handle or group:slug`,
              );
            if (!st.subject.trim()) add("steps", `${p}/subject`, `Step ${i + 1}: add a subject`);
            if (!st.body.trim()) add("steps", `${p}/body`, `Step ${i + 1}: add a message`);
            break;
          case "apply_promotion":
            if (!st.promotion) add("steps", `${p}/promotion`, `Step ${i + 1}: choose a promotion`);
            if (!(st.expires_in_days >= 1 && st.expires_in_days <= 365))
              add("steps", `${p}/expires_in_days`, `Step ${i + 1}: expiry is 1 to 365 days`);
            break;
          case "create_task":
            if (!st.title.trim()) add("steps", `${p}/title`, `Step ${i + 1}: add a task title`);
            if (!(st.assignee === "$owner" || st.assignee === "$member" || SUBJECT_RE.test(st.assignee)))
              add("steps", `${p}/assignee`, `Step ${i + 1}: assign to $owner, $member or user:handle`);
            break;
          case "webhook":
            if (!/^[a-z][a-z0-9-]{1,40}$/.test(st.target_label ?? ""))
              add("steps", `${p}/target_label`, `Step ${i + 1}: use a lowercase label such as crm-hook`);
            break;
          default:
        }
      });
      for (const k of ["max_runs_per_member_per_day", "cooldown_minutes"])
        if (s.limits[k] !== undefined && !(Number.isInteger(s.limits[k]) && s.limits[k] > 0))
          add("conditions", `/spec/limits/${k}`, "Limits are whole numbers above 0");
      return errs;
    };

    const cleanSpec = () => {
      const s = clone(model.draft.spec);
      if (s.trigger.type === "event" && !s.trigger.filter) delete s.trigger.filter;
      if (s.trigger.type !== "metric") {
        delete s.trigger.query;
      }
      delete s.trigger._queryText;
      delete s.trigger._queryError;
      if (!s.conditions) delete s.conditions;
      for (const k of Object.keys(s.limits))
        if (s.limits[k] === undefined || s.limits[k] === null) delete s.limits[k];
      s.steps = s.steps.map((st) => {
        const c = { ...st };
        if (!c.when) delete c.when;
        if (c.type === "notify" && !c.link) delete c.link;
        if (c.type === "create_task") {
          if (!c.description) delete c.description;
          if (c.due_in_days === undefined || c.due_in_days === null) delete c.due_in_days;
        }
        return c;
      });
      return s;
    };

    function refreshProblems() {
      if (!model) return;
      const errs = validate();
      problems.replaceChildren(
        errs.length
          ? h(
              "div",
              { class: "wa-builder__problems-box" },
              h(
                "p",
                {},
                icon("alert", { size: 16 }),
                ` ${errs.length} thing${errs.length === 1 ? "" : "s"} to fix before saving`,
              ),
              h(
                "ul",
                {},
                ...errs.slice(0, 4).map((e) => h("li", {}, e.message)),
                errs.length > 4 ? h("li", {}, `and ${errs.length - 4} more`) : null,
              ),
            )
          : h("p", { class: "wp-builder__ok" }, icon("check-circle", { size: 16 }), " Ready to save"),
      );
    }

    // ---------- save, enable, run now ----------
    const save = async () => {
      if (saving || !model) return;
      formErrors(null, { form: root });
      const errs = validate();
      refreshProblems();
      if (errs.length) {
        const summary = formErrors(
          { code: "VALIDATION_FAILED", path: errs[0].path, message: errs[0].message },
          { form: root },
        );
        const list = summary?.querySelector("ul");
        if (list) for (const x of errs.slice(1)) list.append(h("li", {}, x.message));
        summary?.focus?.();
        return;
      }
      saving = true;
      saveBtn?.setAttribute("aria-busy", "true");
      try {
        const out = await saveNode(api, {
          kind: "Automation",
          slug: model.draft.slug,
          title: model.draft.title.trim(),
          spec: cleanSpec(),
          existing: model.existing,
          skip: ["enabled"],
          prefix: "automation-save",
        });
        if (life.dead) return;
        if (out.status === "pending_approval")
          ctx.toast({
            title: "Sent for approval",
            body: "A rule holds this change until an approver accepts it.",
            tone: "info",
          });
        else if (out.status === "unchanged") ctx.toast({ title: "Nothing to save", tone: "neutral" });
        else ctx.toast({ title: "Automation saved", body: model.draft.title, tone: "success" });
        ctx.announce("Saved");
        if (!model.existing) {
          nav.go(`/automations/${model.draft.slug}`);
          return;
        }
        await load();
      } catch (e) {
        if (life.dead) return;
        if (isStale(e)) root.prepend(staleBanner(() => load()));
        else {
          formErrors(toErrorInfo(e), { form: root });
          failToast(ctx, e, "Could not save the automation");
        }
      } finally {
        saving = false;
        saveBtn?.removeAttribute("aria-busy");
      }
    };

    const toggleEnabled = async () => {
      const { existing } = model;
      if (!existing) return;
      if (dirty()) return ctx.toast({ title: "Save or discard your edits first", tone: "warning" });
      const enabled = !existing.spec.enabled;
      if (
        enabled &&
        !(await ctx.confirm({
          title: `Enable ${existing.title}?`,
          message:
            "It will start running on its trigger, with real effects such as points, messages and tasks.",
          confirmLabel: "Enable",
        }))
      )
        return;
      try {
        const out = await api.call("automation.set_enabled", {
          slug: existing.slug,
          enabled,
          base_revision: existing.revision,
        });
        if (life.dead) return;
        if (out.status === "pending_approval")
          ctx.toast({
            title: "Sent for approval",
            body: `${existing.title} will ${enabled ? "turn on" : "turn off"} once an approver accepts it.`,
            tone: "info",
          });
        else
          ctx.toast({
            title: enabled ? "Automation enabled" : "Automation disabled",
            body: existing.title,
            tone: "success",
          });
        load();
      } catch (e) {
        failToast(ctx, e, "Could not change the automation");
      }
    };

    const sampleEvent = () => {
      const t = model.draft.spec.trigger;
      if (t.type !== "event") return undefined;
      let payload = {};
      try {
        payload = sample.text.trim() ? JSON.parse(sample.text) : defaultPayload();
      } catch {
        throw invalid("/sample", "The sample event is not valid JSON");
      }
      return { type: t.event, payload, ...(sample.member ? { member: sample.member } : {}) };
    };

    const defaultPayload = () => {
      const payload = {};
      for (const f of eventDef()?.fields ?? [])
        setPath(payload, f.path.replace(/^event\./, ""), sampleValue(f));
      return payload;
    };

    const runNow = async () => {
      const { existing } = model;
      if (!existing) return ctx.toast({ title: "Save the automation first", tone: "warning" });
      if (dirty()) return ctx.toast({ title: "Save your edits before running", tone: "warning" });
      let event;
      try {
        event = sampleEvent();
      } catch (e) {
        return ctx.toast({ title: e.message, tone: "danger" });
      }
      const ok = await ctx.confirm({
        title: `Run ${existing.title} now?`,
        message: "This is a real run with real effects, even while the automation is disabled.",
        confirmLabel: "Run now",
      });
      if (!ok) return;
      try {
        const out = await api.call("automation.trigger", {
          slug: existing.slug,
          ...(event ? { event } : {}),
          idempotency_key: api.idempotencyKey("run-now"),
        });
        if (life.dead) return;
        latestRun = out;
        bus.publish("run.selected", { id: out.run_id });
        ctx.toast({
          title: "Run started",
          body: `Run ${out.status}. Open it in the run history.`,
          tone: "success",
        });
        ctx.announce("Run started");
        paintRunChip();
      } catch (e) {
        failToast(ctx, e, "Could not start the run");
      }
    };

    // ---------- small field helpers ----------
    const tf = (name, label, obj, key, opts = {}) =>
      textField({
        name,
        label,
        value: obj[key] ?? "",
        hint: opts.hint,
        required: opts.required,
        placeholder: opts.placeholder,
        onInput: (v) => {
          obj[key] = opts.map ? opts.map(v) : v;
          touch();
        },
      });
    const nf = (name, label, obj, key, opts = {}) =>
      numberField({
        name,
        label,
        value: obj[key],
        min: opts.min,
        max: opts.max,
        step: opts.step ?? 1,
        hint: opts.hint,
        required: opts.required,
        onInput: (v) => {
          if (v === null) delete obj[key];
          else obj[key] = v;
          touch();
        },
      });
    const sf = (name, label, obj, key, options, opts = {}) =>
      selectField({
        name,
        label,
        value: obj[key],
        options,
        hint: opts.hint,
        onChange: (v) => {
          obj[key] = v;
          touch();
          opts.after?.(v);
        },
      });

    const conditionBlock = (label, obj, key, hint) => {
      const host = h("div", { class: "wa-builder__rule" });
      let on = Boolean(obj[key]);
      const draw = () => {
        host.replaceChildren();
        if (!on) return;
        const facts = factsFor();
        host.append(
          ruleBuilder({
            label,
            facts,
            value: obj[key],
            onChange: (tree) => {
              obj[key] = tree;
              touch();
            },
          }),
        );
      };
      draw();
      return h(
        "div",
        { class: "wk-stack" },
        switchField({
          name: `/${key}`,
          label: hint,
          value: on,
          onChange: (v) => {
            on = v;
            if (!v) delete obj[key];
            touch();
            draw();
          },
        }),
        host,
      );
    };

    // ---------- trigger panel ----------
    const triggerPanel = () => {
      const { draft, existing } = model;
      const s = draft.spec;
      const t = s.trigger;
      const detail = h("div", { class: "wk-stack" });
      const slugField = textField({
        name: "/metadata/slug",
        label: "Slug",
        value: draft.slug,
        disabled: Boolean(existing),
        hint: existing ? "The slug cannot change after creation" : "Used in the address and in references",
        onInput: (v) => {
          slugTouched = true;
          draft.slug = v.trim();
          touch();
        },
      });
      const drawDetail = () => {
        detail.replaceChildren();
        if (t.type === "event") {
          const ev = eventDef();
          detail.append(
            sf(
              "/spec/trigger/event",
              "When this event happens",
              t,
              "event",
              catalog.events.map((e) => ({ value: e.type, label: e.label })),
              {
                hint: ev
                  ? `${ev.fields.length} payload field${ev.fields.length === 1 ? "" : "s"}${ev.has_member ? ", about one member" : ""}`
                  : undefined,
                after: () => {
                  delete t.filter;
                  delete s.conditions;
                  sample.text = "";
                  sample.result = null;
                  drawDetail();
                  refreshDependents();
                },
              },
            ),
            conditionBlock("Only for events matching", t, "filter", "Only when the event matches a filter"),
          );
        } else if (t.type === "schedule") {
          const desc = h("p", { class: "u-muted", "aria-live": "polite" }, describeCron(t.cron));
          const cron = textField({
            name: "/spec/trigger/cron",
            label: "Cron (UTC virtual time)",
            value: t.cron ?? "",
            required: true,
            hint: "minute hour day-of-month month day-of-week, Monday = 1",
            onInput: (v) => {
              t.cron = v;
              desc.textContent = describeCron(v);
              touch();
            },
          });
          detail.append(
            cron,
            desc,
            h(
              "div",
              { class: "wk-actions" },
              ...CRON_PRESETS.map((p) =>
                button({
                  label: p.label,
                  size: "sm",
                  onClick: () => {
                    t.cron = p.cron;
                    cron.querySelector("input").value = p.cron;
                    desc.textContent = describeCron(p.cron);
                    touch();
                  },
                }),
              ),
            ),
          );
        } else {
          if (t._queryText === undefined) t._queryText = t.query ? JSON.stringify(t.query, null, 2) : "";
          const first = catalog.sources?.[0];
          detail.append(
            banner({
              tone: "info",
              body: "Every few minutes the query runs as the owner. When the compared value holds for the set time it fires, once per rising edge.",
            }),
            textArea({
              name: "/spec/trigger/query",
              label: "Query (JSON)",
              rows: 9,
              value: t._queryText,
              hint: first
                ? `Sources: ${catalog.sources.map((x) => `source:${x.slug} (time column ${x.time_column})`).join(", ")}`
                : undefined,
              onInput: (v) => {
                t._queryText = v;
                if (!v.trim()) {
                  delete t.query;
                  t._queryError = "Add a query";
                } else {
                  try {
                    t.query = JSON.parse(v);
                    delete t._queryError;
                  } catch (e) {
                    t._queryError = `The query is not valid JSON: ${e.message}`;
                  }
                }
                touch();
              },
            }),
            ...[
              first
                ? button({
                    label: `Start from source:${first.slug}`,
                    size: "sm",
                    onClick: () => {
                      const q = {
                        from: `source:${first.slug}`,
                        where: [{ field: first.time_column, op: "gte", value: { expr: "now() - 1h" } }],
                        aggregate: { value: { fn: "count" } },
                        limit: 1,
                      };
                      t.query = q;
                      t._queryText = JSON.stringify(q, null, 2);
                      delete t._queryError;
                      t.value_column ??= "value";
                      drawDetail();
                      touch();
                    },
                  })
                : null,
            ].filter(Boolean),
            h(
              "div",
              { class: "wk-grid-3" },
              tf("/spec/trigger/value_column", "Value column", t, "value_column", {
                required: true,
                placeholder: "value",
              }),
              sf("/spec/trigger/op", "Fires when value is", t, "op", [
                { value: "gt", label: "above" },
                { value: "gte", label: "at least" },
                { value: "lt", label: "below" },
                { value: "lte", label: "at most" },
              ]),
              numberField({
                name: "/spec/trigger/threshold",
                label: "Threshold",
                value: t.threshold,
                step: "any",
                required: true,
                onInput: (v) => {
                  if (v === null) delete t.threshold;
                  else t.threshold = v;
                  touch();
                },
              }),
              nf("/spec/trigger/for_minutes", "Must hold for (minutes)", t, "for_minutes", {
                min: 0,
                max: 1440,
              }),
              nf("/spec/trigger/every_minutes", "Check every (minutes)", t, "every_minutes", {
                min: 1,
                max: 1440,
              }),
            ),
          );
        }
      };
      drawDetail();
      return h(
        "div",
        { class: "wa-builder__panel" },
        h(
          "div",
          { class: "wk-grid-2" },
          textField({
            name: "/metadata/title",
            label: "Title",
            required: true,
            value: draft.title,
            onInput: (v) => {
              draft.title = v;
              if (!slugTouched && !existing) {
                draft.slug = slugify(v);
                slugField.querySelector("input").value = draft.slug;
              }
              touch();
            },
          }),
          slugField,
        ),
        textArea({
          name: "/spec/description",
          label: "Description",
          rows: 2,
          value: s.description,
          onInput: (v) => ((s.description = v), touch()),
        }),
        card({
          title: "Trigger",
          body: h(
            "div",
            { class: "wk-stack" },
            selectField({
              name: "/spec/trigger/type",
              label: "Trigger type",
              value: t.type,
              options: [
                { value: "event", label: "An event happens" },
                { value: "schedule", label: "On a schedule" },
                { value: "metric", label: "A metric crosses a threshold" },
              ],
              onChange: (v) => {
                const next =
                  v === "event"
                    ? { type: "event", event: catalog.events[0]?.type }
                    : v === "schedule"
                      ? { type: "schedule", cron: "0 9 * * 1-5" }
                      : {
                          type: "metric",
                          op: "gt",
                          threshold: 0,
                          for_minutes: 0,
                          every_minutes: 5,
                          value_column: "value",
                        };
                s.trigger = next;
                delete s.conditions;
                for (const st of s.steps) delete st.when;
                sample.text = "";
                sample.result = null;
                touch();
                // rebuild the panels that read the trigger so none keeps a stale reference
                swapPanel("trigger");
                refreshDependents();
              },
            }),
            detail,
          ),
        }),
      );
    };

    // ---------- conditions panel ----------
    const conditionsPanel = () => {
      const s = model.draft.spec;
      return h(
        "div",
        { class: "wa-builder__panel" },
        banner({
          tone: "info",
          body: "Conditions are checked after a run is created; if they fail the run is skipped. Limits skip a run too.",
        }),
        card({
          title: "Conditions",
          body: conditionBlock("Run conditions", s, "conditions", "Only continue when conditions are met"),
        }),
        card({
          title: "Limits",
          body: h(
            "div",
            { class: "wk-grid-2" },
            nf(
              "/spec/limits/max_runs_per_member_per_day",
              "Max runs per member per day",
              s.limits,
              "max_runs_per_member_per_day",
              { min: 1, max: 100, hint: "Leave empty for no limit" },
            ),
            nf(
              "/spec/limits/cooldown_minutes",
              "Cooldown per member (minutes)",
              s.limits,
              "cooldown_minutes",
              { min: 1, max: 10080, hint: "Since the last successful run" },
            ),
          ),
        }),
      );
    };

    // ---------- steps panel ----------
    const stepForm = (st, i, redraw) => {
      const p = `/spec/steps/${i}`;
      const targets = (key, label) =>
        textField({
          name: `${p}/${key}`,
          label,
          value: Array.isArray(st[key]) ? st[key].join(", ") : "",
          hint: "Comma separated: $member, $actor, $owner, user:handle, group:slug",
          onInput: (v) => {
            st[key] = csv(v);
            touch();
          },
        });
      const common = [
        h(
          "div",
          { class: "wk-grid-2" },
          tf(`${p}/id`, "Step id", st, "id", { hint: "Lowercase letters, digits and dashes" }),
          sf(`${p}/on_error`, "If this step fails", st, "on_error", [
            { value: "stop", label: "Stop the run" },
            { value: "continue", label: "Carry on with later steps" },
          ]),
        ),
      ];
      let fields;
      switch (st.type) {
        case "award_points":
          fields = [
            h(
              "div",
              { class: "wk-grid-2" },
              textField({
                name: `${p}/to`,
                label: "Award to",
                value: st.to,
                hint: "$member, $actor or user:handle",
                onInput: (v) => ((st.to = v.trim()), touch()),
              }),
              nf(`${p}/points`, "Points", st, "points", { min: 1, required: true }),
            ),
            tf(`${p}/memo`, "Memo", st, "memo", {
              hint: "Shown in the ledger. Templates like {{event.reason}} work.",
            }),
          ];
          break;
        case "notify":
          fields = [
            targets("to", "Notify"),
            h(
              "div",
              { class: "wk-grid-2" },
              sf(
                `${p}/notification_type`,
                "Notification type",
                st,
                "notification_type",
                (catalog.notification_types.length
                  ? catalog.notification_types
                  : [{ type: "system", label: "System" }]
                ).map((n) => ({ value: n.type, label: n.label })),
              ),
              tf(`${p}/link`, "Link (optional)", st, "link", { placeholder: "/points" }),
            ),
            tf(`${p}/title`, "Title", st, "title", { required: true }),
            textArea({
              name: `${p}/body`,
              label: "Body",
              rows: 3,
              value: st.body,
              onInput: (v) => ((st.body = v), touch()),
            }),
          ];
          break;
        case "send_message":
          fields = [
            targets("to", "Send to"),
            tf(`${p}/subject`, "Subject", st, "subject", { required: true }),
            textArea({
              name: `${p}/body`,
              label: "Message",
              rows: 4,
              value: st.body,
              required: true,
              onInput: (v) => ((st.body = v), touch()),
            }),
          ];
          break;
        case "apply_promotion":
          fields = [
            h(
              "div",
              { class: "wk-grid-3" },
              selectField({
                name: `${p}/promotion`,
                label: "Promotion",
                value: st.promotion ? st.promotion.split(":")[1] : "",
                options: [
                  { value: "", label: "Choose a promotion" },
                  ...promotions.map((x) => ({ value: x.slug, label: x.title })),
                ],
                onChange: (v) => ((st.promotion = v ? `promotion:${v}` : ""), touch()),
              }),
              sf(`${p}/to`, "Grant to", st, "to", [
                { value: "$member", label: "The event's member" },
                { value: "$actor", label: "The actor" },
              ]),
              nf(`${p}/expires_in_days`, "Expires after (days)", st, "expires_in_days", { min: 1, max: 365 }),
            ),
          ];
          break;
        case "create_task":
          fields = [
            tf(`${p}/title`, "Task title", st, "title", { required: true }),
            textArea({
              name: `${p}/description`,
              label: "Description (optional)",
              rows: 3,
              value: st.description ?? "",
              onInput: (v) => ((st.description = v), touch()),
            }),
            h(
              "div",
              { class: "wk-grid-3" },
              textField({
                name: `${p}/assignee`,
                label: "Assignee",
                value: st.assignee,
                hint: "$owner, $member or user:handle",
                onInput: (v) => ((st.assignee = v.trim()), touch()),
              }),
              sf(
                `${p}/priority`,
                "Priority",
                st,
                "priority",
                ["low", "normal", "high", "urgent"].map((x) => ({ value: x, label: enumLabel(x) })),
              ),
              nf(`${p}/due_in_days`, "Due in (days)", st, "due_in_days", { min: 0, max: 90 }),
            ),
          ];
          break;
        default:
          fields = [
            tf(`${p}/target_label`, "Target label", st, "target_label", {
              hint: "Recorded with the delivery. Webhooks are recorded, never sent.",
              required: true,
            }),
            textArea({
              name: `${p}/payload`,
              label: "Payload (one key=value per line)",
              rows: 4,
              value: Object.entries(st.payload ?? {})
                .map(([k, v]) => `${k}=${v}`)
                .join("\n"),
              hint: "Webhook steps are held for approval when the automation is saved.",
              onInput: (v) => {
                st.payload = Object.fromEntries(
                  v
                    .split("\n")
                    .map((l) => l.split("="))
                    .filter(([k]) => k && k.trim())
                    .map(([k, ...rest]) => [k.trim(), rest.join("=").trim()]),
                );
                touch();
              },
            }),
          ];
      }
      const whenOn = Boolean(st.when);
      const whenHost = h("div", { class: "wa-builder__rule" });
      const drawWhen = (on) => {
        whenHost.replaceChildren();
        if (on)
          whenHost.append(
            ruleBuilder({
              label: `Step ${i + 1} condition`,
              facts: factsFor(),
              value: st.when,
              onChange: (tree) => ((st.when = tree), touch()),
            }),
          );
      };
      drawWhen(whenOn);
      return h(
        "div",
        { class: "wa-step-form" },
        h(
          "p",
          { class: "wa-step-form__type" },
          stepIcon(st.type),
          ` ${STEP_META[st.type]?.label ?? st.type}`,
          h(
            "span",
            { class: "u-muted" },
            ` needs ${STEP_META[st.type]?.permission ?? "permission"} from the owner`,
          ),
        ),
        ...common,
        ...fields,
        switchField({
          name: `${p}/when`,
          label: "Only run this step when a condition holds",
          value: whenOn,
          onChange: (v) => {
            if (!v) delete st.when;
            touch();
            drawWhen(v);
          },
        }),
        whenHost,
      );
    };

    const stepsPanel = () => {
      const s = model.draft.spec;
      const host = h("div", { class: "wa-builder__panel" });
      let focusIndex = null;
      const draw = () => {
        const vars = [
          ...(model.draft.spec.trigger.type === "event"
            ? (eventDef()?.fields ?? [])
                .slice(0, 8)
                .map((f) => `{{${f.path.startsWith("event.") ? f.path : `event.${f.path}`}}}`)
            : []),
          "{{member.handle}}",
          "{{run.id}}",
          "{{now}}",
        ];
        const list = stepList({
          label: "Automation steps",
          items: s.steps,
          max: 10,
          addLabel: "Add a step",
          renderItem: (st, i) => stepForm(st, i, draw),
          onAdd: () => openAddStep(),
          onRemove: (i) => {
            s.steps.splice(i, 1);
            ctx.announce(`Step removed, ${s.steps.length} left`);
            touch();
            draw();
          },
          onMove: (from, to) => {
            const [m] = s.steps.splice(from, 1);
            s.steps.splice(to, 0, m);
            focusIndex = to;
            touch();
            draw();
          },
        });
        host.replaceChildren(
          banner({
            tone: "info",
            body: "Steps run in order as the automation, within the owner's permissions. Each step's writes are idempotent, so a retry never duplicates an effect.",
          }),
          ...[
            s.steps.length === 0
              ? emptyState({
                  icon: "workflow",
                  title: "No steps yet",
                  body: "Add what should happen when the automation runs.",
                })
              : null,
          ].filter(Boolean),
          list,
          h(
            "details",
            { class: "wk-json" },
            h("summary", {}, "Template variables"),
            h(
              "div",
              { class: "wk-actions wa-vars" },
              ...vars.map((v) =>
                button({
                  label: v,
                  size: "sm",
                  variant: "ghost",
                  onClick: async () => {
                    try {
                      await navigator.clipboard.writeText(v);
                      ctx.toast({ title: "Copied", body: v, tone: "neutral", timeout: 2000 });
                    } catch {
                      ctx.toast({ title: v, body: "Select and copy this variable.", tone: "neutral" });
                    }
                  },
                }),
              ),
            ),
          ),
        );
        if (focusIndex !== null) {
          const n = focusIndex;
          focusIndex = null;
          queueMicrotask(() => host.querySelectorAll(".c-step")[n]?.focus());
        }
      };
      const openAddStep = () => {
        const list = h(
          "ul",
          { class: "wa-addstep", role: "list" },
          ...STEP_ORDER.map((type) =>
            h(
              "li",
              {},
              h(
                "button",
                {
                  type: "button",
                  class: "wa-addstep__btn",
                  onclick: () => {
                    let n = s.steps.length + 1;
                    const base = type.replace(/_/g, "-");
                    while (s.steps.some((x) => x.id === `${base}-${n}`)) n += 1;
                    s.steps.push(defaultStep(type, `${base}-${n}`));
                    drawerRef.close();
                    touch();
                    draw();
                    ctx.announce(`${STEP_META[type].label} step added`);
                    queueMicrotask(() => host.querySelectorAll(".c-step")[s.steps.length - 1]?.focus());
                  },
                },
                h("span", { class: "wa-addstep__icon" }, stepIcon(type)),
                h(
                  "span",
                  {},
                  h("strong", {}, STEP_META[type].label),
                  h("span", { class: "u-muted" }, ` ${STEP_META[type].permission}`),
                ),
              ),
            ),
          ),
        );
        const body = h("div", { "data-widget-domain": "automation" }, list);
        const drawerRef = ctx.openDrawer({ title: "Add a step", width: "sm", body });
      };
      draw();
      return host;
    };

    // ---------- dry run panel ----------
    const dryPanel = () => {
      const t = model.draft.spec.trigger;
      const out = h("div", { class: "wa-builder__dry", "aria-live": "polite" });
      const paintResult = () => {
        out.replaceChildren();
        const r = sample.result;
        if (sample.busy) return out.append(h("p", { class: "u-muted" }, "Running a dry run"));
        if (!r)
          return out.append(
            emptyState({
              icon: "play",
              title: "No dry run yet",
              body: "A dry run checks the trigger, conditions, limits and every step without changing anything.",
            }),
          );
        const verdict = (ok, yes, no) =>
          pill({
            label: ok ? yes : no,
            tone: ok ? "success" : "warning",
            icon: ok ? "check-circle" : "alert",
          });
        out.append(
          h(
            "div",
            { class: "wp-quick__top" },
            verdict(r.trigger_matched, "Trigger matched", "Trigger did not match"),
            verdict(r.conditions_passed, "Conditions passed", "Conditions failed"),
            verdict(r.limits_ok, "Within limits", "Over limits"),
          ),
          ...[
            r.next_fires?.length
              ? h(
                  "div",
                  {},
                  h("h4", { class: "wk-caps" }, "Next fires (UTC)"),
                  h(
                    "ul",
                    { class: "wa-fires" },
                    ...r.next_fires.map((f) => h("li", {}, `${when(f)} · ${rel(f)}`)),
                  ),
                )
              : null,
          ].filter(Boolean),
          h("h4", { class: "wk-caps" }, "Steps"),
          h(
            "ol",
            { class: "wa-steps" },
            ...r.steps.map((s) =>
              h(
                "li",
                { class: `wa-step wa-step--${s.would_run ? "succeeded" : s.error ? "failed" : "skipped"}` },
                h(
                  "div",
                  { class: "wa-step__head" },
                  h("span", { class: "wa-step__icon" }, stepIcon(s.type)),
                  h("strong", {}, `${s.index + 1}. ${STEP_META[s.type]?.label ?? s.type}`),
                  h("code", { class: "u-muted" }, s.id),
                  s.would_run
                    ? pill({ label: "Would run", tone: "success" })
                    : pill({
                        label: `Skipped${s.skipped_reason ? `: ${enumLabel(s.skipped_reason)}` : ""}`,
                        tone: "neutral",
                      }),
                ),
                s.effect ? h("p", {}, s.effect) : null,
                s.error
                  ? h("p", { class: "wa-step__error" }, icon("alert", { size: 16 }), " ", errorLine(s.error))
                  : null,
                s.input !== undefined && s.input !== null
                  ? jsonBlock(s.input, "Input after templates")
                  : null,
              ),
            ),
          ),
          jsonBlock(r.context, "Context the run would see"),
        );
      };
      const run = async () => {
        const errs = validate();
        if (errs.length) {
          ctx.toast({ title: "Fix the problems first", body: errs[0].message, tone: "warning" });
          return;
        }
        let event;
        try {
          event = sampleEvent();
        } catch (e) {
          formErrors(toErrorInfo(e), { form: out.parentElement });
          return;
        }
        sample.busy = true;
        paintResult();
        try {
          sample.result = await api.call("automation.dry_run", {
            automation: {
              slug: model.draft.slug || "draft-preview",
              title: model.draft.title || "Draft",
              spec: cleanSpec(),
            },
            ...(event ? { event } : {}),
            ...(sample.seq ? { event_seq: sample.seq } : {}),
          });
          ctx.announce("Dry run finished");
        } catch (e) {
          sample.result = null;
          out.replaceChildren(
            banner({ tone: "danger", title: "The dry run failed.", body: e.message, role: "alert" }),
          );
          sample.busy = false;
          return;
        }
        sample.busy = false;
        if (!life.dead) paintResult();
      };
      const wrap = h("div", { class: "wa-builder__panel" });
      if (t.type === "event") {
        if (!sample.text) sample.text = JSON.stringify(defaultPayload(), null, 2);
        wrap.append(
          banner({
            tone: "info",
            body: "Edit the sample event, or replay a recorded event by its sequence number. Nothing is written.",
          }),
          h(
            "div",
            { class: "wk-grid-2" },
            textField({
              name: "member",
              label: "Event member (handle)",
              value: sample.member,
              onInput: (v) => (sample.member = v.trim()),
            }),
            numberField({
              name: "event_seq",
              label: "Or replay recorded event (seq)",
              value: sample.seq ?? undefined,
              min: 1,
              step: 1,
              onInput: (v) => (sample.seq = v),
            }),
          ),
          textArea({
            name: "/sample",
            label: "Sample event payload (JSON)",
            rows: 8,
            value: sample.text,
            onInput: (v) => (sample.text = v),
          }),
        );
      } else
        wrap.append(
          banner({
            tone: "info",
            body:
              t.type === "schedule"
                ? "A dry run lists the next five fire times and what each step would do."
                : "A dry run shows what the steps would do for the current context.",
          }),
        );
      wrap.append(
        h(
          "div",
          { class: "wk-actions" },
          button({ label: "Run dry run", icon: "play", variant: "primary", onClick: run }),
        ),
        out,
      );
      paintResult();
      return wrap;
    };

    // ---------- history panel ----------
    const historyPanel = () => {
      const host = h("div", { class: "wa-builder__panel" });
      if (!model.existing) {
        host.append(
          emptyState({
            icon: "history",
            title: "No history yet",
            body: "History appears after the first save.",
          }),
        );
        return host;
      }
      host.append(skeleton({ shape: "text", lines: 4 }));
      api.nodes
        .history({ uri: model.existing.uri, limit: 30 })
        .then((rows) => !life.dead && host.replaceChildren(historyList(rows, "Automation history")))
        .catch((e) => !life.dead && host.replaceChildren(errorState({ error: e })));
      return host;
    };

    // ---------- chrome ----------
    const tabHosts = {};
    const swapPanel = (id) => {
      const host = tabHosts[id];
      if (!host) return;
      host.replaceChildren(PANELS[id]());
    };
    const refreshDependents = () => {
      for (const id of ["conditions", "steps", "dry-run"]) swapPanel(id);
    };
    const PANELS = {
      trigger: triggerPanel,
      conditions: conditionsPanel,
      steps: stepsPanel,
      "dry-run": dryPanel,
      history: historyPanel,
    };
    const lazy = (id) => () => {
      const host = h("div", { class: "wa-panel-host" });
      tabHosts[id] = host;
      host.append(PANELS[id]());
      return host;
    };

    const runChip = h("span", { class: "wa-builder__lastrun" });
    function paintRunChip() {
      runChip.replaceChildren();
      const r = latestRun;
      if (!r) return;
      runChip.append(
        statusPill("run", r.status),
        button({
          label: "Open run",
          size: "sm",
          variant: "ghost",
          icon: "external",
          onClick: () => bus.publish("run.selected", { id: r.run_id }),
        }),
      );
    }

    function build() {
      const { existing, draft } = model;
      Object.keys(tabHosts).forEach((k) => delete tabHosts[k]);
      saveBtn = button({
        label: existing ? "Save changes" : "Create automation",
        icon: "check",
        variant: "primary",
        onClick: save,
      });
      const tabset = tabs({
        label: "Automation sections",
        items: [
          { id: "trigger", label: "Trigger", panel: lazy("trigger") },
          { id: "conditions", label: "Conditions", panel: lazy("conditions") },
          { id: "steps", label: "Steps", panel: lazy("steps") },
          { id: "dry-run", label: "Dry run", panel: lazy("dry-run") },
          { id: "history", label: "History", panel: lazy("history") },
        ],
        selected: "trigger",
      });
      const enabled = existing?.spec.enabled;
      root.replaceChildren(
        h(
          "div",
          { class: "wa-builder__bar" },
          h(
            "div",
            { class: "wp-builder__status" },
            existing
              ? enabled
                ? pill({ label: "Enabled", tone: "success", icon: "check-circle" })
                : pill({ label: "Disabled", tone: "neutral" })
              : pill({ label: "New", tone: "info" }),
            existing ? h("span", { class: "u-muted" }, `Revision ${existing.revision}`) : null,
            dirtyMark,
            runChip,
          ),
          h(
            "div",
            { class: "wk-actions" },
            button({
              label: "Discard edits",
              variant: "ghost",
              onClick: async () => {
                if (
                  !dirty() ||
                  (await ctx.confirm({
                    title: "Discard your edits?",
                    message: "Your unsaved changes will be lost.",
                    confirmLabel: "Discard",
                    tone: "danger",
                  }))
                )
                  load();
              },
            }),
            existing ? button({ label: "Run now", icon: "play", onClick: runNow }) : null,
            existing
              ? button({
                  label: enabled ? "Disable" : "Enable",
                  icon: enabled ? "pause" : "bolt",
                  onClick: toggleEnabled,
                })
              : null,
            saveBtn,
          ),
        ),
        problems,
        tabset,
      );
      paintRunChip();
      refreshProblems();
      dirtyMark.hidden = !dirty();
    }

    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && root.contains(document.activeElement)) {
        e.preventDefault();
        save();
      }
    };
    root.addEventListener("keydown", onKey);

    // ---------- realtime and bus ----------
    life.add(
      rt.on("automation.run_updated", (ev) => {
        const p = ev.payload;
        if (!model?.existing || p.automation !== model.existing.slug) return;
        latestRun = { ...(latestRun ?? {}), run_id: p.run_id, status: p.status };
        paintRunChip();
      }),
    );
    life.add(
      rt.onChange(
        (c) => model?.existing && c.node === model.existing.uri && c.rev > model.existing.revision,
        () => {
          if (!dirty()) {
            ctx.toast({
              title: "Automation updated elsewhere",
              body: "Showing the latest version.",
              tone: "info",
            });
            load();
          } else if (!external) {
            external = banner({
              tone: "warning",
              title: "This changed elsewhere.",
              body: "Reload to see it; your edits here will be lost.",
              actions: [button({ label: "Reload", size: "sm", onClick: () => load() })],
            });
            root.prepend(external);
          }
        },
      ),
    );
    life.add(
      bus.subscribe("automation.selected", async ({ id }) => {
        if (!id || id === model?.existing?.slug) return;
        if (
          dirty() &&
          !(await ctx.confirm({
            title: "Switch automation?",
            message: "Your unsaved edits will be lost.",
            confirmLabel: "Switch",
            tone: "danger",
          }))
        )
          return;
        current = id;
        load();
      }),
    );

    load();
    return () => {
      root.removeEventListener("keydown", onKey);
      life.dispose();
    };
  },
};
