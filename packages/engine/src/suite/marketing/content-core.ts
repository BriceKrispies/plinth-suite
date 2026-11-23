import { Effect, Either } from "effect";
import { applyOps, evalCond, jsonEqual } from "@plinth/core";
import {
  DomainError,
  type ContentBlock,
  type ContentSpec,
  type ContentStatus,
  type MemberFacts,
  type Json,
  type NodeChange,
  type Op,
  type PersonRef,
  REACTIONS,
} from "@plinth/spec";
import { Authorizer } from "../../authz";
import { ChangeLog } from "../../change-log";
import { ControlStore, store } from "../../control-store";
import type { StoreError } from "../../errors";
import type { Principal } from "../../identity";
import { emitFrom, type EmitCtx, type PrincipalRef } from "../domain-events";
import { createNotifications } from "../notify";
import { memberFactsFor } from "../segments";
import { audienceMemberIds } from "../segments";
import { commitNodeChange, type CommittedChange } from "./commit";
import {
  dom,
  iso,
  loadNodes,
  nodeUriOf,
  refSlug,
  requireNode,
  personBySubjectSafe,
  type SuiteNode,
} from "./common";

/**
 * Content workflow and reading helpers (CONTRACT.md section 10), shared by the `content.*` handlers and the worker's
 * content scheduler.
 */

export type ContentNode = SuiteNode<ContentSpec>;
type Reaction = (typeof REACTIONS)[number];
export type TxCtx = EmitCtx & {
  readonly principal: Principal;
  readonly sessionId?: string | undefined;
};

export type ContentAction =
  | "submit"
  | "approve"
  | "request_changes"
  | "publish"
  | "schedule"
  | "unschedule"
  | "revise"
  | "archive"
  | "restore";

/** from-states of each action, and the status it moves to (10.3). */
export const WORKFLOW: Readonly<
  Record<
    ContentAction,
    { readonly from: ReadonlyArray<ContentStatus>; readonly to: ContentStatus; readonly permission: string }
  >
> = {
  submit: { from: ["draft"], to: "in_review", permission: "content:author" },
  approve: { from: ["in_review"], to: "approved", permission: "content:review" },
  request_changes: { from: ["in_review"], to: "draft", permission: "content:review" },
  publish: { from: ["approved"], to: "published", permission: "content:publish" },
  schedule: { from: ["approved"], to: "approved", permission: "content:publish" },
  unschedule: { from: ["approved"], to: "approved", permission: "content:publish" },
  revise: { from: ["published"], to: "draft", permission: "content:author" },
  archive: { from: ["published", "approved", "draft"], to: "archived", permission: "content:publish" },
  restore: { from: ["archived"], to: "draft", permission: "content:author" },
};

const EDITORS = ["role:content-editor", "role:marketing-manager", "role:admin"];

export const displayStatus = (spec: ContentSpec, now: Date) =>
  spec.status === "approved" &&
  spec.schedule.publish_at &&
  Date.parse(spec.schedule.publish_at) > now.getTime()
    ? ("scheduled" as const)
    : spec.status === "draft" && spec.published_revision !== null
      ? ("revising" as const)
      : spec.status;

// ---- audience --------------------------------------------------------------------------------------------------

export const inAudience = (spec: ContentSpec, facts: MemberFacts | undefined): boolean => {
  if (spec.audience.everyone) return true;
  if (!facts) return false;
  // segments are evaluated by the caller through `segmentMatches`; groups come from the member's facts
  if ((spec.audience.groups ?? []).some((g) => facts.groups.includes(refSlug(g)))) return true;
  return false;
};

/** Segment slug -> does the member match, for every segment the given contents name. */
export const segmentMatches = (
  ws: string,
  specs: ReadonlyArray<ContentSpec>,
  facts: MemberFacts | undefined,
): Effect.Effect<ReadonlyMap<string, boolean>, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const out = new Map<string, boolean>();
    const refs = new Set(specs.flatMap((s) => (s.audience.segments ?? []).map(refSlug)));
    if (refs.size === 0 || !facts) return out;
    const segs = yield* loadNodes<{ rule: Parameters<typeof evalCond>[0] }>(ws, "Segment");
    for (const r of refs) {
      const n = segs.find((x) => x.slug === r);
      out.set(r, n ? evalCond(n.spec.rule, facts as unknown as Record<string, unknown>) : false);
    }
    return out;
  });

