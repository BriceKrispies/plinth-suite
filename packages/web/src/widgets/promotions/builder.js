// promotions.builder: eligibility, effects, budget, schedule, review and history for one promotion.
// Drafts are saved through the kernel node API; lifecycle changes go through promotions.transition.
import { schemaOf } from "../../core/widgets.js";
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { card } from "../../ds/js/card.js";
import { combobox } from "../../ds/js/combobox.js";
import {
  textField,
  textArea,
  numberField,
  selectField,
  switchField,
  checkboxField,
  dateTimeField,
  formErrors,
} from "../../ds/js/field.js";
import { menuButton } from "../../ds/js/menu.js";
import { pill, statusPill } from "../../ds/js/pill.js";
import { ruleBuilder } from "../../ds/js/builder.js";
import { tabs } from "../../ds/js/tabs.js";
import { emptyState, skeleton, errorState } from "../../ds/js/states.js";
import { number, points } from "../../ds/js/format.js";
import { icon } from "../../ds/js/icons.js";
import {
  lifecycle,
  debounce,
  clone,
  same,
  prune,
  slugify,
  SLUG_RE,
  userSubject,
  toUtcInput,
  fromUtcInput,
  addDays,
  nowIso,
  readNode,
  listNodes,
  saveNode,
  historyList,
  banner,
  staleBanner,
  isStale,
  failToast,
  enumLabel,
  when,
  WEEKDAYS,
  kv,
  toErrorInfo,
} from "./_kit.js";
import {
  TIERS,
  REGIONS,
  CHANNELS,
  CHANNEL_LABEL,
  EFFECT_TYPES,
  transitionsFor,
  runTransition,
  describeEffect,
  describeEligibility,
  REJECTION_LABEL,
} from "./_promo.js";

const TONES = ["info", "success", "warning", "danger", "signal", "neutral"];
const BANNER_ICONS = [
  "percent",
  "gift",
  "megaphone",
  "sparkle",
  "bolt",
  "trophy",
  "coins",
  "flame",
  "star",
  "target",
];

const blankSpec = (ctx) => {
  const start = nowIso();
  return {
    status: "draft",
    description: "",
    eligibility: {},
    effects: [{ type: "points_multiplier", factor: 2 }],
    budget: {},
    schedule: { starts_at: start, ends_at: addDays(start, 30) },
    priority: 100,
    stacking: "stack",
    owner: userSubject(ctx),
  };
};

const defaultEffect = (type) =>
  ({
    points_multiplier: { type, factor: 2 },
    bonus_points: { type, points: 50, on: "purchase" },
    store_discount: { type, percent: 10 },
    free_item: { type, product: "", min_cart_points: 500 },
  })[type];

const slugOf = (ref) => String(ref ?? "").split(":")[1] ?? "";

