// content.editor: block editor with live preview, settings (metadata, audience, reviewers, schedule), the review
// workflow, versions and a block diff. Body edits are only possible while the item is a draft.
import { schemaOf } from "../../core/widgets.js";
import { h } from "../../ds/js/dom.js";
import { button, iconButton } from "../../ds/js/button.js";
import { card } from "../../ds/js/card.js";
import { artwork } from "../../ds/js/artwork.js";
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
import { pill } from "../../ds/js/pill.js";
import { personChip } from "../../ds/js/avatar.js";
import { tabs } from "../../ds/js/tabs.js";
import { timeline } from "../../ds/js/timeline.js";
import { emptyState, skeleton, errorState } from "../../ds/js/states.js";
import { icon, ICON_PATHS } from "../../ds/js/icons.js";
import {
  lifecycle,
  debounce,
  clone,
  same,
  slugify,
  SLUG_RE,
  csv,
  userSubject,
  toUtcInput,
  fromUtcInput,
  nowIso,
  saveNode,
  banner,
  staleBanner,
  isStale,
  failToast,
  promptNote,
  openForm,
  invalid,
  reasonOf,
  displayPill,
  enumLabel,
  toErrorInfo,
  rel,
  when,
} from "../promotions/_kit.js";
import {
  BLOCK_TYPES,
  TYPE_META,
  REACTIONS,
  blockLabel,
  defaultBlock,
  renderBlocks,
  diffBlocks,
  diffFields,
} from "./_blocks.js";

const PATTERNS = ["solid", "stripes", "dots", "rings", "grid", "waves"];
const TONES = ["info", "success", "warning", "danger", "signal", "neutral"];
const ART_ICONS = [
  "article",
  "document",
  "announcement",
  "megaphone",
  "trophy",
  "gift",
  "star",
  "sparkle",
  "bolt",
  "flame",
  "target",
  "leaf",
  "globe",
  "sun",
  "book",
  "users",
  "heart",
  "image",
  "coins",
  "calendar",
];
const CALLOUT_ICONS = [
  "info",
  "alert",
  "bolt",
  "star",
  "check-circle",
  "megaphone",
  "sparkle",
  "flame",
  "gift",
  "trophy",
];
const TAG_RE = /^[a-z][a-z0-9-]{0,31}$/;
const SUBJECT_RE = /^(user|agent|service):[a-z0-9][a-z0-9._-]*$/;
const REF_RE = (kind) => new RegExp(`^${kind}:[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*$`);
const HREF_RE = /^\/[A-Za-z0-9/_.:?=&%-]*$/;
const iconOk = (names) => names.filter((n) => n in ICON_PATHS);

