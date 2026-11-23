// segments.builder: a rule builder over member facts with a live count, distribution and sample members.
// Clicking a member explains, condition by condition, why they match or not.
import { schemaOf } from "../../core/widgets.js";
import { h } from "../../ds/js/dom.js";
import { scoped } from "../reporting/_common.js";
import { button } from "../../ds/js/button.js";
import { card } from "../../ds/js/card.js";
import { avatar } from "../../ds/js/avatar.js";
import { textField, textArea, formErrors } from "../../ds/js/field.js";
import { ruleBuilder } from "../../ds/js/builder.js";
import { donut } from "../../ds/js/chart.js";
import { progressBar } from "../../ds/js/progress.js";
import { pill, statusPill } from "../../ds/js/pill.js";
import { tabs } from "../../ds/js/tabs.js";
import { emptyState, skeleton, errorState } from "../../ds/js/states.js";
import { number } from "../../ds/js/format.js";
import { icon } from "../../ds/js/icons.js";
import {
  lifecycle,
  debounce,
  clone,
  same,
  slugify,
  SLUG_RE,
  userSubject,
  readNode,
  saveNode,
  historyList,
  banner,
  staleBanner,
  isStale,
  failToast,
  enumLabel,
  toErrorInfo,
  kv,
} from "../promotions/_kit.js";
import { explain } from "./_eval.js";

const countOf = (v) => (typeof v === "number" ? v : (v?.count ?? v?.members ?? 0));
const KIND_ROUTE = {
  Promotion: "promotions",
  Automation: "automations",
  Content: "content",
  Badge: "badges",
};