export default {
  id: "promotions.builder",
  domain: "promotions",
  title: "Promotion builder",
  configSchema: schemaOf("promotions.builder"),
  sizes: ["xl", "full"],
  mount(el, { config, size, api, rt, bus, nav, ctx }) {
    const life = lifecycle();
    const canManage = ctx.can("promotions:manage");
    const root = h("div", { class: `wp wp-builder wp-builder--${size}` });
    el.append(root);

    // model: { existing: node | null, draft: { title, slug, spec }, lists, facts }
    let model = null;
    let slugTouched = false;
    let saving = false;
    const lists = { Segment: [], Group: [], Category: [], Product: [] };
    let facts = [];
    let current = typeof config.promotion === "string" ? config.promotion : null;
    let external = null; // banner element shown when the node changed elsewhere

    const dirty = () => model && !same(model.draft, model.baseDraft);

    // ---------- loading ----------
    const optionOf = (kind, slug) => {
      const n = lists[kind].find((x) => x.slug === slug);
      return { value: slug, label: n?.title ?? slug };
    };
    const refreshLists = async () => {
      await Promise.all(
        Object.keys(lists).map(async (k) => {
          try {
            lists[k] = await listNodes(api, k);
          } catch {
            lists[k] = lists[k] ?? [];
          }
        }),
      );
    };

    let seq = 0;
    const load = async () => {
      const mine = ++seq;
      root.replaceChildren(skeleton({ shape: "card", lines: 4 }));
      try {
        const [existing] = await Promise.all([
          current ? readNode(api, `promotion:${current}`) : null,
          refreshLists(),
          api
            .call("catalog.get", {})
            .then((c) => {
              facts = c.member_facts ?? [];
            })
            .catch(() => {
              facts = [];
            }),
        ]);
        if (life.dead || mine !== seq) return;
        const draft = existing
          ? { title: existing.title, slug: existing.slug, spec: clone(existing.spec) }
          : { title: "", slug: "", spec: blankSpec(ctx) };
        model = { existing, draft, baseDraft: clone(draft) };
        slugTouched = Boolean(existing);
        external = null;
        ctx.setTitle(existing ? `Promotion: ${existing.title}` : "New promotion");
        build();
      } catch (e) {
        if (life.dead || mine !== seq) return;
        root.replaceChildren(errorState({ error: e, retry: load }));
        ctx.setState("error", { error: e });
      }
    };

    // ---------- validation ----------
    const validate = () => {
      const { draft } = model;
      const s = draft.spec;
      const errs = [];
      const add = (tab, path, message) => errs.push({ tab, path, message });
      if (!draft.title.trim()) add("details", "/metadata/title", "Give the promotion a title");
      if (!model.existing && !SLUG_RE.test(draft.slug))
        add("details", "/metadata/slug", "Use a lowercase slug such as spring-double-points");
      if (s.description.length > 500)
        add("details", "/spec/description", "Keep the description under 500 characters");
      if (s.effects.length === 0) add("effects", "/spec/effects", "Add at least one effect");
      s.effects.forEach((e, i) => {
        const p = `/spec/effects/${i}`;
        if (e.type === "points_multiplier" && !(e.factor > 1))
          add("effects", `${p}/factor`, "A multiplier must be above 1");
        if (e.type === "bonus_points" && !(e.points > 0))
          add("effects", `${p}/points`, "Bonus points must be above 0");
        if (e.type === "store_discount" && !(e.percent >= 1 && e.percent <= 90))
          add("effects", `${p}/percent`, "A discount is 1 to 90 percent");
        if (e.type === "free_item" && !e.product) add("effects", `${p}/product`, "Choose the free product");
        if (e.type === "free_item" && !(e.min_cart_points > 0))
          add("effects", `${p}/min_cart_points`, "Set a minimum cart value");
      });
      const sc = s.schedule;
      if (!sc.starts_at || !sc.ends_at) add("schedule", "/spec/schedule/starts_at", "Set a start and an end");
      else if (new Date(sc.ends_at) <= new Date(sc.starts_at))
        add("schedule", "/spec/schedule/ends_at", "The end must be after the start");
      if (sc.hours_utc && !(sc.hours_utc.from < sc.hours_utc.to))
        add("schedule", "/spec/schedule/hours_utc/to", "Hours must run from earlier to later");
      if (!(s.priority >= 0 && s.priority <= 1000)) add("details", "/spec/priority", "Priority is 0 to 1000");
      if (s.stack_group && !SLUG_RE.test(s.stack_group))
        add("details", "/spec/stack_group", "Use a slug for the stack group");
      for (const k of ["max_cost_points", "max_redemptions", "max_per_member"])
        if (s.budget[k] !== undefined && !(Number.isInteger(s.budget[k]) && s.budget[k] > 0))
          add("budget", `/spec/budget/${k}`, "Use a whole number above 0");
      return errs;
    };

    const cleanSpec = () => {
      const s = clone(model.draft.spec);
      const e = s.eligibility;
      for (const k of ["tiers", "regions", "segments", "groups", "channels", "categories", "products"])
        if (!e[k]?.length) delete e[k];
      for (const k of ["new_members_days", "min_cart_points"]) if (!e[k]) delete e[k];
      if (!e.entitlement_only) delete e.entitlement_only;
      if (!e.filter) delete e.filter;
      s.budget = prune(s.budget);
      if (!s.schedule.days_of_week?.length || s.schedule.days_of_week.length === 7)
        delete s.schedule.days_of_week;
      if (!s.schedule.hours_utc) delete s.schedule.hours_utc;
      if (!s.stack_group) delete s.stack_group;
      if (!s.banner) delete s.banner;
      s.effects = s.effects.map((ef) => {
        const copy = { ...ef };
        for (const k of ["categories", "products"]) if (copy[k] && !copy[k].length) delete copy[k];
        if (copy.max_discount_points === undefined || copy.max_discount_points === null)
          delete copy.max_discount_points;
        return copy;
      });
      return s;
    };

    // ---------- save ----------
    const save = async () => {
      if (saving || !model) return;
      formErrors(null, { form: root });
      const errs = validate();
      refreshSummary();
      if (errs.length) {
        const summary = formErrors(
          { code: "VALIDATION_FAILED", path: errs[0].path, message: errs[0].message },
          { form: root },
        );
        const list = summary?.querySelector("ul");
        if (list) for (const x of errs.slice(1)) list.append(h("li", {}, x.message));
        summary?.focus?.();
        ctx.announce(`${errs.length} problems to fix before saving`);
        return;
      }
      saving = true;
      saveBtn.setAttribute("aria-busy", "true");
      try {
        const spec = cleanSpec();
        const out = await saveNode(api, {
          kind: "Promotion",
          slug: model.draft.slug,
          title: model.draft.title.trim(),
          spec,
          existing: model.existing ? { ...model.existing, spec: model.existing.spec } : null,
          skip: ["status"],
          prefix: "promo-save",
        });
        if (life.dead) return;
        if (out.status === "pending_approval") {
          ctx.toast({
            title: "Sent for approval",
            body: "Edits to a live promotion are held until an approver accepts them.",
            tone: "info",
          });
        } else if (out.status === "unchanged") {
          ctx.toast({ title: "Nothing to save", tone: "neutral" });
        } else {
          ctx.toast({ title: "Draft saved", body: model.draft.title, tone: "success" });
          ctx.announce("Saved");
        }
        if (!model.existing) {
          nav.go(`/promotions/${model.draft.slug}`);
          return;
        }
        await load();
      } catch (e) {
        if (life.dead) return;
        if (isStale(e)) {
          root.prepend(staleBanner(() => load()));
        } else {
          formErrors(toErrorInfo(e), { form: root });
          failToast(ctx, e, "Could not save the promotion");
        }
      } finally {
        saving = false;
        saveBtn?.removeAttribute("aria-busy");
      }
    };

    // ---------- shared field helpers ----------
    const refCombo = ({ label, kind, prefix, value, single = false, onChange, hint, required, name }) =>
      combobox({
        label,
        name,
        hint,
        required,
        multiple: !single,
        value: single
          ? value
            ? optionOf(kind, slugOf(value))
            : null
          : (value ?? []).map((r) => optionOf(kind, slugOf(r))),
        placeholder: `Search ${label.toLowerCase()}`,
        search: async (q) =>
          lists[kind]
            .filter((n) => `${n.title} ${n.slug}`.toLowerCase().includes(q.toLowerCase()))
            .slice(0, 12)
            .map((n) => ({ value: n.slug, label: n.title, description: n.slug })),
        onChange: (v) => {
          if (single) onChange(v ? `${prefix}:${v.value}` : "");
          else onChange(v.map((o) => `${prefix}:${o.value}`));
          touch();
        },
      });

    const touch = () => {
      refreshSummary();
      refreshDirty();
    };

    // ---------- tab panels ----------
    const reach = h("div", { class: "wp-builder__reach", "aria-live": "polite" });
    const refreshReach = debounce(
      life,
      async () => {
        const e = model.draft.spec.eligibility;
        const rows = [];
        reach.replaceChildren(h("p", { class: "u-muted" }, "Counting members"));
        try {
          if (e.filter) {
            const out = await api.call("segments.preview", { rule: e.filter, sample: 1 });
            rows.push([`Custom rule`, `${number(out.count)} of ${number(out.total_members)} members`]);
          }
          for (const ref of e.segments ?? []) {
            const out = await api.call("segments.preview", { segment: ref, sample: 1 });
            rows.push([optionOf("Segment", slugOf(ref)).label, `${number(out.count)} members`]);
          }
        } catch (err) {
          if (life.dead) return;
          reach.replaceChildren(
            banner({ tone: "warning", title: "Could not count members.", body: err.message }),
          );
          return;
        }
        if (life.dead) return;
        reach.replaceChildren(
          rows.length
            ? kv(rows)
            : h(
                "p",
                { class: "u-muted" },
                "Add a segment or a custom rule to see how many members it reaches.",
              ),
        );
      },
      500,
    );

    const eligibilityPanel = () => {
      const s = model.draft.spec;
      const e = s.eligibility;
      const set = (k, v) => {
        if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) delete e[k];
        else e[k] = v;
        touch();
        if (k === "segments" || k === "filter") refreshReach();
      };
      const filterHost = h("div", { class: "wp-builder__rule" });
      const drawRule = () => {
        filterHost.replaceChildren();
        if (!e.filter && !ruleOn) return;
        if (facts.length === 0) {
          filterHost.append(
            banner({
              tone: "warning",
              title: "Member facts are unavailable.",
              body: "The rule builder needs the builder catalogue.",
            }),
          );
          return;
        }
        filterHost.append(
          ruleBuilder({
            label: "Custom eligibility rule",
            facts,
            value: e.filter,
            onChange: (tree) => set("filter", tree),
          }),
        );
      };
      let ruleOn = Boolean(e.filter);
      const panel = h(
        "div",
        { class: "wp-builder__panel" },
        h(
          "div",
          { class: "wk-grid-2" },
          checkboxField({
            name: "/spec/eligibility/tiers",
            label: "Tiers",
            hint: "Leave all unchecked for every tier",
            options: TIERS.map((t) => ({ value: t, label: enumLabel(t) })),
            value: e.tiers ?? [],
            onChange: (v) => set("tiers", v),
          }),
          checkboxField({
            name: "/spec/eligibility/regions",
            label: "Regions",
            hint: "Leave all unchecked for every region",
            options: REGIONS.map((r) => ({ value: r, label: r })),
            value: e.regions ?? [],
            onChange: (v) => set("regions", v),
          }),
          checkboxField({
            name: "/spec/eligibility/channels",
            label: "Channels",
            hint: "Where the promotion applies",
            options: CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] })),
            value: e.channels ?? [],
            onChange: (v) => set("channels", v),
          }),
          h(
            "div",
            { class: "wk-stack" },
            numberField({
              name: "/spec/eligibility/new_members_days",
              label: "New members only (days since joining)",
              value: e.new_members_days,
              min: 1,
              step: 1,
              onInput: (v) => set("new_members_days", v),
            }),
            numberField({
              name: "/spec/eligibility/min_cart_points",
              label: "Minimum cart (points)",
              value: e.min_cart_points,
              min: 1,
              step: 1,
              onInput: (v) => set("min_cart_points", v),
            }),
            switchField({
              name: "/spec/eligibility/entitlement_only",
              label: "Only members holding an entitlement",
              value: Boolean(e.entitlement_only),
              onChange: (v) => set("entitlement_only", v || null),
            }),
          ),
        ),
        h(
          "div",
          { class: "wk-grid-2" },
          refCombo({
            label: "Segments",
            name: "/spec/eligibility/segments",
            kind: "Segment",
            prefix: "segment",
            value: e.segments,
            onChange: (v) => set("segments", v),
            hint: "A member in any listed segment qualifies",
          }),
          refCombo({
            label: "Groups",
            name: "/spec/eligibility/groups",
            kind: "Group",
            prefix: "group",
            value: e.groups,
            onChange: (v) => set("groups", v),
          }),
          refCombo({
            label: "Categories in scope",
            name: "/spec/eligibility/categories",
            kind: "Category",
            prefix: "category",
            value: e.categories,
            onChange: (v) => set("categories", v),
            hint: "Purchases need a line in these categories",
          }),
          refCombo({
            label: "Products in scope",
            name: "/spec/eligibility/products",
            kind: "Product",
            prefix: "product",
            value: e.products,
            onChange: (v) => set("products", v),
          }),
        ),
        card({
          title: "Custom rule",
          body: h(
            "div",
            { class: "wk-stack" },
            switchField({
              name: "/spec/eligibility/filter",
              label: "Add a rule over member facts",
              value: ruleOn,
              onChange: (v) => {
                ruleOn = v;
                if (!v) set("filter", null);
                drawRule();
              },
            }),
            filterHost,
          ),
        }),
        card({ title: "Who this reaches", body: reach }),
      );
      drawRule();
      refreshReach();
      return panel;
    };

    const effectFields = (ef, i, redraw) => {
      const base = `/spec/effects/${i}`;
      const bump = () => touch();
      switch (ef.type) {
        case "points_multiplier":
          return [
            numberField({
              name: `${base}/factor`,
              label: "Multiplier",
              value: ef.factor,
              min: 1.1,
              max: 20,
              step: 0.1,
              hint: "Applies to earnings only, such as awards and badge rewards. The largest multiplier applies once.",
              required: true,
              onInput: (v) => {
                ef.factor = v ?? 0;
                bump();
              },
            }),
          ];
        case "bonus_points":
          return [
            numberField({
              name: `${base}/points`,
              label: "Bonus points",
              value: ef.points,
              min: 1,
              step: 1,
              required: true,
              onInput: (v) => {
                ef.points = v ?? 0;
                bump();
              },
            }),
            selectField({
              name: `${base}/on`,
              label: "Applies to",
              value: ef.on,
              options: [
                { value: "purchase", label: "Purchases (credited at delivery)" },
                { value: "earn", label: "Earnings (added to the award)" },
              ],
              onChange: (v) => {
                ef.on = v;
                bump();
              },
            }),
          ];
        case "store_discount":
          return [
            numberField({
              name: `${base}/percent`,
              label: "Discount percent",
              value: ef.percent,
              min: 1,
              max: 90,
              step: 1,
              required: true,
              onInput: (v) => {
                ef.percent = v ?? 0;
                bump();
              },
            }),
            numberField({
              name: `${base}/max_discount_points`,
              label: "Cap (points, optional)",
              value: ef.max_discount_points,
              min: 1,
              step: 1,
              onInput: (v) => {
                ef.max_discount_points = v ?? undefined;
                bump();
              },
            }),
            refCombo({
              label: "Categories",
              name: `${base}/categories`,
              kind: "Category",
              prefix: "category",
              value: ef.categories,
              onChange: (v) => {
                ef.categories = v;
              },
              hint: "Empty means every line",
            }),
            refCombo({
              label: "Products",
              name: `${base}/products`,
              kind: "Product",
              prefix: "product",
              value: ef.products,
              onChange: (v) => {
                ef.products = v;
              },
            }),
          ];
        case "free_item":
          return [
            refCombo({
              label: "Free product",
              name: `${base}/product`,
              kind: "Product",
              prefix: "product",
              value: ef.product,
              single: true,
              required: true,
              onChange: (v) => {
                ef.product = v;
              },
            }),
            numberField({
              name: `${base}/min_cart_points`,
              label: "Minimum cart (points)",
              value: ef.min_cart_points,
              min: 1,
              step: 1,
              required: true,
              onInput: (v) => {
                ef.min_cart_points = v ?? 0;
                bump();
              },
            }),
          ];
        default:
          return [];
      }
    };

    const effectsPanel = () => {
      const s = model.draft.spec;
      const host = h("div", { class: "wp-builder__panel" });
      const draw = () => {
        host.replaceChildren(
          banner({
            tone: "info",
            body: "Effects apply together when the promotion is selected. Purchases take discounts, free items and purchase bonuses; earnings take multipliers and earn bonuses.",
          }),
          ...s.effects.map((ef, i) =>
            card({
              title: `Effect ${i + 1}: ${describeEffect(ef)}`,
              actions: button({
                label: `Remove effect ${i + 1}`,
                icon: "trash",
                iconOnly: true,
                variant: "ghost",
                size: "sm",
                onClick: () => {
                  s.effects.splice(i, 1);
                  ctx.announce(`Effect removed, ${s.effects.length} left`);
                  touch();
                  draw();
                },
              }),
              body: h(
                "div",
                { class: "wk-grid-2" },
                selectField({
                  name: `/spec/effects/${i}/type`,
                  label: "Type",
                  value: ef.type,
                  options: EFFECT_TYPES,
                  onChange: (v) => {
                    s.effects[i] = defaultEffect(v);
                    touch();
                    draw();
                  },
                }),
                ...effectFields(ef, i, draw),
              ),
            }),
          ),
          ...[
            s.effects.length === 0
              ? emptyState({
                  icon: "percent",
                  title: "No effects yet",
                  body: "A promotion needs at least one effect.",
                })
              : null,
          ].filter(Boolean),
          h(
            "div",
            { class: "wk-actions" },
            button({
              label: "Add effect",
              icon: "plus",
              disabled: s.effects.length >= 4,
              onClick: () => {
                s.effects.push(defaultEffect("bonus_points"));
                touch();
                draw();
                ctx.announce(`Effect added, ${s.effects.length} in total`);
              },
            }),
            s.effects.length >= 4 ? h("span", { class: "u-muted" }, "Up to 4 effects") : null,
          ),
        );
      };
      draw();
      return host;
    };

    const budgetPanel = () => {
      const b = model.draft.spec.budget;
      const num = (k, label, hint) =>
        numberField({
          name: `/spec/budget/${k}`,
          label,
          hint,
          value: b[k],
          min: 1,
          step: 1,
          onInput: (v) => {
            if (v === null) delete b[k];
            else b[k] = v;
            touch();
          },
        });
      return h(
        "div",
        { class: "wp-builder__panel" },
        banner({
          tone: "info",
          body: "Leave a limit empty for no limit. When a limit is reached the promotion stays active but is rejected with the reason budget.",
        }),
        h(
          "div",
          { class: "wk-grid-2" },
          num("max_cost_points", "Programme cost cap (points)", "Total cost across every redemption"),
          num("max_redemptions", "Redemption cap", "Total times the promotion may apply"),
          num("max_per_member", "Per-member cap", "Times one member may use it"),
        ),
      );
    };

    const schedulePanel = () => {
      const sc = model.draft.spec.schedule;
      const summary = h("p", { class: "u-muted", "aria-live": "polite" });
      const text = () => {
        const days =
          sc.starts_at && sc.ends_at
            ? Math.round((new Date(sc.ends_at) - new Date(sc.starts_at)) / 86400000)
            : 0;
        const dow = sc.days_of_week?.length
          ? ` on ${sc.days_of_week.map((d) => WEEKDAYS[d - 1]).join(", ")}`
          : "";
        const hrs = sc.hours_utc
          ? ` between ${String(sc.hours_utc.from).padStart(2, "0")}:00 and ${String(sc.hours_utc.to).padStart(2, "0")}:00 UTC`
          : "";
        summary.textContent = `Runs for ${days} day${days === 1 ? "" : "s"}${dow}${hrs}.`;
      };
      const startField = dateTimeField({
        name: "/spec/schedule/starts_at",
        label: "Starts (UTC)",
        value: toUtcInput(sc.starts_at),
        required: true,
        onInput: (v) => {
          sc.starts_at = fromUtcInput(v);
          text();
          touch();
        },
      });
      const endField = dateTimeField({
        name: "/spec/schedule/ends_at",
        label: "Ends (UTC)",
        value: toUtcInput(sc.ends_at),
        required: true,
        onInput: (v) => {
          sc.ends_at = fromUtcInput(v);
          text();
          touch();
        },
      });
      const setEnd = (days) => {
        if (!sc.starts_at) return;
        sc.ends_at = addDays(sc.starts_at, days);
        endField.querySelector("input").value = toUtcInput(sc.ends_at);
        text();
        touch();
      };
      const hoursOn = Boolean(sc.hours_utc);
      const hoursHost = h("div", { class: "wk-grid-2" });
      const drawHours = (on) => {
        hoursHost.replaceChildren();
        if (!on) return;
        hoursHost.append(
          numberField({
            name: "/spec/schedule/hours_utc/from",
            label: "From hour (UTC)",
            value: sc.hours_utc.from,
            min: 0,
            max: 23,
            step: 1,
            onInput: (v) => {
              sc.hours_utc.from = v ?? 0;
              text();
              touch();
            },
          }),
          numberField({
            name: "/spec/schedule/hours_utc/to",
            label: "To hour (UTC)",
            value: sc.hours_utc.to,
            min: 1,
            max: 24,
            step: 1,
            onInput: (v) => {
              sc.hours_utc.to = v ?? 24;
              text();
              touch();
            },
          }),
        );
      };
      drawHours(hoursOn);
      text();
      return h(
        "div",
        { class: "wp-builder__panel" },
        h("div", { class: "wk-grid-2" }, startField, endField),
        h(
          "div",
          { class: "wk-actions" },
          h("span", { class: "u-muted" }, "Set the end:"),
          ...[7, 14, 30, 90].map((d) =>
            button({ label: `${d} days after start`, size: "sm", onClick: () => setEnd(d) }),
          ),
        ),
        checkboxField({
          name: "/spec/schedule/days_of_week",
          label: "Days of the week",
          hint: "Leave all unchecked for every day",
          options: WEEKDAYS.map((d, i) => ({ value: String(i + 1), label: d })),
          value: (sc.days_of_week ?? []).map(String),
          onChange: (v) => {
            sc.days_of_week = v.map(Number);
            text();
            touch();
          },
        }),
        switchField({
          name: "/spec/schedule/hours_utc",
          label: "Limit to hours of the day",
          value: hoursOn,
          onChange: (v) => {
            if (v) sc.hours_utc = { from: 9, to: 17 };
            else delete sc.hours_utc;
            drawHours(v);
            text();
            touch();
          },
        }),
        hoursHost,
        summary,
      );
    };

    // ---------- review: validation, plain-language summary, test run ----------
    const sentences = () => {
      const { draft } = model;
      const s = draft.spec;
      return [
        ["Who qualifies", describeEligibility(s.eligibility)],
        ["What they get", s.effects.map(describeEffect).join("; ") || "No effects yet"],
        [
          "Budget",
          [
            s.budget.max_cost_points && `${points(s.budget.max_cost_points)} total`,
            s.budget.max_redemptions && `${number(s.budget.max_redemptions)} redemptions`,
            s.budget.max_per_member && `${number(s.budget.max_per_member)} per member`,
          ]
            .filter(Boolean)
            .join(", ") || "No limits",
        ],
        ["Window", `${when(s.schedule.starts_at)} to ${when(s.schedule.ends_at)}`],
        [
          "Stacking",
          `${s.stacking === "exclusive" ? "Exclusive: blocks others" : "Stacks with others"}${s.stack_group ? ` (group ${s.stack_group})` : ""}, priority ${s.priority}`,
        ],
      ];
    };

    const summaryHosts = new Set();
    const makeSummaryHost = () => {
      const host = h("div", { class: "wp-builder__summary" });
      summaryHosts.add(host);
      return host;
    };
    function refreshSummary() {
      if (!model) return;
      const errs = validate();
      for (const host of summaryHosts) {
        if (!host.isConnected && host.dataset.seen) {
          summaryHosts.delete(host);
          continue;
        }
        host.dataset.seen = host.isConnected ? "1" : "";
        host.replaceChildren(
          h("h3", { class: "wk-caps" }, "What this does"),
          kv(sentences()),
          errs.length
            ? h(
                "div",
                { class: "wp-builder__problems", role: "status" },
                h(
                  "p",
                  {},
                  icon("alert", { size: 16 }),
                  ` ${errs.length} thing${errs.length === 1 ? "" : "s"} to fix`,
                ),
                h("ul", {}, ...errs.slice(0, 5).map((x) => h("li", {}, x.message))),
              )
            : h("p", { class: "wp-builder__ok" }, icon("check-circle", { size: 16 }), " Ready to save"),
        );
      }
    }

    const reviewPanel = () => {
      const t = {
        member: ctx.memberHandle("$me") ?? "",
        kind: "earn",
        base: 200,
        product: null,
        busy: false,
      };
      const out = h("div", { class: "wp-builder__test", "aria-live": "polite" });
      const run = async () => {
        const errs = validate();
        if (errs.length) {
          out.replaceChildren(
            banner({ tone: "warning", title: "Fix the problems first.", body: errs[0].message }),
          );
          return;
        }
        if (!t.member) {
          out.replaceChildren(banner({ tone: "warning", title: "Enter a member handle." }));
          return;
        }
        let context;
        if (t.kind === "earn")
          context = {
            kind: "earn",
            channel: "recognition",
            base_points: Math.max(1, Math.round(t.base)),
            earn_type: "award",
          };
        else {
          const p = lists.Product.find((x) => x.slug === t.product) ?? lists.Product[0];
          if (!p) {
            out.replaceChildren(banner({ tone: "warning", title: "No products available to test with." }));
            return;
          }
          context = {
            kind: "purchase",
            channel: "store",
            lines: [
              {
                product: p.slug,
                category: slugOf(p.spec.category),
                qty: 1,
                unit_points: p.spec.price_points,
              },
            ],
          };
        }
        out.replaceChildren(h("p", { class: "u-muted" }, "Simulating"));
        try {
          const r = await api.call("promotions.simulate", {
            promotion: {
              slug: model.draft.slug || "draft-preview",
              title: model.draft.title || "Draft",
              spec: cleanSpec(),
            },
            member: t.member,
            context,
            include_live: false,
          });
          if (life.dead) return;
          const mine = r.evaluation.applied[0];
          const rej = r.evaluation.rejected[0];
          out.replaceChildren(
            mine
              ? banner({
                  tone: "success",
                  title: "Applies.",
                  body: `Member impact ${r.evaluation.delta_points >= 0 ? "+" : "−"}${points(Math.abs(r.evaluation.delta_points))}; programme cost ${points(r.evaluation.cost_points)}.`,
                })
              : banner({
                  tone: "warning",
                  title: "Does not apply to this member and event.",
                  body: rej ? `${REJECTION_LABEL[rej.reason] ?? rej.reason}. ${rej.detail}` : "",
                }),
          );
        } catch (e) {
          if (life.dead) return;
          out.replaceChildren(
            banner({ tone: "danger", title: "Simulation failed.", body: e.message, role: "alert" }),
          );
        }
      };
      return h(
        "div",
        { class: "wp-builder__panel" },
        card({ title: "Summary", body: makeSummaryHost() }),
        card({
          title: "Try it on a member",
          body: h(
            "div",
            { class: "wk-stack" },
            h(
              "div",
              { class: "wk-grid-2" },
              textField({
                name: "member",
                label: "Member handle",
                value: t.member,
                onInput: (v) => {
                  t.member = v.trim();
                },
              }),
              selectField({
                name: "kind",
                label: "Sample event",
                value: t.kind,
                options: [
                  { value: "earn", label: "Earn 200 points" },
                  { value: "purchase", label: "Buy one product" },
                ],
                onChange: (v) => {
                  t.kind = v;
                },
              }),
            ),
            h(
              "div",
              { class: "wk-actions" },
              button({ label: "Run test", icon: "play", variant: "primary", onClick: run }),
            ),
            out,
            h(
              "p",
              { class: "u-muted" },
              "Open the simulator below the builder for carts, several members and the live stacking set.",
            ),
          ),
        }),
        model.existing && model.draft.spec.status !== "draft"
          ? banner({
              tone: "info",
              title: "This promotion is " + model.draft.spec.status + ".",
              body: "Saving edits to a scheduled, active or paused promotion is held for approval.",
            })
          : null,
      );
    };

    const historyPanel = () => {
      const host = h("div", { class: "wp-builder__panel" });
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
        .then((rows) => {
          if (life.dead) return;
          host.replaceChildren(historyList(rows, "Promotion history"));
        })
        .catch((e) => {
          if (life.dead) return;
          host.replaceChildren(errorState({ error: e }));
        });
      return host;
    };

    // ---------- details block and chrome ----------
    let saveBtn = null;
    const dirtyMark = h(
      "span",
      { class: "wp-builder__dirty", hidden: true },
      pill({ label: "Unsaved changes", tone: "warning" }),
    );
    function refreshDirty() {
      if (dirtyMark) dirtyMark.hidden = !dirty();
    }

    const detailsBlock = () => {
      const { draft, existing } = model;
      const s = draft.spec;
      const bannerOn = Boolean(s.banner);
      const bannerHost = h("div", { class: "wk-grid-2" });
      const drawBanner = () => {
        bannerHost.replaceChildren();
        if (!s.banner) return;
        bannerHost.append(
          textField({
            name: "/spec/banner/headline",
            label: "Banner headline",
            value: s.banner.headline,
            onInput: (v) => {
              s.banner.headline = v;
              touch();
            },
          }),
          selectField({
            name: "/spec/banner/tone",
            label: "Tone",
            value: s.banner.tone,
            options: TONES.map((t) => ({ value: t, label: enumLabel(t) })),
            onChange: (v) => {
              s.banner.tone = v;
              touch();
            },
          }),
          selectField({
            name: "/spec/banner/icon",
            label: "Icon",
            value: s.banner.icon,
            options: BANNER_ICONS.map((t) => ({ value: t, label: enumLabel(t) })),
            onChange: (v) => {
              s.banner.icon = v;
              touch();
            },
          }),
        );
      };
      drawBanner();
      const slugInput = textField({
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
      return h(
        "div",
        { class: "wp-builder__details" },
        h(
          "div",
          { class: "wk-grid-2" },
          textField({
            name: "/metadata/title",
            label: "Title",
            value: draft.title,
            required: true,
            onInput: (v) => {
              draft.title = v;
              if (!slugTouched && !existing) {
                draft.slug = slugify(v);
                slugInput.querySelector("input").value = draft.slug;
              }
              touch();
            },
          }),
          slugInput,
        ),
        textArea({
          name: "/spec/description",
          label: "Description",
          rows: 2,
          value: s.description,
          hint: "Shown to members in the offer details",
          onInput: (v) => {
            s.description = v;
            touch();
          },
        }),
        h(
          "div",
          { class: "wk-grid-3" },
          numberField({
            name: "/spec/priority",
            label: "Priority",
            value: s.priority,
            min: 0,
            max: 1000,
            step: 1,
            hint: "Higher applies first",
            onInput: (v) => {
              s.priority = v ?? 0;
              touch();
            },
          }),
          selectField({
            name: "/spec/stacking",
            label: "Stacking",
            value: s.stacking,
            options: [
              { value: "stack", label: "Stacks with others" },
              { value: "exclusive", label: "Exclusive" },
            ],
            onChange: (v) => {
              s.stacking = v;
              touch();
            },
          }),
          textField({
            name: "/spec/stack_group",
            label: "Stack group (optional)",
            value: s.stack_group ?? "",
            hint: "Only the first in a group applies",
            onInput: (v) => {
              s.stack_group = v.trim() || undefined;
              touch();
            },
          }),
        ),
        switchField({
          name: "/spec/banner",
          label: "Show a banner to eligible members",
          value: bannerOn,
          onChange: (v) => {
            if (v) s.banner = { headline: draft.title || "New offer", tone: "info", icon: "percent" };
            else delete s.banner;
            drawBanner();
            touch();
          },
        }),
        bannerHost,
      );
    };

    // ---------- build ----------
    function build() {
      summaryHosts.clear();
      const { existing, draft } = model;
      const s = draft.spec;
      const steps = existing ? transitionsFor(s.status, s.schedule.starts_at) : [];
      saveBtn = button({
        label: existing ? "Save changes" : "Create draft",
        icon: "check",
        variant: "primary",
        onClick: save,
        disabled: !canManage,
      });
      const lifecycleMenu = steps.length
        ? menuButton({
            label: "Lifecycle",
            icon: "workflow",
            items: steps.map((step) => ({
              label: step.label,
              icon: step.icon,
              danger: step.danger,
              onSelect: async () => {
                if (dirty()) {
                  ctx.toast({ title: "Save or discard your edits first", tone: "warning" });
                  return;
                }
                const out = await runTransition(ctx, api, {
                  slug: existing.slug,
                  title: existing.title,
                  revision: existing.revision,
                  step,
                });
                if (out) load();
              },
            })),
          })
        : null;
      const header = h(
        "div",
        { class: "wp-builder__bar" },
        h(
          "div",
          { class: "wp-builder__status" },
          existing ? statusPill("promotion", s.status) : pill({ label: "New", tone: "info" }),
          existing ? h("span", { class: "u-muted" }, `Revision ${existing.revision}`) : null,
          dirtyMark,
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
          lifecycleMenu,
          saveBtn,
        ),
      );
      const tabset = tabs({
        label: "Promotion sections",
        items: [
          { id: "eligibility", label: "Eligibility", panel: eligibilityPanel },
          { id: "effects", label: "Effects", panel: effectsPanel },
          { id: "budget", label: "Budget", panel: budgetPanel },
          { id: "schedule", label: "Schedule", panel: schedulePanel },
          { id: "review", label: "Review", panel: reviewPanel },
          { id: "history", label: "History", panel: historyPanel },
        ],
        selected: "eligibility",
        onChange: (id) => {
          if (id === "review") refreshSummary();
        },
      });
      root.replaceChildren(
        ...[
          header,
          !canManage
            ? banner({
                tone: "info",
                title: "Read only.",
                body: "You need the promotions manage permission to edit.",
              })
            : null,
          existing && s.status !== "draft" && s.status !== "ended"
            ? banner({
                tone: "info",
                body: "Edits to eligibility, effects, budget or schedule of a non-draft promotion are held for approval.",
              })
            : null,
          h(
            "div",
            { class: "wp-builder__layout" },
            h("div", { class: "wp-builder__main" }, detailsBlock(), tabset),
            h(
              "aside",
              { class: "wp-builder__aside", "aria-label": "Summary" },
              card({ body: makeSummaryHost() }),
            ),
          ),
        ].filter(Boolean),
      );
      refreshSummary();
      refreshDirty();
      if (!canManage) root.querySelectorAll("input, select, textarea").forEach((x) => (x.disabled = true));
    }

    // keyboard: Ctrl or Cmd + S saves
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && root.contains(document.activeElement)) {
        e.preventDefault();
        save();
      }
    };
    root.addEventListener("keydown", onKey);

    // ---------- realtime and bus ----------
    const externalChange = (text) => {
      if (!model?.existing) return;
      if (!dirty()) {
        ctx.toast({ title: "Promotion updated", body: text, tone: "info" });
        load();
        return;
      }
      if (external) return;
      external = banner({
        tone: "warning",
        title: "This changed elsewhere.",
        body: text,
        actions: [button({ label: "Reload", size: "sm", onClick: () => load() })],
      });
      root.prepend(external);
    };
    life.add(
      rt.on("promotion.state_changed", (ev) => {
        if (
          ev.payload.promotion === model?.existing?.slug &&
          ev.payload.revision > (model.existing.revision ?? 0)
        )
          externalChange(`Now ${ev.payload.to}.`);
      }),
    );
    life.add(
      rt.on("approval.decided", (ev) => {
        if (ev.payload.approval_type === "change" || ev.payload.approval_type === "action") {
          if (model?.existing) externalChange(`An approval was ${ev.payload.decision}d.`);
        }
      }),
    );
    life.add(
      rt.onChange(
        (c) => model?.existing && c.node === model.existing.uri && c.rev > model.existing.revision,
        () => externalChange("Another revision was saved."),
      ),
    );
    for (const kind of ["Segment", "Product", "Category"])
      life.add(
        rt.onNode(
          kind,
          debounce(
            life,
            async () => {
              try {
                lists[kind] = await listNodes(api, kind);
              } catch {
                /* keep the previous list */
              }
            },
            800,
          ),
        ),
      );
    life.add(
      bus.subscribe("promotion.selected", async ({ id }) => {
        if (!id || id === model?.existing?.slug) return;
        if (
          dirty() &&
          !(await ctx.confirm({
            title: "Switch promotion?",
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
