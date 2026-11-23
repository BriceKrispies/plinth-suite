import { Effect } from "effect";
import { type AutomationSpec, type NodeChange, SuiteAutomation } from "@plinth/spec";
import { ControlStore, store } from "../../control-store";
import {
  decodeCursor,
  dom,
  encodeCursor,
  iso,
  loadNodes,
  nodeLinkOf,
  nodeUriOf,
  refSlug,
  requireNode,
} from "../marketing/common";
import {
  automationPrincipal,
  cancelRun,
  dryRun,
  engineEmitCtx,
  listRuns,
  listSummaryData,
  retryRunOf,
  runDetailOf,
  runSummaryOf,
  summariesOf,
  triggerManual,
  type AutoNode,
} from "../marketing/automation-core";
import { announceHeldChange, commitNodeChange } from "../marketing/commit";
import { nextFires, parseCron } from "../marketing/cron";
import type { ActionCtx, ActionHandler } from "../types";
import type { HandlerTable } from "./stub";

type In<K extends keyof typeof SuiteAutomation> = (typeof SuiteAutomation)[K] extends { Type: infer T }
  ? T
  : never;

const triggerSummary = (spec: AutomationSpec): string => {
  const t = spec.trigger;
  switch (t.type) {
    case "event":
      return `When ${t.event}${t.filter ? " and the filter matches" : ""}`;
    case "schedule":
      return `On schedule ${t.cron} (UTC)`;
    case "metric":
      return `When ${t.value_column} ${t.op} ${t.threshold} for ${t.for_minutes} min (checked every ${t.every_minutes} min)`;
  }
};

const list: ActionHandler<unknown, In<"AutomationsListOut">> = {
  run: (_input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const wsSlug = ctx.principal.workspaceSlug;
      const nodes = yield* loadNodes<AutomationSpec>(ws, "Automation");
      const data = yield* listSummaryData(ws, ctx.now);
      const lastRows = [...data.last.values()];
      const lastSummaries = yield* summariesOf(ws, lastRows);
      const lastBySlug = new Map(lastRows.map((r, i) => [r.automation_slug, lastSummaries[i]] as const));
      return {
        items: nodes.map((n) => {
          const t = n.spec.trigger;
          const cron = t.type === "schedule" ? parseCron(t.cron) : undefined;
          const c = data.counts.get(n.slug);
          return {
            node: nodeLinkOf(wsSlug, ws, "Automation", n),
            enabled: n.spec.enabled,
            description: n.spec.description,
            trigger_summary: triggerSummary(n.spec),
            trigger_type: t.type,
            step_count: n.spec.steps.length,
            owner: n.spec.owner,
            last_run: (lastBySlug.get(n.slug) ??
              null) as In<"AutomationsListOut">["items"][number]["last_run"],
            runs_7d: c?.runs ?? 0,
            failures_7d: c?.failures ?? 0,
            next_fire_at:
              n.spec.enabled && cron ? (nextFires(cron, ctx.now, 1)[0]?.toISOString() ?? null) : null,
            pending_approval_id: data.pending.get(nodeUriOf(wsSlug, ws, "Automation", n.slug)) ?? null,
          };
        }),
      };
    }),
};

const dryRunHandler: ActionHandler<In<"DryRunIn">, unknown> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      let spec: AutomationSpec;
      let node: AutoNode | undefined;
      if (typeof input.automation === "string") {
        node = yield* requireNode<AutomationSpec>(ws, "Automation", refSlug(input.automation));
        spec = node.spec;
      } else spec = input.automation.spec;
      return yield* dryRun(ws, {
        spec,
        node,
        event: input.event,
        eventSeq: input.event_seq,
        at: input.at ? new Date(input.at) : ctx.now,
      });
    }),
};

const setEnabled: ActionHandler<In<"SetEnabledIn">, unknown> = {
  preview: (input, ctx) =>
    Effect.gen(function* () {
      const n = yield* requireNode<AutomationSpec>(ctx.principal.workspaceId, "Automation", input.slug);
      if (n.spec.enabled === input.enabled)
        return yield* Effect.fail(
          dom(
            "CONFLICT",
            "/enabled",
            `automation ${n.slug} is already ${input.enabled ? "enabled" : "disabled"}`,
            {
              details: {
                reason: "INVALID_TRANSITION",
                from: n.spec.enabled ? "enabled" : "disabled",
                to: input.enabled ? "enabled" : "disabled",
                allowed: [],
              },
            },
          ),
        );
      const external = input.enabled && n.spec.steps.some((s) => s.type === "webhook");
      const agent = ctx.principal.kind === "agent";
      const held = external || (agent && (input.enabled || n.spec.enabled));
      return {
        effect: `${input.enabled ? "Enable" : "Disable"} automation ${n.slug}${held ? ` (held for approval by ${external ? "admin:settings" : "automation:manage"})` : ""}`,
        facts: { automation: n.slug, enabled: input.enabled, held_for_approval: held },
        // the hold is the change log's (a `change` approval): the commit itself returns `pending_approval`
        decision: "auto" as const,
      };
    }),
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const n = yield* requireNode<AutomationSpec>(ws, "Automation", input.slug);
      if (n.spec.enabled === input.enabled)
        return yield* Effect.fail(
          dom(
            "CONFLICT",
            "/enabled",
            `automation ${n.slug} is already ${input.enabled ? "enabled" : "disabled"}`,
            {
              details: {
                reason: "INVALID_TRANSITION",
                from: n.spec.enabled ? "enabled" : "disabled",
                to: input.enabled ? "enabled" : "disabled",
                allowed: [],
              },
            },
          ),
        );
      const change: NodeChange = {
        target: nodeUriOf(ctx.principal.workspaceSlug, ws, "Automation", n.slug),
        base_revision: input.base_revision,
        ops: [{ op: "set", path: "/spec/enabled", value: input.enabled }],
      };
      const res = yield* commitNodeChange(ctx, change, { managedBy: "automation.set_enabled" });
      if (res.status === "pending_approval")
        yield* announceHeldChange(ctx, {
          approvalId: res.approval_id!,
          title: `${input.enabled ? "Enable" : "Disable"} automation ${n.title}`,
          approverPermission: res.approver_permission ?? "automation:manage",
        });
      return {
        status: res.status,
        ...(res.approval_id !== undefined ? { approval_id: res.approval_id } : {}),
        ...(res.change_seq !== undefined ? { change_seq: res.change_seq } : {}),
        ...(res.revision !== undefined ? { revision: res.revision } : {}),
        rule_id: res.rule_id,
      };
    }),
};

