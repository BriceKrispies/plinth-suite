/**
 * The Change path: preview, commit, approvals, undo, history, audit chain (spec 05 section 8.4, 06 section 5).
 *
 * `commit` is one transaction in the fixed order of 8.4: lock `workspace_chain` FOR UPDATE, idempotency lookup,
 * preview-token consume, lock nodes ascending, merge, validate against the locked head, classify, apply, append to
 * the chain, write projections, head, idempotency, outbox, notify, COMMIT. A change classified `approval` is filed
 * in `change_approvals` instead of applied; a human approver applies it later as a Change of their own.
 */
import { randomBytes } from "node:crypto";
import { newId } from "./suite/ids";
import { Context, Effect, Either, Layer, Schema } from "effect";
import {
  NodeChange as NodeChangeSchema,
  DomainError,
  NODE_KINDS,
  SourceSpec,
  didYouMean,
  type ChangeEvent,
  type CommitResult,
  type Json,
  type Kind,
  type NodeBody,
  type NodeChange,
  type NodeView,
  type Op,
  type Surface,
  withPath,
} from "@plinth/spec";
import {
  GENESIS_HASH,
  anyOverlap,
  applyOps,
  bodyHash,
  canonicalize,
  changeHash,
  chainRowHash,
  diffJson,
  getAt,
  inverseOps,
  jsonEqual,
  nodeId,
  nodeUri,
  parsePointer,
  parseUri,
  requestChangeHash,
  sha256,
  summarizeOps,
  tokenHash,
  touchedPaths,
  type ChainRowFields,
} from "@plinth/core";
import { AppConfig } from "./config";
import { PlinthClock } from "./clock";
import { ControlStore, store } from "./control-store";
import { StoreError } from "./errors";
import type { Principal } from "./identity";
import { APPROVER_PERMISSION, SUITE_NODE_KINDS } from "@plinth/spec";
import { classify, isSiteManaged } from "./rules";
import { checkSemantics, decodeBody, type AnyNodeBody, type Lookup } from "./validate";
import { checkSuiteDelete } from "./suite-validate";
import { Authorizer, forbidden, subjectOf } from "./authz";
import { authorize as authorizePure, canonicalResource, grantsOf, type AuthzSnapshot } from "./authz-core";

const n = (x: unknown): number => (typeof x === "number" ? x : Number(x));
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const pgTextArray = (xs: ReadonlyArray<string>): string =>
  "{" + xs.map((s) => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"').join(",") + "}";

export interface ActorCtx {
  readonly principal: Principal;
  readonly surface: Surface;
  readonly sessionId?: string | undefined;
}

export interface PreviewResult {
  readonly valid: true;
  readonly diff: ReadonlyArray<{
    readonly uri: string;
    readonly op: "create" | "update" | "delete" | "undo";
    readonly path?: string;
    readonly before_hash?: string;
    readonly after_hash: string;
  }>;
  readonly rule_id: ReadonlyArray<string>;
  readonly decision: "auto" | "approval";
  readonly change_hash: string;
  readonly base: Readonly<Record<string, number>>;
  readonly preview_token: string;
  readonly expires_in_s: number;
}

export interface CommitExpect {
  /** node.delete: the token must stage a delete of this node at this base revision. */
  readonly delete?: { readonly target: string; readonly baseRevision: number };
  /** node.undo: the token must stage the undo of this change sequence. */
  readonly undoOf?: number;
}

export interface CommitInput {
  readonly actor: ActorCtx;
  readonly changes?: ReadonlyArray<NodeChange> | undefined;
  readonly previewToken?: string | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly reason?: string | undefined;
  readonly undoOf?: number | undefined;
  readonly expect?: CommitExpect | undefined;
  /**
   * K6: set only by an action handler. Allows the named action to write the managed fields of a Suite node
   * (Promotion status, Content status / published_revision / review_log). HTTP POST /changes and the MCP node verbs
   * never set it, so they are refused on those paths.
   */
  readonly managed?: { readonly by: string } | undefined;
}

export interface VerifyResult {
  readonly ok: boolean;
  readonly checked: number;
  readonly head_seq: number;
  readonly head_hash: string;
  readonly error?: { readonly seq: number; readonly reason: string };
}

export interface HistoryFilter {
  readonly uri?: string | undefined;
  readonly principal?: string | undefined;
  readonly since?: string | undefined;
  readonly surface?: Surface | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly limit?: number | undefined;
}

export interface HistoryItem {
  readonly seq: number;
  readonly node_uri: string;
  readonly actor: string;
  readonly on_behalf_of: string | null;
  readonly surface: Surface;
  readonly at: string;
  readonly reason: string | null;
  readonly change_hash: string;
  readonly ops_summary: string;
  readonly group_id: string;
  readonly rule_id: ReadonlyArray<string>;
  readonly undo_of?: number;
  readonly replay_of?: string;
  readonly approved_by?: string;
}

export interface ChangeStatusResult {
  readonly status:
    "pending_approval" | "approved" | "committed" | "rejected" | "withdrawn" | "expired" | "stale";
  readonly requested_by: string;
  readonly on_behalf_of: string | null;
  readonly rule_id: ReadonlyArray<string>;
  readonly group_id: string | null;
  readonly approval_id?: string;
  readonly approver?: { readonly principal: string; readonly kind: "human"; readonly at: string };
  readonly nodes: ReadonlyArray<{ readonly uri: string; readonly result_revision?: number }>;
}

export interface ApprovalView {
  readonly approval_id: string;
  readonly status: string;
  readonly requested_by: string;
  readonly on_behalf_of: string | null;
  readonly rule_id: ReadonlyArray<string>;
  readonly created_at: string;
  readonly expires_at: string;
  readonly decided_by: string | null;
  readonly diff: ReadonlyArray<{ readonly uri: string; readonly ops: ReadonlyArray<Op> }>;
}

type Fail = DomainError | StoreError;