export default {
  id: "segments.builder",
  domain: "segments",
  title: "Segment builder",
  configSchema: schemaOf("segments.builder"),
  sizes: ["xl", "full"],
  mount(el, { config, size, api, rt, bus, nav, ctx }) {
    const life = lifecycle();
    const root = h("div", { class: `ws ws-builder ws-builder--${size}` });
    el.append(root);

    let current = typeof config.segment === "string" ? config.segment : null;
    let model = null;
    let facts = [];
    let preview = null; // last segments.preview output
    let previewError = null;
    let previewing = false;
    let slugTouched = false;
    let saving = false;
    let saveBtn = null;
    const aside = h("div", { class: "ws-builder__live", "aria-live": "polite" });
    const previewHost = h("div", { class: "ws-builder__preview" });
    const dirtyMark = h("span", { hidden: true }, pill({ label: "Unsaved changes", tone: "warning" }));

    const dirty = () => model && !same(model.draft, model.base);
    const touch = () => {
      dirtyMark.hidden = !dirty();
      if (saveBtn) saveBtn.disabled = !canSave();
    };
    const canSave = () => Boolean(model?.draft.rule) && Boolean(model?.draft.title.trim());

    // ---------- load ----------
    let seq = 0;
    const load = async () => {
      const mine = ++seq;
      root.replaceChildren(skeleton({ shape: "card", lines: 4 }));
      try {
        const [existing, catalog] = await Promise.all([
          current ? readNode(api, `segment:${current}`) : null,
          api.call("catalog.get", {}),
        ]);
        if (life.dead || mine !== seq) return;
        facts = catalog.member_facts ?? [];
        const draft = existing
          ? {
              title: existing.title,
              slug: existing.slug,
              description: existing.spec.description ?? "",
              rule: clone(existing.spec.rule),
            }
          : { title: "", slug: "", description: "", rule: undefined };
        model = { existing, draft, base: clone(draft) };
        slugTouched = Boolean(existing);
        preview = null;
        previewError = null;
        ctx.setTitle(existing ? `Segment: ${existing.title}` : "New segment");
        build();
        if (draft.rule) runPreview();
        else paintLive();
      } catch (e) {
        if (life.dead || mine !== seq) return;
        root.replaceChildren(errorState({ error: e, retry: load }));
      }
    };

    // ---------- preview ----------
    let pseq = 0;
    const runPreview = async () => {
      const rule = model.draft.rule;
      if (!rule) {
        preview = null;
        paintLive();
        return;
      }
      const mine = ++pseq;
      previewing = true;
      previewError = null;
      paintLive();
      try {
        const out = await api.call("segments.preview", { rule, sample: 12 });
        if (life.dead || mine !== pseq) return;
        preview = out;
        previewing = false;
        paintLive();
        paintPreview();
      } catch (e) {
        if (life.dead || mine !== pseq) return;
        previewing = false;
        previewError = toErrorInfo(e);
        paintLive();
      }
    };
    const schedulePreview = debounce(life, runPreview, 450);

    function paintLive() {
      aside.replaceChildren();
      if (!model.draft.rule) {
        aside.append(h("p", { class: "u-muted" }, "Complete every condition to see how many members match."));
        return;
      }
      if (previewError) {
        aside.append(
          banner({ tone: "danger", title: "Preview failed.", body: previewError.message, role: "alert" }),
        );
        return;
      }
      if (!preview) {
        aside.append(h("p", { class: "u-muted" }, "Counting members"));
        return;
      }
      aside.setAttribute("aria-busy", previewing ? "true" : "false");
      aside.append(
        h("p", { class: "ws-builder__big u-tabular" }, number(preview.count)),
        h("p", { class: "u-muted" }, `of ${number(preview.total_members)} members`),
        progressBar({
          value: preview.count,
          max: Math.max(1, preview.total_members),
          label: "Share of members matching",
          tone: preview.count === 0 ? "warning" : "info",
        }),
        ...[
          preview.count === 0
            ? banner({
                tone: "warning",
                body: "No member matches this rule, so any promotion or content that uses it reaches nobody.",
              })
            : preview.total_members > 0 && preview.count === preview.total_members
              ? banner({ tone: "info", body: "Every member matches. Is the rule too broad?" })
              : null,
        ].filter(Boolean),
      );
    }

    // ---------- explain a member ----------
    const renderExplain = (node, factDefs) => {
      const label = (path) => factDefs.find((f) => f.path === path)?.label ?? path;
      const draw = (n) => {
        if (n.kind === "cond") {
          const c = n.cond;
          const val =
            c.value === undefined ? "" : Array.isArray(c.value) ? c.value.join(" and ") : String(c.value);
          return h(
            "li",
            { class: `ws-explain__cond ${n.pass ? "is-pass" : "is-fail"}` },
            h(
              "span",
              { class: "ws-explain__mark" },
              icon(n.pass ? "check-circle" : "x", { size: 16 }),
              h("span", { class: "sr-only" }, n.pass ? "Met" : "Not met"),
            ),
            h("span", {}, `${label(c.field)} ${c.op.replace(/_/g, " ")} ${val}`.trim()),
            h(
              "span",
              { class: "u-muted" },
              ` (member: ${n.seen === undefined || n.seen === null ? "not set" : Array.isArray(n.seen) ? n.seen.join(", ") || "none" : String(n.seen)})`,
            ),
          );
        }
        const word = n.kind === "all" ? "All of" : n.kind === "any" ? "Any of" : "None of";
        return h(
          "li",
          { class: `ws-explain__group ${n.pass ? "is-pass" : "is-fail"}` },
          h(
            "span",
            { class: "ws-explain__mark" },
            icon(n.pass ? "check-circle" : "x", { size: 16 }),
            h("span", { class: "sr-only" }, n.pass ? "Met" : "Not met"),
          ),
          h("strong", {}, `${word} these`),
          h("ul", {}, ...n.children.map(draw)),
        );
      };
      return h("ul", { class: "ws-explain" }, draw(node));
    };

    const openExplain = async (handle, displayName) => {
      if (!model.draft.rule) {
        ctx.toast({ title: "Finish the rule first", tone: "warning" });
        return;
      }
      const body = h("div", { class: "ws-explain-body" }, skeleton({ shape: "text", lines: 4 }));
      ctx.openDrawer({ title: `Why ${displayName ?? handle}?`, width: "md", body: scoped("segments", body) });
      try {
        const out = await api.call("people.facts", { handle });
        if (life.dead) return;
        const tree = explain(model.draft.rule, out.facts);
        body.replaceChildren(
          banner({
            tone: tree.pass ? "success" : "warning",
            title: tree.pass ? "This member matches." : "This member does not match.",
            body: `Checked against the rule as drafted${dirty() ? " (unsaved)" : ""}.`,
          }),
          renderExplain(tree, facts),
          h("h3", { class: "wk-caps" }, "Member facts"),
          kv(
            Object.entries(out.facts).map(([k, v]) => [
              k,
              Array.isArray(v) ? v.join(", ") || "none" : String(v),
            ]),
          ),
        );
      } catch (e) {
        if (life.dead) return;
        body.replaceChildren(errorState({ error: e }));
      }
    };

    // ---------- tabs ----------
    const distribution = (title, data) => {
      const entries = Object.entries(data ?? {})
        .map(([k, v]) => [k, countOf(v)])
        .filter(([, n]) => n > 0);
      if (entries.length === 0) return h("p", { class: "u-muted" }, `No ${title.toLowerCase()} data.`);
      return donut(
        entries.map(([k, n]) => ({ label: enumLabel(k), value: n })),
        { label: title },
      );
    };

    function paintPreview() {
      previewHost.replaceChildren();
      if (!model.draft.rule) {
        previewHost.append(
          emptyState({
            icon: "segment",
            title: "No rule yet",
            body: "Build the rule on the Rule tab; the preview follows as you type.",
          }),
        );
        return;
      }
      if (!preview) {
        previewHost.append(skeleton({ shape: "card", lines: 3 }));
        return;
      }
      const testState = { handle: "" };
      previewHost.append(
        h(
          "div",
          { class: "ws-builder__split" },
          h(
            "section",
            { "aria-label": "By tier" },
            h("h3", { class: "wk-caps" }, "By tier"),
            distribution("By tier", preview.by_tier),
          ),
          h(
            "section",
            { "aria-label": "By region" },
            h("h3", { class: "wk-caps" }, "By region"),
            distribution("By region", preview.by_region),
          ),
        ),
        h(
          "section",
          { "aria-label": "Sample members" },
          h(
            "h3",
            { class: "wk-caps" },
            `Sample members (${preview.sample.length} of ${number(preview.count)})`,
          ),
          preview.sample.length
            ? h(
                "ul",
                { class: "ws-builder__sample", role: "list" },
                ...preview.sample.map((m) =>
                  h(
                    "li",
                    {},
                    h(
                      "button",
                      {
                        type: "button",
                        class: "ws-sample",
                        onclick: () => {
                          bus.publish("member.selected", { id: m.person.handle });
                          openExplain(m.person.handle, m.person.display_name);
                        },
                      },
                      avatar({ name: m.person.display_name, avatar: m.person.avatar, size: "sm" }),
                      h(
                        "span",
                        { class: "ws-sample__name" },
                        m.person.display_name,
                        h("span", { class: "u-muted" }, ` ${m.title}`),
                      ),
                      statusPill("tier", m.tier),
                    ),
                  ),
                ),
              )
            : h("p", { class: "u-muted" }, "Nobody to show."),
        ),
        h(
          "section",
          { "aria-label": "Test a member" },
          h("h3", { class: "wk-caps" }, "Test a member"),
          h(
            "form",
            {
              class: "ws-builder__test",
              onsubmit: (e) => {
                e.preventDefault();
                if (testState.handle) openExplain(testState.handle);
              },
            },
            textField({
              name: "handle",
              label: "Member handle",
              placeholder: "maya-ortiz",
              onInput: (v) => (testState.handle = v.trim()),
            }),
            button({ label: "Explain", type: "submit", icon: "search" }),
          ),
        ),
        h(
          "section",
          { "aria-label": "Where this segment is used" },
          h("h3", { class: "wk-caps" }, "Used by"),
          preview.used_by?.length
            ? h(
                "ul",
                { class: "ws-builder__used", role: "list" },
                ...preview.used_by.map((n) =>
                  h(
                    "li",
                    {},
                    h("a", { href: `/${KIND_ROUTE[n.kind] ?? "search"}/${n.slug}` }, n.title),
                    h("span", { class: "u-muted" }, ` ${n.kind}`),
                  ),
                ),
              )
            : h("p", { class: "u-muted" }, "Not used by anything yet."),
        ),
      );
    }

    const rulePanel = () => {
      const { draft } = model;
      const slugField = textField({
        name: "/metadata/slug",
        label: "Slug",
        value: draft.slug,
        disabled: Boolean(model.existing),
        hint: model.existing
          ? "The slug cannot change after creation"
          : "Used in references such as segment:emea-gold",
        onInput: (v) => {
          slugTouched = true;
          draft.slug = v.trim();
          touch();
        },
      });
      return h(
        "div",
        { class: "ws-builder__panel" },
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
              if (!slugTouched && !model.existing) {
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
          value: draft.description,
          hint: "Say who this group is and why it exists",
          onInput: (v) => {
            draft.description = v;
            touch();
          },
        }),
        facts.length
          ? ruleBuilder({
              label: "Segment rule",
              facts,
              value: draft.rule,
              onChange: (tree) => {
                draft.rule = tree;
                touch();
                schedulePreview();
              },
            })
          : banner({
              tone: "warning",
              title: "Member facts are unavailable.",
              body: "The rule builder needs the builder catalogue.",
            }),
      );
    };

    const historyPanel = () => {
      const host = h("div", { class: "ws-builder__panel" });
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
        .then((rows) => !life.dead && host.replaceChildren(historyList(rows, "Segment history")))
        .catch((e) => !life.dead && host.replaceChildren(errorState({ error: e })));
      return host;
    };

    // ---------- save ----------
    const save = async () => {
      if (saving || !model) return;
      formErrors(null, { form: root });
      const { draft, existing } = model;
      if (!draft.title.trim())
        return formErrors(
          { code: "VALIDATION_FAILED", path: "/metadata/title", message: "Give the segment a title" },
          { form: root },
        );
      if (!existing && !SLUG_RE.test(draft.slug))
        return formErrors(
          {
            code: "VALIDATION_FAILED",
            path: "/metadata/slug",
            message: "Use a lowercase slug such as emea-gold",
          },
          { form: root },
        );
      if (!draft.rule)
        return formErrors(
          { code: "VALIDATION_FAILED", path: "/spec/rule", message: "Complete every condition in the rule" },
          { form: root },
        );
      if (existing && preview?.used_by?.length && !same(draft.rule, model.base.rule)) {
        const ok = await ctx.confirm({
          title: "Change a segment in use?",
          message: `${preview.used_by.length} item${preview.used_by.length === 1 ? "" : "s"} use this segment (${preview.used_by
            .slice(0, 3)
            .map((n) => n.title)
            .join(", ")}). The new rule applies to them at once.`,
          confirmLabel: "Save the rule",
        });
        if (!ok) return;
      }
      saving = true;
      saveBtn?.setAttribute("aria-busy", "true");
      try {
        const spec = {
          description: draft.description,
          rule: draft.rule,
          owner: existing?.spec.owner ?? userSubject(ctx),
        };
        const out = await saveNode(api, {
          kind: "Segment",
          slug: draft.slug,
          title: draft.title.trim(),
          spec,
          existing,
          prefix: "segment-save",
        });
        if (life.dead) return;
        ctx.toast({
          title: out.status === "unchanged" ? "Nothing to save" : "Segment saved",
          body: draft.title,
          tone: out.status === "unchanged" ? "neutral" : "success",
        });
        ctx.announce("Saved");
        if (!existing) {
          nav.go(`/segments/${draft.slug}`);
          return;
        }
        await load();
      } catch (e) {
        if (life.dead) return;
        if (isStale(e)) root.prepend(staleBanner(() => load()));
        else {
          formErrors(toErrorInfo(e), { form: root });
          failToast(ctx, e, "Could not save the segment");
        }
      } finally {
        saving = false;
        saveBtn?.removeAttribute("aria-busy");
      }
    };

    function build() {
      saveBtn = button({
        label: model.existing ? "Save segment" : "Create segment",
        icon: "check",
        variant: "primary",
        onClick: save,
        disabled: !canSave(),
      });
      const tabset = tabs({
        label: "Segment sections",
        items: [
          { id: "rule", label: "Rule", panel: rulePanel },
          {
            id: "preview",
            label: "Preview",
            panel: () => {
              paintPreview();
              return previewHost;
            },
          },
          { id: "history", label: "History", panel: historyPanel },
        ],
        selected: "rule",
      });
      root.replaceChildren(
        h(
          "div",
          { class: "ws-builder__bar" },
          h(
            "div",
            { class: "wp-builder__status" },
            model.existing
              ? h("span", { class: "u-muted" }, `Revision ${model.existing.revision}`)
              : pill({ label: "New", tone: "info" }),
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
            saveBtn,
          ),
        ),
        h(
          "div",
          { class: "ws-builder__layout" },
          h("div", { class: "ws-builder__main" }, tabset),
          h(
            "aside",
            { class: "ws-builder__aside", "aria-label": "Live match count" },
            card({ title: "Matches now", body: aside }),
          ),
        ),
      );
      dirtyMark.hidden = !dirty();
    }

    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && root.contains(document.activeElement)) {
        e.preventDefault();
        save();
      }
    };
    root.addEventListener("keydown", onKey);

    let notice = null;
    life.add(
      rt.onChange(
        (c) => model?.existing && c.node === model.existing.uri && c.rev > model.existing.revision,
        () => {
          if (!dirty()) {
            ctx.toast({
              title: "Segment updated elsewhere",
              body: "Showing the latest version.",
              tone: "info",
            });
            load();
          } else if (!notice) {
            notice = banner({
              tone: "warning",
              title: "This changed elsewhere.",
              body: "Reload to see it; your edits here will be lost.",
              actions: [
                button({
                  label: "Reload",
                  size: "sm",
                  onClick: () => {
                    notice = null;
                    load();
                  },
                }),
              ],
            });
            root.prepend(notice);
          }
        },
      ),
    );
    life.add(
      bus.subscribe("segment.selected", async ({ id }) => {
        if (!id || id === model?.existing?.slug) return;
        if (
          dirty() &&
          !(await ctx.confirm({
            title: "Switch segment?",
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
