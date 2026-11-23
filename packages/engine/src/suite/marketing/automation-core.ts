import { Effect, Either, Option } from "effect";
import { evalCond, nodeId } from "@plinth/core";
import {
  DomainError,
  type AutomationSpec,
  type AutomationStep,
  type MemberFacts,
  type PersonRef,
  type RunStatus,
} from "@plinth/spec";
import { Authorizer } from "../../authz";
import { ControlStore, store } from "../../control-store";
import { Identity, type Principal } from "../../identity";
import { QueryEngine } from "../../query-engine";
import { StoreError } from "../../errors";
import type { Allow } from "../../authz-core";
import { callAction } from "../dispatcher";
import { emitFrom, type EmitCtx, type PrincipalRef } from "../domain-events";
import type { StoredDomainEvent } from "../domain-stream";
import { newId } from "../ids";
import { postAward } from "../ledger";
import { createNotifications } from "../notify";
import { memberByHandle, memberBySubject, personRefOf, type MemberRow } from "../people";
import { loadProgram, nextCounter } from "../program";
import { memberFactsFor } from "../segments";
import { mayTarget } from "../target";
import { dom, iso, loadNodes, refSlug, DAY_MS, type SuiteNode } from "./common";
import { cronMatches, nextFires, parseCron } from "./cron";
import { chargePromotions, evaluateLive } from "./promotions-core";
import type { HandlerError, SuiteEnv } from "../types";

/**
 * The automation engine core (CONTRACT.md section 9): trigger matching, run creation (exactly once per trigger key),
 * limits, step execution as `service:automation` inside the owner's grants, retries, dry runs. Used by the worker's
 * automation engine and by the `automation.*` handlers, so a manual run and an event run share one code path.
 */

export type AutoNode = SuiteNode<AutomationSpec>;

export interface StepError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

const AUDIENCE = ["role:marketing-manager", "role:admin", "role:manager"];

// ---- templates ------------------------------------------------------------------------------------------------

export type RunContext = Record<string, unknown>;

const lookup = (root: unknown, path: string): unknown => {
  let cur: unknown = root;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
};

/** `{{path}}` placeholders over the run context, substituted as plain text. Unknown paths become empty text. */
export const substitute = (template: string, ctx: RunContext): string =>
  template.replace(/\{\{\s*([a-z_][a-z0-9_.]*)\s*\}\}/gi, (_m, path: string) => {
    const v = lookup(ctx, path);
    if (v === undefined || v === null) return "";
    if (Array.isArray(v)) return v.map(String).join(", ");
    if (typeof v === "object") return "";
    return String(v);
  });

const substituteDeep = (v: unknown, ctx: RunContext): unknown => {
  if (typeof v === "string") return substitute(v, ctx);
  if (Array.isArray(v)) return v.map((x) => substituteDeep(x, ctx));
  if (v !== null && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substituteDeep(x, ctx)]));
  return v;
};

/** The step with every template substituted, except the fields that hold targets, ids and conditions. */
const substituteStep = (step: AutomationStep, ctx: RunContext): AutomationStep => {
  const keep = new Set([
    "id",
    "type",
    "when",
    "on_error",
    "to",
    "assignee",
    "promotion",
    "notification_type",
    "target_label",
  ]);
  return Object.fromEntries(
    Object.entries(step).map(([k, v]) => [k, keep.has(k) ? v : substituteDeep(v, ctx)]),
  ) as AutomationStep;
};

// ---- principals and emit contexts ------------------------------------------------------------------------------

export const automationPrincipal = (): Effect.Effect<Principal, HandlerError, Identity> =>
  Effect.flatMap(Identity, (i) => i.bySubject("service:automation"));

/** The emit context of the engine: `service:automation` on the system surface, on behalf of an owner. */
export const engineEmitCtx = (
  svc: Principal,
  now: Date,
  owner?: PrincipalRef,
): EmitCtx & { readonly principal: Principal } => ({
  principal: svc,
  surface: "system",
  now,
  ...(owner ? { onBehalfOf: owner } : {}),
});

// ---- runs: reading ---------------------------------------------------------------------------------------------

interface RunRow {
  run_id: string;
  automation_id: string;
  automation_slug: string;
  automation_revision: string;
  trigger_key: string;
  trigger: Record<string, unknown>;
  context: RunContext;
  status: RunStatus;
  member_id: string | null;
  cause_depth: number;
  attempt: number;
  error: StepError | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  steps_total: string;
  steps_succeeded: string;
}

const RUN_COLS = `r.run_id, r.automation_id, r.automation_slug, r.automation_revision::text AS automation_revision, r.trigger_key,
  r.trigger, r.context, r.status, r.member_id, r.cause_depth, r.attempt, r.error, r.created_at, r.started_at, r.finished_at,
  (SELECT count(*) FROM automation_steps s WHERE s.run_id = r.run_id)::text AS steps_total,
  (SELECT count(*) FROM automation_steps s WHERE s.run_id = r.run_id AND s.status = 'succeeded')::text AS steps_succeeded`;

const toSummary = (
  ws: string,
  r: RunRow,
  titles: ReadonlyMap<string, string>,
): Effect.Effect<Record<string, unknown>, DomainError | StoreError, ControlStore> =>
  Effect.gen(function* () {
    const member: PersonRef | null = r.member_id
      ? yield* personRefOf(ws, r.member_id).pipe(Effect.orElseSucceed(() => null as PersonRef | null))
      : null;
    return {
      run_id: r.run_id,
      automation: r.automation_slug,
      automation_title: titles.get(r.automation_slug) ?? r.automation_slug,
      automation_revision: Number(r.automation_revision),
      status: r.status,
      trigger: { ...r.trigger, key: r.trigger_key },
      member,
      started_at: r.started_at ? iso(r.started_at) : null,
      finished_at: r.finished_at ? iso(r.finished_at) : null,
      steps_total: Number(r.steps_total),
      steps_succeeded: Number(r.steps_succeeded),
      error: r.error,
    };
  });

export const automationTitles = (
  ws: string,
): Effect.Effect<ReadonlyMap<string, string>, StoreError, ControlStore> =>
  loadNodes(ws, "Automation").pipe(Effect.map((ns) => new Map(ns.map((n) => [n.slug, n.title] as const))));

export const loadRunRow = (
  ws: string,
  runId: string,
  lock = false,
): Effect.Effect<RunRow | undefined, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    if (!/^[0-9a-f-]{36}$/.test(runId)) return undefined;
    const rows = yield* store(
      sql.unsafe<RunRow>(
        `SELECT ${RUN_COLS} FROM automation_runs r WHERE r.workspace_id = $1 AND r.run_id = $2${lock ? " FOR UPDATE OF r" : ""}`,
        [ws, runId],
      ),
    );
    return rows[0];
  });

export const runSummaryOf = (
  ws: string,
  runId: string,
): Effect.Effect<Record<string, unknown>, DomainError | StoreError, ControlStore> =>
  Effect.gen(function* () {
    const r = yield* loadRunRow(ws, runId);
    if (!r) return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/run_id", `no run '${runId}'`));
    return yield* toSummary(ws, r, yield* automationTitles(ws));
  });

interface StepRow {
  step_index: number;
  step_id: string;
  type: string;
  status: string;
  attempts: number;
  idempotency_key: string;
  input: { step?: AutomationStep } & Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: StepError | null;
  started_at: Date | null;
  finished_at: Date | null;
  next_attempt_at: Date | null;
}

const loadSteps = (runId: string): Effect.Effect<ReadonlyArray<StepRow>, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    return yield* store(
      sql<StepRow>`
        SELECT step_index, step_id, type, status, attempts, idempotency_key, input, output, error, started_at, finished_at,
               next_attempt_at FROM automation_steps WHERE run_id = ${runId} ORDER BY step_index`,
    );
  });