export const mayRead = (
  spec: ContentSpec,
  facts: MemberFacts | undefined,
  segs: ReadonlyMap<string, boolean>,
): boolean =>
  spec.audience.everyone ||
  inAudience(spec, facts) ||
  (spec.audience.segments ?? []).some((s) => segs.get(refSlug(s)) === true);

// ---- bodies ----------------------------------------------------------------------------------------------------

/** The body of a node at a revision, replayed from the change log without a read check (the feed serves members). */
export const bodyAtRevision = (
  ws: string,
  node: string,
  revision: number,
): Effect.Effect<{ spec?: ContentSpec } | undefined, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{ ops: Op[] }>`
        SELECT ops FROM changes WHERE workspace_id = ${ws} AND node_id = ${node} AND kind = 'change'
          AND result_revision <= ${revision} ORDER BY result_revision`,
    );
    let body: Json | undefined;
    for (const r of rows) {
      const a = applyOps(body, r.ops, false);
      if (Either.isLeft(a)) return undefined;
      body = a.right.body;
    }
    return body as { spec?: ContentSpec } | undefined;
  });

/** The spec the feed serves: the head when it is the published revision, else the body at `published_revision`. */
export const servedSpec = (
  ws: string,
  n: ContentNode,
): Effect.Effect<ContentSpec, StoreError, ControlStore> =>
  Effect.gen(function* () {
    if (
      n.spec.status === "published" ||
      n.spec.published_revision === null ||
      n.spec.published_revision === n.revision
    )
      return n.spec;
    const body = yield* bodyAtRevision(ws, n.id, n.spec.published_revision);
    return body?.spec ?? n.spec;
  });

// ---- engagement ------------------------------------------------------------------------------------------------

export interface Engagement {
  readonly views: number;
  readonly reactions: Record<Reaction, number>;
  readonly mine: Reaction | null;
  readonly seen: boolean;
}

export const loadEngagement = (
  ws: string,
  viewerId: string | undefined,
): Effect.Effect<ReadonlyMap<string, Engagement>, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{ content_id: string; views: string; like: string; celebrate: string; insightful: string }>`
        SELECT content_id, coalesce(sum(views), 0)::text AS views,
               count(*) FILTER (WHERE reaction = 'like')::text AS "like",
               count(*) FILTER (WHERE reaction = 'celebrate')::text AS celebrate,
               count(*) FILTER (WHERE reaction = 'insightful')::text AS insightful
        FROM content_engagement WHERE workspace_id = ${ws} GROUP BY content_id`,
    );
    const mine = viewerId
      ? yield* store(
          sql<{ content_id: string; reaction: Reaction | null }>`
            SELECT content_id, reaction FROM content_engagement WHERE workspace_id = ${ws} AND member_id = ${viewerId}`,
        )
      : [];
    const my = new Map(mine.map((r) => [r.content_id, r.reaction] as const));
    const out = new Map<string, Engagement>();
    for (const r of rows)
      out.set(r.content_id, {
        views: Number(r.views),
        reactions: { like: Number(r.like), celebrate: Number(r.celebrate), insightful: Number(r.insightful) },
        mine: my.get(r.content_id) ?? null,
        seen: my.has(r.content_id),
      });
    for (const [id, reaction] of my)
      if (!out.has(id))
        out.set(id, {
          views: 0,
          reactions: { like: 0, celebrate: 0, insightful: 0 },
          mine: reaction,
          seen: true,
        });
    return out;
  });

export const emptyEngagement: Engagement = {
  views: 0,
  reactions: { like: 0, celebrate: 0, insightful: 0 },
  mine: null,
  seen: false,
};

