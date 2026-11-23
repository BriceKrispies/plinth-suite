// audit.node-history: the revisions of one node (kernel history), a diff between any two revisions (kernel diff)
// and undo. The node comes from config (a reference, a URI or a route-bound slug). New revisions arrive live.
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { pill } from "../../ds/js/pill.js";
import { emptyState } from "../../ds/js/states.js";
import { selectField } from "../../ds/js/field.js";
import { dateTime } from "../../ds/js/format.js";
import { catalogEntry, schemaOf } from "../../core/widgets.js";
import { latest, region, timeNode, toErrorInfo, toastError } from "../reporting/_common.js";
import { actorLabel } from "../reporting/_events.js";
import { opLine } from "../reporting/_detail.js";
import { hashNode, kernelDiff, undoChange } from "./_audit.js";

// A bare slug from a route binding has no kind: try the kinds a node page can show, most likely first.
const KINDS = [
  "content",
  "promotion",
  "automation",
  "segment",
  "product",
  "badge",
  "category",
  "group",
  "role",
  "page",
  "widget",
  "dashboard",
  "panel",
  "program",
];

const resolveNode = async (api, ref) => {
  if (ref.includes(":") || ref.startsWith("plinth://") || /^[0-9a-f-]{36}$/.test(ref))
    return api.nodes.get(ref);
  let last;
  for (const kind of KINDS) {
    try {
      return await api.nodes.get(`${kind}:${ref}`);
    } catch (e) {
      last = e;
      if (toErrorInfo(e).code !== "UNKNOWN_REFERENCE") throw e;
    }
  }
  throw last;
};