export const runDetailOf = (
  ws: string,
  runId: string,
): Effect.Effect<Record<string, unknown>, DomainError | StoreError, ControlStore> =>
  Effect.gen(function* () {
    const r = yield* loadRunRow(ws, runId);
    if (!r) return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/run_id", `no run '${runId}'`));
    const sum = yield* toSummary(ws, r, yield* automationTitles(ws));
    const steps = yield* loadSteps(runId);
    return {
      ...sum,
      context: r.context,
      cause_depth: r.cause_depth,
      steps: steps.map((s) => ({
        index: s.step_index,
        id: s.step_id,
        type: s.type,
        status: s.status,
        attempts: s.attempts,
        started_at: s.started_at ? iso(s.started_at) : null,
        finished_at: s.finished_at ? iso(s.finished_at) : null,
        input: s.input.step ?? s.input,
        output: s.output,
        error: s.error,
      })),
    };
  });

export const listRuns = (
  ws: string,
  q: {
    readonly automation?: string | undefined;
    readonly status?: ReadonlyArray<string> | undefined;
    readonly member?: string | undefined;
    readonly before?: { readonly at: string; readonly id: string } | undefined;
    readonly limit: number;
  },
): Effect.Effect<ReadonlyArray<RunRow>, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const where: string[] = ["r.workspace_id = $1"];
    const params: unknown[] = [ws];
    const add = (cond: string, v: unknown) => {
      params.push(v);
      where.push(cond.replace("?", `$${params.length}`));
    };
    if (q.automation) add("r.automation_slug = ?", refSlug(q.automation));
    if (q.status && q.status.length > 0) add("r.status = ANY(?::text[])", `{${q.status.join(",")}}`);
    if (q.member)
      add("r.member_id = (SELECT member_id FROM members WHERE workspace_id = $1 AND handle = ?)", q.member);
    if (q.before) {
      params.push(q.before.at, q.before.id);
      where.push(`(r.created_at, r.run_id::text) < ($${params.length - 1}::timestamptz, $${params.length})`);
    }
    params.push(q.limit + 1);
    return yield* store(
      sql.unsafe<RunRow>(
        `SELECT ${RUN_COLS} FROM automation_runs r WHERE ${where.join(" AND ")}
         ORDER BY r.created_at DESC, r.run_id DESC LIMIT $${params.length}`,
        params,
      ),
    );
  });

export const summariesOf = (
  ws: string,
  rows: ReadonlyArray<RunRow>,
): Effect.Effect<ReadonlyArray<Record<string, unknown>>, DomainError | StoreError, ControlStore> =>
  Effect.gen(function* () {
    const titles = yield* automationTitles(ws);
    const out: Record<string, unknown>[] = [];
    for (const r of rows) out.push(yield* toSummary(ws, r, titles));
    return out;
  });

// ---- context ---------------------------------------------------------------------------------------------------

export interface TriggerEventLike {
  readonly seq?: number;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly member?: { readonly id: string; readonly subject: string; readonly handle: string } | null;
  readonly actorSubject?: string | null;
}

export const buildContext = (
  ws: string,
  now: Date,
  ev: TriggerEventLike | undefined,
): Effect.Effect<{ context: RunContext; facts: MemberFacts | undefined }, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const facts = ev?.member ? (yield* memberFactsFor(ws, now, [ev.member.id]))[0]?.facts : undefined;
    const context: RunContext = {
      event: ev?.payload ?? {},
      ...(facts ? { member: facts } : {}),
      ...(ev?.actorSubject ? { actor: { subject: ev.actorSubject } } : {}),
      ...(ev ? { event_type: ev.type } : {}),
      now: iso(now),
    };
    return { context, facts };
  });

// ---- permissions -----------------------------------------------------------------------------------------------

const STEP_PERMISSION: Readonly<Record<string, { permission: string; module: string }>> = {
  award_points: { permission: "points:award", module: "points" },
  notify: { permission: "notifications:send", module: "notifications" },
  send_message: { permission: "messages:use", module: "messages" },
  apply_promotion: { permission: "promotions:manage", module: "promotions" },
  create_task: { permission: "tasks:use", module: "tasks" },
  webhook: { permission: "automation:manage", module: "automation" },
};

const ownerAllow = (
  owner: Principal,
  permission: string,
  module: string,
): Effect.Effect<Allow, DomainError | StoreError, Authorizer> =>
  Effect.flatMap(Authorizer, (a) =>
    a.require(owner, permission, `plinth://${owner.workspaceSlug}/suite/${module}`),
  );

const forbiddenStep = (owner: string, permission: string) =>
  dom("FORBIDDEN", "", `automation owner ${owner} lacks ${permission}`, {
    details: { reason: "no_grant", permission },
    retryable: false,
  });

const safeOwner = (subject: string): Effect.Effect<Principal | undefined, StoreError, Identity> =>
  Effect.flatMap(Identity, (i) =>
    i.bySubject(subject).pipe(
      Effect.map((p): Principal | undefined => p),
      Effect.catchIf(
        (e) => e instanceof DomainError,
        () => Effect.succeed(undefined),
      ),
    ),
  ) as Effect.Effect<Principal | undefined, StoreError, Identity>;

/** Does the owner hold the permission a step type needs (and for `notify`/`create_task` to others, the wider one)? */
const stepNeeds = (
  step: AutomationStep,
  ctx: { memberSubject: string | undefined; owner: string },
): { permission: string; module: string } | undefined => {
  const base = STEP_PERMISSION[step.type];
  if (!base) return undefined;
  if (step.type === "notify") {
    const others = step.to.some((t) => (t === "$member" ? false : t === "$owner" ? false : true));
    return others || step.to.length > 1 ? base : undefined;
  }
  if (step.type === "create_task") {
    const target =
      step.assignee === "$owner"
        ? ctx.owner
        : step.assignee === "$member"
          ? ctx.memberSubject
          : step.assignee;
    return target !== ctx.owner ? { permission: "tasks:manage", module: "tasks" } : base;
  }
  return base;
};

// ---- target resolution -----------------------------------------------------------------------------------------

const resolveOne = (
  ws: string,
  t: string,
  who: { member: MemberRow | undefined; actor: string | undefined; owner: string },
): Effect.Effect<ReadonlyArray<MemberRow>, DomainError | StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    if (t === "$member") {
      if (!who.member)
        return yield* Effect.fail(
          dom("UNKNOWN_REFERENCE", "/to", "the trigger has no member", { retryable: false }),
        );
      return [who.member];
    }
    const subject = t === "$actor" ? who.actor : t === "$owner" ? who.owner : t;
    if (!subject) return [];
    if (subject.startsWith("group:")) {
      const rows = yield* store(
        sql<{ subject: string }>`
          SELECT s.subject FROM nodes n
          JOIN LATERAL jsonb_array_elements_text(n.body -> 'spec' -> 'members') s(subject) ON true
          WHERE n.workspace_id = ${ws} AND n.kind = 'Group' AND n.slug = ${subject.slice(6)} AND n.deleted_at IS NULL`,
      );
      const out: MemberRow[] = [];
      for (const r of rows) {
        const m = yield* memberBySubject(ws, r.subject).pipe(Effect.option);
        if (Option.isSome(m)) out.push(m.value);
      }
      return out;
    }
    if (!subject.startsWith("user:")) return [];
    const m = yield* memberBySubject(ws, subject).pipe(Effect.option);
    return Option.isSome(m) ? [m.value] : [];
  });

const resolveTargets = (
  ws: string,
  targets: ReadonlyArray<string>,
  who: { member: MemberRow | undefined; actor: string | undefined; owner: string },
): Effect.Effect<ReadonlyArray<MemberRow>, DomainError | StoreError, ControlStore> =>
  Effect.gen(function* () {
    const seen = new Set<string>();
    const out: MemberRow[] = [];
    for (const t of targets)
      for (const m of yield* resolveOne(ws, t, who))
        if (!seen.has(m.id) && !m.disabled) {
          seen.add(m.id);
          out.push(m);
        }
    return out;
  });

// ---- step effects ----------------------------------------------------------------------------------------------

interface StepOutcome {
  readonly output: Record<string, unknown>;
  readonly ids: ReadonlyArray<string>;
}

interface StepEnv {
  readonly ws: string;
  readonly wsSlug: string;
  readonly now: Date;
  readonly svc: Principal;
  readonly owner: Principal;
  readonly runId: string;
  readonly member: MemberRow | undefined;
  readonly actor: string | undefined;
  readonly context: RunContext;
  readonly depth: number;
  readonly automation: string;
}