export default {
  id: "content.editor",
  domain: "content",
  title: "Content editor",
  configSchema: schemaOf("content.editor"),
  sizes: ["xl", "full"],
  mount(el, { config, size, api, rt, bus, nav, ctx }) {
    const life = lifecycle();
    const root = h("div", { class: `wn wn-editor wn-editor--${size}` });
    el.append(root);

    let current = typeof config.content === "string" ? config.content : null;
    let model = null;
    let segments = [];
    let groups = [];
    let slugTouched = false;
    let saving = false;
    let saveBtn = null;
    let external = null;
    let versions = null; // { items, head, published_revision }
    let versionsPromise = null;
    const dirtyMark = h("span", { hidden: true }, pill({ label: "Unsaved changes", tone: "warning" }));
    let previewHosts = new Set();
    let diffCtl = null;
    let tabset = null;

    const me = ctx.memberHandle("$me");
    const strip = (d) => JSON.parse(JSON.stringify(d));
    const dirty = () => model && !same(strip(model.draft), strip(model.base));
    const editable = () => !model?.existing || model.draft.spec.status === "draft";
    const touch = () => {
      dirtyMark.hidden = !dirty();
      schedulePreview();
    };

    // ---------- load ----------
    const blankSpec = () => ({
      type: "article",
      status: "draft",
      summary: "",
      hero: { icon: "article", hue: 220, pattern: "solid" },
      blocks: [defaultBlock("paragraph")],
      tags: [],
      audience: { everyone: true },
      author: userSubject(ctx),
      reviewers: [],
      schedule: {},
      pinned: false,
      allow_reactions: true,
      published_revision: null,
      review_log: [],
    });

    let seq = 0;
    const load = async () => {
      const mine = ++seq;
      root.replaceChildren(skeleton({ shape: "card", lines: 4 }));
      try {
        const [pre, segs, grps] = await Promise.all([
          current ? api.call("content.preview", { slug: current }) : null,
          api
            .call("segments.list", {})
            .then((r) => r.items)
            .catch(() => []),
          api
            .call("groups.list", {})
            .then((r) => r.items)
            .catch(() => []),
        ]);
        if (life.dead || mine !== seq) return;
        segments = segs;
        groups = grps;
        const existing = pre
          ? {
              uri: pre.node.uri,
              revision: pre.node.revision,
              slug: pre.node.slug,
              title: pre.node.title,
              spec: pre.spec,
            }
          : null;
        const draft = existing
          ? { title: existing.title, slug: existing.slug, spec: clone(existing.spec) }
          : { title: "", slug: "", spec: blankSpec() };
        model = { existing, draft, base: clone(draft) };
        slugTouched = Boolean(existing);
        versions = null;
        versionsPromise = null;
        external = null;
        ctx.setTitle(existing ? `Editing: ${existing.title}` : "New content");
        build();
      } catch (e) {
        if (life.dead || mine !== seq) return;
        root.replaceChildren(errorState({ error: e, retry: load }));
      }
    };

    // ---------- validation ----------
    const validate = () => {
      const { draft, existing } = model;
      const s = draft.spec;
      const errs = [];
      const add = (tab, path, message) => errs.push({ tab, path, message });
      if (!draft.title.trim()) add("settings", "/metadata/title", "Give the content a title");
      if (!existing && !SLUG_RE.test(draft.slug))
        add("settings", "/metadata/slug", "Use a lowercase slug such as spring-update");
      if (s.summary.length > 280) add("settings", "/spec/summary", "Keep the summary under 280 characters");
      if (s.blocks.length < 1) add("blocks", "/spec/blocks", "Add at least one block");
      if (s.blocks.length > 60) add("blocks", "/spec/blocks", "Up to 60 blocks");
      s.blocks.forEach((b, i) => {
        const p = `/spec/blocks/${i}`;
        const n = `Block ${i + 1}`;
        switch (b.type) {
          case "heading":
            if (!b.text.trim()) add("blocks", `${p}/text`, `${n}: the heading is empty`);
            if (b.text.length > 140) add("blocks", `${p}/text`, `${n}: a heading is at most 140 characters`);
            break;
          case "paragraph":
            if (!b.text.trim()) add("blocks", `${p}/text`, `${n}: the paragraph is empty`);
            if (b.text.length > 4000)
              add("blocks", `${p}/text`, `${n}: a paragraph is at most 4000 characters`);
            break;
          case "list":
            if (b.items.length < 1 || b.items.some((x) => !x.trim()))
              add("blocks", `${p}/items`, `${n}: list items cannot be empty`);
            if (b.items.length > 30) add("blocks", `${p}/items`, `${n}: up to 30 list items`);
            break;
          case "quote":
          case "callout":
            if (!b.text.trim()) add("blocks", `${p}/text`, `${n}: the text is empty`);
            break;
          case "image":
            if (!b.alt.trim()) add("blocks", `${p}/alt`, `${n}: describe the image for screen readers`);
            break;
          case "cta":
            if (!b.label.trim()) add("blocks", `${p}/label`, `${n}: add a button label`);
            if (!HREF_RE.test(b.href))
              add("blocks", `${p}/href`, `${n}: the link is an app route such as /store`);
            break;
          case "panel":
            if (!REF_RE("panel").test(b.panel)) add("blocks", `${p}/panel`, `${n}: use panel:<slug>`);
            break;
          case "products":
            if (
              b.products.length < 1 ||
              b.products.length > 8 ||
              !b.products.every((x) => REF_RE("product").test(x))
            )
              add("blocks", `${p}/products`, `${n}: list 1 to 8 products as product:<slug>`);
            break;
          case "badge":
            if (!REF_RE("badge").test(b.badge)) add("blocks", `${p}/badge`, `${n}: use badge:<slug>`);
            break;
          default:
        }
      });
      if (s.tags.length > 10 || s.tags.some((t) => !TAG_RE.test(t)))
        add("settings", "/spec/tags", "Up to 10 tags of lowercase letters, digits and dashes");
      if (!s.audience.everyone && !(s.audience.segments?.length || s.audience.groups?.length))
        add("settings", "/spec/audience", "Choose who can see it: everyone, a segment or a group");
      if (s.reviewers.some((r) => !SUBJECT_RE.test(r)))
        add("settings", "/spec/reviewers", "Reviewers are written user:handle");
      if (
        s.schedule.unpublish_at &&
        s.schedule.publish_at &&
        new Date(s.schedule.unpublish_at) <= new Date(s.schedule.publish_at)
      )
        add("settings", "/spec/schedule/unpublish_at", "Unpublish must be after publish");
      return errs;
    };

    const cleanSpec = () => {
      const s = clone(model.draft.spec);
      if (s.audience.everyone) s.audience = { everyone: true };
      else {
        if (!s.audience.segments?.length) delete s.audience.segments;
        if (!s.audience.groups?.length) delete s.audience.groups;
      }
      if (!s.allow_reactions) delete s.reactions_enabled;
      if (!s.schedule.unpublish_at) delete s.schedule.unpublish_at;
      return s;
    };

    // ---------- save ----------
    const save = async () => {
      if (saving || !model) return;
      if (!editable())
        return ctx.toast({
          title: "Only drafts can be edited",
          body: "Use Revise to start a new draft.",
          tone: "warning",
        });
      formErrors(null, { form: root });
      const errs = validate();
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
      saveBtn?.setAttribute("aria-busy", "true");
      try {
        const out = await saveNode(api, {
          kind: "Content",
          slug: model.draft.slug,
          title: model.draft.title.trim(),
          spec: cleanSpec(),
          existing: model.existing,
          skip: ["status", "review_log", "published_revision"],
          prefix: "content-save",
        });
        if (life.dead) return;
        if (out.status === "unchanged") ctx.toast({ title: "Nothing to save", tone: "neutral" });
        else ctx.toast({ title: "Draft saved", body: model.draft.title, tone: "success" });
        ctx.announce("Saved");
        if (!model.existing) {
          nav.go(`/content/${model.draft.slug}`);
          return;
        }
        await load();
      } catch (e) {
        if (life.dead) return;
        if (isStale(e)) root.prepend(staleBanner(() => load()));
        else {
          formErrors(toErrorInfo(e), { form: root });
          failToast(ctx, e, "Could not save the draft");
        }
      } finally {
        saving = false;
        saveBtn?.removeAttribute("aria-busy");
      }
    };

    // ---------- workflow ----------
    const transition = async (action, { note, publish_at } = {}) => {
      const { existing } = model;
      try {
        const out = await api.call("content.transition", {
          slug: existing.slug,
          action,
          ...(note ? { note } : {}),
          ...(publish_at ? { publish_at } : {}),
          base_revision: existing.revision,
        });
        if (life.dead) return true;
        ctx.toast({
          title: out.status === "pending_approval" ? "Sent for approval" : `${enumLabel(action)} done`,
          body: existing.title,
          tone: out.status === "pending_approval" ? "info" : "success",
        });
        ctx.announce(`${enumLabel(action)} done`);
        load();
        return true;
      } catch (e) {
        const reason = reasonOf(e);
        if (reason === "SELF_ACTION")
          ctx.toast({ title: "You cannot do this to your own content", tone: "warning" });
        else if (reason === "NOT_ELIGIBLE")
          ctx.toast({
            title: "You are not allowed to do this",
            body: toErrorInfo(e).message,
            tone: "warning",
          });
        else failToast(ctx, e, `Could not ${action.replace("_", " ")}`);
        return false;
      }
    };

    const workflowActions = () => {
      const { existing, draft } = model;
      if (!existing) return [];
      const s = draft.spec;
      const author = s.author === `user:${me}`;
      const reviewer = s.reviewers.includes(`user:${me}`);
      const out = [];
      const needSaved = (fn) => async () => {
        if (dirty()) return ctx.toast({ title: "Save or discard your edits first", tone: "warning" });
        return fn();
      };
      const noted = (action, title, opts = {}) =>
        needSaved(async () => {
          const note = await promptNote(ctx, {
            title,
            label: opts.label ?? "Note (optional)",
            required: opts.required,
            hint: opts.hint,
            submitLabel: opts.submit ?? enumLabel(action),
            danger: opts.danger,
          });
          if (note === null) return;
          await transition(action, { note });
        });
      switch (s.status) {
        case "draft":
          if (ctx.can("content:author") && (author || ctx.can("content:publish")))
            out.push({
              action: "submit",
              label: "Submit for review",
              icon: "send",
              primary: true,
              run: needSaved(async () => {
                if (s.reviewers.length < 1)
                  return ctx.toast({
                    title: "Add a reviewer first",
                    body: "Reviewers are set in the settings tab.",
                    tone: "warning",
                  });
                await noted("submit", "Submit for review", { hint: "Reviewers are notified." })();
              }),
            });
          if (ctx.can("content:publish"))
            out.push({
              action: "archive",
              label: "Archive",
              icon: "archive",
              danger: true,
              run: noted("archive", `Archive ${existing.title}`, { danger: true }),
            });
          break;
        case "in_review":
          if (ctx.can("content:review") && reviewer && !author) {
            out.push({
              action: "approve",
              label: "Approve",
              icon: "check",
              primary: true,
              run: noted("approve", `Approve ${existing.title}`),
            });
            out.push({
              action: "request_changes",
              label: "Request changes",
              icon: "reply",
              run: noted("request_changes", `Request changes: ${existing.title}`, {
                required: true,
                label: "What should change?",
                submit: "Send back",
                hint: "The author sees this note.",
              }),
            });
          }
          break;
        case "approved":
          if (ctx.can("content:publish")) {
            out.push({
              action: "publish",
              label: "Publish now",
              icon: "megaphone",
              primary: true,
              run: noted("publish", `Publish ${existing.title}`, {
                hint: "It goes live to its audience at once.",
              }),
            });
            out.push({
              action: "schedule",
              label: s.schedule.publish_at ? "Reschedule" : "Schedule",
              icon: "calendar",
              run: needSaved(openSchedule),
            });
            if (s.schedule.publish_at)
              out.push({
                action: "unschedule",
                label: "Unschedule",
                icon: "x",
                run: noted("unschedule", "Unschedule publishing"),
              });
            out.push({
              action: "archive",
              label: "Archive",
              icon: "archive",
              danger: true,
              run: noted("archive", `Archive ${existing.title}`, { danger: true }),
            });
          }
          break;
        case "published":
          if (ctx.can("content:author"))
            out.push({
              action: "revise",
              label: "Revise",
              icon: "edit",
              primary: true,
              run: noted("revise", `Revise ${existing.title}`, {
                hint: "A new draft starts while the published version stays live.",
              }),
            });
          if (ctx.can("content:publish"))
            out.push({
              action: "archive",
              label: "Archive",
              icon: "archive",
              danger: true,
              run: noted("archive", `Archive ${existing.title}`, { danger: true }),
            });
          break;
        case "archived":
          if (ctx.can("content:author"))
            out.push({
              action: "restore",
              label: "Restore as draft",
              icon: "history",
              primary: true,
              run: noted("restore", `Restore ${existing.title}`),
            });
          break;
        default:
      }
      return out;
    };

    const openSchedule = () => {
      let at = toUtcInput(
        model.draft.spec.schedule.publish_at ??
          new Date(new Date(nowIso()).getTime() + 3600000).toISOString(),
      );
      let note = "";
      openForm(ctx, {
        title: "Schedule publishing",
        width: "sm",
        submitLabel: "Schedule",
        fields: [
          dateTimeField({
            name: "/publish_at",
            label: "Publish at (UTC)",
            value: at,
            required: true,
            hint: "The scheduler publishes it at this time.",
            onInput: (v) => (at = v),
          }),
          textArea({ name: "/note", label: "Note (optional)", rows: 2, onInput: (v) => (note = v) }),
        ],
        onSubmit: async () => {
          const iso = fromUtcInput(at);
          if (!iso || new Date(iso) <= new Date(nowIso()))
            throw invalid("/publish_at", "Choose a time in the future");
          const ok = await transition("schedule", { note: note.trim() || undefined, publish_at: iso });
          return ok ? undefined : false;
        },
      });
    };

    // ---------- blocks panel ----------
    const blockField = (b, i, redraw) => {
      const p = `/spec/blocks/${i}`;
      const upd = (fn) => (v) => {
        fn(v);
        touch();
      };
      switch (b.type) {
        case "heading":
          return [
            h(
              "div",
              { class: "wk-grid-2" },
              selectField({
                name: `${p}/level`,
                label: "Level",
                value: String(b.level),
                options: [
                  { value: "2", label: "Section heading" },
                  { value: "3", label: "Sub-heading" },
                ],
                onChange: upd((v) => (b.level = Number(v))),
              }),
              textField({
                name: `${p}/text`,
                label: "Text",
                value: b.text,
                required: true,
                onInput: upd((v) => (b.text = v)),
              }),
            ),
          ];
        case "paragraph":
          return [
            textArea({
              name: `${p}/text`,
              label: "Text",
              rows: 5,
              value: b.text,
              required: true,
              hint: "**bold**, _emphasis_ and @handle are supported",
              onInput: upd((v) => (b.text = v)),
            }),
          ];
        case "list":
          return [
            switchField({
              name: `${p}/ordered`,
              label: "Numbered list",
              value: b.ordered,
              onChange: upd((v) => (b.ordered = v)),
            }),
            textArea({
              name: `${p}/items`,
              label: "Items (one per line)",
              rows: 4,
              value: b.items.join("\n"),
              onInput: upd((v) => (b.items = v.split("\n").filter((l) => l.length > 0 || false))),
            }),
          ];
        case "quote":
          return [
            textArea({
              name: `${p}/text`,
              label: "Quote",
              rows: 3,
              value: b.text,
              required: true,
              onInput: upd((v) => (b.text = v)),
            }),
            textField({
              name: `${p}/cite`,
              label: "Attribution (optional)",
              value: b.cite ?? "",
              onInput: upd((v) => (b.cite = v || undefined)),
            }),
          ];
        case "callout":
          return [
            h(
              "div",
              { class: "wk-grid-2" },
              selectField({
                name: `${p}/tone`,
                label: "Tone",
                value: b.tone,
                options: TONES.map((t) => ({ value: t, label: enumLabel(t) })),
                onChange: upd((v) => (b.tone = v)),
              }),
              selectField({
                name: `${p}/icon`,
                label: "Icon",
                value: b.icon,
                options: iconOk(CALLOUT_ICONS).map((t) => ({ value: t, label: enumLabel(t) })),
                onChange: upd((v) => (b.icon = v)),
              }),
            ),
            textArea({
              name: `${p}/text`,
              label: "Text",
              rows: 3,
              value: b.text,
              required: true,
              onInput: upd((v) => (b.text = v)),
            }),
          ];
        case "image":
          return [
            h(
              "div",
              { class: "wk-grid-2" },
              selectField({
                name: `${p}/artwork/icon`,
                label: "Icon",
                value: b.artwork.icon,
                options: iconOk(ART_ICONS).map((t) => ({ value: t, label: enumLabel(t) })),
                onChange: upd((v) => (b.artwork.icon = v)),
              }),
              selectField({
                name: `${p}/artwork/pattern`,
                label: "Pattern",
                value: b.artwork.pattern,
                options: PATTERNS.map((t) => ({ value: t, label: enumLabel(t) })),
                onChange: upd((v) => (b.artwork.pattern = v)),
              }),
              numberField({
                name: `${p}/artwork/hue`,
                label: "Hue (0 to 359)",
                value: b.artwork.hue,
                min: 0,
                max: 359,
                step: 1,
                onInput: upd((v) => (b.artwork.hue = Math.max(0, Math.min(359, Math.round(v ?? 0))))),
              }),
              textField({
                name: `${p}/artwork/glyph`,
                label: "Glyph (up to 3 characters)",
                value: b.artwork.glyph ?? "",
                onInput: upd((v) => (b.artwork.glyph = v.slice(0, 3) || undefined)),
              }),
            ),
            textField({
              name: `${p}/alt`,
              label: "Description for screen readers",
              value: b.alt,
              required: true,
              onInput: upd((v) => (b.alt = v)),
            }),
            textField({
              name: `${p}/caption`,
              label: "Caption (optional)",
              value: b.caption ?? "",
              onInput: upd((v) => (b.caption = v || undefined)),
            }),
          ];
        case "cta":
          return [
            h(
              "div",
              { class: "wk-grid-2" },
              textField({
                name: `${p}/label`,
                label: "Button label",
                value: b.label,
                required: true,
                onInput: upd((v) => (b.label = v)),
              }),
              textField({
                name: `${p}/href`,
                label: "Link (an app route)",
                value: b.href,
                required: true,
                hint: "For example /store or /badges",
                onInput: upd((v) => (b.href = v.trim())),
              }),
            ),
          ];
        case "panel":
          return [
            h(
              "div",
              { class: "wk-grid-2" },
              textField({
                name: `${p}/panel`,
                label: "Panel",
                value: b.panel,
                hint: "panel:<slug>",
                onInput: upd((v) => (b.panel = v.trim())),
              }),
              textField({
                name: `${p}/dashboard`,
                label: "Dashboard (optional)",
                value: b.dashboard ?? "",
                onInput: upd((v) => (b.dashboard = v.trim() || undefined)),
              }),
            ),
          ];
        case "products":
          return [
            textField({
              name: `${p}/products`,
              label: "Products",
              value: b.products.join(", "),
              hint: "Up to 8, comma separated: product:fleece-quarter-zip",
              onInput: upd((v) => (b.products = csv(v))),
            }),
          ];
        case "badge":
          return [
            textField({
              name: `${p}/badge`,
              label: "Badge",
              value: b.badge,
              hint: "badge:<slug>",
              onInput: upd((v) => (b.badge = v.trim())),
            }),
          ];
        default:
          return [h("p", { class: "u-muted" }, "This block has no settings.")];
      }
    };

    const blocksPanel = () => {
      const s = model.draft.spec;
      const edit = editable();
      const list = h("div", { class: "wn-blocklist" });
      const side = h("aside", { class: "wn-editor__side", "aria-label": "Live preview" });
      previewHosts.add(side);
      const draw = (focusIndex = null) => {
        list.replaceChildren(
          ...s.blocks.map((b, i) =>
            h(
              "section",
              {
                class: "wn-bcard",
                "data-i": i,
                tabindex: "-1",
                "aria-label": `Block ${i + 1}: ${blockLabel(b.type)}`,
              },
              h(
                "header",
                { class: "wn-bcard__head" },
                h("strong", {}, `${i + 1}. ${blockLabel(b.type)}`),
                edit
                  ? h(
                      "span",
                      { class: "wn-bcard__tools" },
                      iconButton({
                        icon: "chevron-up",
                        label: `Move block ${i + 1} up`,
                        size: "sm",
                        disabled: i === 0,
                        onClick: () => move(i, i - 1),
                      }),
                      iconButton({
                        icon: "chevron-down",
                        label: `Move block ${i + 1} down`,
                        size: "sm",
                        disabled: i === s.blocks.length - 1,
                        onClick: () => move(i, i + 1),
                      }),
                      iconButton({
                        icon: "copy",
                        label: `Duplicate block ${i + 1}`,
                        size: "sm",
                        disabled: s.blocks.length >= 60,
                        onClick: () => dup(i),
                      }),
                      iconButton({
                        icon: "trash",
                        label: `Remove block ${i + 1}`,
                        size: "sm",
                        onClick: () => remove(i),
                      }),
                    )
                  : null,
              ),
              h("div", { class: "wn-bcard__body wk-stack" }, ...blockField(b, i, draw)),
            ),
          ),
          ...[
            s.blocks.length === 0
              ? emptyState({
                  icon: "article",
                  title: "No blocks",
                  body: "Add the first block to start writing.",
                })
              : null,
          ].filter(Boolean),
        );
        if (!edit) list.querySelectorAll("input, select, textarea").forEach((x) => (x.disabled = true));
        if (focusIndex !== null)
          queueMicrotask(() => list.querySelector(`[data-i="${focusIndex}"]`)?.focus());
        schedulePreview();
      };
      const move = (from, to) => {
        const [b] = s.blocks.splice(from, 1);
        s.blocks.splice(to, 0, b);
        ctx.announce(`Block ${from + 1} moved to position ${to + 1}`);
        touch();
        draw(to);
      };
      const dup = (i) => {
        s.blocks.splice(i + 1, 0, clone(s.blocks[i]));
        ctx.announce(`Block ${i + 1} duplicated`);
        touch();
        draw(i + 1);
      };
      const remove = (i) => {
        s.blocks.splice(i, 1);
        ctx.announce(`Block removed, ${s.blocks.length} left`);
        touch();
        draw(Math.max(0, i - 1));
      };
      const add = (type) => {
        s.blocks.push(defaultBlock(type));
        ctx.announce(`${blockLabel(type)} block added`);
        touch();
        draw(s.blocks.length - 1);
      };
      const adder = edit
        ? h(
            "div",
            { class: "wk-actions" },
            menuButton({
              label: "Add a block",
              icon: "plus",
              variant: "secondary",
              items: BLOCK_TYPES.map((t) => ({ label: t.label, icon: t.icon, onSelect: () => add(t.type) })),
            }),
            s.blocks.length >= 60 ? h("span", { class: "u-muted" }, "Up to 60 blocks") : null,
          )
        : null;
      draw();
      return h(
        "div",
        { class: "wn-editor__split" },
        h("div", { class: "wn-editor__main wk-stack" }, !edit ? readOnlyBanner() : null, list, adder),
        side,
      );
    };

    const readOnlyBanner = () =>
      banner({
        tone: "info",
        title: "Read only.",
        body:
          model.draft.spec.status === "published"
            ? "Published content cannot be edited; use Revise to start a new draft while this stays live."
            : "Only drafts can be edited. Use the workflow actions to change its state.",
      });

    // ---------- preview rendering ----------
    const paintPreviews = () => {
      const { draft } = model;
      const s = draft.spec;
      for (const host of [...previewHosts]) {
        if (!host.isConnected && host.dataset.seen) {
          previewHosts.delete(host);
          continue;
        }
        host.dataset.seen = host.isConnected ? "1" : "";
        host.replaceChildren(
          h(
            "article",
            { class: "wn-article wn-article--preview", "data-widget-domain": "content" },
            h(
              "header",
              { class: "wn-article__head" },
              h("div", { class: "wn-article__hero" }, artwork(s.hero, { size: 96 })),
              h(
                "div",
                { class: "wn-article__titles" },
                h(
                  "p",
                  { class: "wn-article__eyebrow" },
                  pill({
                    label: TYPE_META[s.type].label,
                    tone: s.type === "announcement" ? "signal" : "neutral",
                    icon: TYPE_META[s.type].icon,
                  }),
                  s.pinned ? pill({ label: "Pinned", tone: "info", icon: "star" }) : null,
                ),
                h("h2", { class: "wn-article__title" }, draft.title || "Untitled"),
                s.summary ? h("p", { class: "wn-article__summary" }, s.summary) : null,
              ),
            ),
            renderBlocks(s.blocks, { idPrefix: "pv" }),
            s.tags.length
              ? h(
                  "ul",
                  { class: "wn-tags", role: "list" },
                  ...s.tags.map((t) => h("li", {}, pill({ label: t }))),
                )
              : null,
          ),
        );
      }
    };
    const schedulePreview = debounce(life, () => model && paintPreviews(), 250);

    // ---------- settings ----------
    const settingsPanel = () => {
      const { draft, existing } = model;
      const s = draft.spec;
      const edit = editable();
      const art = h("span", { class: "wn-hero-preview" }, artwork(s.hero, { size: 64 }));
      const redrawArt = () => art.replaceChildren(artwork(s.hero, { size: 64 }));
      const slugField = textField({
        name: "/metadata/slug",
        label: "Slug",
        value: draft.slug,
        disabled: Boolean(existing),
        hint: existing
          ? "The slug cannot change after creation"
          : "Used in the address, such as /read/spring-update",
        onInput: (v) => {
          slugTouched = true;
          draft.slug = v.trim();
          touch();
        },
      });
      const audienceHost = h("div", { class: "wk-grid-2" });
      const drawAudience = () => {
        audienceHost.replaceChildren();
        if (s.audience.everyone) return;
        const pick = (label, key, list, prefix) =>
          combobox({
            label,
            name: `/spec/audience/${key}`,
            multiple: true,
            value: (s.audience[key] ?? []).map((r) => ({
              value: r.split(":")[1],
              label: list.find((x) => x.node.slug === r.split(":")[1])?.node.title ?? r,
            })),
            placeholder: `Search ${label.toLowerCase()}`,
            search: async (q) =>
              list
                .filter((x) => `${x.node.title} ${x.node.slug}`.toLowerCase().includes(q.toLowerCase()))
                .slice(0, 12)
                .map((x) => ({ value: x.node.slug, label: x.node.title, description: x.description })),
            onChange: (v) => {
              s.audience[key] = v.map((o) => `${prefix}:${o.value}`);
              touch();
            },
          });
        audienceHost.append(
          pick("Segments", "segments", segments, "segment"),
          pick("Groups", "groups", groups, "group"),
        );
      };
      drawAudience();
      const reactionsHost = h("div", {});
      const drawReactions = () => {
        reactionsHost.replaceChildren();
        if (!s.allow_reactions) return;
        reactionsHost.append(
          checkboxField({
            name: "/spec/reactions_enabled",
            label: "Which reactions",
            options: REACTIONS.map((r) => ({ value: r.value, label: r.label })),
            value: s.reactions_enabled ?? REACTIONS.map((r) => r.value),
            onChange: (v) => {
              s.reactions_enabled = v;
              touch();
            },
          }),
        );
      };
      drawReactions();
      const panel = h(
        "div",
        { class: "wn-editor__panel wk-stack" },
        !edit ? readOnlyBanner() : null,
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
          selectField({
            name: "/spec/type",
            label: "Type",
            value: s.type,
            options: Object.entries(TYPE_META).map(([k, v]) => ({ value: k, label: v.label })),
            onChange: (v) => ((s.type = v), touch()),
          }),
          h("div", { class: "wn-hero-row" }, h("span", { class: "wk-caps" }, "Hero"), art),
        ),
        textArea({
          name: "/spec/summary",
          label: "Summary",
          rows: 2,
          value: s.summary,
          hint: "Up to 280 characters; shown in the feed",
          onInput: (v) => ((s.summary = v), touch()),
        }),
        card({
          title: "Hero artwork",
          body: h(
            "div",
            { class: "wk-grid-2" },
            selectField({
              name: "/spec/hero/icon",
              label: "Icon",
              value: s.hero.icon,
              options: iconOk(ART_ICONS).map((t) => ({ value: t, label: enumLabel(t) })),
              onChange: (v) => ((s.hero.icon = v), redrawArt(), touch()),
            }),
            selectField({
              name: "/spec/hero/pattern",
              label: "Pattern",
              value: s.hero.pattern,
              options: PATTERNS.map((t) => ({ value: t, label: enumLabel(t) })),
              onChange: (v) => ((s.hero.pattern = v), redrawArt(), touch()),
            }),
            numberField({
              name: "/spec/hero/hue",
              label: "Hue (0 to 359)",
              value: s.hero.hue,
              min: 0,
              max: 359,
              step: 1,
              onInput: (v) => (
                (s.hero.hue = Math.max(0, Math.min(359, Math.round(v ?? 0)))),
                redrawArt(),
                touch()
              ),
            }),
            textField({
              name: "/spec/hero/glyph",
              label: "Glyph (up to 3 characters)",
              value: s.hero.glyph ?? "",
              onInput: (v) => ((s.hero.glyph = v.slice(0, 3) || undefined), redrawArt(), touch()),
            }),
          ),
        }),
        textField({
          name: "/spec/tags",
          label: "Tags",
          value: s.tags.join(", "),
          hint: "Comma separated, lowercase, up to 10",
          onInput: (v) => ((s.tags = csv(v)), touch()),
        }),
        card({
          title: "Audience",
          body: h(
            "div",
            { class: "wk-stack" },
            switchField({
              name: "/spec/audience/everyone",
              label: "Visible to everyone",
              value: s.audience.everyone,
              onChange: (v) => ((s.audience.everyone = v), drawAudience(), touch()),
            }),
            audienceHost,
          ),
        }),
        card({
          title: "Review and publishing",
          body: h(
            "div",
            { class: "wk-stack" },
            textField({
              name: "/spec/reviewers",
              label: "Reviewers",
              value: s.reviewers.join(", "),
              hint: "Comma separated: user:handle. At least one is needed to submit.",
              onInput: (v) => ((s.reviewers = csv(v)), touch()),
            }),
            h(
              "p",
              { class: "u-muted" },
              "Author: ",
              personChip({
                display_name: s.author.split(":")[1] ?? s.author,
                kind: "human",
                handle: s.author.split(":")[1],
                avatar: { initials: (s.author.split(":")[1] ?? "?").slice(0, 2).toUpperCase(), hue: 220 },
              }),
            ),
            s.schedule.publish_at
              ? h(
                  "p",
                  {},
                  icon("calendar", { size: 16 }),
                  ` Scheduled to publish ${when(s.schedule.publish_at)} (${rel(s.schedule.publish_at)})`,
                )
              : null,
            dateTimeField({
              name: "/spec/schedule/unpublish_at",
              label: "Archive automatically at (UTC, optional)",
              value: toUtcInput(s.schedule.unpublish_at),
              onInput: (v) => ((s.schedule.unpublish_at = fromUtcInput(v) || undefined), touch()),
            }),
            switchField({
              name: "/spec/pinned",
              label: "Pin to the top of the feed",
              value: s.pinned,
              onChange: (v) => ((s.pinned = v), touch()),
            }),
            switchField({
              name: "/spec/allow_reactions",
              label: "Allow reactions",
              value: s.allow_reactions,
              onChange: (v) => ((s.allow_reactions = v), drawReactions(), touch()),
            }),
            reactionsHost,
          ),
        }),
        s.review_log?.length
          ? card({
              title: "Review log",
              body: timeline({
                label: "Review log",
                now: nowIso(),
                items: [...s.review_log].reverse().map((r) => ({
                  title: `${enumLabel(r.decision)} (revision ${r.revision})`,
                  body: r.note ?? null,
                  at: r.at,
                  tone:
                    r.decision === "changes_requested"
                      ? "warning"
                      : r.decision === "published" || r.decision === "approved"
                        ? "success"
                        : "neutral",
                  actor: {
                    display_name: r.by.split(":")[1] ?? r.by,
                    kind: "human",
                    handle: r.by.split(":")[1] ?? null,
                    avatar: { initials: (r.by.split(":")[1] ?? "?").slice(0, 2).toUpperCase(), hue: 220 },
                  },
                })),
              }),
            })
          : null,
      );
      if (!edit) panel.querySelectorAll("input, select, textarea").forEach((x) => (x.disabled = true));
      return panel;
    };

    const previewPanel = () => {
      const host = h("div", { class: "wn-editor__panel wn-preview" });
      previewHosts.add(host);
      paintPreviews();
      return host;
    };

    // ---------- versions and diff ----------
    const ensureVersions = () => {
      if (!model.existing) return Promise.resolve(null);
      versionsPromise ??= api
        .call("content.versions", { slug: model.existing.slug })
        .then((v) => (versions = v));
      return versionsPromise;
    };

    const openRevision = async (rev) => {
      const body = h(
        "div",
        { class: "wn-article wn-article--preview" },
        skeleton({ shape: "text", lines: 4 }),
      );
      ctx.openDrawer({ title: `Revision ${rev}`, width: "lg", body });
      try {
        const out = await api.call("content.preview", { slug: model.existing.slug, revision: rev });
        if (life.dead) return;
        const s = out.spec;
        body.replaceChildren(
          h(
            "p",
            { class: "wn-article__eyebrow" },
            displayPill(s.status),
            ` ${TYPE_META[s.type]?.label ?? s.type}`,
          ),
          h("h2", { class: "wn-article__title" }, out.node.title),
          ...[s.summary ? h("p", { class: "wn-article__summary" }, s.summary) : null].filter(Boolean),
          renderBlocks(s.blocks, { idPrefix: `rev${rev}` }),
        );
      } catch (e) {
        if (!life.dead) body.replaceChildren(errorState({ error: e }));
      }
    };

    const gotoDiff = (from, to) => {
      diffCtl?.set(from, to);
      tabset?.querySelector('[data-id="diff"]')?.click();
    };

    const versionsPanel = () => {
      const host = h("div", { class: "wn-editor__panel wk-stack" });
      if (!model.existing) {
        host.append(
          emptyState({
            icon: "history",
            title: "No versions yet",
            body: "Versions appear after the first save.",
          }),
        );
        return host;
      }
      host.append(skeleton({ shape: "text", lines: 4 }));
      ensureVersions()
        .then((v) => {
          if (life.dead) return;
          host.replaceChildren(
            h(
              "p",
              { class: "u-muted" },
              `Head is revision ${v.head}${v.published_revision !== null ? `; revision ${v.published_revision} is live` : ""}.`,
            ),
            h(
              "ol",
              { class: "wn-versions", "aria-label": "Revisions, newest first" },
              ...v.items.map((it) =>
                h(
                  "li",
                  { class: "wn-version" },
                  h(
                    "div",
                    { class: "wn-version__main" },
                    h("strong", {}, `Revision ${it.revision}`),
                    displayPill(it.status),
                    it.published ? pill({ label: "Live", tone: "success", icon: "check-circle" }) : null,
                    it.revision === v.head ? pill({ label: "Head", tone: "info" }) : null,
                  ),
                  h(
                    "p",
                    { class: "u-muted" },
                    `${it.actor.display_name} · ${when(it.at)}${it.reason ? ` · ${it.reason}` : ""}`,
                  ),
                  it.paths.length
                    ? h(
                        "p",
                        { class: "u-muted wn-version__paths" },
                        `Changed ${it.paths.slice(0, 4).join(", ")}${it.paths.length > 4 ? ` and ${it.paths.length - 4} more` : ""}`,
                      )
                    : null,
                  h(
                    "div",
                    { class: "wk-actions" },
                    button({
                      label: "Preview",
                      size: "sm",
                      icon: "eye",
                      onClick: () => openRevision(it.revision),
                    }),
                    it.revision !== v.head
                      ? button({
                          label: "Compare with head",
                          size: "sm",
                          icon: "sort",
                          onClick: () => gotoDiff(it.revision, v.head),
                        })
                      : null,
                  ),
                ),
              ),
            ),
          );
        })
        .catch((e) => !life.dead && host.replaceChildren(errorState({ error: e })));
      return host;
    };

    const diffPanel = () => {
      const host = h("div", { class: "wn-editor__panel wk-stack" });
      const out = h("div", { class: "wn-diffout", "aria-live": "polite" });
      const sel = { from: null, to: null };
      let fromSel = null;
      let toSel = null;
      if (!model.existing) {
        host.append(
          emptyState({
            icon: "sort",
            title: "Nothing to compare",
            body: "Save the content to start a history.",
          }),
        );
        return host;
      }
      const run = async () => {
        if (sel.from === null || sel.to === null) return;
        out.replaceChildren(skeleton({ shape: "text", lines: 3 }));
        try {
          const d = await api.call("content.diff", { slug: model.existing.slug, from: sel.from, to: sel.to });
          if (life.dead) return;
          out.replaceChildren(
            h("p", {}, d.human_summary),
            ...[
              d.changed_paths.length
                ? h("p", { class: "u-muted" }, `Changed paths: ${d.changed_paths.join(", ")}`)
                : null,
            ].filter(Boolean),
            diffFields(d.fields),
            diffBlocks(d.blocks),
          );
          ctx.announce("Comparison ready");
        } catch (e) {
          if (!life.dead) out.replaceChildren(errorState({ error: e, retry: run }));
        }
      };
      const drawSelectors = () => {
        const opts = (versions?.items ?? []).map((v) => ({
          value: String(v.revision),
          label: `Revision ${v.revision}`,
        }));
        fromSel = selectField({
          name: "from",
          label: "From",
          value: String(sel.from ?? ""),
          options: [{ value: "", label: "Choose" }, ...opts],
          onChange: (v) => (sel.from = v ? Number(v) : null),
        });
        toSel = selectField({
          name: "to",
          label: "To",
          value: String(sel.to ?? ""),
          options: [{ value: "", label: "Choose" }, ...opts],
          onChange: (v) => (sel.to = v ? Number(v) : null),
        });
        host.replaceChildren(
          h(
            "div",
            { class: "wn-diff__pick" },
            fromSel,
            toSel,
            button({ label: "Compare", icon: "sort", variant: "primary", onClick: run }),
          ),
          out,
        );
      };
      diffCtl = {
        set: async (from, to) => {
          sel.from = from;
          sel.to = to;
          await ensureVersions().catch(() => null);
          drawSelectors();
          run();
        },
      };
      host.append(skeleton({ shape: "text", lines: 2 }));
      ensureVersions()
        .then((v) => {
          if (life.dead) return;
          if (sel.from === null && v.items.length > 1) {
            sel.to = v.head;
            sel.from =
              v.published_revision !== null && v.published_revision < v.head
                ? v.published_revision
                : (v.items[v.items.length - 1]?.revision ?? 1);
          }
          drawSelectors();
          if (sel.from !== null && sel.to !== null && sel.from !== sel.to) run();
          else out.append(h("p", { class: "u-muted" }, "Choose two revisions to compare."));
        })
        .catch((e) => !life.dead && host.replaceChildren(errorState({ error: e })));
      return host;
    };

    // ---------- chrome ----------
    function build() {
      previewHosts = new Set();
      diffCtl = null;
      const { existing, draft } = model;
      const s = draft.spec;
      const edit = editable();
      saveBtn = button({
        label: existing ? "Save draft" : "Create draft",
        icon: "check",
        variant: "primary",
        onClick: save,
        disabled: !edit,
      });
      const actions = workflowActions();
      tabset = tabs({
        label: "Editor sections",
        items: [
          { id: "blocks", label: "Blocks", panel: blocksPanel },
          { id: "settings", label: "Settings", panel: settingsPanel },
          { id: "preview", label: "Preview", panel: previewPanel },
          { id: "versions", label: "Versions", panel: versionsPanel },
          { id: "diff", label: "Diff", panel: diffPanel },
        ],
        selected: "blocks",
      });
      const display = existing
        ? s.status === "approved" && s.schedule.publish_at
          ? "scheduled"
          : s.status === "draft" && s.published_revision !== null
            ? "revising"
            : s.status
        : null;
      root.replaceChildren(
        h(
          "div",
          { class: "wn-editor__bar" },
          h(
            "div",
            { class: "wp-builder__status" },
            existing ? displayPill(display) : pill({ label: "New", tone: "info" }),
            existing ? h("span", { class: "u-muted" }, `Revision ${existing.revision}`) : null,
            s.published_revision !== null
              ? pill({ label: `Live: revision ${s.published_revision}`, tone: "success" })
              : null,
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
            ...actions.map((a) =>
              button({
                label: a.label,
                icon: a.icon,
                variant: a.danger ? "danger" : a.primary ? "secondary" : "secondary",
                onClick: a.run,
              }),
            ),
            saveBtn,
          ),
        ),
        ...[
          s.status === "in_review" && existing
            ? banner({
                tone: "info",
                title: "In review.",
                body: `Waiting on ${s.reviewers.length ? s.reviewers.join(", ") : "a reviewer"}.`,
              })
            : null,
        ].filter(Boolean),
        tabset,
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

    // ---------- realtime and bus ----------
    const changedElsewhere = (text) => {
      if (!model?.existing) return;
      if (!dirty()) {
        ctx.toast({ title: "Content updated", body: text, tone: "info" });
        load();
      } else if (!external) {
        external = banner({
          tone: "warning",
          title: "This changed elsewhere.",
          body: `${text} Reload to see it; your edits here will be lost.`,
          actions: [button({ label: "Reload", size: "sm", onClick: () => load() })],
        });
        root.prepend(external);
      }
    };
    life.add(
      rt.on("content.state_changed", (ev) => {
        const p = ev.payload;
        if (p.content !== model?.existing?.slug) return;
        changedElsewhere(`${enumLabel(p.from)} to ${enumLabel(p.to)}${p.note ? `: ${p.note}` : ""}.`);
      }),
    );
    life.add(
      rt.onChange(
        (c) => model?.existing && c.node === model.existing.uri && c.rev > model.existing.revision,
        () => changedElsewhere("A new revision was saved."),
      ),
    );
    life.add(
      bus.subscribe("content.selected", async ({ id }) => {
        if (!id || typeof config.content === "string" || id === model?.existing?.slug) return;
        if (
          dirty() &&
          !(await ctx.confirm({
            title: "Switch content?",
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