export const reactionTotal = (e: Engagement): number => REACTIONS.reduce((a, r) => a + e.reactions[r], 0);

/** When the item was published: the newest `published` entry of its review log. */
export const publishedAt = (spec: ContentSpec, fallback: string): string => {
  for (let i = spec.review_log.length - 1; i >= 0; i--) {
    const e = spec.review_log[i];
    if (e && e.decision === "published") return e.at;
  }
  return fallback;
};

// ---- the workflow ----------------------------------------------------------------------------------------------

export interface TransitionInput {
  readonly slug: string;
  readonly action: ContentAction;
  readonly note?: string | undefined;
  readonly publish_at?: string | undefined;
  readonly base_revision: number;
}

const invalidFrom = (n: ContentNode, action: ContentAction) =>
  dom("CONFLICT", "/action", `cannot ${action} content that is ${n.spec.status}`, {
    details: {
      reason: "INVALID_TRANSITION",
      from: n.spec.status,
      to: WORKFLOW[action].to,
      allowed: [...WORKFLOW[action].from],
    },
    fix_hint: `${action} applies to: ${WORKFLOW[action].from.join(", ")}.`,
  });

/** Checks that need no write: state, role, people, inputs. `check` is false for the scheduler (system). */
export const checkTransition = (
  ctx: TxCtx,
  n: ContentNode,
  input: TransitionInput,
  check: boolean,
): Effect.Effect<void, DomainError | StoreError, Authorizer> =>
  Effect.gen(function* () {
    const w = WORKFLOW[input.action];
    if (!w.from.includes(n.spec.status)) return yield* Effect.fail(invalidFrom(n, input.action));
    const actor = ctx.principal.subject;
    if (check) {
      const authz = yield* Authorizer;
      const res = `plinth://${ctx.principal.workspaceSlug}/suite/content`;
      if (w.permission === "content:author") {
        // authoring actions are open to people who can publish too (a marketing manager edits and submits their own items)
        const a = yield* authz.authorize(ctx.principal, "content:author", res);
        if (a.kind !== "allow") yield* authz.require(ctx.principal, "content:publish", res);
      } else yield* authz.require(ctx.principal, w.permission, res);
      if (input.action === "submit") {
        if (n.spec.author !== actor) {
          const pub = yield* authz.authorize(
            ctx.principal,
            "content:publish",
            `plinth://${ctx.principal.workspaceSlug}/suite/content`,
          );
          if (pub.kind !== "allow")
            return yield* Effect.fail(
              dom("FORBIDDEN", "/slug", "only the author, or someone who can publish, may submit this", {
                details: { reason: "not_author" },
              }),
            );
        }
      }
      if (input.action === "approve" || input.action === "request_changes") {
        if (!n.spec.reviewers.includes(actor))
          return yield* Effect.fail(
            dom("RULE_REFUSED", "/slug", "you are not a reviewer of this content", {
              details: { reason: "NOT_ELIGIBLE" },
            }),
          );
        if (input.action === "approve" && n.spec.author === actor)
          return yield* Effect.fail(
            dom("RULE_REFUSED", "/slug", "you cannot approve your own content", {
              details: { reason: "SELF_ACTION" },
            }),
          );
      }
    }
    if (input.action === "submit" && n.spec.reviewers.length === 0)
      return yield* Effect.fail(
        dom("VALIDATION_FAILED", "/reviewers", "add at least one reviewer before submitting", {
          expected: "at least one reviewer",
        }),
      );
    if (input.action === "request_changes" && (input.note === undefined || input.note.trim() === ""))
      return yield* Effect.fail(
        dom("VALIDATION_FAILED", "/note", "a note is required when requesting changes", { expected: "note" }),
      );
    if (input.action === "schedule") {
      if (input.publish_at === undefined)
        return yield* Effect.fail(
          dom("VALIDATION_FAILED", "/publish_at", "schedule needs publish_at", {
            expected: "a future Timestamp",
          }),
        );
      if (Date.parse(input.publish_at) <= ctx.now.getTime())
        return yield* Effect.fail(
          dom("VALIDATION_FAILED", "/publish_at", "publish_at must be in the future", {
            expected: "a future Timestamp",
          }),
        );
    }
    if (input.action === "unschedule" && n.spec.schedule.publish_at === undefined)
      return yield* Effect.fail(
        dom("CONFLICT", "/action", "this content has no scheduled publication", {
          details: { reason: "INVALID_TRANSITION", from: "approved", to: "approved", allowed: [] },
        }),
      );
  });