const taskLinkFor = (event: Record<string, unknown>) => {
  const orderId = event["order_id"];
  const orderNo = event["order_no"];
  if (typeof orderId === "string" && typeof orderNo === "string")
    return { kind: "order", ref: orderId, label: orderNo, href: `/store/orders/${orderNo}` };
  const content = event["content"];
  if (typeof content === "string")
    return {
      kind: "content",
      ref: content,
      label: String(event["title"] ?? content),
      href: `/content/${content}`,
    };
  const promotion = event["promotion"];
  if (typeof promotion === "string")
    return {
      kind: "promotion",
      ref: promotion,
      label: String(event["title"] ?? promotion),
      href: `/promotions/${promotion}`,
    };
  const product = event["product"];
  if (typeof product === "string")
    return { kind: "product", ref: product, label: product, href: `/store/p/${product}` };
  return null;
};

const execStep = (
  env: StepEnv,
  step: AutomationStep,
  key: string,
): Effect.Effect<StepOutcome, HandlerError, SuiteEnv> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const { ws, now, svc, owner } = env;
    const ownerRef: PrincipalRef = { id: owner.id, subject: owner.subject };
    const ectx = engineEmitCtx(svc, now, ownerRef);
    const who = { member: env.member, actor: env.actor, owner: owner.subject };
    const needs = stepNeeds(step, { memberSubject: env.member?.subject, owner: owner.subject });
    let allow: Allow | undefined;
    if (needs)
      allow = yield* ownerAllow(owner, needs.permission, needs.module).pipe(
        Effect.catchIf(
          (e): e is DomainError => e instanceof DomainError,
          () => Effect.fail(forbiddenStep(owner.subject, needs.permission)),
        ),
      );

    switch (step.type) {
      case "award_points": {
        const targets = yield* resolveTargets(ws, [step.to], who);
        const target = targets[0];
        if (!target)
          return yield* Effect.fail(
            dom("UNKNOWN_REFERENCE", "/to", "no eligible member to award", { retryable: false }),
          );
        if (!mayTarget({ allow }, target))
          return yield* Effect.fail(
            dom("FORBIDDEN", "/to", "the owner's grant does not reach this member", {
              details: { reason: "row_predicate" },
            }),
          );
        const program = yield* loadProgram(ws);
        if (step.points > program.awards.manager_max_per_award)
          return yield* Effect.fail(
            dom(
              "RULE_REFUSED",
              "/points",
              `an award above ${program.awards.manager_max_per_award} points needs approval`,
              {
                details: {
                  reason: "LIMIT_EXCEEDED",
                  limit: program.awards.manager_max_per_award,
                  value: step.points,
                },
              },
            ),
          );
        const facts = (yield* memberFactsFor(ws, now, [target.id]))[0]?.facts;
        const ev = facts
          ? yield* evaluateLive(
              ws,
              { id: target.id, facts },
              { kind: "earn", channel: "automation", base_points: step.points, earn_type: "automation" },
              now,
            )
          : undefined;
        const bonus = ev?.totals.bonus_points ?? 0;
        const res = yield* postAward(ectx, {
          handle: target.handle,
          base: step.points,
          bonus,
          memo: clip(step.memo || "Automation award", 200),
          key,
          ref: { kind: "automation_run", id: env.runId },
        });
        if (!res.replayed && ev && ev.applied.length > 0)
          yield* chargePromotions(ectx, {
            member: { id: target.id, subject: target.subject, handle: target.handle },
            context: "earn",
            evaluation: ev,
            ref: { kind: "txn", id: res.txn_id },
          });
        if (!res.replayed)
          yield* createNotifications(ectx, {
            recipients: [{ id: target.id, subject: target.subject }],
            type: "points_awarded",
            title: `You received ${step.points + bonus} points`,
            body: clip(step.memo, 500),
            link: "/points",
            subject: { kind: "txn", id: res.txn_id },
            sourceEventSeq: res.event_seq,
            dedupeKey: `${key}:points`,
          });
        return {
          output: {
            txn_id: res.txn_id,
            txn_no: res.txn_no,
            points: step.points,
            bonus,
            member: target.handle,
            ids: [res.txn_id],
          },
          ids: [res.txn_id],
        };
      }
      case "notify": {
        const recipients = yield* resolveTargets(ws, step.to, who);
        const seq = (yield* store(
          sql<{
            head_seq: string;
          }>`SELECT head_seq::text AS head_seq FROM domain_chain WHERE workspace_id = ${ws}`,
        ))[0]?.head_seq;
        const r = yield* createNotifications(ectx, {
          recipients: recipients.map((m) => ({ id: m.id, subject: m.subject })),
          type: step.notification_type,
          title: clip(step.title, 140),
          body: clip(step.body, 500),
          link: step.link ?? null,
          sourceEventSeq: seq !== undefined ? Number(seq) : null,
          dedupeKey: key,
        });
        return {
          output: {
            recipients: recipients.length,
            created: r.created,
            suppressed: r.suppressed,
            ids: r.notificationIds,
          },
          ids: r.notificationIds,
        };
      }
      case "send_message": {
        const recipients = step.to
          .map((t) =>
            t === "$member"
              ? env.member
                ? `user:${env.member.handle}`
                : ""
              : t === "$actor"
                ? (env.actor ?? "")
                : t === "$owner"
                  ? owner.subject
                  : t,
          )
          .filter((x) => x.length > 0);
        if (recipients.length === 0)
          return yield* Effect.fail(
            dom("UNKNOWN_REFERENCE", "/to", "no recipients resolved", { retryable: false }),
          );
        const out = (yield* callAction(
          owner,
          "messages.send",
          {
            to: [...new Set(recipients)],
            subject: clip(step.subject, 140),
            body: step.body,
            idempotency_key: key,
          },
          { surface: "system", at: now, idempotencyKey: key },
        )) as { thread_id?: string; message_id?: string };
        const ids = [out.thread_id, out.message_id].filter((x): x is string => typeof x === "string");
        return { output: { thread_id: out.thread_id ?? null, message_id: out.message_id ?? null, ids }, ids };
      }
      case "apply_promotion": {
        const targets = yield* resolveTargets(ws, [step.to], who);
        const target = targets[0];
        if (!target)
          return yield* Effect.fail(
            dom("UNKNOWN_REFERENCE", "/to", "no member to grant the entitlement", { retryable: false }),
          );
        const slug = refSlug(step.promotion);
        const pid = nodeId(ws, "Promotion", slug);
        const exists = yield* store(
          sql<{ n: string }>`
            SELECT count(*)::text AS n FROM nodes WHERE workspace_id = ${ws} AND node_id = ${pid} AND deleted_at IS NULL`,
        );
        if (Number(exists[0]?.n ?? 0) === 0)
          return yield* Effect.fail(
            dom("UNKNOWN_REFERENCE", "/promotion", `no promotion '${slug}'`, { retryable: false }),
          );
        const origRun = key.split(":")[1] ?? env.runId;
        const have = yield* store(
          sql<{ entitlement_id: string }>`
            SELECT entitlement_id FROM promotion_entitlements
            WHERE workspace_id = ${ws} AND run_id = ${origRun} AND promotion_id = ${pid} AND member_id = ${target.id}`,
        );
        let id = have[0]?.entitlement_id;
        if (!id) {
          id = newId();
          yield* store(
            sql`INSERT INTO promotion_entitlements (entitlement_id, workspace_id, promotion_id, member_id, run_id, granted_at, expires_at)
                VALUES (${id}, ${ws}, ${pid}, ${target.id}, ${origRun}, ${now.toISOString()}::timestamptz,
                        ${new Date(now.getTime() + step.expires_in_days * DAY_MS).toISOString()}::timestamptz)`,
          );
        }
        return {
          output: { entitlement_id: id, member: target.handle, promotion: slug, ids: [id] },
          ids: [id],
        };
      }
      case "create_task": {
        const assignees = yield* resolveTargets(
          ws,
          [step.assignee === "$owner" ? "$owner" : step.assignee === "$member" ? "$member" : step.assignee],
          who,
        );
        const assignee = assignees[0];
        if (!assignee)
          return yield* Effect.fail(
            dom("RULE_REFUSED", "/assignee", "the assignee is missing or disabled", {
              details: { reason: "MEMBER_DISABLED" },
              retryable: false,
            }),
          );
        const origRun = key.split(":")[1] ?? env.runId;
        const have = yield* store(
          sql<{ task_id: string }>`
            SELECT task_id FROM tasks WHERE workspace_id = ${ws} AND run_id = ${origRun} AND title = ${clip(step.title, 140)}
              AND assignee_id = ${assignee.id}`,
        );
        if (have[0])
          return {
            output: { task_id: have[0].task_id, replayed: true, ids: [have[0].task_id] },
            ids: [have[0].task_id],
          };
        const taskId = newId();
        const no = yield* nextCounter(ws, "task");
        const due =
          step.due_in_days !== undefined ? new Date(now.getTime() + step.due_in_days * DAY_MS) : null;
        const event = (env.context["event"] ?? {}) as Record<string, unknown>;
        const link = taskLinkFor(event);
        yield* store(
          sql`INSERT INTO tasks (task_id, workspace_id, task_no, title, description, status, priority, assignee_id, created_by, created_at,
                                 updated_at, due_at, link, source, run_id, version)
              VALUES (${taskId}, ${ws}, ${no}, ${clip(step.title, 140) || "Task"}, ${clip(step.description ?? "", 2000)}, 'open', ${step.priority},
                      ${assignee.id}, ${svc.id}, ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz,
                      ${due ? due.toISOString() : null}::timestamptz, ${link ? JSON.stringify(link) : null}::jsonb, 'automation',
                      ${origRun}, 1)`,
        );
        yield* store(
          sql`INSERT INTO task_history (task_id, version, actor_id, at, changed)
              VALUES (${taskId}, 1, ${svc.id}, ${now.toISOString()}::timestamptz, ARRAY['created']::text[])`,
        );
        const seq = yield* emitFrom(ectx, "task.assigned", {
          audience: [assignee.subject],
          subject: { kind: "task", id: taskId },
          member: { id: assignee.id, subject: assignee.subject },
          payload: {
            task_id: taskId,
            task_no: no,
            title: clip(step.title, 140),
            priority: step.priority,
            due_at: due ? due.toISOString() : null,
            assignee: assignee.subject,
          },
        });
        if (assignee.id !== owner.id)
          yield* createNotifications(ectx, {
            recipients: [{ id: assignee.id, subject: assignee.subject }],
            type: "task_assigned",
            title: "New task assigned",
            body: clip(step.title, 500),
            link: "/tasks",
            subject: { kind: "task", id: taskId },
            sourceEventSeq: seq,
            dedupeKey: `${key}:task`,
          });
        return {
          output: { task_id: taskId, task_no: no, assignee: assignee.handle, ids: [taskId] },
          ids: [taskId],
        };
      }
      case "webhook": {
        const have = yield* store(
          sql<{ delivery_id: string }>`
            SELECT delivery_id FROM webhook_deliveries WHERE run_id = ${env.runId} AND step_index = ${Number(
              (env.context["__step_index"] as number | undefined) ?? 0,
            )}`,
        );
        if (have[0])
          return {
            output: { delivery_id: have[0].delivery_id, replayed: true, ids: [have[0].delivery_id] },
            ids: [have[0].delivery_id],
          };
        const id = newId();
        yield* store(
          sql`INSERT INTO webhook_deliveries (delivery_id, workspace_id, run_id, step_index, target_label, payload, status, recorded_at)
              VALUES (${id}, ${ws}, ${env.runId}, ${Number((env.context["__step_index"] as number | undefined) ?? 0)},
                      ${step.target_label}, ${JSON.stringify(step.payload)}::jsonb, 'recorded', ${now.toISOString()}::timestamptz)`,
        );
        return { output: { delivery_id: id, target: step.target_label, ids: [id] }, ids: [id] };
      }
    }
  });