export interface ChangeLogShape {
  readonly getNode: (p: Principal, uri: string) => Effect.Effect<NodeView, Fail>;
  /** Resolve a URI, `kind:slug` or bare slug to a readable node. */
  readonly resolve: (p: Principal, ref: string, kinds?: ReadonlyArray<Kind>) => Effect.Effect<NodeView, Fail>;
  readonly findBySlug: (
    p: Principal,
    kind: Kind,
    slug: string,
  ) => Effect.Effect<NodeView | undefined, StoreError>;
  readonly listNodes: (p: Principal, kind: Kind) => Effect.Effect<ReadonlyArray<NodeView>, StoreError>;
  readonly search: (
    p: Principal,
    q: {
      kind?: Kind | undefined;
      text?: string | undefined;
      labels?: Readonly<Record<string, string>> | undefined;
      limit?: number | undefined;
    },
  ) => Effect.Effect<
    ReadonlyArray<{ uri: string; kind: Kind; slug: string; title: string; revision: number }>,
    StoreError
  >;
  readonly preview: (
    actor: ActorCtx,
    changes: ReadonlyArray<NodeChange>,
    opts?: { readonly undoOf?: number },
  ) => Effect.Effect<PreviewResult, Fail>;
  /** The inverse of a recorded change as a NodeChange against the node's head. CONFLICT if a later change overlaps. */
  readonly buildUndo: (p: Principal, seq: number) => Effect.Effect<NodeChange, Fail>;
  readonly commit: (input: CommitInput) => Effect.Effect<CommitResult, Fail>;
  readonly decideApproval: (
    approver: Principal,
    approvalId: string,
    decision: "approve" | "reject",
    reason?: string,
  ) => Effect.Effect<{ status: string; commit?: CommitResult }, Fail>;
  readonly listApprovals: (
    p: Principal,
    status?: string,
  ) => Effect.Effect<ReadonlyArray<ApprovalView>, StoreError>;
  readonly status: (
    p: Principal,
    q: { change_id?: number | undefined; group_id?: string | undefined; approval_id?: string | undefined },
  ) => Effect.Effect<ChangeStatusResult, Fail>;
  readonly history: (p: Principal, f: HistoryFilter) => Effect.Effect<ReadonlyArray<HistoryItem>, Fail>;
  readonly bodyAt: (p: Principal, uri: string, revision: number) => Effect.Effect<Json, Fail>;
  readonly diffRevisions: (
    p: Principal,
    a: { uri: string; revision: number },
    b: { uri: string; revision: number },
  ) => Effect.Effect<
    { ops: ReadonlyArray<Op>; changed_paths: ReadonlyArray<string>; human_summary: string },
    Fail
  >;
  readonly headSeq: (workspaceId: string) => Effect.Effect<number, StoreError>;
  readonly changesSince: (
    workspaceId: string,
    workspaceSlug: string,
    afterSeq: number,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<ChangeEvent>, StoreError>;
  readonly verify: (workspaceId: string) => Effect.Effect<VerifyResult, StoreError>;
}

export class ChangeLog extends Context.Tag("plinth/ChangeLog")<ChangeLog, ChangeLogShape>() {}

interface NodeRow {
  readonly node_id: string;
  readonly kind: Kind;
  readonly slug: string;
  readonly revision: string | number;
  readonly body: Json;
  readonly body_hash: Buffer;
  readonly deleted_at: unknown;
}

interface Planned {
  readonly target: string;
  readonly id: string;
  readonly kind: Kind;
  readonly slug: string;
  readonly create: boolean;
  /** A create over a soft-deleted node of the same slug (site actions only): the row is updated, not inserted. */
  readonly revive?: boolean;
  readonly deleted: boolean;
  readonly baseRevision: number;
  readonly headRevision: number;
  readonly before: Json | undefined;
  readonly beforeHash: Buffer | undefined;
  readonly afterJson: Json;
  readonly afterBody: AnyNodeBody | undefined;
  readonly normalised: NodeChange;
  readonly paths: ReadonlyArray<string>;
  readonly rule_id: ReadonlyArray<string>;
  readonly decision: "auto" | "approval";
  readonly bodyHash: Buffer;
  readonly merged:
    { readonly base: number; readonly head: number; readonly seqs: ReadonlyArray<number> } | undefined;
}

interface PlanCtx {
  readonly lock: boolean;
  readonly surface: Surface;
  readonly undoOf?: number | undefined;
  /** The change is being applied by an approver: classification and authorization were done when it was filed. */
  readonly approved?: boolean | undefined;
  readonly managed?: { readonly by: string } | undefined;
}

/** Fields only an action may write (K6): kind -> JSON pointers. */
export const MANAGED_PATHS: Readonly<Record<string, ReadonlyArray<string>>> = {
  Promotion: ["/spec/status"],
  Content: ["/spec/status", "/spec/published_revision", "/spec/review_log"],
};

const isSuiteKind = (k: string): boolean => (SUITE_NODE_KINDS as ReadonlyArray<string>).includes(k);

const dom = (
  code: DomainError["code"],
  path: string,
  message: string,
  extra?: Partial<ConstructorParameters<typeof DomainError>[0]>,
) => new DomainError({ code, path, message, ...extra });

/** A stored preview may hold no changes at all: every op was an identical edit and dropped at preview. */
const StoredChanges = Schema.Struct({ changes: Schema.Array(NodeChangeSchema) });

const STRICT_READ_KINDS: ReadonlyArray<Kind> = ["Dashboard", "Grant", "Source"];

/**
 * Whether a principal may read a node. Dashboards, Grants and Sources need a matching `node:read` grant. Other kinds
 * are readable by any principal that holds some `node:read` grant (a Panel is read through its Dashboard).
 */
export const canReadNode = (
  p: Principal,
  snap: AuthzSnapshot,
  kind: Kind,
  uri: string,
  dashboardUris: ReadonlyArray<string> = [],
): boolean => {
  const subject = subjectOf(p);
  if (STRICT_READ_KINDS.includes(kind))
    return authorizePure({ principal: subject, action: "node:read", resource: uri }, snap).kind === "allow";
  if (subject.kind === "agent" && !(subject.ceiling ?? []).includes("node:read")) return false;
  const eff = subject.kind === "agent" ? subject.delegatorSubject : subject.subject;
  void dashboardUris;
  return grantsOf(snap, eff ?? "").some(
    (g) =>
      g.effect === "allow" &&
      g.status === "active" &&
      g.actions.includes("node:read") &&
      (g.expiresAt === null || new Date(g.expiresAt).getTime() > snap.now.getTime()),
  );
};

const grantResourceOf = (body: unknown): string | undefined => {
  const r = (body as { spec?: { resource?: unknown } } | null | undefined)?.spec?.resource;
  return typeof r === "string" ? r : undefined;
};

export const ChangeLogLive = Layer.effect(
  ChangeLog,
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const clock = yield* PlinthClock;
    const cfg = yield* AppConfig;
    const authz = yield* Authorizer;

    const rowToView = (p: Principal, r: NodeRow): NodeView => ({
      uri: nodeUri(p.workspaceSlug, r.kind, r.node_id),
      kind: r.kind,
      slug: r.slug,
      revision: n(r.revision),
      body_hash: hex(r.body_hash),
      body: r.body,
      deleted: r.deleted_at !== null && r.deleted_at !== undefined,
    });

    const loadHeads = (ws: string, ids: ReadonlyArray<string>, lock: boolean) =>
      ids.length === 0
        ? Effect.succeed([] as ReadonlyArray<NodeRow>)
        : lock
          ? sql<NodeRow>`SELECT node_id, kind, slug, revision, body, body_hash, deleted_at FROM nodes
              WHERE workspace_id = ${ws} AND node_id IN ${sql.in(ids)} ORDER BY node_id FOR UPDATE`
          : sql<NodeRow>`SELECT node_id, kind, slug, revision, body, body_hash, deleted_at FROM nodes
              WHERE workspace_id = ${ws} AND node_id IN ${sql.in(ids)} ORDER BY node_id`;

    const makeLookup = (ws: string, pending: ReadonlyMap<string, AnyNodeBody>): Lookup => ({
      slugs: (kind) =>
        store(
          sql<{
            slug: string;
          }>`SELECT slug FROM nodes WHERE workspace_id = ${ws} AND kind = ${kind} AND deleted_at IS NULL ORDER BY slug`,
        ).pipe(
          Effect.map((rows) => {
            const set = new Set(rows.map((r) => r.slug));
            for (const [k, b] of pending) if (k.startsWith(kind + ":")) set.add(b.metadata.slug);
            return [...set].sort();
          }),
        ),
      body: (kind, slug) => {
        const pend = pending.get(`${kind}:${slug}`);
        if (pend) return Effect.succeed<unknown>(pend);
        return store(
          sql<{
            body: unknown;
          }>`SELECT body FROM nodes WHERE workspace_id = ${ws} AND kind = ${kind} AND slug = ${slug} AND deleted_at IS NULL`,
        ).pipe(Effect.map((rows) => rows[0]?.body));
      },
      bodies: (kind) =>
        store(
          sql<{
            slug: string;
            body: unknown;
          }>`SELECT slug, body FROM nodes WHERE workspace_id = ${ws} AND kind = ${kind} AND deleted_at IS NULL ORDER BY slug`,
        ).pipe(
          Effect.map((rows) => {
            const m = new Map(rows.map((r) => [r.slug, r.body] as const));
            for (const [k, b] of pending) if (k.startsWith(kind + ":")) m.set(b.metadata.slug, b);
            return [...m].map(([slug, body]) => ({ slug, body }));
          }),
        ),
      handleOf: (subject) =>
        store(
          sql<{
            handle: string;
          }>`SELECT m.handle FROM members m JOIN principals p ON p.principal_id = m.member_id
            WHERE m.workspace_id = ${ws} AND p.subject = ${subject}`,
        ).pipe(Effect.map((rows) => rows[0]?.handle)),
      missingHumans: (subjects) =>
        subjects.length === 0
          ? Effect.succeed([] as ReadonlyArray<string>)
          : store(
              sql<{
                subject: string;
              }>`SELECT subject FROM principals WHERE workspace_id = ${ws} AND kind = 'human' AND disabled_at IS NULL AND subject IN ${sql.in([...new Set(subjects)])}`,
            ).pipe(
              Effect.map((rows) => {
                const have = new Set(rows.map((r) => r.subject));
                return [...new Set(subjects)].filter((x) => !have.has(x));
              }),
            ),
      source: (slug) => {
        const pend = pending.get(`Source:${slug}`);
        if (pend && pend.kind === "Source") return Effect.succeed(pend.spec);
        return store(
          sql<{
            body: { spec?: unknown };
          }>`SELECT body FROM nodes WHERE workspace_id = ${ws} AND kind = 'Source' AND slug = ${slug} AND deleted_at IS NULL`,
        ).pipe(
          Effect.map((rows) => {
            const r = Schema.decodeUnknownEither(SourceSpec)(rows[0]?.body.spec);
            return Either.isRight(r) ? r.right : undefined;
          }),
        );
      },
    });

    /**
     * A Grant's `resource` is stored as a canonical node URI (or a prefix ending in `/`), whatever form was sent:
     * a URI with a UUID or a slug, `kind:slug`, or a bare slug when exactly one node has it.
     */
    const grantResource = (p: Principal, r: string, path: string) =>
      Effect.gen(function* () {
        if (r.startsWith("plinth://") && r.endsWith("/")) return r;
        const base = { workspaceId: p.workspaceId, workspaceSlug: p.workspaceSlug };
        if (r.startsWith("plinth://") || /^[A-Za-z]+:[a-z]/.test(r)) {
          const c = canonicalResource(base, r);
          if (c.startsWith("plinth://")) return c;
          return yield* Effect.fail(
            dom("VALIDATION_FAILED", path, `'${r}' is not a resource`, {
              expected: "a node URI, kind:slug or a slug",
            }),
          );
        }
        const rows = yield* store(
          sql<{ kind: Kind; node_id: string }>`
            SELECT kind, node_id FROM nodes WHERE workspace_id = ${p.workspaceId} AND slug = ${r} AND deleted_at IS NULL`,
        );
        if (rows.length === 1 && rows[0]) return nodeUri(p.workspaceSlug, rows[0].kind, rows[0].node_id);
        if (rows.length > 1)
          return yield* Effect.fail(
            dom("VALIDATION_FAILED", path, `slug '${r}' is ambiguous`, {
              expected: "kind:slug",
              allowed: rows.map((x) => `${x.kind.toLowerCase()}:${r}`),
            }),
          );
        return yield* Effect.fail(
          dom("UNKNOWN_REFERENCE", path, `no node with slug '${r}'`, {
            expected: "a node URI, kind:slug or a slug; node.search lists nodes",
          }),
        );
      });

    /** Facts about the change being undone: its node's kind and whether the actor made it. */
    const undoMeta = (p: Principal, seq: number) =>
      Effect.gen(function* () {
        const rows = yield* store(
          sql<{ kind: Kind; actor_id: string }>`
            SELECT nd.kind, c.actor_id FROM changes c
            JOIN nodes nd ON nd.workspace_id = c.workspace_id AND nd.node_id = c.node_id
            WHERE c.workspace_id = ${p.workspaceId} AND c.seq = ${seq} AND c.kind = 'change'`,
        );
        const r = rows[0];
        if (!r)
          return yield* Effect.fail(
            dom("UNKNOWN_REFERENCE", "/undo_of", `no change with sequence ${seq}`, {
              expected: "a sequence from change.history",
            }),
          );
        return { ofKind: r.kind, ownChange: r.actor_id === p.id };
      });

    /** Resolve, merge, apply, validate, classify and authorize a change set against the (optionally locked) head. */
    const plan = (
      p: Principal,
      changes: ReadonlyArray<NodeChange>,
      ctx: PlanCtx,
    ): Effect.Effect<ReadonlyArray<Planned>, Fail> =>
      Effect.gen(function* () {
        const ws = p.workspaceId;
        const parsed: Array<{ c: NodeChange; id: string; kind: Kind }> = [];
        const seen = new Set<string>();
        for (const [i, c] of changes.entries()) {
          const u = parseUri(c.target);
          if (!u)
            return yield* Effect.fail(
              dom("VALIDATION_FAILED", `/changes/${i}/target`, `'${c.target}' is not a node URI`, {
                expected: "plinth://<workspace>/<Kind>/<uuid>",
              }),
            );
          if (u.workspace !== p.workspaceSlug)
            return yield* Effect.fail(
              dom("UNKNOWN_REFERENCE", `/changes/${i}/target`, `no node '${c.target}'`),
            );
          if (seen.has(u.id))
            return yield* Effect.fail(
              dom("VALIDATION_FAILED", `/changes/${i}/target`, "a node may appear once per commit"),
            );
          seen.add(u.id);
          parsed.push({ c, id: u.id, kind: u.kind });
        }
        const heads = yield* store(
          loadHeads(
            ws,
            parsed.map((x) => x.id),
            ctx.lock,
          ),
        );
        const headById = new Map(heads.map((h) => [h.node_id, h] as const));
        const undo = ctx.undoOf !== undefined ? yield* undoMeta(p, ctx.undoOf) : undefined;
        const snap = ctx.approved ? undefined : yield* authz.snapshot(p);

        const planned: Planned[] = [];
        for (const [i, { c, id, kind }] of parsed.entries()) {
          const head = headById.get(id);
          const first = c.ops[0];
          const isCreate = first?.op === "create";
          const at = `/changes/${i}`;
          let before: Json | undefined;
          let headRevision = 0;
          let ops: ReadonlyArray<Op> = c.ops;
          let slug: string;
          let merged: Planned["merged"];
          let revive = false;
          if (isCreate) {
            if (c.ops.length !== 1 || first?.op !== "create")
              return yield* Effect.fail(dom("VALIDATION_FAILED", `${at}/ops`, "a create is a single op"));
            if (head && head.deleted_at && isSiteManaged(ctx.managed?.by, kind)) {
              // site.restore / site.page.put recreate what site.clear removed: the soft-deleted row is revived
              revive = true;
              headRevision = n(head.revision);
            } else if (head)
              return yield* Effect.fail(
                dom("VALIDATION_FAILED", `${at}/target`, `a ${kind} with this slug already exists`, {
                  details: { uri: c.target },
                }),
              );
            if (first.kind !== kind)
              return yield* Effect.fail(
                dom("VALIDATION_FAILED", `${at}/ops/0/kind`, "create kind does not match the target URI"),
              );
            if (nodeId(ws, first.kind, first.slug) !== id)
              return yield* Effect.fail(
                dom(
                  "VALIDATION_FAILED",
                  `${at}/target`,
                  "the target URI does not match the derived node id",
                  { expected: nodeUri(p.workspaceSlug, first.kind, nodeId(ws, first.kind, first.slug)) },
                ),
              );
            const raw = first.body as { metadata?: { id?: string; slug?: string } } | null;
            if (raw?.metadata?.id !== undefined && raw.metadata.id !== id)
              return yield* Effect.fail(
                dom(
                  "VALIDATION_FAILED",
                  `${at}/ops/0/body/metadata/id`,
                  "metadata.id must equal the derived id or be omitted",
                  { expected: id },
                ),
              );
            if (raw?.metadata?.slug !== first.slug)
              return yield* Effect.fail(
                dom(
                  "VALIDATION_FAILED",
                  `${at}/ops/0/body/metadata/slug`,
                  "metadata.slug must equal the create slug",
                  { expected: first.slug },
                ),
              );
            let body = { ...(raw as object), metadata: { ...(raw?.metadata ?? {}), id } } as Json;
            if (kind === "Grant") {
              const spec = (body as { spec?: { resource?: unknown } }).spec;
              if (spec && typeof spec.resource === "string") {
                const resolved = yield* grantResource(p, spec.resource, `${at}/ops/0/body/spec/resource`);
                body = { ...(body as object), spec: { ...spec, resource: resolved } } as Json;
              }
            }
            ops = [{ op: "create", kind: first.kind, slug: first.slug, body }];
            slug = first.slug;
          } else {
            if (!head || head.deleted_at) {
              const known = yield* store(
                sql<{
                  slug: string;
                }>`SELECT slug FROM nodes WHERE workspace_id = ${ws} AND kind = ${kind} AND deleted_at IS NULL ORDER BY slug LIMIT 5`,
              );
              return yield* Effect.fail(
                dom("UNKNOWN_REFERENCE", `${at}/target`, `no ${kind} node '${c.target}'`, {
                  allowed: known.map((r) => r.slug),
                }),
              );
            }
            before = head.body;
            headRevision = n(head.revision);
            slug = head.slug;
            const base = c.base_revision;
            if (base === null)
              return yield* Effect.fail(
                dom("VALIDATION_FAILED", `${at}/base_revision`, "base_revision is required for an update", {
                  expected: "an integer revision",
                }),
              );
            if (base > headRevision)
              return yield* Effect.fail(
                dom(
                  "VALIDATION_FAILED",
                  `${at}/base_revision`,
                  `base_revision ${base} is ahead of head ${headRevision}`,
                ),
              );
            if (base < headRevision) {
              // The merge rule (spec 05 section 8.4, 06 section 5.4): disjoint paths rebase, identical edits are
              // no-ops, intersecting paths with different values conflict.
              const later = yield* store(
                sql<{
                  seq: string;
                  paths: string[];
                }>`SELECT seq, paths FROM changes WHERE workspace_id = ${ws} AND node_id = ${id} AND result_revision > ${base} ORDER BY seq`,
              );
              const theirs = later.flatMap((r) => r.paths);
              const keep: Op[] = [];
              const clashing: string[] = [];
              for (const op of c.ops) {
                const path = op.op === "set" || op.op === "remove" ? op.path : "";
                if (anyOverlap([path], theirs).length === 0) {
                  keep.push(op);
                  continue;
                }
                if (op.op === "set" && jsonEqual(getAt(head.body, parsePointer(op.path)), op.value as Json))
                  continue;
                clashing.push(path);
              }
              if (clashing.length > 0) {
                const clash = [...new Set(clashing)].sort();
                return yield* Effect.fail(
                  dom(
                    "CONFLICT",
                    clash[0] ?? "",
                    `the node changed under the same paths since revision ${base}: ${clash.join(", ")}`,
                    {
                      expected:
                        "preview again from the head revision, changing only paths that did not conflict",
                      details: {
                        conflicting_paths: clash,
                        head_revision: headRevision,
                        head_values_at_paths: Object.fromEntries(
                          clash.map((x) => [x, getAt(head.body, parsePointer(x)) ?? null]),
                        ),
                        your_values_at_paths: Object.fromEntries(
                          clash.map((x) => [
                            x,
                            c.ops.flatMap((o) =>
                              o.op === "set" && anyOverlap([o.path], [x]).length > 0 ? [o.value ?? null] : [],
                            )[0] ?? null,
                          ]),
                        ),
                      },
                    },
                  ),
                );
              }
              ops = keep;
              merged = { base, head: headRevision, seqs: later.map((r) => n(r.seq)) };
            }
          }
          if (ops.length === 0) continue; // every op was an identical edit: nothing to write for this node
          const applied = applyOps(before, ops, false);
          if (Either.isLeft(applied))
            return yield* Effect.fail(dom("VALIDATION_FAILED", applied.left.path, applied.left.message));
          if (applied.right.deleted && isSuiteKind(kind))
            yield* checkSuiteDelete(kind, before, slug, makeLookup(ws, new Map()), ctx.managed?.by).pipe(
              Effect.mapError((e) => (e instanceof DomainError ? withPath(e, at) : e)),
            );
          const afterJson = applied.right.body as Json;
          let afterBody: AnyNodeBody | undefined;
          if (!applied.right.deleted) {
            const decoded = decodeBody(afterJson);
            if (Either.isLeft(decoded))
              return yield* Effect.fail(withPath(decoded.left, `${at}${decoded.left.path}`));
            afterBody = decoded.right;
            if (afterBody.kind !== kind)
              return yield* Effect.fail(dom("VALIDATION_FAILED", "/kind", "kind cannot change"));
            slug = afterBody.metadata.slug;
          }
          const paths = touchedPaths(ops);
          let createdByActor = isCreate;
          if (!isCreate && applied.right.deleted && p.kind === "agent" && !ctx.approved) {
            const first1 = yield* store(
              sql<{
                actor_id: string;
              }>`SELECT actor_id FROM changes WHERE workspace_id = ${ws} AND node_id = ${id} AND result_revision = 1`,
            );
            createdByActor = first1[0]?.actor_id === p.id;
          }
          if (isSuiteKind(kind)) {
            const managedPaths = MANAGED_PATHS[kind] ?? [];
            const hit = paths.find((x) => managedPaths.some((m) => x === m || x.startsWith(m + "/")));
            const cs = (afterBody as { spec?: Record<string, unknown> } | undefined)?.spec ?? {};
            if (
              isCreate &&
              ctx.managed === undefined &&
              ((kind === "Promotion" && cs["status"] !== "draft") ||
                (kind === "Content" &&
                  (cs["status"] !== "draft" ||
                    cs["published_revision"] !== null ||
                    (Array.isArray(cs["review_log"]) && cs["review_log"].length > 0))))
            )
              return yield* Effect.fail(
                dom(
                  "RULE_REFUSED",
                  `${at}/ops/0/body/spec/status`,
                  `a new ${kind} is created as a draft with no managed history`,
                  {
                    details: { reason: "managed_field", pointer: "/spec/status" },
                  },
                ),
              );
            if (!isCreate && ctx.managed === undefined && hit !== undefined)
              return yield* Effect.fail(
                dom("RULE_REFUSED", `${at}${hit}`, `${hit} is managed: only its action may change it`, {
                  details: { reason: "managed_field", pointer: hit },
                  fix_hint: "Use the domain action (promotions.transition or content.transition) instead.",
                }),
              );
            if (
              !isCreate &&
              kind === "Content" &&
              ctx.managed === undefined &&
              (before as { spec?: { status?: string } } | undefined)?.spec?.status !== "draft" &&
              !applied.right.deleted
            )
              return yield* Effect.fail(
                dom(
                  "RULE_REFUSED",
                  `${at}${paths[0] ?? ""}`,
                  "content can only be edited while it is a draft",
                  {
                    details: { reason: "INVALID_TRANSITION" },
                  },
                ),
              );
          }
          const classOf = ctx.approved
            ? Either.right({ rule_id: [] as ReadonlyArray<string>, decision: "auto" as const })
            : classify(p, {
                kind,
                create: isCreate,
                deleted: applied.right.deleted,
                paths,
                undo: undo ? { ofKind: undo.ofKind, ownChange: undo.ownChange } : undefined,
                createdByActor,
                surface: ctx.surface,
                before: before as unknown,
                after: afterJson as unknown,
                managedBy: ctx.managed?.by,
              });
          if (Either.isLeft(classOf)) return yield* Effect.fail(withPath(classOf.left, at));
          if (
            !ctx.approved &&
            snap !== undefined &&
            ctx.surface !== "system" &&
            !isSiteManaged(ctx.managed?.by, kind)
          ) {
            const isGrant = kind === "Grant";
            const action = isGrant
              ? ctx.undoOf !== undefined
                ? "grant:write"
                : "grant:propose"
              : applied.right.deleted
                ? "node:delete"
                : "node:write";
            const resource = isGrant ? (grantResourceOf(afterBody ?? before) ?? c.target) : c.target;
            const ownerOf = (afterBody ?? before) as { spec?: { owner?: unknown } } | undefined;
            const owner = typeof ownerOf?.spec?.owner === "string" ? ownerOf.spec.owner : undefined;
            const d = authorizePure(
              {
                principal: subjectOf(p),
                action,
                resource: canonicalResource(snap, resource),
                ...(owner !== undefined ? { context: { owner } } : {}),
              },
              snap,
            );
            if (d.kind === "deny") return yield* Effect.fail(forbidden(d, resource));
          }
          planned.push({
            target: c.target,
            id,
            kind,
            slug,
            create: isCreate,
            ...(revive ? { revive } : {}),
            deleted: applied.right.deleted,
            baseRevision: isCreate ? 0 : (c.base_revision ?? headRevision),
            headRevision,
            before,
            beforeHash: head?.body_hash,
            afterJson,
            afterBody,
            normalised: {
              target: c.target,
              base_revision: isCreate ? null : (c.base_revision ?? headRevision),
              ops,
            },
            paths,
            rule_id: classOf.right.rule_id,
            decision: classOf.right.decision,
            bodyHash: bodyHash(afterJson),
            merged,
          });
        }
        // references and types, with the other nodes of this commit visible
        const pending = new Map<string, AnyNodeBody>();
        for (const pl of planned) if (pl.afterBody) pending.set(`${pl.kind}:${pl.slug}`, pl.afterBody);
        const lookup = makeLookup(ws, pending);
        for (const [i, pl] of planned.entries()) {
          if (!pl.afterBody) continue;
          yield* checkSemantics(pl.afterBody, lookup).pipe(
            Effect.mapError((e) => (e instanceof DomainError ? withPath(e, `/changes/${i}${e.path}`) : e)),
          );
        }
        return planned as ReadonlyArray<Planned>;
      });

    /** K4: the permission an approver needs besides approval:decide; the first rule with an entry decides. */
    const approverPermissionOf = (ruleIds: ReadonlyArray<string>): string =>
      ruleIds.map((r) => APPROVER_PERMISSION[r]).find((x) => x !== undefined) ?? "grant:write";

    const requestHash = (input: CommitInput, tokenH: Buffer | undefined): Buffer =>
      tokenH
        ? sha256(canonicalize({ token: hex(tokenH), reason: input.reason ?? null }))
        : sha256(canonicalize({ changes: input.changes ?? [], reason: input.reason ?? null }));

    const preview: ChangeLogShape["preview"] = (actor, changes, opts) =>
      Effect.gen(function* () {
        const p = actor.principal;
        const planned = yield* plan(p, changes, {
          lock: false,
          surface: actor.surface,
          undoOf: opts?.undoOf,
        });
        const normalised = planned.map((x) => x.normalised);
        const ch = requestChangeHash(normalised);
        const token = "pvt_" + randomBytes(32).toString("base64url");
        const base = Object.fromEntries(planned.map((x) => [x.target, x.baseRevision] as const));
        yield* store(
          sql`INSERT INTO preview_tokens (token_hash, workspace_id, principal_id, change_hash, base_revisions, payload, expires_at)
              VALUES (${tokenHash(token)}, ${p.workspaceId}, ${p.id}, ${ch}, ${JSON.stringify(base)}::jsonb,
                      ${JSON.stringify({ changes: normalised, ...(opts?.undoOf !== undefined ? { undo_of: opts.undoOf } : {}) })}::jsonb,
                      now() + make_interval(secs => ${cfg.previewTtlS}))`,
        );
        const ruleIds = [...new Set(planned.flatMap((x) => x.rule_id))];
        const decision = planned.some((x) => x.decision === "approval") ? "approval" : "auto";
        const result: PreviewResult = {
          valid: true,
          diff: planned.map((x) => ({
            uri: x.target,
            op: opts?.undoOf !== undefined ? "undo" : x.deleted ? "delete" : x.create ? "create" : "update",
            ...(x.create
              ? {}
              : { path: x.paths[0] ?? "", before_hash: hex(x.beforeHash ?? Buffer.alloc(0)) }),
            after_hash: hex(x.bodyHash),
          })),
          rule_id: ruleIds,
          decision,
          change_hash: hex(ch),
          base,
          preview_token: token,
          expires_in_s: cfg.previewTtlS,
        };
        return result;
      });

    interface ApplyCtx {
      readonly ws: string;
      readonly actorId: string;
      readonly onBehalf: string | null;
      readonly approvedBy: string | null;
      readonly approvalId: string | null;
      readonly surface: Surface;
      readonly sessionId: string | null;
      readonly reason: string | null;
      readonly commitId: string;
      readonly createdAt: string;
      readonly virtualAt: string;
      readonly undoOf: number | null;
      readonly head: { readonly seq: number; readonly hash: Buffer };
    }

    /** Append the planned changes to the chain and write the projections. Runs inside the commit transaction. */
    const applyPlanned = (a: ApplyCtx, planned: ReadonlyArray<Planned>) =>
      Effect.gen(function* () {
        let seq = a.head.seq;
        let prev: Buffer = a.head.hash;
        const nodes: Array<{ uri: string; result_revision: number; change_seq: number }> = [];
        let mergedFrom: CommitResult["merged_from"];
        for (const pl of planned) {
          seq += 1;
          const resultRevision = pl.headRevision + 1;
          const ops = pl.normalised.ops.filter(() => true);
          const effectiveOps = applyOpsList(pl);
          const inverse = pl.create ? ([{ op: "delete" }] as Op[]) : inverseOps(pl.before, effectiveOps);
          const ch = changeHash(pl.target, effectiveOps, pl.create ? null : pl.baseRevision);
          void ops;
          const ruleIds = pl.rule_id.length > 0 ? pl.rule_id : ["R-GRANT"];
          const fields: ChainRowFields = {
            surface: a.surface,
            actor_id: a.actorId,
            on_behalf_of: a.onBehalf,
            approved_by: a.approvedBy,
            approval_id: a.approvalId,
            session_id: a.sessionId,
            rule_id: ruleIds,
            replay_of: null,
            replay_change_hash: null,
            recorded_actor: null,
            reason: a.reason,
            created_at: a.createdAt,
            virtual_at: a.virtualAt,
            kind: "change",
          };
          const hash = chainRowHash(prev, ch, fields);
          const widened =
            ruleIds.includes("R-GRANT-UNDO") && pl.before !== undefined && grantRestricts(pl.before)
              ? { audit_event: "grant.widened" }
              : null;
          yield* sql`
            INSERT INTO changes (workspace_id, seq, kind, commit_id, node_id, base_revision, result_revision, actor_id, on_behalf_of,
                                 approved_by, approval_id, surface, session_id, rule_id, change_hash, ops, inverse_ops, paths, payload,
                                 reason, undo_of, virtual_at, merged_from, prev_hash, hash, created_at)
            VALUES (${a.ws}, ${seq}, 'change', ${a.commitId}, ${pl.id}, ${pl.create ? 0 : pl.baseRevision}, ${resultRevision}, ${a.actorId}, ${a.onBehalf},
                    ${a.approvedBy}, ${a.approvalId}, ${a.surface}, ${a.sessionId}, ${pgTextArray(ruleIds)}::text[], ${ch},
                    ${JSON.stringify(effectiveOps)}::jsonb, ${JSON.stringify(inverse)}::jsonb, ${pgTextArray(pl.paths)}::text[],
                    ${widened === null ? null : JSON.stringify(widened)}::jsonb, ${a.reason}, ${a.undoOf},
                    ${a.virtualAt}::timestamptz, ${pl.merged ? pgTextArray(pl.merged.seqs.map(String)) : null}::bigint[],
                    ${prev}, ${hash}, ${a.createdAt}::timestamptz)`;
          if (pl.create && !pl.revive) {
            yield* sql`
              INSERT INTO nodes (workspace_id, node_id, kind, slug, revision, body, body_hash, created_seq, updated_seq)
              VALUES (${a.ws}, ${pl.id}, ${pl.kind}, ${pl.slug}, ${resultRevision}, ${JSON.stringify(pl.afterJson)}::jsonb, ${pl.bodyHash}, ${seq}, ${seq})`;
          } else {
            yield* sql`
              UPDATE nodes SET slug = ${pl.slug}, revision = ${resultRevision}, body = ${JSON.stringify(pl.afterJson)}::jsonb, body_hash = ${pl.bodyHash},
                               deleted_at = ${pl.deleted ? a.createdAt : null}::timestamptz, updated_seq = ${seq}
              WHERE workspace_id = ${a.ws} AND node_id = ${pl.id}`;
          }
          if (pl.kind === "Product" && pl.create)
            yield* sql`
              INSERT INTO product_inventory (product_id, workspace_id, product_slug, on_hand, updated_at)
              VALUES (${pl.id}, ${a.ws}, ${pl.slug}, 0, ${a.virtualAt}::timestamptz)
              ON CONFLICT (product_id) DO NOTHING`;
          if (pl.kind === "Grant" || pl.kind === "Role")
            yield* sql`UPDATE workspaces SET grant_index_version = grant_index_version + 1 WHERE workspace_id = ${a.ws}`;
          yield* sql`INSERT INTO outbox (workspace_id, seq) VALUES (${a.ws}, ${seq})`;
          nodes.push({ uri: pl.target, result_revision: resultRevision, change_seq: seq });
          if (pl.merged && mergedFrom === undefined)
            mergedFrom = { base: pl.merged.base, head: pl.merged.head, rebased_paths: pl.paths };
          prev = hash;
        }
        if (planned.length > 0)
          yield* sql`UPDATE workspace_chain SET head_seq = ${seq}, head_hash = ${prev} WHERE workspace_id = ${a.ws}`;
        yield* sql`SELECT pg_notify('plinth_changes', ${a.ws})`;
        return { nodes, mergedFrom, seq };
      });

    const applyOpsList = (pl: Planned): ReadonlyArray<Op> => pl.normalised.ops;

    const grantRestricts = (body: Json): boolean => {
      const spec = (body as { spec?: { effect?: string; row_predicate?: unknown; column_mask?: unknown[] } })
        .spec;
      return (
        spec?.effect === "deny" ||
        (typeof spec?.row_predicate === "string" && spec.row_predicate.length > 0) ||
        (Array.isArray(spec?.column_mask) && spec.column_mask.length > 0)
      );
    };

    const commitTx = (input: CommitInput, commitId: string, createdAt: string, virtualAt: string) => {
      const p = input.actor.principal;
      const ws = p.workspaceId;
      return sql.withTransaction(
        Effect.gen(function* () {
          yield* sql.unsafe(
            `SET LOCAL lock_timeout = '${Math.max(1, Math.trunc(cfg.commitLockTimeoutMs))}ms'`,
          );
          // 1. the chain head is the first lock
          const chain = yield* sql<{ head_seq: string; head_hash: Buffer }>`
            SELECT head_seq, head_hash FROM workspace_chain WHERE workspace_id = ${ws} FOR UPDATE`;
          const head = chain[0];
          if (!head)
            return yield* Effect.fail(new StoreError({ message: `workspace ${ws} has no chain head` }));

          const tokenH = input.previewToken ? tokenHash(input.previewToken) : undefined;
          const reqHash = requestHash(input, tokenH);

          // 2. idempotency
          if (input.idempotencyKey) {
            const rec = yield* sql<{ request_hash: Buffer; result: CommitResult }>`
              SELECT request_hash, result FROM idempotency_records
              WHERE workspace_id = ${ws} AND principal_id = ${p.id} AND idempotency_key = ${input.idempotencyKey}`;
            const r = rec[0];
            if (r) {
              if (Buffer.compare(r.request_hash, reqHash) === 0)
                return { ...r.result, replayed: true } as CommitResult;
              return yield* Effect.fail(
                dom(
                  "IDEMPOTENCY_KEY_REUSED",
                  "",
                  "this idempotency key was already used with a different request",
                  {
                    expected: "a new idempotency key for a new request, or the same request again",
                    details: { original_change_seq: r.result.change_seq ?? null },
                  },
                ),
              );
            }
          }

          // 3. preview token: consumed inside this transaction, so a rollback restores it
          let changes = input.changes;
          let undoOf = input.undoOf;
          if (tokenH) {
            const row = yield* sql<{ change_hash: Buffer; payload: unknown }>`
              UPDATE preview_tokens SET consumed_at = now(), consumed_by = ${commitId}
              WHERE token_hash = ${tokenH} AND workspace_id = ${ws} AND principal_id = ${p.id}
                AND consumed_at IS NULL AND expires_at > now()
              RETURNING change_hash, payload`;
            const t = row[0];
            if (!t)
              return yield* Effect.fail(
                dom(
                  "PREVIEW_REQUIRED",
                  "",
                  "the preview token is missing, spent, expired, or belongs to another principal",
                  {
                    suggestion: { kind: "call", tool: "node.preview", arguments: {} },
                  },
                ),
              );
            const decoded = Schema.decodeUnknownEither(StoredChanges)(t.payload);
            if (Either.isLeft(decoded))
              return yield* Effect.fail(new StoreError({ message: "stored preview payload is invalid" }));
            if (input.changes && Buffer.compare(requestChangeHash(input.changes), t.change_hash) !== 0)
              return yield* Effect.fail(
                dom("PREVIEW_REQUIRED", "", "the preview token is for another change"),
              );
            changes = decoded.right.changes;
            const stored = (t.payload as { undo_of?: number }).undo_of;
            undoOf = stored;
            const ex = input.expect;
            if (ex?.undoOf !== undefined && stored !== ex.undoOf)
              return yield* Effect.fail(
                dom("PREVIEW_REQUIRED", "/change_seq", "the preview token does not stage this undo", {
                  suggestion: { kind: "call", tool: "node.preview", arguments: { undo_of: ex.undoOf } },
                }),
              );
            if (ex?.delete !== undefined) {
              const c0 = changes[0];
              if (
                changes.length !== 1 ||
                c0?.target !== ex.delete.target ||
                c0.base_revision !== ex.delete.baseRevision ||
                c0.ops[0]?.op !== "delete"
              )
                return yield* Effect.fail(
                  dom("PREVIEW_REQUIRED", "/uri", "the preview token does not stage this delete", {
                    suggestion: { kind: "call", tool: "node.preview", arguments: { delete: true } },
                  }),
                );
            }
          }
          if (!changes)
            return yield* Effect.fail(dom("VALIDATION_FAILED", "/changes", "no changes to commit"));

          // 4-7. lock nodes, merge, validate against the head, classify, authorize
          const planned = yield* plan(p, changes, {
            lock: true,
            surface: input.actor.surface,
            undoOf,
            managed: input.managed,
          });

          // held: an approval-class change is filed, not applied
          if (planned.some((x) => x.decision === "approval")) {
            const approvalId = newId();
            const ruleIds = [...new Set(planned.flatMap((x) => x.rule_id))];
            const normalised = planned.map((x) => x.normalised);
            yield* sql`
              INSERT INTO change_approvals (approval_id, workspace_id, requester_id, on_behalf_of, rule_id, change_hash, payload, status,
                                            reason, idempotency_key, expires_at, approver_permission)
              VALUES (${approvalId}, ${ws}, ${p.id}, ${p.kind === "agent" ? p.delegatorId : null}, ${pgTextArray(ruleIds)}::text[],
                      ${requestChangeHash(normalised)},
                      ${JSON.stringify({
                        changes: normalised,
                        ...(undoOf !== undefined ? { undo_of: undoOf } : {}),
                        ...(input.managed !== undefined ? { managed: input.managed } : {}),
                      })}::jsonb,
                      'pending_approval', ${input.reason ?? null}, ${input.idempotencyKey ?? null},
                      ${createdAt}::timestamptz + interval '900 seconds',
                      ${approverPermissionOf(ruleIds)})`;
            const held: CommitResult = {
              status: "pending_approval",
              replayed: false,
              commit_id: commitId,
              approval_id: approvalId,
            };
            if (input.idempotencyKey)
              yield* sql`
                INSERT INTO idempotency_records (workspace_id, principal_id, idempotency_key, request_hash, commit_id, result)
                VALUES (${ws}, ${p.id}, ${input.idempotencyKey}, ${reqHash}, ${commitId}, ${JSON.stringify(held)}::jsonb)`;
            return held;
          }

          // 8-11. apply, append to the chain, write projections, outbox
          const applied = yield* applyPlanned(
            {
              ws,
              actorId: p.id,
              onBehalf: p.kind === "agent" ? p.delegatorId : null,
              approvedBy: null,
              approvalId: null,
              surface: input.actor.surface,
              sessionId: input.actor.sessionId ?? null,
              reason: input.reason ?? null,
              commitId,
              createdAt,
              virtualAt,
              undoOf: undoOf ?? null,
              head: { seq: n(head.head_seq), hash: head.head_hash },
            },
            planned,
          );
          const result: CommitResult = {
            status: "committed",
            replayed: false,
            commit_id: commitId,
            ...(applied.nodes[0] ? { change_seq: applied.nodes[0].change_seq } : {}),
            nodes: applied.nodes,
            ...(applied.mergedFrom ? { merged_from: applied.mergedFrom } : {}),
          };
          if (input.idempotencyKey) {
            yield* sql`
              INSERT INTO idempotency_records (workspace_id, principal_id, idempotency_key, request_hash, commit_id, result)
              VALUES (${ws}, ${p.id}, ${input.idempotencyKey}, ${reqHash}, ${commitId}, ${JSON.stringify(result)}::jsonb)`;
          }
          return result;
        }),
      );
    };

    const mapCommitErrors = <A>(eff: Effect.Effect<A, Fail>): Effect.Effect<A, Fail> =>
      eff.pipe(
        Effect.catchIf(
          (e) => e._tag === "StoreError" && e.sqlstate === "55P03",
          () =>
            Effect.fail(
              dom("CONFLICT", "", "another commit holds the workspace lock", {
                details: { reason: "commit_busy", retry_after_ms: 500 },
                retryable: true,
              }),
            ),
        ),
        Effect.catchIf(
          (e) => e._tag === "StoreError" && e.sqlstate === "23505",
          () => Effect.fail(dom("VALIDATION_FAILED", "", "a node with this kind and slug already exists")),
        ),
      );

    const commit: ChangeLogShape["commit"] = (input) =>
      Effect.gen(function* () {
        const p = input.actor.principal;
        // P0d: an agent never commits without a preview token
        if (p.kind === "agent" && !input.previewToken && input.managed === undefined)
          return yield* Effect.fail(
            dom(
              "PREVIEW_REQUIRED",
              "",
              "agent writes go through node.preview and then node.commit with the token",
              {
                suggestion: { kind: "call", tool: "node.preview", arguments: {} },
              },
            ),
          );
        const created = yield* clock.now;
        const virtual = yield* clock.virtualNow;
        const commitId = yield* Effect.sync(() => newId());
        return yield* mapCommitErrors(
          store(commitTx(input, commitId, created.toISOString(), virtual.toISOString())),
        );
      });

    // ---- approvals -----------------------------------------------------------------------------------------

    interface ApprovalRow {
      readonly approval_id: string;
      readonly requester_id: string;
      readonly on_behalf_of: string | null;
      readonly rule_id: string[];
      readonly payload: { changes: NodeChange[]; undo_of?: number; managed?: { by: string } };
      readonly approver_permission: string;
      readonly status: string;
      readonly reason: string | null;
      readonly commit_id: string | null;
      readonly decided_by: string | null;
      readonly expired: boolean;
    }

    const subjectById = (ws: string, id: string | null) =>
      id === null
        ? Effect.succeed<{ subject: string; kind: Principal["kind"] } | null>(null)
        : store(
            sql<{ subject: string; kind: Principal["kind"] }>`
              SELECT subject, kind FROM principals WHERE workspace_id = ${ws} AND principal_id = ${id}`,
          ).pipe(Effect.map((r) => r[0] ?? null));

    const decideApproval: ChangeLogShape["decideApproval"] = (approver, approvalId, decision, reason) =>
      Effect.gen(function* () {
        const ws = approver.workspaceId;
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(approvalId))
          return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/approval_id", `no approval '${approvalId}'`));
        const created = yield* clock.now;
        const virtual = yield* clock.virtualNow;
        const commitId = yield* Effect.sync(() => newId());
        const outcome = yield* mapCommitErrors(
          store(
            sql.withTransaction(
              Effect.gen(function* () {
                yield* sql.unsafe(
                  `SET LOCAL lock_timeout = '${Math.max(1, Math.trunc(cfg.commitLockTimeoutMs))}ms'`,
                );
                const chain = yield* sql<{ head_seq: string; head_hash: Buffer }>`
                  SELECT head_seq, head_hash FROM workspace_chain WHERE workspace_id = ${ws} FOR UPDATE`;
                const head = chain[0];
                if (!head) return yield* Effect.fail(new StoreError({ message: "no chain head" }));
                const rows = yield* sql<ApprovalRow>`
                  SELECT approval_id, requester_id, on_behalf_of, rule_id, payload, status, reason, commit_id, decided_by, approver_permission,
                         (expires_at < ${created.toISOString()}::timestamptz) AS expired
                  FROM change_approvals WHERE workspace_id = ${ws} AND approval_id = ${approvalId} FOR UPDATE`;
                const a = rows[0];
                if (!a)
                  return yield* Effect.fail(
                    dom("UNKNOWN_REFERENCE", "/approval_id", `no approval '${approvalId}'`),
                  );
                const requester = yield* subjectById(ws, a.requester_id);
                const onBehalf = yield* subjectById(ws, a.on_behalf_of);
                // the resource the held change is about: a Grant's `resource`, else the target node
                const c0 = a.payload.changes[0];
                const createOp = c0?.ops[0];
                let resource = c0?.target ?? "";
                if (createOp?.op === "create") resource = grantResourceOf(createOp.body) ?? resource;
                else if (c0) {
                  const u = parseUri(c0.target);
                  const h = u ? (yield* loadHeads(ws, [u.id], false))[0] : undefined;
                  resource = grantResourceOf(h?.body) ?? resource;
                }
                const denied = yield* authz.checkApprover(approver, {
                  requesterSubject: requester?.subject ?? "",
                  requesterKind: requester?.kind ?? "agent",
                  onBehalfOfSubject: onBehalf?.subject ?? null,
                  resource,
                  approverPermission: a.approver_permission,
                });
                if (denied)
                  return yield* Effect.fail(
                    new DomainError({
                      ...forbidden(denied, resource),
                      message:
                        denied.reason === "sod_violation"
                          ? `separation of duties: ${approver.subject} may not decide this change (${denied.policy})`
                          : `${approver.subject} lacks ${denied.permission ?? "the permission"} on the resource (${denied.reason})`,
                    }),
                  );
                if (a.status !== "pending_approval")
                  return yield* Effect.fail(
                    dom("CONFLICT", "/approval_id", `approval is already ${a.status}`, {
                      details: { reason: "approval_not_pending", status: a.status },
                    }),
                  );
                if (a.expired) {
                  yield* sql`UPDATE change_approvals SET status = 'expired' WHERE approval_id = ${approvalId}`;
                  return { status: "expired" as const, commit: undefined, error: undefined };
                }
                if (decision === "reject") {
                  yield* sql`
                    UPDATE change_approvals SET status = 'rejected', decided_by = ${approver.id}, decided_at = ${created.toISOString()}::timestamptz,
                                                decision_reason = ${reason ?? null} WHERE approval_id = ${approvalId}`;
                  return { status: "rejected" as const, commit: undefined, error: undefined };
                }
                // approve: re-plan against the locked head; a moved base on the same paths makes the change stale
                const planned = yield* Effect.either(
                  plan(approver, a.payload.changes, {
                    lock: true,
                    surface: "api",
                    undoOf: a.payload.undo_of,
                    approved: true,
                    managed: a.payload.managed,
                  }),
                );
                if (Either.isLeft(planned)) {
                  yield* sql`UPDATE change_approvals SET status = 'stale' WHERE approval_id = ${approvalId}`;
                  return { status: "stale" as const, commit: undefined, error: planned.left };
                }
                const ruleIds = a.rule_id;
                const withRules = planned.right.map((x) => ({ ...x, rule_id: ruleIds }));
                const applied = yield* applyPlanned(
                  {
                    ws,
                    actorId: approver.id,
                    onBehalf: a.requester_id,
                    approvedBy: approver.id,
                    approvalId,
                    surface: "api",
                    sessionId: null,
                    reason: a.reason,
                    commitId,
                    createdAt: created.toISOString(),
                    virtualAt: virtual.toISOString(),
                    undoOf: a.payload.undo_of ?? null,
                    head: { seq: n(head.head_seq), hash: head.head_hash },
                  },
                  withRules,
                );
                yield* sql`
                  UPDATE change_approvals SET status = 'approved', decided_by = ${approver.id}, decided_at = ${created.toISOString()}::timestamptz,
                                              decision_reason = ${reason ?? null}, commit_id = ${commitId}, group_id = ${commitId}
                  WHERE approval_id = ${approvalId}`;
                const result: CommitResult = {
                  status: "committed",
                  replayed: false,
                  commit_id: commitId,
                  ...(applied.nodes[0] ? { change_seq: applied.nodes[0].change_seq } : {}),
                  nodes: applied.nodes,
                };
                return { status: "approved" as const, commit: result, error: undefined };
              }),
            ),
          ),
        );
        if (outcome.error) return yield* Effect.fail(outcome.error);
        return outcome.commit
          ? { status: outcome.status, commit: outcome.commit }
          : { status: outcome.status };
      });