const trigger: ActionHandler<In<"TriggerIn">, unknown> = {
  preview: (input, ctx) =>
    Effect.gen(function* () {
      const n = yield* requireNode<AutomationSpec>(ctx.principal.workspaceId, "Automation", input.slug);
      return {
        effect: `Run automation ${n.slug} now with real effects (${n.spec.steps.length} steps)`,
        facts: { automation: n.slug, steps: n.spec.steps.length, enabled: n.spec.enabled },
      };
    }),
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const n = yield* requireNode<AutomationSpec>(ws, "Automation", input.slug);
      const svc = yield* automationPrincipal();
      const ectx = engineEmitCtx(svc, ctx.now);
      const key = input.idempotency_key;
      const runId = yield* triggerManual(ectx, {
        node: n,
        by: ctx.principal.subject,
        key,
        event: input.event,
        at: ctx.now,
      });
      let id = runId;
      if (!id) {
        const { sql } = yield* ControlStore;
        const r = yield* store(
          sql<{ run_id: string }>`
            SELECT run_id FROM automation_runs WHERE workspace_id = ${ws} AND automation_id = ${n.id} AND trigger_key = ${"manual:" + key}`,
        );
        id = r[0]?.run_id;
      }
      if (!id) return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "", "the run was not created"));
      return yield* runSummaryOf(ws, id);
    }),
};

const runs: ActionHandler<In<"RunsListIn">, In<"RunsListOut">> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const limit = input.limit ?? 50;
      const rows = yield* listRuns(ws, {
        automation: input.automation,
        status: input.status,
        member: input.member,
        before: decodeCursor<{ at: string; id: string }>(input.cursor),
        limit,
      });
      const page = rows.slice(0, limit);
      const items = yield* summariesOf(ws, page);
      const last = page[page.length - 1];
      return {
        items: items as unknown as In<"RunsListOut">["items"],
        next_cursor:
          rows.length > limit && last ? encodeCursor({ at: iso(last.created_at), id: last.run_id }) : null,
      };
    }),
};

const runOne: ActionHandler<In<"RunIn">, unknown> = {
  run: (input, ctx) => runDetailOf(ctx.principal.workspaceId, input.run_id),
};

const retry: ActionHandler<In<"RetryIn">, unknown> = {
  preview: (input, ctx) =>
    Effect.gen(function* () {
      const s = yield* runSummaryOf(ctx.principal.workspaceId, input.run_id);
      return {
        effect: `Retry the failed and pending steps of run ${String(s["automation"])} with the original step keys`,
        facts: { run_id: input.run_id, status: s["status"] },
      };
    }),
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const svc = yield* automationPrincipal();
      const id = yield* retryRunOf(engineEmitCtx(svc, ctx.now), { runId: input.run_id, at: ctx.now });
      return yield* runSummaryOf(ws, id);
    }),
};

const cancel: ActionHandler<In<"RunIn">, unknown> = {
  preview: (input, ctx) =>
    Effect.gen(function* () {
      const s = yield* runSummaryOf(ctx.principal.workspaceId, input.run_id);
      return {
        effect: `Cancel run of ${String(s["automation"])} (${String(s["status"])}); finished steps stay done`,
        facts: { run_id: input.run_id, status: s["status"] },
      };
    }),
  run: (input, ctx: ActionCtx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const svc = yield* automationPrincipal();
      yield* cancelRun(engineEmitCtx(svc, ctx.now), { runId: input.run_id, at: ctx.now });
      return yield* runSummaryOf(ws, input.run_id);
    }),
};

export const automationHandlers = {
  "automation.list": list,
  "automation.dry_run": dryRunHandler,
  "automation.set_enabled": setEnabled,
  "automation.trigger": trigger,
  "automation.runs": runs,
  "automation.run": runOne,
  "automation.retry": retry,
  "automation.cancel": cancel,
} satisfies HandlerTable;