const DECISION: Partial<Record<ContentAction, ContentSpec["review_log"][number]["decision"]>> = {
  submit: "submitted",
  approve: "approved",
  request_changes: "changes_requested",
  publish: "published",
  archive: "archived",
  revise: "revised",
};

const subjectsToRefs = (
  ws: string,
  subjects: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<PrincipalRef>, StoreError, ControlStore> =>
  Effect.gen(function* () {
    if (subjects.length === 0) return [];
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{ principal_id: string; subject: string }>`
        SELECT principal_id, subject FROM principals
        WHERE workspace_id = ${ws} AND subject IN ${sql.in([...subjects])} AND kind = 'human' AND disabled_at IS NULL`,
    );
    return rows.map((r) => ({ id: r.principal_id, subject: r.subject }));
  });

/** Everyone in the audience of a content item, as principals (disabled members excluded). */
export const audiencePrincipals = (
  ws: string,
  spec: ContentSpec,
  now: Date,
): Effect.Effect<ReadonlyArray<PrincipalRef> | "everyone", DomainError | StoreError, ControlStore> =>
  Effect.gen(function* () {
    const ids = yield* audienceMemberIds(ws, spec.audience, now);
    const { sql } = yield* ControlStore;
    if (ids === "everyone") return "everyone" as const;
    if (ids.length === 0) return [];
    const rows = yield* store(
      sql<{ principal_id: string; subject: string }>`
        SELECT principal_id, subject FROM principals WHERE workspace_id = ${ws} AND principal_id IN ${sql.in([...ids])} AND disabled_at IS NULL`,
    );
    return rows.map((r) => ({ id: r.principal_id, subject: r.subject }));
  });

const allActiveMembers = (ws: string): Effect.Effect<ReadonlyArray<PrincipalRef>, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{ principal_id: string; subject: string }>`
        SELECT p.principal_id, p.subject FROM principals p JOIN members m ON m.member_id = p.principal_id
        WHERE p.workspace_id = ${ws} AND p.disabled_at IS NULL ORDER BY p.subject`,
    );
    return rows.map((r) => ({ id: r.principal_id, subject: r.subject }));
  });

/**
 * Run a workflow action: one change-log commit (rule R-CONTENT-STATUS, `managed: { by: "content.transition" }`) that
 * sets the status, `published_revision`, the schedule and appends the review log entry, then the domain events and
 * notifications of 10.3. `check` is false for the scheduler.
 */