export default {
  id: "audit.node-history",
  domain: "audit",
  title: "History",
  configSchema: schemaOf("audit.node-history"),
  sizes: catalogEntry("audit.node-history")?.sizes ?? [],
  mount(el, { config, size, api, rt, ctx }) {
    const compact = size === "m";
    const stage = region("rp-history__stage");
    const root = h("div", { class: `rp-app rp-history rp-history--${size}` }, stage.el);
    el.append(root);
    const next = latest();
    let alive = true;
    let node = null;
    let rows = [];
    let view = "revisions";
    let pick = { a: null, b: null };
    let offNode = () => {};
    const arrived = new Set();
    const timers = new Set();

    const ref = typeof config.node === "string" ? config.node : null;
    if (!ref) {
      stage.show(
        emptyState({
          icon: "history",
          title: "No node chosen",
          body: "This widget needs a node reference in its configuration.",
        }),
      );
      return () => {};
    }

    const refOf = () => `${node.kind.toLowerCase()}:${node.slug}`;
    const titleOf = () => node.body?.metadata?.title ?? node.slug;

    async function load({ first = false, live = false } = {}) {
      const ok = next();
      if (first) stage.loading({ lines: 5 });
      try {
        const n = await resolveNode(api, ref);
        const items = await api.nodes.history({ uri: n.uri, limit: 100 });
        if (!ok() || !alive) return;
        const known = new Set(rows.map((r) => r.seq));
        node = n;
        rows = items.map((it, i) => ({ ...it, revision: n.revision - i }));
        if (live) for (const r of rows) if (!known.has(r.seq)) arrived.add(r.seq);
        ctx.setTitle(`History: ${titleOf()}`);
        ctx.setCount(rows.length);
        if (first) {
          offNode();
          offNode = rt.onNode(n.uri, () => load({ live: true }));
        }
        if (view === "revisions") paintRevisions();
        if (live && arrived.size) ctx.announce("A new revision was recorded");
      } catch (e) {
        if (!ok() || !alive) return;
        const info = toErrorInfo(e);
        if (info.code === "UNKNOWN_REFERENCE") ctx.setState("unavailable", { reason: "missing" });
        else if (info.code === "FORBIDDEN") ctx.setState("unavailable", { reason: "forbidden" });
        else stage.error(e, () => load({ first: true }));
      }
    }

    const revisionLabel = (r) => `r${r.revision} · ${dateTime(r.at)} · ${actorLabel(r.actor)}`;

    // ---- revisions view ----
    function paintRevisions() {
      view = "revisions";
      if (rows.length === 0) {
        stage.show(
          emptyState({
            icon: "history",
            title: "No recorded revisions",
            body: "Changes to this node will be listed here.",
          }),
        );
        return;
      }
      const options = rows.map((r) => ({ value: String(r.revision), label: revisionLabel(r) }));
      const a = selectField({
        name: "a",
        label: "From revision",
        value: String(pick.a ?? rows[Math.min(1, rows.length - 1)].revision),
        options,
        onChange: (v) => (pick.a = Number(v)),
      });
      const b = selectField({
        name: "b",
        label: "To revision",
        value: String(pick.b ?? rows[0].revision),
        options,
        onChange: (v) => (pick.b = Number(v)),
      });
      pick = { a: Number(a.querySelector("select").value), b: Number(b.querySelector("select").value) };
      const compare = button({
        label: "Compare",
        icon: "sort",
        variant: "primary",
        onClick: () => {
          if (pick.a === pick.b) {
            ctx.toast({ title: "Choose two different revisions", tone: "warning" });
            return;
          }
          showDiff(Math.min(pick.a, pick.b), Math.max(pick.a, pick.b));
        },
      });
      const head = h(
        "header",
        { class: "rp-detail__head" },
        h("h3", { class: "rp-detail__heading" }, titleOf()),
        h(
          "div",
          { class: "rp-detail__pills" },
          pill({ label: node.kind }),
          pill({ label: `Revision ${node.revision}`, tone: "info" }),
        ),
      );
      const list = h(
        "ol",
        { class: "rp-rows", "aria-label": "Revisions, newest first" },
        ...rows.map((r) =>
          h(
            "li",
            { class: `rp-row${arrived.has(r.seq) ? " u-arrive" : ""}`, "data-key": String(r.seq) },
            h(
              "div",
              { class: "rp-row__main" },
              h("span", { class: "rp-row__title" }, `Revision ${r.revision}`),
              h("p", { class: "rp-row__summary" }, r.ops_summary || "No paths recorded"),
              h(
                "div",
                { class: "rp-row__meta" },
                h("span", {}, actorLabel(r.actor)),
                r.on_behalf_of ? h("span", {}, `for ${actorLabel(r.on_behalf_of)}`) : null,
                timeNode(r.at),
                pill({ label: r.surface }),
                ...(r.rule_id ?? []).map((x) => pill({ label: x, tone: "info" })),
                r.approved_by
                  ? pill({ label: `Approved by ${actorLabel(r.approved_by)}`, tone: "success" })
                  : null,
                r.undo_of ? pill({ label: `Undoes #${r.undo_of}`, tone: "warning" }) : null,
                r.reason ? h("span", {}, `“${r.reason}”`) : null,
                arrived.has(r.seq) ? pill({ label: "New", tone: "signal" }) : null,
              ),
              compact
                ? null
                : h(
                    "div",
                    { class: "rp-meta-line" },
                    "Change ",
                    h("span", { class: "u-mono" }, `#${r.seq}`),
                    " ",
                    hashNode(r.change_hash),
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
                    onClick: () => showDiff(r.revision - 1, r.revision),
                  })
                : null,
              button({
                label: "Undo",
                icon: "history",
                size: "sm",
                variant: "ghost",
                onClick: async () => {
                  const out = await undoChange({
                    ctx,
                    seq: r.seq,
                    subject: r.ops_summary || `revision ${r.revision}`,
                  });
                  if (!out) return;
                  ctx.toast({ title: "Change undone", body: `Revision ${r.revision}`, tone: "success" });
                  ctx.announce("Change undone");
                  load({ live: true });
                },
              }),
            ),
          ),
        ),
      );
      stage.show(
        head,
        h("div", { class: "rp-form__row" }, a, b),
        h("div", { class: "rp-detail__actions" }, compare),
        list,
      );
      for (const seq of arrived) {
        const t = setTimeout(() => (timers.delete(t), arrived.delete(seq)), 6000);
        timers.add(t);
      }
    }

    // ---- diff view ----
    async function showDiff(a, b) {
      view = "diff";
      const ok = next();
      const back = button({
        label: "Back to revisions",
        icon: "chevron-left",
        variant: "ghost",
        size: "sm",
        onClick: () => {
          view = "revisions";
          paintRevisions();
        },
      });
      stage.show(
        back,
        h(
          "h3",
          { class: "rp-detail__heading", tabindex: "-1", "data-focus": "" },
          `Revision ${a} to revision ${b}`,
        ),
        h("p", { class: "u-muted" }, "Loading the difference."),
      );
      stage.el.querySelector("[data-focus]")?.focus({ preventScroll: true });
      try {
        const d = await kernelDiff(refOf(), a, b);
        if (!ok() || !alive || view !== "diff") return;
        stage.show(
          back,
          h(
            "h3",
            { class: "rp-detail__heading", tabindex: "-1", "data-focus": "" },
            `Revision ${a} to revision ${b}`,
          ),
          h("p", { class: "rp-notice", "data-tone": d.ops.length ? "info" : "success" }, d.human_summary),
          d.changed_paths.length
            ? h(
                "div",
                { class: "rp-detail__pills", "aria-label": "Changed paths" },
                ...d.changed_paths.map((p) => pill({ label: p || "(document)" })),
              )
            : null,
          d.ops.length
            ? h(
                "ul",
                { class: "rp-ops", "aria-label": "Operations" },
                ...d.ops.map((o) => h("li", { class: "u-mono" }, opLine(o))),
              )
            : emptyState({
                icon: "check-circle",
                title: "No differences",
                body: "These two revisions have the same content.",
              }),
        );
      } catch (e) {
        if (!ok() || !alive || view !== "diff") return;
        toastError(ctx.toast, e, "Could not compare those revisions");
        stage.show(
          back,
          emptyState({
            icon: "alert",
            title: "The comparison failed",
            body: toErrorInfo(e).message ?? "Try again.",
          }),
        );
      }
    }

    load({ first: true });
    return () => {
      alive = false;
      offNode();
      for (const t of timers) clearTimeout(t);
    };
  },
};
