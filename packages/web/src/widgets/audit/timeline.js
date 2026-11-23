// audit.timeline: the change log and the domain events merged by time. Filters (source, actor, text, region, time
// range), an entry view with the full detail and hash, undo for undoable changes, realtime arrivals at the top,
// and a member filter driven by the page bus (member.selected).
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { pill } from "../../ds/js/pill.js";
import { personChip } from "../../ds/js/avatar.js";
import { emptyState } from "../../ds/js/states.js";
import { dateTimeField, searchField, selectField, textField } from "../../ds/js/field.js";
import { dateTime } from "../../ds/js/format.js";
import { catalogEntry, schemaOf } from "../../core/widgets.js";
import {
  debounce,
  keyValues,
  latest,
  localInputToIso,
  region,
  timeNode,
  toErrorInfo,
} from "../reporting/_common.js";
import { splitPane } from "../reporting/_split.js";
import { hashNode, undoChange } from "./_audit.js";

const REGIONS = ["NA", "EMEA", "APAC", "LATAM", "ANZ"];
const SUBJECT = /^(user|agent|service):[a-z0-9][a-z0-9._-]*$/;
const PAGE = 40;

const keyOf = (e) => `${e.source}:${e.seq}`;

export default {
  id: "audit.timeline",
  domain: "audit",
  title: "Audit log",
  configSchema: schemaOf("audit.timeline"),
  sizes: catalogEntry("audit.timeline")?.sizes ?? [],
  mount(el, { config, size, api, rt, bus, nav, ctx }) {
    const st = {
      sources: new Set(config.sources?.length ? config.sources : ["change", "event"]),
      actor: config.actor ?? "",
      q: "",
      region: "any",
      from: "",
      to: "",
      items: [],
      next: null,
      selected: null,
      arrived: new Set(),
      member: null,
    };
    const next = latest();
    let alive = true;
    const timers = new Set();

    const list = region("rp-audit__list");
    const tools = h("div", { class: "rp-tools" });
    const chips = h("div", { class: "rp-chips", hidden: true });
    const pane = splitPane({
      label: "Audit log",
      placeholder: emptyState({
        icon: "audit",
        title: "Select an entry",
        body: "Its full detail, hash and undo appear here.",
      }),
    });
    pane.list.append(list.el);
    el.append(h("div", { class: `rp-app rp-audit rp-audit--${size}` }, tools, chips, pane.el));

    const effectiveActor = () => st.member ?? (st.actor || undefined);

    // ---- toolbar ----
    const sourceButtons = () =>
      ["change", "event"].map((s) =>
        button({
          label: s === "change" ? "Changes" : "Events",
          icon: s === "change" ? "edit" : "bolt",
          size: "sm",
          variant: "secondary",
          pressed: st.sources.has(s),
          onClick: () => {
            if (st.sources.has(s) && st.sources.size === 1) return;
            if (st.sources.has(s)) st.sources.delete(s);
            else st.sources.add(s);
            reset();
          },
        }),
      );

    const paintTools = () => {
      const search = searchField({
        name: "q",
        label: "Search",
        value: st.q,
        placeholder: "Summary or what",
        onInput: debounce((v) => {
          st.q = v;
          reset();
        }, 300),
      });
      search.classList.add("c-field--grow");
      const actorField = textField({
        name: "actor",
        label: "Actor",
        value: st.actor,
        placeholder: "user:maya-ortiz",
        hint: "A subject such as user:handle or agent:name",
        onChange: (v) => {
          const t = v.trim();
          if (t && !SUBJECT.test(t)) {
            ctx.toast({
              title: "Not a subject",
              body: "Use user:handle, agent:name or service:name.",
              tone: "warning",
            });
            return;
          }
          st.actor = t;
          reset();
        },
      });
      tools.replaceChildren(
        h("div", { class: "rp-segment", role: "group", "aria-label": "Sources" }, ...sourceButtons()),
        search,
        actorField,
        selectField({
          name: "region",
          label: "Region",
          value: st.region,
          options: [{ value: "any", label: "Any region" }, ...REGIONS.map((r) => ({ value: r, label: r }))],
          onChange: (v) => ((st.region = v), reset()),
        }),
        dateTimeField({
          name: "from",
          label: "From",
          value: st.from,
          onChange: (v) => ((st.from = v), reset()),
        }),
        dateTimeField({ name: "to", label: "To", value: st.to, onChange: (v) => ((st.to = v), reset()) }),
      );
      const list2 = [];
      if (st.member)
        list2.push(
          h(
            "span",
            { class: "rp-chip" },
            `Member ${st.member}`,
            button({
              label: "Clear member filter",
              icon: "x",
              iconOnly: true,
              size: "sm",
              variant: "ghost",
              onClick: () => ((st.member = null), paintTools(), reset()),
            }),
          ),
        );
      chips.replaceChildren(...list2);
      chips.hidden = list2.length === 0;
    };

    const reset = () => {
      st.next = null;
      st.selected = null;
      pane.clearDetail();
      load({ first: true });
    };

    // ---- loading ----
    const query = (cursor) => ({
      sources: [...st.sources],
      actor: effectiveActor(),
      q: st.q.trim() || undefined,
      from: localInputToIso(st.from) ?? undefined,
      to: localInputToIso(st.to) ?? undefined,
      region: st.region === "any" ? undefined : st.region,
      cursor: cursor ?? undefined,
      limit: PAGE,
    });

    async function load({ first = false, silent = false, more = false } = {}) {
      const ok = next();
      if (first) list.loading({ lines: 5 });
      else if (!silent) list.busy(true);
      try {
        const out = await api.call("audit.timeline", query(more ? st.next : null));
        if (!ok() || !alive) return;
        if (more) {
          st.items = [...st.items, ...out.items];
          st.next = out.next_cursor;
        } else if (silent && st.items.length) {
          const known = new Set(st.items.map(keyOf));
          for (const e of out.items) if (!known.has(keyOf(e))) st.arrived.add(keyOf(e));
          const fresh = out.items.filter((e) => st.arrived.has(keyOf(e)));
          if (fresh.length)
            ctx.announce(fresh.length === 1 ? "1 new audit entry" : `${fresh.length} new audit entries`);
          const merged = new Map([...out.items, ...st.items].map((e) => [keyOf(e), e]));
          st.items = [...merged.values()].sort((x, y) => y.at.localeCompare(x.at) || y.seq - x.seq);
        } else {
          st.items = out.items;
          st.next = out.next_cursor;
        }
        list.busy(false);
        ctx.setCount(st.items.length);
        paintList();
        for (const k of st.arrived) {
          const row = list.el.querySelector(`[data-key="${CSS.escape(k)}"]`);
          if (!row) continue;
          row.classList.add("u-arrive");
          const t = setTimeout(() => (timers.delete(t), row.classList.remove("u-arrive")), 6000);
          timers.add(t);
        }
      } catch (e) {
        if (!ok() || !alive) return;
        list.busy(false);
        if (toErrorInfo(e).code === "FORBIDDEN") ctx.setState("unavailable", { reason: "forbidden" });
        else if (silent) return;
        else list.error(e, () => load({ first: true }));
      }
    }

    // ---- list ----
    const rowNode = (e) => {
      const k = keyOf(e);
      return h(
        "li",
        { class: `rp-row${st.selected === k ? " is-selected" : ""}`, "data-key": k },
        h(
          "div",
          { class: "rp-row__main" },
          h(
            "button",
            {
              type: "button",
              class: "rp-row__title",
              "aria-current": st.selected === k ? "true" : null,
              onclick: () => select(e),
            },
            e.what,
          ),
          h("p", { class: "rp-row__summary" }, e.summary),
          h(
            "div",
            { class: "rp-row__meta" },
            personChip(e.actor),
            e.on_behalf_of ? h("span", {}, "for ", personChip(e.on_behalf_of)) : null,
            timeNode(e.at),
            pill({ label: e.surface }),
            ...e.rule_id.map((r) => pill({ label: r, tone: "info" })),
            st.arrived.has(k) ? pill({ label: "New", tone: "signal" }) : null,
          ),
        ),
        h(
          "div",
          { class: "rp-row__side" },
          pill({
            label: e.source === "change" ? "Change" : "Event",
            icon: e.source === "change" ? "edit" : "bolt",
          }),
          e.undoable ? pill({ label: "Undoable", tone: "warning" }) : null,
        ),
      );
    };

    function paintList() {
      if (st.items.length === 0) {
        const filtered = st.q || st.actor || st.member || st.from || st.to || st.region !== "any";
        list.show(
          emptyState({
            icon: "audit",
            title: filtered ? "No entries match" : "The log is empty",
            body: filtered
              ? "Loosen a filter to see more of the log."
              : "Changes and events are recorded here as they happen.",
          }),
        );
        return;
      }
      list.show(
        h("ol", { class: "rp-rows", "aria-label": "Audit entries, newest first" }, ...st.items.map(rowNode)),
        st.next
          ? h(
              "div",
              { class: "rp-more" },
              button({
                label: "Load older entries",
                icon: "chevron-down",
                variant: "secondary",
                onClick: () => load({ more: true }),
              }),
            )
          : null,
      );
    }

    // ---- entry ----
    function select(e) {
      st.selected = keyOf(e);
      st.arrived.delete(keyOf(e));
      paintList();
      paintDetail(e);
      pane.showDetail();
    }

    function paintDetail(e) {
      const undo = e.undoable
        ? button({
            label: "Undo this change",
            icon: "history",
            variant: "danger",
            onClick: async () => {
              const out = await undoChange({ ctx, seq: e.seq, subject: e.summary });
              if (!out) return;
              ctx.toast({ title: "Change undone", body: e.summary, tone: "success" });
              ctx.announce("Change undone");
              load({ silent: true });
              pane.clearDetail();
              st.selected = null;
              paintList();
            },
          })
        : null;
      pane.detail.replaceChildren(
        h(
          "article",
          { class: "rp-detail", "aria-label": e.what },
          h(
            "header",
            { class: "rp-detail__head" },
            h("h3", { class: "rp-detail__heading", tabindex: "-1", "data-focus": "" }, e.what),
            h(
              "div",
              { class: "rp-detail__pills" },
              pill({ label: e.source === "change" ? "Change" : "Event" }),
              pill({ label: e.surface }),
              ...e.rule_id.map((r) => pill({ label: r, tone: "info" })),
            ),
          ),
          h("p", {}, e.summary),
          keyValues([
            ["Sequence", `#${e.seq}`],
            ["When", h("time", { datetime: e.at }, dateTime(e.at))],
            ["Actor", personChip(e.actor)],
            ["On behalf of", e.on_behalf_of ? personChip(e.on_behalf_of) : null],
            ["Approved by", e.approved_by ? personChip(e.approved_by) : null],
            ["Hash", hashNode(e.hash)],
          ]),
          h(
            "div",
            { class: "rp-detail__actions" },
            e.link
              ? h(
                  "a",
                  { class: "c-button c-button--secondary c-button--sm", href: nav.href(e.link) },
                  "Open the item",
                )
              : null,
            button({
              label: `Only ${e.actor.display_name}`,
              icon: "filter",
              size: "sm",
              variant: "secondary",
              onClick: () => {
                st.actor = e.actor.subject;
                paintTools();
                reset();
              },
            }),
            undo,
          ),
        ),
      );
    }

    // ---- bus and realtime ----
    const offs = [
      bus.subscribe("member.selected", (p) => {
        if (!p?.id) return;
        st.member = String(p.id).includes(":") ? String(p.id) : `user:${p.id}`;
        paintTools();
        reset();
      }),
    ];
    const refresh = debounce(() => load({ silent: true }), 700);
    offs.push(
      rt.onChange(
        (c) => c.kind !== "present",
        () => refresh(),
      ),
    );

    const initial = bus.latest?.("member.selected");
    if (initial?.id) st.member = String(initial.id).includes(":") ? String(initial.id) : `user:${initial.id}`;
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