    const listApprovals: ChangeLogShape["listApprovals"] = (p, status) =>
      store(
        sql<{
          approval_id: string;
          status: string;
          requester: string;
          on_behalf_of: string | null;
          rule_id: string[];
          created_at: string;
          expires_at: string;
          decided_by: string | null;
          payload: { changes: NodeChange[] };
        }>`
          SELECT a.approval_id, a.status, r.subject AS requester, o.subject AS on_behalf_of, a.rule_id,
                 to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
                 to_char(a.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at,
                 d.subject AS decided_by, a.payload
          FROM change_approvals a
          JOIN principals r ON r.principal_id = a.requester_id
          LEFT JOIN principals o ON o.principal_id = a.on_behalf_of
          LEFT JOIN principals d ON d.principal_id = a.decided_by
          WHERE a.workspace_id = ${p.workspaceId} AND (${status ?? null}::text IS NULL OR a.status = ${status ?? null})
          ORDER BY a.created_at DESC LIMIT 100`,
      ).pipe(
        Effect.map((rows) =>
          rows.map((r): ApprovalView => ({
            approval_id: r.approval_id,
            status: r.status,
            requested_by: r.requester,
            on_behalf_of: r.on_behalf_of,
            rule_id: r.rule_id,
            created_at: r.created_at,
            expires_at: r.expires_at,
            decided_by: r.decided_by,
            diff: r.payload.changes.map((c) => ({ uri: c.target, ops: c.ops })),
          })),
        ),
      );