export const transitionContent = (
  ctx: TxCtx,
  input: TransitionInput,
  check: boolean,
): Effect.Effect<CommittedChange, DomainError | StoreError, ControlStore | ChangeLog | Authorizer> =>
  Effect.gen(function* () {
    const ws = ctx.principal.workspaceId;
    const wsSlug = ctx.principal.workspaceSlug;
    const n = yield* requireNode<ContentSpec>(ws, "Content", input.slug);
    yield* checkTransition(ctx, n, input, check);
    const w = WORKFLOW[input.action];
    const predicted = n.revision + 1;
    const ops: Array<NodeChange["ops"][number]> = [];
    if (w.to !== n.spec.status) ops.push({ op: "set", path: "/spec/status", value: w.to });
    if (input.action === "publish")
      ops.push({ op: "set", path: "/spec/published_revision", value: predicted });
    if (input.action === "schedule")
      ops.push({ op: "set", path: "/spec/schedule/publish_at", value: input.publish_at });
    if (input.action === "unschedule") ops.push({ op: "remove", path: "/spec/schedule/publish_at" });
    const decision = DECISION[input.action];
    if (decision)
      ops.push({
        op: "set",
        path: "/spec/review_log/-",
        value: {
          by: ctx.principal.subject,
          at: iso(ctx.now),
          decision,
          ...(input.note !== undefined && input.note.trim() !== "" ? { note: input.note } : {}),
          revision: predicted,
        },
      });
    if (ops.length === 0) ops.push({ op: "set", path: "/spec/status", value: w.to });
    const change: NodeChange = {
      target: nodeUriOf(wsSlug, ws, "Content", n.slug),
      base_revision: input.base_revision,
      ops,
    };
    const res = yield* commitNodeChange(ctx, change, {
      reason: input.note !== undefined ? input.note.slice(0, 280) : `content ${input.action}`,
      managedBy: "content.transition",
    });
    if (res.revision !== undefined && res.revision !== predicted && (input.action === "publish" || decision))
      return yield* Effect.fail(
        dom(
          "CONFLICT",
          "/base_revision",
          "the content changed while this action was applied; reload and retry",
          {
            retryable: true,
            details: { reason: "STALE_VERSION", current_version: res.revision },
          },
        ),
      );

    // ---- events and notifications
    const reviewers = yield* subjectsToRefs(ws, n.spec.reviewers);
    const watchers = [...new Set([n.spec.author, ctx.principal.subject, ...n.spec.reviewers])];
    const stateSeq = yield* emitFrom(ctx, "content.state_changed", {
      audience: [...EDITORS, ...watchers],
      subject: { kind: "content", id: n.slug },
      payload: {
        content: n.slug,
        title: n.title,
        from: n.spec.status,
        to: w.to,
        by: ctx.principal.subject,
        note: input.note ?? null,
      },
    });
    const author = (yield* subjectsToRefs(ws, [n.spec.author]))[0];
    if (input.action === "submit") {
      const seq = yield* emitFrom(ctx, "approval.requested", {
        audience: n.spec.reviewers,
        subject: { kind: "content", id: n.slug },
        payload: {
          approval_type: "content_review",
          id: n.slug,
          title: `Review content ${n.title}`.slice(0, 140),
          requested_by: ctx.principal.subject,
        },
      });
      yield* createNotifications(ctx, {
        recipients: reviewers.filter((r) => r.id !== ctx.principal.id),
        type: "content_review",
        title: "Content awaiting your review",
        body: n.title,
        link: `/content/${n.slug}`,
        actorId: ctx.principal.id,
        subject: { kind: "content", id: n.slug },
        sourceEventSeq: seq,
        dedupeKey: `${seq}:content_review`,
      });
    }
    if (input.action === "approve" || input.action === "request_changes") {
      const seq = yield* emitFrom(ctx, "approval.decided", {
        audience: [...new Set([n.spec.author, ...n.spec.reviewers])],
        subject: { kind: "content", id: n.slug },
        payload: {
          approval_type: "content_review",
          id: n.slug,
          decision: input.action === "approve" ? "approve" : "reject",
          by: ctx.principal.subject,
          status: input.action === "approve" ? "approved" : "changes_requested",
        },
      });
      if (author && author.id !== ctx.principal.id)
        yield* createNotifications(ctx, {
          recipients: [author],
          type: "approval_decision",
          title: input.action === "approve" ? "Content approved" : "Changes requested",
          body: `${n.title}${input.note ? `: ${input.note}` : ""}`.slice(0, 500),
          link: `/content/${n.slug}`,
          actorId: ctx.principal.id,
          subject: { kind: "content", id: n.slug },
          sourceEventSeq: seq,
          dedupeKey: `${seq}:approval_decision`,
        });
    }
    if (input.action === "publish") {
      const aud = yield* audiencePrincipals(ws, n.spec, ctx.now);
      const pubSeq = yield* emitFrom(ctx, "content.published", {
        audience: aud === "everyone" ? ["*"] : [...EDITORS, ...aud.map((a) => a.subject)],
        subject: { kind: "content", id: n.slug },
        payload: {
          content: n.slug,
          title: n.title,
          content_type: n.spec.type,
          summary: n.spec.summary,
          pinned: n.spec.pinned,
        },
      });
      if (n.spec.pinned || n.spec.type === "announcement") {
        const recipients = aud === "everyone" ? yield* allActiveMembers(ws) : aud;
        yield* createNotifications(ctx, {
          recipients: recipients.filter((r) => r.id !== ctx.principal.id),
          type: "content_published",
          title: n.spec.type === "announcement" ? "New announcement" : "New in the news feed",
          body: n.title,
          link: `/read/${n.slug}`,
          actorId: ctx.principal.id,
          subject: { kind: "content", id: n.slug },
          sourceEventSeq: pubSeq,
          dedupeKey: `${pubSeq}:content_published`,
        });
      }
    }
    void stateSeq;
    return res;
  });