// ---- errors ----------------------------------------------------------------------------------------------------

export const toStepError = (e: unknown): StepError => {
  if (e instanceof DomainError) {
    const reason = e.details?.["reason"];
    return {
      code: typeof reason === "string" ? reason : e.code,
      message: clip(e.message, 280),
      retryable: e.retryable === true || e.code === "RATE_LIMITED" || reason === "commit_busy",
    };
  }
  if (e instanceof StoreError) return { code: "STORE_ERROR", message: clip(e.message, 280), retryable: true };
  return {
    code: "INTERNAL",
    message: clip(String((e as { message?: string })?.message ?? e), 280),
    retryable: false,
  };
};

const BACKOFF_S = [1, 4, 16] as const;
const MAX_ATTEMPTS = 3;

// ---- run lifecycle ---------------------------------------------------------------------------------------------

const AUTOMATION_RUN_AUDIENCE = (owner: string) => [...AUDIENCE, owner];

const emitRun = (
  ectx: EmitCtx,
  a: {
    runId: string;
    automation: string;
    owner: string;
    status: RunStatus;
    stepIndex: number | null;
    stepStatus: "pending" | "running" | "succeeded" | "failed" | "skipped" | null;
    errorCode: string | null;
    depth: number;
  },
) =>
  emitFrom(ectx, "automation.run_updated", {
    audience: AUTOMATION_RUN_AUDIENCE(a.owner),
    subject: { kind: "automation_run", id: a.runId },
    cause: {
      automation: a.automation,
      run_id: a.runId,
      step_index: a.stepIndex ?? 0,
      depth: Math.min(8, Math.max(1, a.depth + 1)),
    },
    payload: {
      run_id: a.runId,
      automation: a.automation,
      status: a.status,
      step_index: a.stepIndex,
      step_status: a.stepStatus,
      error_code: a.errorCode,
    },
  });

interface PlannedStep {
  readonly index: number;
  readonly step: AutomationStep;
  readonly key: string;
  readonly status: "pending" | "skipped";
  readonly carried?: StepRow;
}

/** Build the step rows of a new run: `when` is evaluated against the context now. */
const planSteps = (spec: AutomationSpec, runId: string, context: RunContext): ReadonlyArray<PlannedStep> =>
  spec.steps.map((s, i) => {
    const step = substituteStep(s, { ...context, run: { id: runId } });
    const skip = s.when !== undefined && !evalCond(s.when, context);
    return {
      index: i,
      step,
      key: `run:${runId}:step:${s.id}`,
      status: skip ? ("skipped" as const) : ("pending" as const),
    };
  });

export interface NewRun {
  readonly node: AutoNode;
  readonly trigger: Record<string, unknown>;
  readonly triggerKey: string;
  readonly context: RunContext;
  readonly member: { readonly id: string } | null;
  readonly causeDepth: number;
  readonly at: Date;
  /** Skip the run with this error (loop guard, conditions, limits). */
  readonly skip?: StepError | undefined;
  /** A retry copies the failed run's steps and keys. */
  readonly retryOf?: { readonly runId: string; readonly steps: ReadonlyArray<StepRow> } | undefined;
}

/** Insert the run and its steps. Returns the new run id, or undefined when this trigger key already has a run. */
export const insertRun = (
  ectx: EmitCtx,
  a: NewRun,
): Effect.Effect<string | undefined, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const ws = ectx.principal.workspaceId;
    const runId = newId();
    const status: RunStatus = a.skip ? "skipped" : "queued";
    const finished = a.skip ? a.at.toISOString() : null;
    const inserted = yield* store(
      sql<{ run_id: string }>`
        INSERT INTO automation_runs (run_id, workspace_id, automation_id, automation_slug, automation_revision, trigger_key, trigger, context,
                                     status, member_id, cause_depth, attempt, error, created_at, started_at, finished_at)
        VALUES (${runId}, ${ws}, ${a.node.id}, ${a.node.slug}, ${a.node.revision}, ${a.triggerKey}, ${JSON.stringify(a.trigger)}::jsonb,
                ${JSON.stringify(a.context)}::jsonb, ${status}, ${a.member?.id ?? null}, ${a.causeDepth}, 1,
                ${a.skip ? JSON.stringify(a.skip) : null}::jsonb, ${a.at.toISOString()}::timestamptz,
                ${a.skip ? a.at.toISOString() : null}::timestamptz, ${finished}::timestamptz)
        ON CONFLICT (workspace_id, automation_id, trigger_key) DO NOTHING
        RETURNING run_id`,
    );
    if (inserted.length === 0) return undefined;
    if (a.retryOf) {
      for (const s of a.retryOf.steps) {
        const done = s.status === "succeeded" || s.status === "skipped";
        yield* store(
          sql`INSERT INTO automation_steps (run_id, step_index, step_id, type, status, attempts, idempotency_key, input, output, error,
                                            started_at, finished_at)
              VALUES (${runId}, ${s.step_index}, ${s.step_id}, ${s.type}, ${done ? s.status : "pending"}, ${done ? s.attempts : 0},
                      ${s.idempotency_key}, ${JSON.stringify(s.input)}::jsonb, ${done && s.output ? JSON.stringify(s.output) : null}::jsonb,
                      ${null}::jsonb, ${s.started_at ? s.started_at.toISOString() : null}::timestamptz,
                      ${s.finished_at ? s.finished_at.toISOString() : null}::timestamptz)`,
        );
      }
    } else {
      for (const p of planSteps(a.node.spec, runId, a.context)) {
        const st = a.skip ? "skipped" : p.status;
        yield* store(
          sql`INSERT INTO automation_steps (run_id, step_index, step_id, type, status, attempts, idempotency_key, input)
              VALUES (${runId}, ${p.index}, ${p.step.id}, ${p.step.type}, ${st}, 0, ${p.key}, ${JSON.stringify({ step: p.step })}::jsonb)`,
        );
      }
    }
    yield* emitRun(ectx, {
      runId,
      automation: a.node.slug,
      owner: a.node.spec.owner,
      status,
      stepIndex: null,
      stepStatus: null,
      errorCode: a.skip?.code ?? null,
      depth: a.causeDepth,
    });
    return runId;
  });