    const status: ChangeLogShape["status"] = (p, q) =>
      Effect.gen(function* () {
        const given = [q.change_id, q.group_id, q.approval_id].filter((x) => x !== undefined).length;
        if (given !== 1)
          return yield* Effect.fail(
            dom("VALIDATION_FAILED", "", "give exactly one of change_id, group_id or approval_id", {
              expected: "one of change_id | group_id | approval_id",
              allowed: ["change_id", "group_id", "approval_id"],
            }),
          );
        const ws = p.workspaceId;
        const iso = `to_char(%s AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
        void iso;
        const notFound = dom("UNKNOWN_REFERENCE", "", "no such change, group or approval");
        const mayRead = (ids: ReadonlyArray<string | null>) =>
          ids.includes(p.id) || (p.kind === "agent" && ids.includes(p.delegatorId))
            ? Effect.succeed(true)
            : authz
                .authorize(p, "grant:inspect", `plinth://${p.workspaceSlug}/`)
                .pipe(Effect.map((d) => d.kind === "allow"));
        if (q.approval_id !== undefined) {
          if (!/^[0-9a-f-]{36}$/.test(q.approval_id)) return yield* Effect.fail(notFound);
          const rows = yield* store(
            sql<{
              status: ChangeStatusResult["status"];
              requester_id: string;
              requester: string;
              on_behalf_of_id: string | null;
              on_behalf_of: string | null;
              rule_id: string[];
              commit_id: string | null;
              decided_by_id: string | null;
              approver: string | null;
              decided_at: string | null;
              payload: { changes: NodeChange[] };
            }>`
              SELECT a.status, a.requester_id, r.subject AS requester, a.on_behalf_of AS on_behalf_of_id, o.subject AS on_behalf_of,
                     a.rule_id, a.commit_id, a.decided_by AS decided_by_id, d.subject AS approver,
                     to_char(a.decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS decided_at, a.payload
              FROM change_approvals a
              JOIN principals r ON r.principal_id = a.requester_id
              LEFT JOIN principals o ON o.principal_id = a.on_behalf_of
              LEFT JOIN principals d ON d.principal_id = a.decided_by
              WHERE a.workspace_id = ${ws} AND a.approval_id = ${q.approval_id}`,
          );
          const r = rows[0];
          if (!r || !(yield* mayRead([r.requester_id, r.on_behalf_of_id, r.decided_by_id])))
            return yield* Effect.fail(notFound);
          const applied = r.commit_id
            ? yield* store(
                sql<{ node_id: string; kind: Kind; result_revision: string }>`
                  SELECT c.node_id, nd.kind, c.result_revision FROM changes c
                  JOIN nodes nd ON nd.workspace_id = c.workspace_id AND nd.node_id = c.node_id
                  WHERE c.workspace_id = ${ws} AND c.commit_id = ${r.commit_id} ORDER BY c.seq`,
              )
            : [];
          return {
            status: r.status,
            requested_by: r.requester,
            on_behalf_of: r.on_behalf_of,
            rule_id: r.rule_id,
            group_id: r.commit_id,
            approval_id: q.approval_id,
            ...(r.approver && (r.status === "approved" || r.status === "rejected")
              ? { approver: { principal: r.approver, kind: "human" as const, at: r.decided_at ?? "" } }
              : {}),
            nodes:
              applied.length > 0
                ? applied.map((x) => ({
                    uri: nodeUri(p.workspaceSlug, x.kind, x.node_id),
                    result_revision: n(x.result_revision),
                  }))
                : r.payload.changes.map((c) => ({ uri: c.target })),
          } satisfies ChangeStatusResult;
        }
        const rows = yield* store(
          q.change_id !== undefined
            ? sql<ChangeRow>`
                SELECT c.seq, c.commit_id, c.node_id, nd.kind, c.result_revision, c.rule_id, c.actor_id, c.on_behalf_of AS on_behalf_of_id,
                       c.approved_by AS approved_by_id, a.subject AS actor, o.subject AS on_behalf_of, ap.subject AS approver,
                       to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at, c.approval_id
                FROM changes c JOIN nodes nd ON nd.workspace_id = c.workspace_id AND nd.node_id = c.node_id
                JOIN principals a ON a.principal_id = c.actor_id
                LEFT JOIN principals o ON o.principal_id = c.on_behalf_of
                LEFT JOIN principals ap ON ap.principal_id = c.approved_by
                WHERE c.workspace_id = ${ws} AND c.commit_id = (SELECT commit_id FROM changes WHERE workspace_id = ${ws} AND seq = ${q.change_id})
                ORDER BY c.seq`
            : sql<ChangeRow>`
                SELECT c.seq, c.commit_id, c.node_id, nd.kind, c.result_revision, c.rule_id, c.actor_id, c.on_behalf_of AS on_behalf_of_id,
                       c.approved_by AS approved_by_id, a.subject AS actor, o.subject AS on_behalf_of, ap.subject AS approver,
                       to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at, c.approval_id
                FROM changes c JOIN nodes nd ON nd.workspace_id = c.workspace_id AND nd.node_id = c.node_id
                JOIN principals a ON a.principal_id = c.actor_id
                LEFT JOIN principals o ON o.principal_id = c.on_behalf_of
                LEFT JOIN principals ap ON ap.principal_id = c.approved_by
                WHERE c.workspace_id = ${ws} AND c.commit_id::text = ${q.group_id ?? ""}
                ORDER BY c.seq`,
        );
        const first = rows[0];
        if (!first || !(yield* mayRead([first.actor_id, first.on_behalf_of_id, first.approved_by_id])))
          return yield* Effect.fail(notFound);
        return {
          status: first.approver ? ("approved" as const) : ("committed" as const),
          requested_by: first.approval_id ? (first.on_behalf_of ?? first.actor) : first.actor,
          on_behalf_of: first.on_behalf_of,
          rule_id: first.rule_id,
          group_id: first.commit_id,
          ...(first.approver
            ? { approver: { principal: first.approver, kind: "human" as const, at: first.created_at } }
            : {}),
          nodes: rows.map((r) => ({
            uri: nodeUri(p.workspaceSlug, r.kind, r.node_id),
            result_revision: n(r.result_revision),
          })),
        } satisfies ChangeStatusResult;
      });