export const personsFor = (
  ws: string,
  subjects: ReadonlyArray<string>,
): Effect.Effect<ReadonlyMap<string, PersonRef>, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const out = new Map<string, PersonRef>();
    for (const s of new Set(subjects)) out.set(s, yield* personBySubjectSafe(ws, s));
    return out;
  });

// ---- diff ------------------------------------------------------------------------------------------------------

export interface BlockDiffRow {
  index: number;
  change: "added" | "removed" | "modified" | "moved" | "unchanged";
  before: ContentBlock | null;
  after: ContentBlock | null;
  from_index: number | null;
}

/** Block-level diff: matched blocks are unchanged, identical blocks at a new position are moved, the rest pair up by type. */
export const diffBlocks = (
  a: ReadonlyArray<ContentBlock>,
  b: ReadonlyArray<ContentBlock>,
): BlockDiffRow[] => {
  const sig = (x: ContentBlock) => JSON.stringify(x);
  const sa = a.map(sig);
  const sb = b.map(sig);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i]![j] = sa[i] === sb[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const matchB = new Map<number, number>(); // b index -> a index
  const matchedA = new Set<number>();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (sa[i] === sb[j]) {
      matchB.set(j, i);
      matchedA.add(i);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  const removed = a.map((_, i) => i).filter((i) => !matchedA.has(i));
  const out: BlockDiffRow[] = [];
  const usedRemoved = new Set<number>();
  for (let j = 0; j < m; j++) {
    const from = matchB.get(j);
    if (from !== undefined) {
      out.push({ index: j, change: "unchanged", before: a[from]!, after: b[j]!, from_index: from });
      continue;
    }
    const mv = removed.find((i) => !usedRemoved.has(i) && sa[i] === sb[j]);
    if (mv !== undefined) {
      usedRemoved.add(mv);
      out.push({ index: j, change: "moved", before: a[mv]!, after: b[j]!, from_index: mv });
      continue;
    }
    const pair = removed.find((i) => !usedRemoved.has(i) && a[i]!.type === b[j]!.type);
    if (pair !== undefined) {
      usedRemoved.add(pair);
      out.push({ index: j, change: "modified", before: a[pair]!, after: b[j]!, from_index: pair });
      continue;
    }
    out.push({ index: j, change: "added", before: null, after: b[j]!, from_index: null });
  }
  for (const i of removed)
    if (!usedRemoved.has(i))
      out.push({ index: i, change: "removed", before: a[i]!, after: null, from_index: i });
  return out;
};

/** Top-level spec fields that differ, other than the blocks. */
export const diffFields = (
  a: ContentSpec,
  b: ContentSpec,
): Array<{ path: string; before: unknown; after: unknown }> => {
  const out: Array<{ path: string; before: unknown; after: unknown }> = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of [...keys].sort()) {
    if (k === "blocks") continue;
    const x = (a as unknown as Record<string, unknown>)[k];
    const y = (b as unknown as Record<string, unknown>)[k];
    if (!jsonEqual(x as never, y as never))
      out.push({ path: `/spec/${k}`, before: x ?? null, after: y ?? null });
  }
  return out;
};