const dayStart = (d: Date): Date => new Date(Math.floor(d.getTime() / DAY_MS) * DAY_MS);

/** The limits of CONTRACT.md 9.3 for one member: `max_runs_per_member_per_day` and `cooldown_minutes`. */
export const limitsFailure = (
  ws: string,
  node: AutoNode,
  memberId: string | null,
  at: Date,
): Effect.Effect<StepError | undefined, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const lim = node.spec.limits;
    if (memberId === null) return undefined;
    if (lim.max_runs_per_member_per_day !== undefined) {
      const start = dayStart(at);
      const r = yield* store(
        sql<{ n: string }>`
          SELECT count(*)::text AS n FROM automation_runs
          WHERE workspace_id = ${ws} AND automation_id = ${node.id} AND member_id = ${memberId}
            AND status IN ('succeeded', 'running') AND created_at >= ${start.toISOString()}::timestamptz
            AND created_at < ${new Date(start.getTime() + DAY_MS).toISOString()}::timestamptz`,
      );
      if (Number(r[0]?.n ?? 0) >= lim.max_runs_per_member_per_day)
        return {
          code: "LIMIT",
          message: `at most ${lim.max_runs_per_member_per_day} runs per member per day`,
          retryable: false,
        };
    }
    if (lim.cooldown_minutes !== undefined) {
      const r = yield* store(
        sql<{ last: Date | null }>`
          SELECT max(coalesce(finished_at, created_at)) AS last FROM automation_runs
          WHERE workspace_id = ${ws} AND automation_id = ${node.id} AND member_id = ${memberId} AND status = 'succeeded'`,
      );
      const last = r[0]?.last;
      if (last && at.getTime() - new Date(last).getTime() < lim.cooldown_minutes * 60_000)
        return { code: "LIMIT", message: `cooldown of ${lim.cooldown_minutes} minutes`, retryable: false };
    }
    return undefined;
  });

/**
 * Execute the pending steps of a run in order. Each step runs in its own savepoint, so a failing step leaves no partial
 * effect. A retryable error keeps the step `pending` with `next_attempt_at` (1 s, 4 s, 16 s of wall time) and leaves the
 * run `running`; `resumeDueRuns` continues it. Returns the final run status.
 */
export const executeRun = (
  ectx0: EmitCtx & { readonly principal: Principal },
  runId: string,
  now: Date,
): Effect.Effect<RunStatus | undefined, HandlerError, SuiteEnv> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const ws = ectx0.principal.workspaceId;
    const run = yield* loadRunRow(ws, runId, true);
    if (!run) return undefined;
    if (run.status !== "queued" && run.status !== "running") return run.status;
    const nodes = yield* loadNodes<AutomationSpec>(ws, "Automation");
    const node = nodes.find((n) => n.id === run.automation_id);
    const owner = node ? yield* safeOwner(node.spec.owner) : undefined;
    const ownerRef: PrincipalRef | undefined = owner ? { id: owner.id, subject: owner.subject } : undefined;
    const ectx = engineEmitCtx(ectx0.principal, now, ownerRef);
    const ownerSubject = node?.spec.owner ?? "";
    if (!owner) {
      // a missing owner fails the run instead of wedging the engine on this event
      const err: StepError = {
        code: "UNKNOWN_REFERENCE",
        message: clip(`automation owner '${ownerSubject}' not found`, 280),
        retryable: false,
      };
      yield* store(
        sql`UPDATE automation_runs SET status = 'failed', started_at = coalesce(started_at, ${now.toISOString()}::timestamptz),
                   finished_at = ${now.toISOString()}::timestamptz, error = ${JSON.stringify(err)}::jsonb WHERE run_id = ${runId}`,
      );
      yield* store(
        sql`UPDATE automation_steps SET status = 'failed', error = ${JSON.stringify(err)}::jsonb WHERE run_id = ${runId} AND status = 'pending'`,
      );
      yield* emitRun(ectx, {
        runId,
        automation: run.automation_slug,
        owner: ownerSubject,
        status: "failed",
        stepIndex: null,
        stepStatus: null,
        errorCode: err.code,
        depth: run.cause_depth,
      });
      return "failed";
    }
    if (run.status === "queued") {
      yield* store(
        sql`UPDATE automation_runs SET status = 'running', started_at = coalesce(started_at, ${now.toISOString()}::timestamptz)
            WHERE run_id = ${runId}`,
      );
      yield* emitRun(ectx, {
        runId,
        automation: run.automation_slug,
        owner: ownerSubject,
        status: "running",
        stepIndex: null,
        stepStatus: null,
        errorCode: null,
        depth: run.cause_depth,
      });
    }
    const member = run.member_id ? yield* memberByIdOption(ws, run.member_id) : undefined;
    const actor = (run.context["actor"] as { subject?: string } | undefined)?.subject;
    let waiting = false;
    let stopped = false;
    for (const s of yield* loadSteps(runId)) {
      if (s.status !== "pending" || stopped) continue;
      const cur = yield* loadRunRow(ws, runId);
      if (cur?.status === "cancelled") return "cancelled";
      if (s.next_attempt_at) {
        const due = yield* store(
          sql<{ ok: boolean }>`SELECT ${s.next_attempt_at.toISOString()}::timestamptz <= now() AS ok`,
        );
        if (!due[0]?.ok) {
          waiting = true;
          break;
        }
      }
      const step = s.input.step as AutomationStep;
      const attempts = s.attempts + 1;
      yield* store(
        sql`UPDATE automation_steps SET status = 'running', attempts = ${attempts}, next_attempt_at = NULL,
                   started_at = coalesce(started_at, ${now.toISOString()}::timestamptz)
            WHERE run_id = ${runId} AND step_index = ${s.step_index}`,
      );
      const env: StepEnv = {
        ws,
        wsSlug: ectx0.principal.workspaceSlug,
        now,
        svc: ectx0.principal,
        owner,
        runId,
        member,
        actor,
        context: { ...run.context, __step_index: s.step_index },
        depth: run.cause_depth,
        automation: run.automation_slug,
      };
      const result = yield* Effect.either(store(sql.withTransaction(execStep(env, step, s.idempotency_key))));
      if (Either.isRight(result)) {
        yield* store(
          sql`UPDATE automation_steps SET status = 'succeeded', output = ${JSON.stringify(result.right.output)}::jsonb, error = NULL,
                     finished_at = ${now.toISOString()}::timestamptz WHERE run_id = ${runId} AND step_index = ${s.step_index}`,
        );
        yield* emitRun(ectx, {
          runId,
          automation: run.automation_slug,
          owner: ownerSubject,
          status: "running",
          stepIndex: s.step_index,
          stepStatus: "succeeded",
          errorCode: null,
          depth: run.cause_depth,
        });
        continue;
      }
      const err = toStepError(result.left);
      if (err.retryable && attempts < MAX_ATTEMPTS) {
        const wait = BACKOFF_S[attempts - 1] ?? 16;
        yield* store(
          sql`UPDATE automation_steps SET status = 'pending', error = ${JSON.stringify(err)}::jsonb,
                     next_attempt_at = now() + make_interval(secs => ${wait}) WHERE run_id = ${runId} AND step_index = ${s.step_index}`,
        );
        waiting = true;
        break;
      }
      yield* store(
        sql`UPDATE automation_steps SET status = 'failed', error = ${JSON.stringify(err)}::jsonb,
                   finished_at = ${now.toISOString()}::timestamptz WHERE run_id = ${runId} AND step_index = ${s.step_index}`,
      );
      yield* emitRun(ectx, {
        runId,
        automation: run.automation_slug,
        owner: ownerSubject,
        status: "running",
        stepIndex: s.step_index,
        stepStatus: "failed",
        errorCode: err.code,
        depth: run.cause_depth,
      });
      if (step.on_error === "stop") stopped = true;
    }
    if (waiting) return "running";
    const after = yield* loadSteps(runId);
    const failed = after.find((s) => s.status === "failed");
    const status: RunStatus = failed ? "failed" : "succeeded";
    yield* store(
      sql`UPDATE automation_runs SET status = ${status}, finished_at = ${now.toISOString()}::timestamptz,
                 error = ${failed?.error ? JSON.stringify(failed.error) : null}::jsonb
          WHERE run_id = ${runId} AND status <> 'cancelled'`,
    );
    yield* emitRun(ectx, {
      runId,
      automation: run.automation_slug,
      owner: ownerSubject,
      status,
      stepIndex: null,
      stepStatus: null,
      errorCode: failed?.error?.code ?? null,
      depth: run.cause_depth,
    });
    return status;
  });