    interface ChangeRow {
      readonly seq: string;
      readonly commit_id: string;
      readonly node_id: string;
      readonly kind: Kind;
      readonly result_revision: string;
      readonly rule_id: string[];
      readonly actor_id: string;
      readonly on_behalf_of_id: string | null;
      readonly approved_by_id: string | null;
      readonly actor: string;
      readonly on_behalf_of: string | null;
      readonly approver: string | null;
      readonly created_at: string;
      readonly approval_id: string | null;
    }

    // ---- undo, history, revisions ----------------------------------------------------------------------------

    const buildUndo: ChangeLogShape["buildUndo"] = (p, seq) =>
      Effect.gen(function* () {
        const rows = yield* store(
          sql<{
            node_id: string;
            kind: Kind;
            result_revision: string;
            ops: Op[];
            inverse_ops: Op[];
            paths: string[];
          }>`
            SELECT c.node_id, nd.kind, c.result_revision, c.ops, c.inverse_ops, c.paths
            FROM changes c JOIN nodes nd ON nd.workspace_id = c.workspace_id AND nd.node_id = c.node_id
            WHERE c.workspace_id = ${p.workspaceId} AND c.seq = ${seq} AND c.kind = 'change'`,
        );
        const r = rows[0];
        if (!r)
          return yield* Effect.fail(
            dom("UNKNOWN_REFERENCE", "/change_seq", `no change with sequence ${seq}`, {
              expected: "a sequence from change.history",
            }),
          );
        if (r.ops.some((o) => o.op === "delete"))
          return yield* Effect.fail(
            dom("VALIDATION_FAILED", "/change_seq", "a delete cannot be undone here", {
              expected: "the sequence of a create or an edit",
            }),
          );
        const head = (yield* store(loadHeads(p.workspaceId, [r.node_id], false)))[0];
        if (!head || head.deleted_at)
          return yield* Effect.fail(
            dom("UNKNOWN_REFERENCE", "/change_seq", "the node of this change no longer exists"),
          );
        const later = yield* store(
          sql<{ seq: string; paths: string[] }>`
            SELECT seq, paths FROM changes WHERE workspace_id = ${p.workspaceId} AND node_id = ${r.node_id}
              AND result_revision > ${r.result_revision} ORDER BY seq`,
        );
        const clash = later.filter((l) => anyOverlap(r.paths, l.paths).length > 0);
        const hit = clash[0];
        if (hit)
          return yield* Effect.fail(
            dom(
              "CONFLICT",
              "/change_seq",
              `change ${n(hit.seq)} touched the same paths after change ${seq}`,
              {
                expected: "undo the later change first, or make a new edit",
                details: {
                  later_change_seq: n(hit.seq),
                  conflicting_paths: anyOverlap(
                    r.paths,
                    clash.flatMap((l) => l.paths),
                  ),
                },
              },
            ),
          );
        return {
          target: nodeUri(p.workspaceSlug, r.kind, r.node_id),
          base_revision: n(head.revision),
          ops: r.inverse_ops,
        } satisfies NodeChange;
      });

