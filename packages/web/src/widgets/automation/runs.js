// automation.runs: run history with status filters; a run opens inside the widget with per-step status, retry and
// cancel. Follows automation.selected and run.selected on the page bus.
import { schemaOf } from "../../core/widgets.js";
import { h } from "../../ds/js/dom.js";
import { button, iconButton } from "../../ds/js/button.js";
import { dataTable, pager } from "../../ds/js/table.js";
import { emptyState, skeleton, errorState } from "../../ds/js/states.js";
import { searchField } from "../../ds/js/field.js";
import { statusPill, pill } from "../../ds/js/pill.js";
import { personChip } from "../../ds/js/avatar.js";
import { toolbar } from "../../ds/js/layout.js";

import { icon } from "../../ds/js/icons.js";
import {
  lifecycle,
  debounce,
  chipFilter,
  arrive,
  kv,
  jsonBlock,
  rel,
  when,
  banner,
  failToast,
  enumLabel,
} from "../promotions/_kit.js";
import { RUN_STATUSES, runTriggerText, stepIcon, STEP_META, durationText, errorLine } from "./_auto.js";

export default {
  id: "automation.runs",
  domain: "automation",
  title: "Run history",
  configSchema: schemaOf("automation.runs"),
  sizes: ["m", "l", "xl", "full"],
  mount(el, { config, size, api, rt, bus, ctx }) {
    const life = lifecycle();
    const compact = size === "m";
    const fixed = typeof config.automation === "string" ? config.automation : null;
    const limit = config.page_size ?? 15;
    const st = {
      view: "list",
      automation: fixed,
      statuses: new Set(config.status ?? []),
      q: "",
      items: [],
      next: null,
      stack: [], // cursors of previous pages
      cursor: null,
      runId: null,
      run: null,
      fresh: new Set(),
    };

    const listHost = h("div", { class: "wa-runs__list" });
    const runHost = h("div", { class: "wa-runs__run", hidden: true });
    const live = h("p", { class: "sr-only", "aria-live": "polite" });
    const results = h("div", { class: "wa-results" });
    const scope = h("p", { class: "wa-runs__scope" });

    const filter = chipFilter({
      label: "Filter runs by status",
      value: [...st.statuses],
      options: RUN_STATUSES.map((s) => ({ value: s, label: enumLabel(s) })),
      onChange: (v) => {
        st.statuses = new Set(v);
        resetList();
      },
    });
    const search = searchField({
      name: "q",
      label: "Filter loaded runs",
      placeholder: "Filter by automation, member or error",
      onInput: debounce(
        life,
        (v) => {
          st.q = v.trim().toLowerCase();
          paintList();
        },
        150,
      ),
    });
    search.classList.add("wk-search");
    listHost.append(
      h(
        "div",
        { class: "wa-runs__filters" },
        filter,
        compact ? null : toolbar({ label: "Run search", children: [search] }),
      ),
      scope,
      results,
    );
    el.append(h("div", { class: `wa wa-runs wa-runs--${size}` }, live, listHost, runHost));

    // ---------- list ----------
    let lseq = 0;
    const loadList = async () => {
      const mine = ++lseq;
      results.setAttribute("aria-busy", "true");
      if (st.items.length === 0) results.replaceChildren(skeleton({ shape: "table", lines: 5 }));
      try {
        const out = await api.call("automation.runs", {
          ...(st.automation ? { automation: st.automation } : {}),
          ...(st.statuses.size ? { status: [...st.statuses] } : {}),
          limit,
          ...(st.cursor ? { cursor: st.cursor } : {}),
        });
        if (life.dead || mine !== lseq) return;
        st.items = out.items;
        st.next = out.next_cursor;
        results.removeAttribute("aria-busy");
        paintList();
      } catch (e) {
        if (life.dead || mine !== lseq) return;
        results.removeAttribute("aria-busy");
        results.replaceChildren(errorState({ error: e, retry: loadList }));
        ctx.setCount(0);
      }
    };
    const resetList = () => {
      st.stack = [];
      st.cursor = null;
      st.items = [];
      loadList();
    };

    const visible = () =>
      st.items.filter(
        (r) =>
          !st.q ||
          `${r.automation_title} ${r.automation} ${r.member?.display_name ?? ""} ${r.member?.handle ?? ""} ${r.error?.code ?? ""} ${r.error?.message ?? ""}`
            .toLowerCase()
            .includes(st.q),
      );

    const openRun = (id) => {
      st.runId = id;
      st.view = "run";
      bus.publish("run.selected", { id });
      paintView();
      loadRun();
    };

    function paintList() {
      results.replaceChildren();
      scope.textContent = st.automation ? `Showing runs of ${st.automation}` : "";
      scope.hidden = !st.automation;
      if (st.automation && !fixed)
        scope.append(
          " ",
          button({
            label: "Show all automations",
            size: "sm",
            variant: "ghost",
            onClick: () => {
              st.automation = null;
              resetList();
            },
          }),
        );
      const rows = visible();
      ctx.setCount(rows.length);
      if (st.items.length === 0) {
        results.append(
          emptyState({
            icon: "history",
            title: st.statuses.size || st.automation ? "No runs match" : "No runs yet",
            body: st.statuses.size
              ? "No run has one of the chosen statuses."
              : "Runs appear when an automation fires or is run by hand.",
          }),
        );
        return;
      }
      if (rows.length === 0) {
        results.append(
          emptyState({
            icon: "search",
            title: "No loaded run matches",
            body: `Nothing found for ‘${st.q}’ on this page.`,
          }),
        );
        return;
      }
      if (compact) {
        results.append(
          h(
            "ul",
            { class: "wa-runs__compact", role: "list" },
            ...rows.map((r) =>
              h(
                "li",
                {},
                h(
                  "button",
                  {
                    type: "button",
                    class: "wa-runrow",
                    "data-run": r.run_id,
                    onclick: () => openRun(r.run_id),
                  },
                  statusPill("run", r.status),
                  h("span", { class: "wa-runrow__title" }, r.automation_title),
                  h("span", { class: "u-muted wa-runrow__when" }, rel(r.started_at ?? r.finished_at)),
                ),
              ),
            ),
          ),
        );
      } else {
        const table = dataTable({
          caption: "Automation runs",
          density: size === "l" ? "compact" : "default",
          rows,
          rowKey: (r) => r.run_id,
          onRowClick: (r) => openRun(r.run_id),
          columns: [
            { key: "status", label: "Status", render: (r) => statusPill("run", r.status) },
            { key: "automation", label: "Automation", render: (r) => h("strong", {}, r.automation_title) },
            { key: "trigger", label: "Trigger", render: (r) => runTriggerText(r.trigger) },
            ...(size === "l"
              ? []
              : [{ key: "member", label: "Member", render: (r) => (r.member ? personChip(r.member) : "–") }]),
            { key: "started", label: "Started", render: (r) => rel(r.started_at) || "–" },
            { key: "took", label: "Took", render: (r) => durationText(r.started_at, r.finished_at) || "–" },
            {
              key: "steps",
              label: "Steps",
              align: "end",
              render: (r) => `${r.steps_succeeded}/${r.steps_total}`,
            },
            { key: "error", label: "Error", render: (r) => (r.error ? h("code", {}, r.error.code) : "") },
          ],
        });
        for (const tr of table.querySelectorAll("tbody tr")) {
          tr.dataset.run = tr.dataset.key;
          tr.tabIndex = 0;
          tr.addEventListener("keydown", (e) => {
            if (e.target === tr && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              openRun(tr.dataset.key);
            }
          });
        }
        results.append(table);
      }
      if (st.next || st.stack.length)
        results.append(
          pager({
            label: "Run pages",
            nextCursor: st.next,
            onNext: (c) => {
              st.stack.push(st.cursor);
              st.cursor = c;
              loadList();
            },
            onPrev: st.stack.length
              ? () => {
                  st.cursor = st.stack.pop();
                  loadList();
                }
              : undefined,
          }),
        );
      for (const id of st.fresh) arrive(life, results.querySelector(`[data-run="${CSS.escape(id)}"]`), false);
      st.fresh.clear();
    }

    // ---------- run detail ----------
    let rseq = 0;
    const loadRun = async () => {
      const mine = ++rseq;
      if (!st.run || st.run.run_id !== st.runId)
        runHost.replaceChildren(header(null), skeleton({ shape: "card", lines: 4 }));
      try {
        const out = await api.call("automation.run", { run_id: st.runId });
        if (life.dead || mine !== rseq) return;
        st.run = out;
        paintRun();
      } catch (e) {
        if (life.dead || mine !== rseq) return;
        runHost.replaceChildren(header(null), errorState({ error: e, retry: loadRun }));
      }
    };

    const header = (run) =>
      h(
        "div",
        { class: "wa-run__head" },
        button({
          label: "Back to runs",
          icon: "chevron-left",
          variant: "ghost",
          size: "sm",
          onClick: () => {
            st.view = "list";
            st.run = null;
            paintView();
            ctx.setTitle(config.title ?? "Run history");
          },
        }),
        run
          ? h(
              "div",
              { class: "wa-run__title" },
              h("h3", {}, run.automation_title),
              statusPill("run", run.status),
              h("span", { class: "u-muted" }, `revision ${run.automation_revision}`),
            )
          : null,
        run ? iconButton({ icon: "history", label: "Refresh run", size: "sm", onClick: loadRun }) : null,
      );

    const act = async (kind, run) => {
      const retry = kind === "retry";
      const ok = await ctx.confirm({
        title: retry ? "Retry this run?" : "Cancel this run?",
        message: retry
          ? "Failed and pending steps run again with their original idempotency keys, so steps that already succeeded do not repeat."
          : "It stops after its current step. Steps already done stay done.",
        confirmLabel: retry ? "Retry" : "Cancel run",
        tone: retry ? "default" : "danger",
      });
      if (!ok) return;
      try {
        const out = retry
          ? await api.call("automation.retry", {
              run_id: run.run_id,
              idempotency_key: api.idempotencyKey("run-retry"),
            })
          : await api.call("automation.cancel", { run_id: run.run_id });
        if (life.dead) return;
        if (retry)
          ctx.toast({
            title: "Retry started",
            body: `New run ${out.status}.`,
            tone: "info",
            action: { label: "Open it", onClick: () => openRun(out.run_id) },
          });
        else ctx.toast({ title: "Run cancelled", tone: "neutral" });
        ctx.announce(retry ? "Retry started" : "Run cancelled");
        loadRun();
        loadList();
      } catch (e) {
        failToast(ctx, e, retry ? "Could not retry the run" : "Could not cancel the run");
      }
    };

    function paintRun() {
      const run = st.run;
      if (!run) return;
      ctx.setTitle(`Run: ${run.automation_title}`);
      const canRetry = run.status === "failed";
      const canCancel = run.status === "queued" || run.status === "running";
      runHost.replaceChildren(
        header(run),
        ...[
          run.error
            ? banner({ tone: "danger", title: `${run.error.code}.`, body: run.error.message, role: "alert" })
            : null,
        ].filter(Boolean),
        h(
          "div",
          { class: "wk-actions" },
          canRetry
            ? button({
                label: "Retry failed steps",
                icon: "history",
                variant: "primary",
                onClick: () => act("retry", run),
              })
            : null,
          canCancel
            ? button({
                label: "Cancel run",
                icon: "stop",
                variant: "danger",
                onClick: () => act("cancel", run),
              })
            : null,
        ),
        kv([
          ["Trigger", runTriggerText(run.trigger)],
          ["Member", run.member ? personChip(run.member) : null],
          ["Started", run.started_at ? `${when(run.started_at)} (${rel(run.started_at)})` : "Not started"],
          ["Finished", run.finished_at ? when(run.finished_at) : null],
          ["Took", durationText(run.started_at, run.finished_at)],
          ["Steps", `${run.steps_succeeded} of ${run.steps_total} succeeded`],
          ["Cause depth", run.cause_depth > 0 ? String(run.cause_depth) : null],
        ]),
        h("h4", { class: "wk-caps" }, "Steps"),
        h(
          "ol",
          { class: "wa-steps", "aria-label": "Run steps" },
          ...run.steps.map((s) =>
            h(
              "li",
              { class: `wa-step wa-step--${s.status}`, "data-step": s.index },
              h(
                "div",
                { class: "wa-step__head" },
                h("span", { class: "wa-step__icon" }, stepIcon(s.type)),
                h("strong", {}, `${s.index + 1}. ${STEP_META[s.type]?.label ?? s.type}`),
                h("code", { class: "u-muted" }, s.id),
                statusPill("step", s.status),
                s.attempts > 1 ? pill({ label: `${s.attempts} attempts`, tone: "warning" }) : null,
              ),
              s.started_at
                ? h(
                    "p",
                    { class: "u-muted wa-step__when" },
                    `${when(s.started_at)}${s.finished_at ? ` · ${durationText(s.started_at, s.finished_at)}` : ""}`,
                  )
                : null,
              s.error
                ? h("p", { class: "wa-step__error" }, icon("alert", { size: 16 }), " ", errorLine(s.error))
                : null,
              s.output ? jsonBlock(s.output, "Output") : null,
              s.input !== undefined && s.input !== null ? jsonBlock(s.input, "Input after templates") : null,
            ),
          ),
        ),
        jsonBlock(run.context, "Run context"),
      );
    }

    function paintView() {
      listHost.hidden = st.view !== "list";
      runHost.hidden = st.view !== "run";
    }

    // ---------- start ----------
    paintView();
    loadList();
    const initial = bus.latest?.("run.selected")?.id;
    if (initial) openRun(initial);

    life.add(
      bus.subscribe("automation.selected", ({ id }) => {
        if (!id || fixed || id === st.automation) return;
        st.automation = id;
        st.view = "list";
        paintView();
        resetList();
      }),
    );
    life.add(
      bus.subscribe("run.selected", ({ id }) => {
        if (!id || (st.view === "run" && st.runId === id)) return;
        st.runId = id;
        st.view = "run";
        paintView();
        loadRun();
      }),
    );

    // ---------- realtime ----------
    const refreshRun = debounce(life, loadRun, 400);
    life.add(
      rt.on("automation.run_updated", (ev) => {
        const p = ev.payload;
        if (fixed && p.automation !== fixed) return;
        if (st.automation && p.automation !== st.automation) return;
        const row = st.items.find((r) => r.run_id === p.run_id);
        if (row) {
          row.status = p.status;
          if (p.error_code)
            row.error = { ...(row.error ?? { message: "", retryable: false }), code: p.error_code };
          st.fresh.add(row.run_id);
        } else if (!st.cursor && (st.statuses.size === 0 || st.statuses.has(p.status))) {
          // an unseen run on the first page: re-read so counts and fields are the server's
          loadList().then(() => {
            st.fresh.add(p.run_id);
            paintList();
          });
        }
        if (row) paintList();
        if (st.view === "run" && st.runId === p.run_id) {
          if (st.run && p.step_index !== null && st.run.steps[p.step_index]) {
            st.run.steps[p.step_index].status = p.step_status ?? st.run.steps[p.step_index].status;
            st.run.status = p.status;
            paintRun();
          }
          refreshRun();
        }
        if (p.status === "failed") live.textContent = "An automation run failed";
      }),
    );

    return () => life.dispose();
  },
};