const memberByIdOption = (
  ws: string,
  id: string,
): Effect.Effect<MemberRow | undefined, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const r = yield* store(
      sql<{ handle: string }>`SELECT handle FROM members WHERE workspace_id = ${ws} AND member_id = ${id}`,
    );
    if (!r[0]) return undefined;
    const m = yield* memberByHandle(ws, r[0].handle).pipe(Effect.option);
    return Option.isSome(m) ? m.value : undefined;
  });

/** Continue runs whose retry delay has passed (every minute tick). */
export const resumeDueRuns = (
  ectx: EmitCtx & { readonly principal: Principal },
  now: Date,
): Effect.Effect<number, HandlerError, SuiteEnv> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const ws = ectx.principal.workspaceId;
    const due = yield* store(
      sql<{ run_id: string }>`
        SELECT DISTINCT r.run_id FROM automation_runs r JOIN automation_steps s ON s.run_id = r.run_id
        WHERE r.workspace_id = ${ws} AND r.status = 'running' AND s.status = 'pending' AND s.next_attempt_at IS NOT NULL
          AND s.next_attempt_at <= now()`,
    );
    for (const d of due) yield* executeRun(ectx, d.run_id, now);
    return due.length;
  });

// ---- creating runs from triggers --------------------------------------------------------------------------------

/**
 * Evaluate conditions and limits, create the run (exactly once per trigger key) and execute it. Returns the run id, or
 * undefined when the trigger already has a run.
 */
export const createAndRun = (
  ectx: EmitCtx & { readonly principal: Principal },
  a: Omit<NewRun, "skip"> & {
    readonly facts?: MemberFacts | undefined;
    readonly forceSkip?: StepError | undefined;
  },
): Effect.Effect<string | undefined, HandlerError, SuiteEnv> =>
  Effect.gen(function* () {
    const ws = ectx.principal.workspaceId;
    const condFacts = a.context;
    let skip: StepError | undefined = a.forceSkip;
    // a retry re-executes a run that already passed its conditions and limits
    if (!skip && !a.retryOf && a.node.spec.conditions && !evalCond(a.node.spec.conditions, condFacts))
      skip = { code: "CONDITIONS", message: "conditions did not pass", retryable: false };
    if (!skip && !a.retryOf) skip = yield* limitsFailure(ws, a.node, a.member?.id ?? null, a.at);
    const ownerP = yield* safeOwner(a.node.spec.owner);
    const ctx2 = engineEmitCtx(
      ectx.principal,
      a.at,
      ownerP ? { id: ownerP.id, subject: ownerP.subject } : undefined,
    );
    const runId = yield* insertRun(ctx2, { ...a, ...(skip ? { skip } : {}) });
    if (!runId || skip) return runId;
    yield* executeRun(ectx, runId, a.at);
    return runId;
  });

// ---- event triggers --------------------------------------------------------------------------------------------

const TRIGGERABLE = new Set([
  "message.received",
  "message.sent",
  "points.posted",
  "tier.changed",
  "order.placed",
  "order.status_changed",
  "stock.changed",
  "review.created",
  "badge.awarded",
  "promotion.state_changed",
  "promotion.redeemed",
  "promotion.budget_alert",
  "automation.run_updated",
  "content.state_changed",
  "content.published",
  "content.engaged",
  "task.assigned",
  "task.updated",
  "approval.requested",
  "approval.decided",
]);

/** Which automation run produced an event: its own `cause`, or a step output that recorded the event's subject id. */
const causeOf = (
  ws: string,
  ev: StoredDomainEvent,
): Effect.Effect<{ automation: string; depth: number } | undefined, StoreError, ControlStore> =>
  Effect.gen(function* () {
    if (ev.cause) return { automation: ev.cause.automation, depth: ev.cause.depth };
    if (!ev.subject) return undefined;
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{ automation_slug: string; cause_depth: number }>`
        SELECT r.automation_slug, r.cause_depth FROM automation_steps s JOIN automation_runs r ON r.run_id = s.run_id
        WHERE r.workspace_id = ${ws} AND s.output -> 'ids' @> to_jsonb(${ev.subject.id}::text) LIMIT 1`,
    );
    const r = rows[0];
    return r ? { automation: r.automation_slug, depth: r.cause_depth + 1 } : undefined;
  });

/** Match one batch of domain events against the enabled event-triggered automations (CONTRACT.md 9.2). */
export const matchEvents = (
  ectx: EmitCtx & { readonly principal: Principal },
  events: ReadonlyArray<StoredDomainEvent>,
): Effect.Effect<void, HandlerError, SuiteEnv> =>
  Effect.gen(function* () {
    const ws = ectx.principal.workspaceId;
    const autos = (yield* loadNodes<AutomationSpec>(ws, "Automation")).filter(
      (n) => n.spec.enabled && n.spec.trigger.type === "event",
    );
    if (autos.length === 0) return;
    for (const ev of events) {
      if (!TRIGGERABLE.has(ev.type)) continue;
      const matching = autos.filter(
        (n) => n.spec.trigger.type === "event" && n.spec.trigger.event === ev.type,
      );
      if (matching.length === 0) continue;
      const cause = yield* causeOf(ws, ev);
      const { context } = yield* buildContext(ws, ev.occurredAt, {
        seq: ev.seq,
        type: ev.type,
        payload: ev.payload,
        member: ev.member,
        actorSubject: ev.actor.subject,
      });
      for (const n of matching) {
        const trig = n.spec.trigger;
        if (trig.type !== "event") continue;
        if (trig.filter && !evalCond(trig.filter, context)) continue;
        const depth = Math.max(ev.causeDepth, cause?.depth ?? 0);
        const loop = depth >= 3 || cause?.automation === n.slug;
        yield* createAndRun(ectx, {
          node: n,
          trigger: { type: "event", event_seq: ev.seq, event_type: ev.type },
          triggerKey: `event:${ev.seq}`,
          context,
          member: ev.member ? { id: ev.member.id } : null,
          causeDepth: depth,
          at: ev.occurredAt,
          ...(loop
            ? {
                forceSkip: {
                  code: "LOOP_SUSPECTED",
                  message: "the event was caused by an automation",
                  retryable: false,
                },
              }
            : {}),
        }).pipe(
          // a refusal for one event never wedges the consumer: the run is simply not created
          Effect.catchIf(
            (e): e is DomainError => e instanceof DomainError,
            (e) => Effect.logWarning(`automation ${n.slug} skipped event ${ev.seq}: ${e.message}`),
          ),
        );
      }
    }
  });