    const history: ChangeLogShape["history"] = (p, f) =>
      Effect.gen(function* () {
        const ws = p.workspaceId;
        let nodeFilter: string | null = null;
        if (f.uri !== undefined) {
          const u = parseUri(f.uri);
          if (!u) return yield* Effect.fail(dom("VALIDATION_FAILED", "/uri", "uri must resolve to a node"));
          nodeFilter = u.id;
        }
        const limit = Math.min(f.limit ?? 50, 200);
        const rows = yield* store(
          sql<{
            seq: string;
            commit_id: string;
            node_id: string;
            kind: Kind;
            actor: string;
            on_behalf_of: string | null;
            approver: string | null;
            surface: Surface;
            at: string;
            reason: string | null;
            change_hash: Buffer;
            ops: Op[];
            rule_id: string[];
            undo_of: string | null;
            replay_of: string | null;
          }>`
            SELECT c.seq, c.commit_id, c.node_id, nd.kind, a.subject AS actor, o.subject AS on_behalf_of, ap.subject AS approver,
                   c.surface, to_char(coalesce(c.virtual_at, c.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at,
                   c.reason, c.change_hash, c.ops, c.rule_id, c.undo_of, c.replay_of
            FROM changes c
            JOIN nodes nd ON nd.workspace_id = c.workspace_id AND nd.node_id = c.node_id
            JOIN principals a ON a.principal_id = c.actor_id
            LEFT JOIN principals o ON o.principal_id = c.on_behalf_of
            LEFT JOIN principals ap ON ap.principal_id = c.approved_by
            WHERE c.workspace_id = ${ws} AND c.kind = 'change'
              AND (${nodeFilter}::uuid IS NULL OR c.node_id = ${nodeFilter}::uuid)
              AND (${f.principal ?? null}::text IS NULL OR a.subject = ${f.principal ?? null})
              AND (${f.since ?? null}::timestamptz IS NULL OR coalesce(c.virtual_at, c.created_at) >= ${f.since ?? null}::timestamptz)
              AND (${f.surface ?? null}::text IS NULL OR c.surface = ${f.surface ?? null})
              AND (${f.idempotencyKey ?? null}::text IS NULL OR c.commit_id IN
                   (SELECT commit_id FROM idempotency_records WHERE workspace_id = ${ws} AND principal_id = ${p.id}
                      AND idempotency_key = ${f.idempotencyKey ?? null}))
            ORDER BY c.seq DESC LIMIT ${limit}`,
        );
        const snap = yield* authz.snapshot(p);
        return rows
          .filter((r) => canReadNode(p, snap, r.kind, nodeUri(p.workspaceSlug, r.kind, r.node_id)))
          .map((r): HistoryItem => ({
            seq: n(r.seq),
            node_uri: nodeUri(p.workspaceSlug, r.kind, r.node_id),
            actor: r.actor,
            on_behalf_of: r.on_behalf_of,
            surface: r.surface,
            at: r.at,
            reason: r.reason,
            change_hash: hex(r.change_hash),
            ops_summary: summarizeOps(r.ops),
            group_id: r.commit_id,
            rule_id: r.rule_id,
            ...(r.undo_of !== null ? { undo_of: n(r.undo_of) } : {}),
            ...(r.replay_of !== null ? { replay_of: r.replay_of } : {}),
            ...(r.approver !== null ? { approved_by: r.approver } : {}),
          }));
      });

    const getNode: ChangeLogShape["getNode"] = (p, uri) =>
      Effect.gen(function* () {
        const u = parseUri(uri);
        if (!u || u.workspace !== p.workspaceSlug)
          return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/uri", `no node '${uri}'`));
        const rows = yield* store(loadHeads(p.workspaceId, [u.id], false));
        const r = rows[0];
        const snap = yield* authz.snapshot(p);
        // absent, deleted and unreadable look the same
        if (
          !r ||
          r.deleted_at ||
          !canReadNode(p, snap, r.kind, nodeUri(p.workspaceSlug, r.kind, r.node_id))
        ) {
          const known = yield* store(
            sql<{
              slug: string;
            }>`SELECT slug FROM nodes WHERE workspace_id = ${p.workspaceId} AND kind = ${u.kind} AND deleted_at IS NULL ORDER BY slug LIMIT 5`,
          );
          return yield* Effect.fail(
            dom("UNKNOWN_REFERENCE", "/uri", `no node '${uri}'`, {
              allowed: known.map((k) => k.slug),
              expected: "a node URI, kind:slug or slug; node.search lists nodes",
            }),
          );
        }
        return rowToView(p, r);
      });

    const findBySlug: ChangeLogShape["findBySlug"] = (p, kind, slug) =>
      store(
        sql<NodeRow>`SELECT node_id, kind, slug, revision, body, body_hash, deleted_at FROM nodes
                     WHERE workspace_id = ${p.workspaceId} AND kind = ${kind} AND slug = ${slug} AND deleted_at IS NULL`,
      ).pipe(
        Effect.flatMap((rows) =>
          Effect.gen(function* () {
            const r = rows[0];
            if (!r) return undefined;
            const snap = yield* authz.snapshot(p);
            const v = rowToView(p, r);
            return canReadNode(p, snap, v.kind, v.uri) ? v : undefined;
          }),
        ),
      );

    const listNodes: ChangeLogShape["listNodes"] = (p, kind) =>
      store(
        sql<NodeRow>`SELECT node_id, kind, slug, revision, body, body_hash, deleted_at FROM nodes
                     WHERE workspace_id = ${p.workspaceId} AND kind = ${kind} AND deleted_at IS NULL ORDER BY slug`,
      ).pipe(
        Effect.flatMap((rows) =>
          authz
            .snapshot(p)
            .pipe(
              Effect.map((snap) =>
                rows.map((r) => rowToView(p, r)).filter((v) => canReadNode(p, snap, v.kind, v.uri)),
              ),
            ),
        ),
      );