// ---- schedule and metric triggers ------------------------------------------------------------------------------

/**
 * Cron triggers: every minute from `previous` (at most 60 missed minutes) to `bucket`, each enabled schedule automation
 * whose cron matches gets a run with trigger key `cron:<minute ISO>`.
 */
export const fireSchedules = (
  ectx: EmitCtx & { readonly principal: Principal },
  tick: { readonly bucket: Date; readonly previous: Date | null },
): Effect.Effect<void, HandlerError, SuiteEnv> =>
  Effect.gen(function* () {
    const ws = ectx.principal.workspaceId;
    const autos = (yield* loadNodes<AutomationSpec>(ws, "Automation")).filter(
      (n) => n.spec.enabled && n.spec.trigger.type === "schedule",
    );
    if (autos.length === 0) return;
    const from = tick.previous
      ? Math.max(tick.previous.getTime() + 60_000, tick.bucket.getTime() - 59 * 60_000)
      : tick.bucket.getTime();
    for (let t = from; t <= tick.bucket.getTime(); t += 60_000) {
      const minute = new Date(t);
      for (const n of autos) {
        const trig = n.spec.trigger;
        if (trig.type !== "schedule") continue;
        const spec = parseCron(trig.cron);
        if (!spec || !cronMatches(spec, minute)) continue;
        const { context } = yield* buildContext(ws, minute, undefined);
        yield* createAndRun(ectx, {
          node: n,
          trigger: { type: "schedule", minute: iso(minute) },
          triggerKey: `cron:${iso(minute)}`,
          context,
          member: null,
          causeDepth: 0,
          at: minute,
        });
      }
    }
  });

/** Metric triggers: evaluate each query every `every_minutes`, fire on the rising edge once held for `for_minutes`. */
export const evaluateMetrics = (
  ectx: EmitCtx & { readonly principal: Principal },
  now: Date,
): Effect.Effect<void, HandlerError, SuiteEnv> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const ws = ectx.principal.workspaceId;
    const autos = (yield* loadNodes<AutomationSpec>(ws, "Automation")).filter(
      (n) => n.spec.enabled && n.spec.trigger.type === "metric",
    );
    if (autos.length === 0) return;
    const qe = yield* Effect.serviceOption(QueryEngine);
    if (Option.isNone(qe)) return;
    for (const n of autos) {
      const trig = n.spec.trigger;
      if (trig.type !== "metric") continue;
      yield* store(
        sql`INSERT INTO automation_metric_state (automation_id, workspace_id) VALUES (${n.id}, ${ws}) ON CONFLICT DO NOTHING`,
      );
      const st = (yield* store(
        sql<{ holding_since: Date | null; last_eval_at: Date | null; last_fired_key: string | null }>`
          SELECT holding_since, last_eval_at, last_fired_key FROM automation_metric_state WHERE automation_id = ${n.id} FOR UPDATE`,
      ))[0];
      if (
        st?.last_eval_at &&
        now.getTime() - new Date(st.last_eval_at).getTime() < trig.every_minutes * 60_000
      )
        continue;
      const owner = yield* safeOwner(n.spec.owner);
      if (!owner) continue;
      const res = yield* Effect.either(qe.value.run({ principal: owner, ast: trig.query, asOf: now }));
      if (Either.isLeft(res)) continue;
      const col = res.right.columns.findIndex((c) => c.name === trig.value_column);
      const lastRow = res.right.rows[res.right.rows.length - 1];
      const raw = col >= 0 && lastRow ? lastRow[col] : undefined;
      const value =
        typeof raw === "number" ? raw : typeof raw === "string" && raw !== "" ? Number(raw) : Number.NaN;
      const holds =
        Number.isFinite(value) &&
        (trig.op === "gt"
          ? value > trig.threshold
          : trig.op === "gte"
            ? value >= trig.threshold
            : trig.op === "lt"
              ? value < trig.threshold
              : value <= trig.threshold);
      let holding = st?.holding_since ? new Date(st.holding_since) : null;
      if (!holds) holding = null;
      else if (!holding) holding = now;
      let fired = st?.last_fired_key ?? null;
      if (holding && now.getTime() - holding.getTime() >= trig.for_minutes * 60_000) {
        const key = `metric:${iso(holding)}`;
        if (fired !== key) {
          const { context } = yield* buildContext(ws, now, undefined);
          const runId = yield* createAndRun(ectx, {
            node: n,
            trigger: { type: "metric", value, window_start: iso(holding) },
            triggerKey: key,
            context: { ...context, metric: { value, threshold: trig.threshold } },
            member: null,
            causeDepth: 0,
            at: now,
          });
          if (runId !== undefined) fired = key;
          else fired = key;
        }
      }
      yield* store(
        sql`UPDATE automation_metric_state SET holding_since = ${holding ? holding.toISOString() : null}::timestamptz,
                   last_eval_at = ${now.toISOString()}::timestamptz, last_value = ${Number.isFinite(value) ? value : null},
                   last_fired_key = ${fired} WHERE automation_id = ${n.id}`,
      );
    }
  });

// ---- manual runs, retry, cancel --------------------------------------------------------------------------------

export const triggerManual = (
  ectx: EmitCtx & { readonly principal: Principal },
  a: {
    readonly node: AutoNode;
    readonly by: string;
    readonly key: string;
    readonly event?:
      { type: string; payload: Record<string, unknown>; member?: string | undefined } | undefined;
    readonly at: Date;
  },
): Effect.Effect<string | undefined, HandlerError, SuiteEnv> =>
  Effect.gen(function* () {
    const ws = ectx.principal.workspaceId;
    const member = a.event?.member ? yield* memberByHandle(ws, a.event.member) : undefined;
    const { context } = yield* buildContext(
      ws,
      a.at,
      a.event
        ? {
            type: a.event.type,
            payload: a.event.payload,
            member: member ? { id: member.id, subject: member.subject, handle: member.handle } : null,
            actorSubject: a.by,
          }
        : undefined,
    );
    return yield* createAndRun(ectx, {
      node: a.node,
      trigger: { type: "manual", by: a.by },
      triggerKey: `manual:${a.key}`,
      context,
      member: member ? { id: member.id } : null,
      causeDepth: 0,
      at: a.at,
    });
  });

/** A retry run: a new run (`retry:<run>:<n>`) that re-executes the failed and pending steps with the original step keys. */
export const retryRunOf = (
  ectx: EmitCtx & { readonly principal: Principal },
  a: { readonly runId: string; readonly at: Date },
): Effect.Effect<string, HandlerError, SuiteEnv> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const ws = ectx.principal.workspaceId;
    const run = yield* loadRunRow(ws, a.runId, true);
    if (!run) return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/run_id", `no run '${a.runId}'`));
    if (run.status !== "failed")
      return yield* Effect.fail(
        dom("CONFLICT", "/run_id", `only a failed run can be retried (this run is ${run.status})`, {
          details: { reason: "INVALID_TRANSITION", from: run.status, to: "running", allowed: ["failed"] },
        }),
      );
    const nodes = yield* loadNodes<AutomationSpec>(ws, "Automation");
    const node = nodes.find((n) => n.id === run.automation_id);
    if (!node)
      return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/run_id", "the automation no longer exists"));
    const steps = yield* loadSteps(a.runId);
    const count = (yield* store(
      sql<{ n: string }>`
        SELECT count(*)::text AS n FROM automation_runs WHERE workspace_id = ${ws} AND automation_id = ${run.automation_id}
          AND trigger_key LIKE ${"retry:" + a.runId + ":%"}`,
    ))[0]?.n;
    const n = Number(count ?? 0) + 1;
    const runId = yield* createAndRun(ectx, {
      node,
      trigger: { type: "retry", of_run: a.runId },
      triggerKey: `retry:${a.runId}:${n}`,
      context: run.context,
      member: run.member_id ? { id: run.member_id } : null,
      causeDepth: run.cause_depth,
      at: a.at,
      retryOf: { runId: a.runId, steps },
    });
    return runId ?? (yield* Effect.fail(dom("CONFLICT", "", "this retry already exists")));
  });

export const cancelRun = (
  ectx: EmitCtx,
  a: { readonly runId: string; readonly at: Date },
): Effect.Effect<void, DomainError | StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const ws = ectx.principal.workspaceId;
    const run = yield* loadRunRow(ws, a.runId, true);
    if (!run) return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/run_id", `no run '${a.runId}'`));
    if (run.status !== "queued" && run.status !== "running")
      return yield* Effect.fail(
        dom("CONFLICT", "/run_id", `a ${run.status} run cannot be cancelled`, {
          details: {
            reason: "INVALID_TRANSITION",
            from: run.status,
            to: "cancelled",
            allowed: ["queued", "running"],
          },
        }),
      );
    yield* store(
      sql`UPDATE automation_runs SET status = 'cancelled', finished_at = ${a.at.toISOString()}::timestamptz WHERE run_id = ${a.runId}`,
    );
    yield* store(
      sql`UPDATE automation_steps SET status = 'skipped' WHERE run_id = ${a.runId} AND status = 'pending'`,
    );
    const nodes = yield* loadNodes<AutomationSpec>(ws, "Automation");
    const owner = nodes.find((n) => n.id === run.automation_id)?.spec.owner ?? "";
    yield* emitRun(ectx, {
      runId: a.runId,
      automation: run.automation_slug,
      owner,
      status: "cancelled",
      stepIndex: null,
      stepStatus: null,
      errorCode: null,
      depth: run.cause_depth,
    });
  });

// ---- dry run ---------------------------------------------------------------------------------------------------

const sentence = (step: AutomationStep, who: string): string => {
  switch (step.type) {
    case "award_points":
      return `Award ${step.points} points to ${who}: ${clip(step.memo, 80)}`;
    case "notify":
      return `Notify ${step.to.length} target(s) (${step.notification_type}): ${clip(step.title, 80)}`;
    case "send_message":
      return `Send message "${clip(step.subject, 80)}" to ${step.to.length} target(s)`;
    case "apply_promotion":
      return `Grant ${refSlug(step.promotion)} entitlement to ${who} for ${step.expires_in_days} days`;
    case "create_task":
      return `Create ${step.priority} task "${clip(step.title, 80)}" for ${step.assignee}`;
    case "webhook":
      return `Record a webhook delivery to ${step.target_label} (never sent)`;
  }
};

export interface DryRunInput {
  readonly spec: AutomationSpec;
  readonly node?: AutoNode | undefined;
  readonly event?:
    { type: string; payload: Record<string, unknown>; member?: string | undefined } | undefined;
  readonly eventSeq?: number | undefined;
  readonly at: Date;
}

/** Evaluate trigger, conditions, limits and every step without writing anything (CONTRACT.md 9.6). */
export const dryRun = (
  ws: string,
  in_: DryRunInput,
): Effect.Effect<Record<string, unknown>, HandlerError, ControlStore | Identity | Authorizer> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const { spec, at } = in_;
    let ev: TriggerEventLike | undefined;
    if (in_.eventSeq !== undefined) {
      const r = yield* store(
        sql<{ type: string; payload: Record<string, unknown>; member_id: string | null; actor: string }>`
          SELECT e.type, e.payload, e.member_id, a.subject AS actor FROM domain_events e JOIN principals a ON a.principal_id = e.actor_id
          WHERE e.workspace_id = ${ws} AND e.seq = ${in_.eventSeq}`,
      );
      if (!r[0])
        return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/event_seq", `no event ${in_.eventSeq}`));
      const m = r[0].member_id ? yield* memberByIdOption(ws, r[0].member_id) : undefined;
      ev = {
        seq: in_.eventSeq,
        type: r[0].type,
        payload: r[0].payload,
        member: m ? { id: m.id, subject: m.subject, handle: m.handle } : null,
        actorSubject: r[0].actor,
      };
    } else if (in_.event) {
      const m = in_.event.member ? yield* memberByHandle(ws, in_.event.member) : undefined;
      ev = {
        type: in_.event.type,
        payload: in_.event.payload,
        member: m ? { id: m.id, subject: m.subject, handle: m.handle } : null,
      };
    }
    const { context } = yield* buildContext(ws, at, ev);
    const trig = spec.trigger;
    const triggerMatched =
      trig.type === "event"
        ? ev !== undefined && ev.type === trig.event && (!trig.filter || evalCond(trig.filter, context))
        : true;
    const conditionsPassed = !spec.conditions || evalCond(spec.conditions, context);
    const node = in_.node;
    const limitErr = node ? yield* limitsFailure(ws, node, ev?.member?.id ?? null, at) : undefined;
    const owner = yield* safeOwner(spec.owner);
    const member = ev?.member ? yield* memberByIdOption(ws, ev.member.id) : undefined;
    const who = ev?.member?.handle ?? "the member";
    const steps: Record<string, unknown>[] = [];
    for (let i = 0; i < spec.steps.length; i++) {
      const s = spec.steps[i]!;
      const sub = substituteStep(s, { ...context, run: { id: "dry-run" } });
      const whenFalse = s.when !== undefined && !evalCond(s.when, context);
      let error: StepError | null = null;
      let reason: "when_false" | "forbidden" | "invalid" | null = whenFalse ? "when_false" : null;
      if (!whenFalse) {
        const needs = stepNeeds(sub, { memberSubject: member?.subject, owner: spec.owner });
        if (needs && owner) {
          const ok = yield* ownerAllow(owner, needs.permission, needs.module).pipe(Effect.either);
          if (Either.isLeft(ok)) {
            error = {
              code: "FORBIDDEN",
              message: `owner ${spec.owner} lacks ${needs.permission}`,
              retryable: false,
            };
            reason = "forbidden";
          }
        } else if (!owner) {
          error = { code: "UNKNOWN_REFERENCE", message: `owner ${spec.owner} not found`, retryable: false };
          reason = "invalid";
        }
      }
      steps.push({
        index: i,
        id: s.id,
        type: s.type,
        would_run: reason === null,
        skipped_reason: reason,
        input: sub,
        effect: clip(sentence(sub, who), 280),
        error,
      });
    }
    const cron = trig.type === "schedule" ? parseCron(trig.cron) : undefined;
    return {
      trigger_matched: triggerMatched,
      conditions_passed: conditionsPassed,
      limits_ok: limitErr === undefined,
      context,
      steps,
      next_fires: cron ? nextFires(cron, at, 5).map(iso) : [],
    };
  });

/** Summaries for the list: last run, counts over the last 7 virtual days, next fire. */
export const listSummaryData = (
  ws: string,
  now: Date,
): Effect.Effect<
  {
    last: Map<string, RunRow>;
    counts: Map<string, { runs: number; failures: number }>;
    pending: Map<string, string>;
  },
  StoreError,
  ControlStore
> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const lastRows = yield* store(
      sql.unsafe<RunRow>(
        `SELECT DISTINCT ON (r.automation_id) ${RUN_COLS} FROM automation_runs r WHERE r.workspace_id = $1
         ORDER BY r.automation_id, r.created_at DESC, r.run_id DESC`,
        [ws],
      ),
    );
    const counts = yield* store(
      sql<{ automation_slug: string; runs: string; failures: string }>`
        SELECT automation_slug, count(*)::text AS runs, count(*) FILTER (WHERE status = 'failed')::text AS failures
        FROM automation_runs WHERE workspace_id = ${ws} AND created_at > ${new Date(now.getTime() - 7 * DAY_MS).toISOString()}::timestamptz
          AND created_at <= ${now.toISOString()}::timestamptz GROUP BY automation_slug`,
    );
    const pend = yield* store(
      sql<{ approval_id: string; targets: string[] }>`
        SELECT approval_id, ARRAY(SELECT c ->> 'target' FROM jsonb_array_elements(payload -> 'changes') c) AS targets
        FROM change_approvals WHERE workspace_id = ${ws} AND status = 'pending_approval'`,
    );
    const pendingBy = new Map<string, string>();
    for (const p of pend) for (const t of p.targets) pendingBy.set(t, p.approval_id);
    return {
      last: new Map(lastRows.map((r) => [r.automation_slug, r] as const)),
      counts: new Map(
        counts.map(
          (r) => [r.automation_slug, { runs: Number(r.runs), failures: Number(r.failures) }] as const,
        ),
      ),
      pending: pendingBy,
    };
  });