    const resolve: ChangeLogShape["resolve"] = (p, ref, kinds) =>
      Effect.gen(function* () {
        if (ref.startsWith("plinth://")) {
          const u = parseUri(ref);
          if (u) return yield* getNode(p, ref);
          // plinth://ws/Kind/slug
          const parts = ref.slice("plinth://".length).split("/");
          const k = (NODE_KINDS as ReadonlyArray<string>).find((x) => x === parts[1]);
          if (parts.length === 3 && k && parts[2]) return yield* resolve(p, `${k}:${parts[2]}`, kinds);
          return yield* Effect.fail(
            dom("VALIDATION_FAILED", "/uri", `'${ref}' is not a node reference`, {
              expected: "plinth://<ws>/<Kind>/<uuid>, kind:slug, or a bare slug",
            }),
          );
        }
        const colon = ref.indexOf(":");
        if (colon > 0) {
          const kindWord = ref.slice(0, colon);
          const slug = ref.slice(colon + 1);
          const kind = (NODE_KINDS as ReadonlyArray<string>).find(
            (x) => x.toLowerCase() === kindWord.toLowerCase(),
          );
          if (!kind)
            return yield* Effect.fail(
              dom("VALIDATION_FAILED", "/uri", `'${kindWord}' is not a node kind`, {
                allowed: [...NODE_KINDS],
                did_you_mean: didYouMean(kindWord, NODE_KINDS),
                expected: "kind:slug, for example dashboard:ops-board",
              }),
            );
          const found = yield* findBySlug(p, kind as Kind, slug);
          if (found) return found;
          const all = yield* listNodes(p, kind as Kind);
          return yield* Effect.fail(
            dom("UNKNOWN_REFERENCE", "/uri", `no ${kind} with slug '${slug}'`, {
              allowed: all.slice(0, 20).map((x) => x.slug),
              did_you_mean: didYouMean(
                slug,
                all.map((x) => x.slug),
              ),
            }),
          );
        }
        // bare slug: unique across the kinds in play, or ambiguous
        const searchKinds = (kinds ?? NODE_KINDS) as ReadonlyArray<Kind>;
        const hits: NodeView[] = [];
        for (const k of searchKinds) {
          const h = yield* findBySlug(p, k, ref);
          if (h) hits.push(h);
        }
        if (hits.length === 1 && hits[0]) return hits[0];
        if (hits.length > 1)
          return yield* Effect.fail(
            dom("VALIDATION_FAILED", "/uri", `slug '${ref}' is ambiguous`, {
              expected: "kind:slug",
              allowed: hits.map((h) => `${h.kind.toLowerCase()}:${h.slug}`),
            }),
          );
        const pool: string[] = [];
        for (const k of searchKinds.filter((x) => ["Dashboard", "Panel", "Source", "Grant"].includes(x)))
          pool.push(...(yield* listNodes(p, k)).map((x) => x.slug));
        return yield* Effect.fail(
          dom("UNKNOWN_REFERENCE", "/uri", `no node with slug '${ref}'`, {
            allowed: pool.slice(0, 20),
            did_you_mean: didYouMean(ref, pool),
            expected: "a node URI, kind:slug or slug; node.search lists nodes",
          }),
        );
      });

    const search: ChangeLogShape["search"] = (p, q) =>
      Effect.gen(function* () {
        const like = q.text ? `%${q.text.replace(/[%_\\]/g, (c) => "\\" + c)}%` : null;
        const rows = yield* store(
          sql<NodeRow>`
            SELECT node_id, kind, slug, revision, body, body_hash, deleted_at FROM nodes
            WHERE workspace_id = ${p.workspaceId} AND deleted_at IS NULL
              AND (${q.kind ?? null}::text IS NULL OR kind = ${q.kind ?? null})
              AND (${like}::text IS NULL OR slug ILIKE ${like} OR body->'metadata'->>'title' ILIKE ${like})
              AND (${q.labels ? JSON.stringify(q.labels) : null}::jsonb IS NULL
                   OR coalesce(body->'metadata'->'labels', '{}'::jsonb) @> ${q.labels ? JSON.stringify(q.labels) : null}::jsonb)
            ORDER BY kind, slug LIMIT 500`,
        );
        const snap = yield* authz.snapshot(p);
        return rows
          .map((r) => rowToView(p, r))
          .filter((v) => canReadNode(p, snap, v.kind, v.uri))
          .slice(0, Math.min(q.limit ?? 20, 100))
          .map((v) => ({
            uri: v.uri,
            kind: v.kind,
            slug: v.slug,
            title: String((v.body as { metadata?: { title?: unknown } }).metadata?.title ?? v.slug),
            revision: v.revision,
          }));
      });

    const bodyAt: ChangeLogShape["bodyAt"] = (p, uri, revision) =>
      Effect.gen(function* () {
        const node = yield* getNode(p, uri);
        const u = parseUri(node.uri);
        if (revision > node.revision)
          return yield* Effect.fail(
            dom("UNKNOWN_REFERENCE", "/at_revision", `${node.slug} has revisions 1 to ${node.revision}`, {
              expected: `a revision between 1 and ${node.revision}`,
            }),
          );
        const rows = yield* store(
          sql<{ ops: Op[] }>`
            SELECT ops FROM changes WHERE workspace_id = ${p.workspaceId} AND node_id = ${u?.id ?? ""}
              AND kind = 'change' AND result_revision <= ${revision} ORDER BY result_revision`,
        );
        let body: Json | undefined;
        for (const r of rows) {
          const a = applyOps(body, r.ops, false);
          if (Either.isLeft(a))
            return yield* Effect.fail(new StoreError({ message: "stored ops do not replay" }));
          body = a.right.body;
        }
        if (body === undefined) return yield* Effect.fail(new StoreError({ message: "no history for node" }));
        return body;
      });

    const diffRevisions: ChangeLogShape["diffRevisions"] = (p, a, b) =>
      Effect.gen(function* () {
        const [x, y] = [yield* bodyAt(p, a.uri, a.revision), yield* bodyAt(p, b.uri, b.revision)];
        const d = diffJson(x, y);
        return {
          ops: d.ops,
          changed_paths: d.changed_paths,
          human_summary: d.ops.length === 0 ? "no differences" : summarizeOps(d.ops),
        };
      });

    const headSeq: ChangeLogShape["headSeq"] = (ws) =>
      store(sql<{ head_seq: string }>`SELECT head_seq FROM workspace_chain WHERE workspace_id = ${ws}`).pipe(
        Effect.map((r) => n(r[0]?.head_seq ?? 0)),
      );

    const changesSince: ChangeLogShape["changesSince"] = (ws, slug, after, limit) =>
      store(
        sql<{
          seq: string;
          kind: "change" | "present" | "event";
          node_id: string;
          node_kind: Kind;
          result_revision: string | null;
          surface: Surface;
          actor: string;
          on_behalf_of: string | null;
          rule_id: string[];
          paths: string[];
          contains_untrusted: boolean;
        }>`
          SELECT c.seq, c.kind, c.node_id, nd.kind AS node_kind, c.result_revision, c.surface, a.subject AS actor,
                 o.subject AS on_behalf_of, c.rule_id, c.paths, c.contains_untrusted
          FROM changes c
          JOIN principals a ON a.principal_id = c.actor_id
          LEFT JOIN principals o ON o.principal_id = c.on_behalf_of
          JOIN nodes nd ON nd.workspace_id = c.workspace_id AND nd.node_id = c.node_id
          WHERE c.workspace_id = ${ws} AND c.seq > ${after}
          ORDER BY c.seq LIMIT ${limit}`,
      ).pipe(
        Effect.map((rows) =>
          rows.map((r): ChangeEvent => ({
            seq: n(r.seq),
            kind: r.kind,
            node: nodeUri(slug, r.node_kind, r.node_id),
            rev: r.result_revision === null ? null : n(r.result_revision),
            surface: r.surface,
            actor: r.actor,
            on_behalf_of: r.on_behalf_of,
            rule_id: r.rule_id,
            ops_summary: r.paths.map((x) => (x === "" ? "(document)" : x)).join(", "),
            contains_untrusted: r.contains_untrusted,
          })),
        ),
      );

    const verify: ChangeLogShape["verify"] = (ws) =>
      Effect.gen(function* () {
        const rows = yield* store(sql<{
          seq: string;
          kind: string;
          surface: string;
          actor_id: string;
          on_behalf_of: string | null;
          approved_by: string | null;
          approval_id: string | null;
          session_id: string | null;
          rule_id: string[];
          replay_of: string | null;
          rch: string | null;
          recorded_actor: string | null;
          reason: string | null;
          created_at: string;
          virtual_at: string | null;
          change_hash: Buffer;
          prev_hash: Buffer;
          hash: Buffer;
        }>`
          SELECT seq, kind, surface, actor_id, on_behalf_of, approved_by, approval_id, session_id, rule_id, replay_of,
                 encode(replay_change_hash, 'hex') AS rch, recorded_actor, reason,
                 to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
                 to_char(virtual_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS virtual_at,
                 change_hash, prev_hash, hash
          FROM changes WHERE workspace_id = ${ws} ORDER BY seq`);
        const chain = yield* store(
          sql<{
            head_seq: string;
            head_hash: Buffer;
          }>`SELECT head_seq, head_hash FROM workspace_chain WHERE workspace_id = ${ws}`,
        );
        const head = chain[0];
        let prev: Buffer = GENESIS_HASH;
        let expectSeq = 1;
        const bad = (seq: number, reason: string): VerifyResult => ({
          ok: false,
          checked: expectSeq - 1,
          head_seq: n(head?.head_seq ?? 0),
          head_hash: hex(head?.head_hash ?? GENESIS_HASH),
          error: { seq, reason },
        });
        for (const r of rows) {
          const seq = n(r.seq);
          if (seq !== expectSeq) return bad(seq, `sequence gap: expected ${expectSeq}`);
          if (Buffer.compare(r.prev_hash, prev) !== 0)
            return bad(seq, "prev_hash does not equal the previous row hash");
          const fields: ChainRowFields = {
            surface: r.surface,
            actor_id: r.actor_id,
            on_behalf_of: r.on_behalf_of,
            approved_by: r.approved_by,
            approval_id: r.approval_id,
            session_id: r.session_id,
            rule_id: r.rule_id,
            replay_of: r.replay_of,
            replay_change_hash: r.rch,
            recorded_actor: r.recorded_actor,
            reason: r.reason,
            created_at: r.created_at,
            virtual_at: r.virtual_at,
            kind: r.kind,
          };
          const expected = chainRowHash(prev, r.change_hash, fields);
          if (Buffer.compare(expected, r.hash) !== 0) return bad(seq, "row hash does not match its contents");
          prev = r.hash;
          expectSeq += 1;
        }
        const total = expectSeq - 1;
        if (head && (n(head.head_seq) !== total || Buffer.compare(head.head_hash, prev) !== 0))
          return bad(total, "workspace_chain head does not match the last change row");
        return { ok: true, checked: total, head_seq: total, head_hash: hex(prev) } satisfies VerifyResult;
      });

    return ChangeLog.of({
      getNode,
      resolve,
      findBySlug,
      listNodes,
      search,
      preview,
      buildUndo,
      commit,
      decideApproval,
      listApprovals,
      status,
      history,
      bodyAt,
      diffRevisions,
      headSeq,
      changesSince,
      verify,
    });
  }),
);

export const KINDS = NODE_KINDS;
