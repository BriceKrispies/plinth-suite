import { createHash, randomBytes } from "node:crypto";
import { Effect, Either, Schema } from "effect";
import {
  ActionInvokeInput,
  ActionListInput,
  actionByName,
  SUITE_EXAMPLES,
  WIDGET_CATALOGUE,
  suiteBodySchemaFor,
  ChangeHistoryInput,
  ChangeStatusInput,
  DiffInput,
  DomainError,
  GrantCheckInput,
  KIND_EXAMPLES,
  KIND_PURPOSE,
  L1_KINDS,
  NODE_KINDS,
  SUITE_NODE_KINDS,
  NodeCommitInput,
  NodeDeleteInput,
  NodeGetInput,
  NodePreviewInput,
  NodeSearchInput,
  NodeUndoInput,
  PANEL_EXAMPLES,
  QueryAst,
  QueryExplainInput,
  QueryRunInput,
  SchemaDescribeInput,
  SourceListInput,
  UiPresentInput,
  bodySchemaFor,
  compactJsonSchema,
  decodeIssueToDomainError,
  didYouMean,
  toErrorBody,
  type Envelope,
  type Json,
  type Kind,
  type NextHint,
  type NodeChange,
  type Op,
  type Warning,
} from "@plinth/spec";
import { canonicalize, nodeId, nodeUri, parseUri } from "@plinth/core";
import {
  AppConfig,
  PlinthClock,
  Authorizer,
  invoke,
  listActions,
  wrapUntrusted,
  ChangeLog,
  ControlStore,
  Identity,
  PRESENT_CHANNEL,
  QueryEngine,
  authorize as authorizePure,
  forbidden,
  store,
  subjectOf,
  type GrantRec,
  type Principal,
} from "@plinth/engine";

/** MCP tools, implemented as Effects (ruling 22). The SDK is wrapped at the edge in server.ts. */

export type ToolDeps =
  ChangeLog | QueryEngine | Authorizer | Identity | ControlStore | AppConfig | PlinthClock;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const callId = (): string => "c_" + Array.from(randomBytes(26), (b) => CROCKFORD[b % 32]).join("");
const traceId = (): string => randomBytes(16).toString("hex");

export interface ToolOutput {
  readonly data: unknown;
  readonly next?: ReadonlyArray<NextHint>;
  readonly warnings?: ReadonlyArray<Warning>;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: object;
  readonly run: (p: Principal, args: unknown) => Effect.Effect<ToolOutput, unknown, ToolDeps>;
}

const decode = <A, I>(schema: Schema.Schema<A, I>, args: unknown, prefix: ReadonlyArray<PropertyKey> = []) =>
  Schema.decodeUnknown(schema, { onExcessProperty: "error", errors: "first" })(args ?? {}).pipe(
    Effect.mapError((e) => decodeIssueToDomainError(schema, args ?? {}, e, prefix)),
  );

/** Decode tool input whose `query` may be an inline AST: the AST is checked alone first, for precise errors. */
const decodeWithQuery = <A, I>(schema: Schema.Schema<A, I>, args: unknown) =>
  Effect.gen(function* () {
    const q = (args as { query?: unknown } | null)?.query;
    if (q !== null && typeof q === "object") yield* decode(QueryAst, q, ["query"]);
    return yield* decode(schema, args);
  });

/** Input schemas are served without a root description: the tool description carries it. */
const inputSchema = (s: Schema.Schema.AnyNoContext): object => {
  const { description: _d, ...rest } = compactJsonSchema(s, false) as Record<string, unknown>;
  return rest;
};

const bad = (path: string, message: string, extra?: Partial<ConstructorParameters<typeof DomainError>[0]>) =>
  new DomainError({ code: "VALIDATION_FAILED", path, message, ...extra });

const idemKey = (p: Principal): string =>
  `${p.subject.split(":")[1] ?? "agent"}:${randomBytes(6).toString("hex")}`;

const commitHint = (p: Principal): NextHint =>
  ({
    tool: "node.commit",
    arguments: { preview_token: { $from: "/data/preview_token" }, idempotency_key: idemKey(p) },
    why: "Commit exactly this change.",
  }) as unknown as NextHint;

// ---- 1. schema.describe ---------------------------------------------------------------------------------------

const VISUAL_CHANNELS = {
  line: ["x", "y", "series"],
  area: ["x", "y", "series"],
  bar: ["x", "y", "color"],
  scatter: ["x", "y", "series", "size"],
  heatmap: ["x", "y", "value"],
  kpi: ["value", "delta", "x", "y"],
  table: ["columns"],
};

const AVAILABLE: ReadonlyArray<Kind> = [...L1_KINDS, ...SUITE_NODE_KINDS];

const verbsFor = (kind: Kind): ReadonlyArray<{ tool: string; purpose: string }> => {
  if (kind === "Source")
    return [
      { tool: "source.list", purpose: "fields and watermark" },
      { tool: "query.run", purpose: "query it" },
      { tool: "query.explain", purpose: "see the compiled SQL and policy" },
    ];
  if (kind === "Grant")
    return [
      { tool: "grant.check", purpose: "before/after counts for a proposed grant" },
      { tool: "node.preview", purpose: "propose a grant; node.commit files it as pending_approval" },
      { tool: "change.status", purpose: "follow the approval" },
    ];
  return [
    { tool: "node.preview", purpose: "stage a create, patch or delete" },
    { tool: "node.commit", purpose: "apply the staged change" },
    { tool: "node.get", purpose: "read" },
    { tool: "node.search", purpose: "find" },
  ];
};

const schemaDescribe: Tool = {
  name: "schema.describe",
  description:
    "Start here. Without kind: the node kinds. With kind: the JSON Schema of that kind's body, a complete valid example, and the verbs that apply. Use the example as the body for node.preview.",
  inputSchema: inputSchema(SchemaDescribeInput),
  run: (_p, args) =>
    Effect.gen(function* () {
      const input = yield* decode(SchemaDescribeInput, args);
      if (input.kind === undefined)
        return {
          data: {
            kinds: NODE_KINDS.map((k) => ({
              kind: k,
              purpose: KIND_PURPOSE[k],
              available: AVAILABLE.includes(k),
            })),
          },
          next: [
            {
              tool: "schema.describe",
              arguments: { kind: "Panel" },
              why: "See the Panel schema and examples.",
            },
          ],
        };
      const schema = bodySchemaFor(input.kind) ?? suiteBodySchemaFor(input.kind);
      if (!schema)
        return yield* Effect.fail(
          bad("/kind", `kind ${input.kind} is not available in this layer`, {
            allowed: [...AVAILABLE],
            expected: `one of ${AVAILABLE.join(", ")}`,
          }),
        );
      const withExamples = input.include_examples !== false;
      return {
        data: {
          kind: input.kind,
          purpose: KIND_PURPOSE[input.kind],
          json_schema: compactJsonSchema(schema),
          ...(input.kind === "Panel" ? { visual_channels: VISUAL_CHANNELS } : {}),
          verbs: verbsFor(input.kind),
          ...(withExamples
            ? {
                example: KIND_EXAMPLES[input.kind] ?? (SUITE_EXAMPLES as Record<string, unknown>)[input.kind],
              }
            : {}),
          ...(input.kind === "Widget"
            ? {
                widgets: WIDGET_CATALOGUE.map((w) => ({
                  id: w.id,
                  domain: w.domain,
                  title: w.title,
                  description: w.description,
                  sizes: w.sizes,
                  permission: w.permission,
                })),
              }
            : {}),
          ...(input.kind === "Page"
            ? {
                place:
                  "node.preview with place: { dashboard: 'page:<slug>' } adds a created Widget or Panel to a Page",
              }
            : {}),
          ...(withExamples && input.kind === "Panel"
            ? {
                examples_by_visual: {
                  heatmap: PANEL_EXAMPLES.heatmap,
                  bar: PANEL_EXAMPLES.bar,
                  kpi: PANEL_EXAMPLES.kpi,
                  table: PANEL_EXAMPLES.table,
                },
              }
            : {}),
        },
        next: [
          input.kind === "Source"
            ? { tool: "source.list", arguments: {}, why: "List the sources and their fields." }
            : {
                tool: "node.preview",
                arguments: { kind: input.kind },
                why: "Stage a create from the example.",
              },
        ],
      };
    }),
};

// ---- 2. node.get ------------------------------------------------------------------------------------------------

const nodeGet: Tool = {
  name: "node.get",
  description:
    "Read one node: its revision, body hash and body. uri accepts a URI, kind:slug (dashboard:ops-board) or a bare slug. at_revision reads an earlier revision.",
  inputSchema: inputSchema(NodeGetInput),
  run: (p, args) =>
    Effect.gen(function* () {
      const input = yield* decode(NodeGetInput, args);
      const log = yield* ChangeLog;
      const node = yield* log.resolve(p, input.uri);
      let body: unknown = node.body;
      let revision = node.revision;
      if (input.at_revision !== undefined && input.at_revision !== node.revision) {
        body = yield* log.bodyAt(p, node.uri, input.at_revision);
        revision = input.at_revision;
      }
      const json = JSON.stringify(body);
      const truncated = json.length > (input.max_bytes ?? 65536);
      const next: NextHint[] =
        node.kind === "Dashboard"
          ? [{ tool: "source.list", arguments: {}, why: "Find a source to build a panel on." }]
          : [];
      return {
        data: {
          uri: node.uri,
          kind: node.kind,
          slug: node.slug,
          revision,
          body_hash: node.body_hash,
          body: truncated ? null : body,
          truncated,
        },
        next,
      };
    }),
};

// ---- 3. node.search -----------------------------------------------------------------------------------------------

const nodeSearch: Tool = {
  name: "node.search",
  description:
    "Find nodes by kind, text (matches title and slug) or labels. Returns uri, kind, slug, title, revision.",
  inputSchema: inputSchema(NodeSearchInput),
  run: (p, args) =>
    Effect.gen(function* () {
      const input = yield* decode(NodeSearchInput, args);
      const log = yield* ChangeLog;
      const items = yield* log.search(p, input);
      return { data: { items, next_cursor: null } };
    }),
};

// ---- 4. source.list -----------------------------------------------------------------------------------------------

const sourceList: Tool = {
  name: "source.list",
  description: "List data sources with their fields, types and watermark. Masked columns are not listed.",
  inputSchema: inputSchema(SourceListInput),
  run: (p, args) =>
    Effect.gen(function* () {
      const input = yield* decode(SourceListInput, args);
      const engine = yield* QueryEngine;
      let slug: string | undefined;
      if (input.source) {
        const log = yield* ChangeLog;
        slug = (yield* log.resolve(p, input.source, ["Source"])).slug;
      }
      const filter: { domain?: string; slug?: string } = {};
      if (input.domain !== undefined) filter.domain = input.domain;
      if (slug !== undefined) filter.slug = slug;
      const items = yield* engine.sources(p, filter);
      return {
        data: {
          items: items.slice(0, input.limit ?? 50).map((s) => ({
            uri: nodeUri(p.workspaceSlug, "Source", nodeId(p.workspaceId, "Source", s.slug)),
            slug: s.slug,
            title: s.title,
            watermark: s.watermark,
            row_estimate: s.rowEstimate,
            fields_total: s.fields.length,
            fields: s.fields.slice(0, 40),
            fields_next: null,
          })),
          next_cursor: null,
        },
        next: [{ tool: "query.run", arguments: {}, why: "Run a query over a source to check the numbers." }],
      };
    }),
};

// ---- 5-6. query.run, query.explain ------------------------------------------------------------------------------------

const QUERY_DOC =
  'query is an inline AST: {"from":"source:orders","where":[{"field":"placed_at","op":"gte","value":{"expr":"now() - 1h"}},{"field":"region","op":"eq","value":"EMEA"}],"derive":{"latency_ms":"ms(fulfilled_at - placed_at)","minute":"bucket(placed_at, \'1 minute\')"},"group":["minute"],"aggregate":{"p95":{"fn":"percentile","of":"latency_ms","p":0.95}},"order":[{"field":"minute","dir":"asc"}]}. A landed source needs a lower bound on its time column. Row security and masks come from your grants.';

const resolveQueryInput = (
  p: Principal,
  input: { query: QueryAst | string; dashboard?: string | undefined },
) =>
  Effect.gen(function* () {
    const log = yield* ChangeLog;
    if (typeof input.query === "string") {
      yield* log.resolve(p, input.query, ["Query"]);
      return yield* Effect.fail(
        bad("/query", "Query nodes are not available in this layer; send an inline AST", {
          expected: "an inline query AST",
        }),
      );
    }
    const dashboard = input.dashboard
      ? (yield* log.resolve(p, input.dashboard, ["Dashboard"])).uri
      : undefined;
    return { ast: input.query, dashboard };
  });

const queryRun: Tool = {
  name: "query.run",
  description: `Run a query and get rows. ${QUERY_DOC}`,
  inputSchema: inputSchema(QueryRunInput),
  run: (p, args) =>
    Effect.gen(function* () {
      const input = yield* decodeWithQuery(QueryRunInput, args);
      const { ast, dashboard } = yield* resolveQueryInput(p, input);
      const asOf = input.as_of ? new Date(input.as_of) : undefined;
      if (asOf && Number.isNaN(asOf.getTime()))
        return yield* Effect.fail(
          bad("/as_of", "as_of is not a timestamp", { expected: "RFC 3339, e.g. 2026-11-20T14:30:00Z" }),
        );
      const engine = yield* QueryEngine;
      const req = {
        principal: p,
        ast,
        params: input.params,
        asOf,
        limit: input.limit,
        timeoutMs: input.timeout_ms,
        dashboard,
      };
      if (input.dry_run) {
        const ex = yield* engine.explain(req).pipe(Effect.either);
        return Either.isLeft(ex)
          ? ex.left instanceof DomainError
            ? { data: { typecheck: { ok: false, errors: [toErrorBody(ex.left)] } } }
            : yield* Effect.fail(ex.left)
          : {
              data: {
                typecheck: { ok: true, errors: [] },
                plan_summary: ex.right.plan_summary,
                as_of: ex.right.as_of,
              },
            };
      }
      const result = yield* engine.run(req);
      return {
        data: result,
        next: [{ tool: "node.preview", arguments: { kind: "Panel" }, why: "Stage a panel on this query." }],
        warnings: result.truncated
          ? [{ code: "TRUNCATED" as const, message: "rows were cut at the limit" }]
          : [],
      };
    }),
};

const queryExplain: Tool = {
  name: "query.explain",
  description: `Compile a query without running it: the SQL, the predicates injected by policy (workspace, row, mask), masked columns, lineage and the policy_hash. ${QUERY_DOC}`,
  inputSchema: inputSchema(QueryExplainInput),
  run: (p, args) =>
    Effect.gen(function* () {
      const input = yield* decodeWithQuery(QueryExplainInput, args);
      const { ast, dashboard } = yield* resolveQueryInput(p, input);
      const engine = yield* QueryEngine;
      const e = yield* engine.explain({ principal: p, ast, params: input.params, dashboard });
      return { data: e };
    }),
};

// ---- 7. node.preview ------------------------------------------------------------------------------------------------

const GRANT_FLAT_KEYS = [
  "principal",
  "effect",
  "action",
  "actions",
  "resource",
  "row_predicate",
  "column_mask",
  "expires_at",
];

/** Default `apiVersion` and `kind` from the call; accept a flat Grant. Pure. */
export const normalizeBody = (
  kind: Kind,
  body: Record<string, unknown>,
): Either.Either<Record<string, unknown>, DomainError> => {
  let b: Record<string, unknown> = { ...body };
  if (kind === "Grant" && b["spec"] === undefined && b["metadata"] === undefined) {
    const extra = Object.keys(b).filter(
      (k) => !GRANT_FLAT_KEYS.includes(k) && k !== "apiVersion" && k !== "kind",
    );
    if (extra[0] !== undefined)
      return Either.left(
        new DomainError({
          code: "UNKNOWN_FIELD",
          path: `/body/${extra[0]}`,
          message: `unknown field '${extra[0]}' in a flat Grant; allowed: ${GRANT_FLAT_KEYS.join(", ")}`,
          allowed: GRANT_FLAT_KEYS,
          did_you_mean: didYouMean(extra[0], GRANT_FLAT_KEYS),
          expected: `one of ${GRANT_FLAT_KEYS.join(", ")}`,
        }),
      );
    const actions = (b["actions"] as unknown) ?? (b["action"] !== undefined ? [b["action"]] : undefined);
    const spec: Record<string, unknown> = {
      principal: b["principal"],
      ...(b["effect"] !== undefined ? { effect: b["effect"] } : {}),
      actions,
      resource: b["resource"],
      ...(b["row_predicate"] !== undefined ? { row_predicate: b["row_predicate"] } : {}),
      ...(b["column_mask"] !== undefined ? { column_mask: b["column_mask"] } : {}),
      ...(b["expires_at"] !== undefined ? { expires_at: b["expires_at"] } : {}),
    };
    const digest = createHash("sha256").update(canonicalize(spec)).digest("hex").slice(0, 8);
    b = {
      ...(b["apiVersion"] !== undefined ? { apiVersion: b["apiVersion"] } : {}),
      ...(b["kind"] !== undefined ? { kind: b["kind"] } : {}),
      metadata: {
        slug: `grant-${digest}`,
        title:
          `Grant ${String(spec["principal"])} ${Array.isArray(actions) ? actions.join(",") : ""} on ${String(spec["resource"])}`.slice(
            0,
            120,
          ),
      },
      spec,
    };
  }
  if (b["apiVersion"] === undefined) b["apiVersion"] = "plinth/v1";
  else if (b["apiVersion"] !== "plinth/v1")
    return Either.left(
      bad(
        "/body/apiVersion",
        `body.apiVersion is ${JSON.stringify(b["apiVersion"])}; it can only be "plinth/v1" (omit it to use the default)`,
        {
          expected: '"plinth/v1"',
          allowed: ["plinth/v1"],
        },
      ),
    );
  if (b["kind"] === undefined) b["kind"] = kind;
  else if (b["kind"] !== kind)
    return Either.left(
      bad(
        "/body/kind",
        `body.kind is ${JSON.stringify(b["kind"])} but the call says kind ${kind}; omit body.kind or make them agree`,
        {
          expected: JSON.stringify(kind),
          allowed: [kind],
        },
      ),
    );
  return Either.right(b);
};

/** The default `place.at`: below the lowest item, full width of the grid, height 6. Pure. */
export const defaultPlacement = (dashboardBody: unknown): { x: number; y: number; w: number; h: number } => {
  const layout = (
    dashboardBody as {
      spec?: { layout?: { columns?: number; items?: Array<{ at: { y: number; h: number } }> } };
    }
  ).spec?.layout;
  const y = (layout?.items ?? []).reduce((m, it) => Math.max(m, it.at.y + it.at.h), 0);
  return { x: 0, y, w: layout?.columns ?? 12, h: 6 };
};

const nodePreview: Tool = {
  name: "node.preview",
  description:
    "Stage a change and get a single-use preview_token (valid 300 s); nothing is written until node.commit. Exactly one of: body (create; spec per kind from schema.describe, apiVersion and kind default from the call), patch + uri + base_revision (update), delete + uri + base_revision, undo_of. place adds a created Panel to a Dashboard in the same commit (place.at defaults to the bottom, full width). decision 'approval' means a person must approve (Grants always).",
  inputSchema: inputSchema(NodePreviewInput),
  run: (p, args) =>
    Effect.gen(function* () {
      const input = yield* decode(NodePreviewInput, args);
      const log = yield* ChangeLog;
      const modes = [
        input.body !== undefined,
        input.patch !== undefined,
        input.delete === true,
        input.undo_of !== undefined,
      ].filter(Boolean).length;
      if (modes !== 1)
        return yield* Effect.fail(
          bad("", "give exactly one of body (create), patch (update), delete: true, or undo_of", {
            expected: "one of body | patch | delete | undo_of",
            allowed: ["body", "patch", "delete", "undo_of"],
          }),
        );
      const changes: NodeChange[] = [];
      let undoOf: number | undefined;
      if (input.body !== undefined) {
        const norm = normalizeBody(input.kind, input.body);
        if (Either.isLeft(norm)) return yield* Effect.fail(norm.left);
        const body = norm.right;
        const slug = (body["metadata"] as { slug?: unknown } | undefined)?.slug;
        if (typeof slug !== "string")
          return yield* Effect.fail(
            bad("/body/metadata/slug", "body.metadata.slug is required", {
              expected:
                'a slug such as "p95-by-region"; body is {"metadata":{"slug":"...","title":"..."},"spec":{...}}',
            }),
          );
        const target = nodeUri(p.workspaceSlug, input.kind, nodeId(p.workspaceId, input.kind, slug));
        changes.push({
          target,
          base_revision: null,
          ops: [{ op: "create", kind: input.kind, slug, body: body as Json }],
        });
        if (input.place) {
          if (input.kind !== "Panel" && input.kind !== "Widget")
            return yield* Effect.fail(
              bad("/place", "place is only valid when creating a Panel or a Widget", {
                expected: "kind Panel (on a Dashboard or Page) or Widget (on a Page)",
              }),
            );
          const dash = yield* log.resolve(p, input.place.dashboard, ["Dashboard", "Page"]);
          if (dash.kind === "Dashboard" && input.kind !== "Panel")
            return yield* Effect.fail(
              bad("/place/dashboard", "a Dashboard holds Panels; place a Widget on a Page", {
                expected: "a page:<slug> reference",
              }),
            );
          const at = input.place.at ?? defaultPlacement(dash.body);
          changes.push({
            target: dash.uri,
            base_revision: dash.revision,
            ops: [
              {
                op: "set",
                path: "/spec/layout/items/-",
                value:
                  dash.kind === "Page"
                    ? { item: `${input.kind === "Widget" ? "widget" : "panel"}:${slug}`, at }
                    : { panel: `panel:${slug}`, at },
              },
            ],
          });
        }
      } else if (input.undo_of !== undefined) {
        changes.push(yield* log.buildUndo(p, input.undo_of));
        undoOf = input.undo_of;
      } else {
        if (!input.uri)
          return yield* Effect.fail(
            bad("/uri", "uri is required for an update or delete", {
              expected: "a node URI, kind:slug or slug",
            }),
          );
        const node = yield* log.resolve(p, input.uri, [input.kind]);
        if (node.kind !== input.kind)
          return yield* Effect.fail(
            bad("/kind", `${input.uri} is a ${node.kind}, kind says ${input.kind}`, {
              expected: node.kind,
              allowed: [node.kind],
            }),
          );
        if (input.base_revision === undefined)
          return yield* Effect.fail(
            bad("/base_revision", "base_revision is required for an update or delete", {
              expected: `the revision you read (head is ${node.revision})`,
            }),
          );
        const ops: Op[] = input.delete
          ? [{ op: "delete" }]
          : (input.patch ?? []).map((o): Op =>
              o.op === "remove"
                ? { op: "remove", path: o.path }
                : { op: "set", path: o.path, value: o.value as Json },
            );
        changes.push({ target: node.uri, base_revision: input.base_revision, ops });
      }
      const r = yield* log.preview(
        { principal: p, surface: "mcp" },
        changes,
        undoOf !== undefined ? { undoOf } : undefined,
      );
      return { data: { ...r, valid: true }, next: [commitHint(p)] };
    }),
};

// ---- 8-10. node.commit, node.delete, node.undo ----------------------------------------------------------------------------

const requireToken = (args: unknown) => {
  const raw = (args ?? {}) as { preview_token?: unknown };
  // an agent write without a usable token is PREVIEW_REQUIRED, not a schema error (AC-VS-4)
  return typeof raw.preview_token !== "string" || !/^pvt_[A-Za-z0-9_-]{43}$/.test(raw.preview_token)
    ? Effect.fail(
        new DomainError({
          code: "PREVIEW_REQUIRED",
          path: "",
          message: "this call needs a preview token from node.preview",
          suggestion: { kind: "call", tool: "node.preview", arguments: {} },
        }),
      )
    : Effect.void;
};

const commitData = (r: {
  status: string;
  replayed: boolean;
  change_seq?: number | undefined;
  commit_id: string;
  nodes?: ReadonlyArray<unknown> | undefined;
  approval_id?: string | undefined;
  merged_from?: unknown;
}) => ({
  status: r.status,
  replayed: r.replayed,
  ...(r.change_seq !== undefined ? { change_seq: r.change_seq } : {}),
  ...(r.status === "committed" ? { group_id: r.commit_id } : {}),
  ...(r.nodes !== undefined ? { nodes: r.nodes } : {}),
  ...(r.merged_from !== undefined ? { merged_from: r.merged_from } : {}),
  ...(r.approval_id !== undefined ? { approval_id: r.approval_id } : {}),
});

const replayWarn = (replayed: boolean): ReadonlyArray<Warning> =>
  replayed
    ? [
        {
          code: "IDEMPOTENT_REPLAY",
          message: "this commit was already applied; the stored result is returned",
        },
      ]
    : [];

const nodeCommit: Tool = {
  name: "node.commit",
  description:
    "Commit exactly the change node.preview staged, with its single-use token and a fresh idempotency_key. A held change (Grants) returns status pending_approval and an approval_id; follow it with change.status. A stale base on the same paths returns CONFLICT with the head values; a disjoint one is rebased (merged_from).",
  inputSchema: inputSchema(NodeCommitInput),
  run: (p, args) =>
    Effect.gen(function* () {
      yield* requireToken(args);
      const input = yield* decode(NodeCommitInput, args);
      const log = yield* ChangeLog;
      const r = yield* log.commit({
        actor: { principal: p, surface: "mcp" },
        previewToken: input.preview_token,
        idempotencyKey: input.idempotency_key,
        reason: input.reason,
      });
      return {
        data: commitData(r),
        next:
          r.status === "pending_approval" && r.approval_id
            ? [
                {
                  tool: "change.status",
                  arguments: { approval_id: r.approval_id },
                  why: "Check whether a person has decided.",
                },
              ]
            : [],
        warnings: replayWarn(r.replayed),
      };
    }),
};

const nodeDelete: Tool = {
  name: "node.delete",
  description:
    "Soft-delete a node. First node.preview with delete: true, uri and base_revision; then call this with the token and the same uri and base_revision.",
  inputSchema: inputSchema(NodeDeleteInput),
  run: (p, args) =>
    Effect.gen(function* () {
      yield* requireToken(args);
      const input = yield* decode(NodeDeleteInput, args);
      const log = yield* ChangeLog;
      const node = yield* log.resolve(p, input.uri);
      const r = yield* log.commit({
        actor: { principal: p, surface: "mcp" },
        previewToken: input.preview_token,
        idempotencyKey: input.idempotency_key ?? idemKey(p),
        reason: input.reason,
        expect: { delete: { target: node.uri, baseRevision: input.base_revision } },
      });
      return {
        data: {
          status: r.status,
          ...(r.change_seq !== undefined ? { change_seq: r.change_seq } : {}),
          uri: node.uri,
          ...(r.nodes?.[0] ? { result_revision: r.nodes[0].result_revision } : {}),
          deleted: r.status === "committed",
          ...(r.approval_id !== undefined ? { approval_id: r.approval_id } : {}),
        },
        warnings: replayWarn(r.replayed),
      };
    }),
};

const nodeUndo: Tool = {
  name: "node.undo",
  description:
    "Undo a change by appending its inverse as a new change. First node.preview with undo_of: <change_seq>; then call this with the token, change_seq and base_revision (the node's head). CONFLICT if a later change touched the same paths.",
  inputSchema: inputSchema(NodeUndoInput),
  run: (p, args) =>
    Effect.gen(function* () {
      yield* requireToken(args);
      const input = yield* decode(NodeUndoInput, args);
      const log = yield* ChangeLog;
      const r = yield* log.commit({
        actor: { principal: p, surface: "mcp" },
        previewToken: input.preview_token,
        idempotencyKey: input.idempotency_key ?? idemKey(p),
        reason: input.reason,
        expect: { undoOf: input.change_seq },
      });
      return {
        data: {
          status: r.status,
          ...(r.change_seq !== undefined ? { undo_change_seq: r.change_seq } : {}),
          group_id: r.commit_id,
          ...(r.nodes !== undefined ? { nodes: r.nodes } : {}),
          undo_of: input.change_seq,
          ...(r.approval_id !== undefined ? { approval_id: r.approval_id } : {}),
        },
        warnings: replayWarn(r.replayed),
      };
    }),
};

// ---- 11-12. change.history, diff -----------------------------------------------------------------------------------------

const changeHistory: Tool = {
  name: "change.history",
  description:
    "The audit trail, newest first: seq, node, actor, on_behalf_of, surface, virtual time, rule_id, ops_summary (paths, no values), undo_of, approved_by. Filter by uri, principal, since, surface.",
  inputSchema: inputSchema(ChangeHistoryInput),
  run: (p, args) =>
    Effect.gen(function* () {
      const input = yield* decode(ChangeHistoryInput, args);
      const log = yield* ChangeLog;
      const uri = input.uri ? (yield* log.resolve(p, input.uri)).uri : undefined;
      const items = yield* log.history(p, { ...input, uri, idempotencyKey: input.idempotency_key });
      return { data: { items, next_cursor: null } };
    }),
};

const splitRev = (s: string): { ref: string; revision: number } => {
  const i = s.lastIndexOf("@");
  return { ref: s.slice(0, i), revision: Number(s.slice(i + 1)) };
};

const diffTool: Tool = {
  name: "diff",
  description:
    "Compare two revisions of nodes: ops, changed_paths and a human summary. a and b look like dashboard:ops-board@3.",
  inputSchema: inputSchema(DiffInput),
  run: (p, args) =>
    Effect.gen(function* () {
      const input = yield* decode(DiffInput, args);
      const log = yield* ChangeLog;
      const [a, b] = [splitRev(input.a), splitRev(input.b)];
      const [na, nb] = [yield* log.resolve(p, a.ref), yield* log.resolve(p, b.ref)];
      const d = yield* log.diffRevisions(
        p,
        { uri: na.uri, revision: a.revision },
        { uri: nb.uri, revision: b.revision },
      );
      return { data: d };
    }),
};

// ---- 13. grant.check --------------------------------------------------------------------------------------------------------

const grantCheck: Tool = {
  name: "grant.check",
  description:
    "Who can do what on a resource, and what changes if a grant is added. principal defaults to you. with_counts returns before/after row counts, only for yourself, your delegator, or with grant:inspect. proposed {row_predicate, column_mask?} evaluates a grant without writing it. The response always has the same keys.",
  inputSchema: inputSchema(GrantCheckInput),
  run: (p, args) =>
    Effect.gen(function* () {
      const input = yield* decode(GrantCheckInput, args);
      const log = yield* ChangeLog;
      const authz = yield* Authorizer;
      const engine = yield* QueryEngine;
      const identity = yield* Identity;
      const targetSubject = input.principal ?? p.subject;
      const shape = (extra: Record<string, unknown>) => ({
        data: {
          principal: targetSubject,
          resource: input.resource,
          action: input.action,
          decision: "deny",
          reason_code: null as string | null,
          policy: null as string | null,
          row_counts: null as { before: number; after: number } | null,
          ...extra,
        },
      });
      const node = yield* log.resolve(p, input.resource).pipe(Effect.either);
      if (Either.isLeft(node)) return shape({ reason_code: "unknown_resource" });
      const resource = node.right.uri;
      const target =
        targetSubject === p.subject
          ? p
          : yield* identity.bySubject(targetSubject).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
      const mayInspect =
        targetSubject === p.subject ||
        targetSubject === p.delegatorSubject ||
        (yield* authz.authorize(p, "grant:inspect", resource)).kind === "allow";
      if (!target || !mayInspect) return shape({ reason_code: "not_permitted" });
      const snap = yield* authz.snapshot(p);
      const withProposed = input.proposed
        ? {
            ...snap,
            grants: [
              ...snap.grants,
              {
                id: "proposed",
                seq: Number.MAX_SAFE_INTEGER,
                principal:
                  target.delegatorSubject && target.kind === "agent"
                    ? target.delegatorSubject
                    : target.subject,
                effect: "allow",
                actions: [input.action],
                resource,
                rowPredicate: input.proposed.row_predicate.trim(),
                columnMask: input.proposed.column_mask ?? [],
                expiresAt: null,
                status: "active",
              } satisfies GrantRec,
            ],
          }
        : snap;
      const d = authorizePure({ principal: subjectOf(target), action: input.action, resource }, withProposed);
      if (d.kind === "deny") return shape({ reason_code: d.reason, policy: d.policy });
      let counts: { before: number; after: number } | null = null;
      if (input.with_counts) {
        const countRows = (override?: {
          rowPredicate: string | null;
          maskedColumns: ReadonlyArray<string>;
        }) =>
          Effect.gen(function* () {
            let ast: QueryAst | undefined;
            let dashboard: string | undefined;
            if (node.right.kind === "Dashboard") {
              const first = (node.right.body as { spec?: { layout?: { items?: Array<{ panel: string }> } } })
                .spec?.layout?.items?.[0];
              if (!first) return null;
              const panel = yield* log.resolve(p, first.panel);
              const q = (panel.body as { spec?: { query?: unknown } }).spec?.query;
              if (typeof q !== "object" || q === null) return null;
              ast = q as QueryAst;
              dashboard = resource;
            } else if (node.right.kind === "Source") {
              ast = {
                from: `source:${node.right.slug}`,
                where: [{ field: "placed_at", op: "gte", value: { expr: "now() - 24h" } }],
                aggregate: { rows: { fn: "count" } },
              };
            }
            if (!ast) return null;
            const r = yield* engine.run({
              principal: target,
              ast,
              dashboard,
              limit: 1000,
              policyOverride: override,
            });
            return node.right.kind === "Source" ? Number(r.rows[0]?.[0] ?? 0) : r.row_count;
          }).pipe(Effect.catchAll(() => Effect.succeed(null)));
        const before = yield* countRows();
        const after = input.proposed
          ? yield* countRows({ rowPredicate: d.rowPredicate, maskedColumns: d.columnMask })
          : before;
        counts = before === null || after === null ? null : { before, after };
      }
      return shape({
        decision: d.rowPredicate !== null || d.columnMask.length > 0 ? "allow_with" : "allow",
        policy: d.grantIds[0] ?? null,
        row_counts: counts,
      });
    }),
};

// ---- 14. ui.present -----------------------------------------------------------------------------------------------------------

const uiPresent: Tool = {
  name: "ui.present",
  description:
    "Move a screen to a node (optionally focusing a parameter). Writes no change and no audit row. target is all (default) or your own principal:<subject>.",
  inputSchema: inputSchema(UiPresentInput),
  run: (p, args) =>
    Effect.gen(function* () {
      const input = yield* decode(UiPresentInput, args);
      const log = yield* ChangeLog;
      const authz = yield* Authorizer;
      const node = yield* log.resolve(p, input.uri);
      yield* authz.require(p, "ui:present", node.uri);
      const target = input.target ?? "all";
      if (target !== "all") {
        const who = target.slice("principal:".length);
        const mine = [p.subject, p.delegatorSubject].filter((x) => x !== null);
        if (!mine.some((m) => m === who || m === `principal:${who}` || m.endsWith(`:${who}`)))
          return yield* Effect.fail(
            new DomainError({
              code: "FORBIDDEN",
              path: "/target",
              message: "target is not in your session",
              details: { reason: "not_in_session" },
              expected: "all, or your own principal",
              retryable: false,
            }),
          );
      }
      const { sql } = yield* ControlStore;
      yield* store(
        sql`SELECT pg_notify(${PRESENT_CHANNEL}, ${JSON.stringify({
          ws: p.workspaceId,
          node: node.uri,
          target,
          focus: input.focus ?? null,
          by: p.subject,
          owners: [p.subject, p.delegatorSubject].filter((x) => x !== null),
        })})`,
      );
      // The gateway fans the notice out to live sockets; the count is not observable from here without waiting.
      return { data: { delivered_to: null, queued: true, skipped: [] } };
    }),
};

// ---- 15. change.status ----------------------------------------------------------------------------------------------------------

const changeStatus: Tool = {
  name: "change.status",
  description:
    "State of a change you proposed: pending_approval, approved (with approver), committed, rejected, expired or stale. Give exactly one of approval_id (from node.commit), change_id or group_id.",
  inputSchema: inputSchema(ChangeStatusInput),
  run: (p, args) =>
    Effect.gen(function* () {
      const input = yield* decode(ChangeStatusInput, args);
      const log = yield* ChangeLog;
      if (input.approval_id !== undefined && /^[0-9a-f-]{36}$/.test(input.approval_id)) {
        // a held domain action (action_approvals) is followed the same way as a held node change
        const { sql } = yield* ControlStore;
        const rows = yield* store(
          sql<{
            status: string;
            action: string;
            requester_id: string;
            on_behalf_of_id: string | null;
            requester: string;
            on_behalf_of: string | null;
            approver: string | null;
            decided_at: string | null;
            approver_permission: string;
            result: unknown;
          }>`
            SELECT a.status, a.action, a.requester_id, a.on_behalf_of AS on_behalf_of_id, r.subject AS requester,
                   o.subject AS on_behalf_of, d.subject AS approver,
                   to_char(a.decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS decided_at,
                   a.approver_permission, a.result
            FROM action_approvals a
            JOIN principals r ON r.principal_id = a.requester_id
            LEFT JOIN principals o ON o.principal_id = a.on_behalf_of
            LEFT JOIN principals d ON d.principal_id = a.decided_by
            WHERE a.workspace_id = ${p.workspaceId} AND a.approval_id = ${input.approval_id}`,
        );
        const r = rows[0];
        if (r && (r.requester_id === p.id || (p.kind === "agent" && r.on_behalf_of_id === p.delegatorId)))
          return {
            data: {
              status: r.status,
              requested_by: r.requester,
              on_behalf_of: r.on_behalf_of,
              rule_id: [],
              group_id: null,
              approval_id: input.approval_id,
              action: r.action,
              approver_permission: r.approver_permission,
              ...(r.approver !== null && r.decided_at !== null
                ? { approver: { principal: r.approver, kind: "human", at: r.decided_at } }
                : {}),
              nodes: [],
            },
          };
      }
      return { data: yield* log.status(p, input) };
    }),
};

// ---- 16-17. action.list, action.invoke ---------------------------------------------------------------------------------------

const actionList: Tool = {
  name: "action.list",
  description:
    "The domain actions you may call (reads and writes) with summary, permission, agent policy (direct, preview, approval), refusals and events. Give name (or include_schemas) for the input and output JSON Schemas.",
  inputSchema: inputSchema(ActionListInput),
  run: (p, args) =>
    Effect.gen(function* () {
      const input = yield* decode(ActionListInput, args);
      const out = yield* listActions(p, input);
      const one = input.name !== undefined ? out.items[0] : undefined;
      return {
        data: out,
        next:
          one && one.mutating
            ? [
                {
                  tool: "action.invoke",
                  arguments: { action: one.name, input: {}, dry_run: true },
                  why: "Dry-run it to get a preview and a preview_token.",
                },
              ]
            : [],
      };
    }),
};

const actionInvoke: Tool = {
  name: "action.invoke",
  description:
    "Run a domain action. Reads: {action, input}. Writes: {action, input, dry_run: true} returns a preview with preview_token and decision; then {action, preview_token, idempotency_key} commits exactly that input, or files it for approval (pending_approval with approval_id; follow it with change.status). Result strings that come from data are returned as {untrusted}.",
  inputSchema: inputSchema(ActionInvokeInput),
  run: (p, args) =>
    Effect.gen(function* () {
      const input = yield* decode(ActionInvokeInput, args);
      const def = actionByName(input.action);
      const out = yield* invoke({
        actor: { principal: p, surface: "mcp", sessionLabel: "MCP" },
        name: input.action,
        input: input.input,
        dryRun: input.dry_run,
        previewToken: input.preview_token,
        idempotencyKey: input.idempotency_key,
        reason: input.reason,
      });
      switch (out.kind) {
        case "result":
          return {
            data: {
              kind: "result",
              action: out.action,
              data: def ? wrapUntrusted(def.output, out.data) : out.data,
              replayed: out.replayed,
            },
          };
        case "preview":
          return {
            data: { kind: "preview", preview: out.preview },
            next: [
              {
                tool: "action.invoke",
                arguments: {
                  action: out.preview.action,
                  preview_token: { $from: "/data/preview/preview_token" },
                  idempotency_key: idemKey(p),
                },
                why:
                  out.preview.decision === "approval"
                    ? "Commit files it for a person to approve."
                    : "Commit exactly this action.",
              },
            ] as unknown as ReadonlyArray<NextHint>,
          };
        case "pending_approval":
          return {
            data: out,
            next: [
              {
                tool: "change.status",
                arguments: { approval_id: out.approval_id },
                why: "Follow the approval.",
              },
            ],
          };
      }
    }),
};

export const TOOLS: ReadonlyArray<Tool> = [
  schemaDescribe,
  nodeGet,
  nodeSearch,
  sourceList,
  queryRun,
  queryExplain,
  nodePreview,
  nodeCommit,
  nodeDelete,
  nodeUndo,
  changeHistory,
  diffTool,
  grantCheck,
  uiPresent,
  changeStatus,
  actionList,
  actionInvoke,
];

/** Run one tool call and wrap the result in the response envelope (spec 06 section 2). */
export const callTool = (
  p: Principal,
  name: string,
  args: unknown,
): Effect.Effect<Envelope, unknown, ToolDeps> => {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return Effect.fail({ _tag: "UnknownTool", name });
  const budget = (bytes: number) => ({
    bytes,
    truncated: false,
    next_cursor: null,
    cost: { units: 1, burst_remaining: 60, reset_ms: 10000 },
  });
  return tool.run(p, args).pipe(
    Effect.map((o): Envelope => {
      const body = {
        ok: true,
        trace_id: traceId(),
        call_id: callId(),
        data: o.data,
        next: (o.next ?? []).slice(0, 3),
        warnings: o.warnings ?? [],
      };
      return { ...body, budget: budget(Buffer.byteLength(JSON.stringify(body.data ?? null))) };
    }),
    Effect.catchIf(
      (e): e is DomainError => e instanceof DomainError,
      (e) =>
        Effect.succeed<Envelope>({
          ok: false,
          trace_id: traceId(),
          call_id: callId(),
          error: toErrorBody(e),
          next:
            e.suggestion?.kind === "call"
              ? [
                  {
                    tool: e.suggestion.tool,
                    arguments: e.suggestion.arguments,
                    why: "Suggested by the error.",
                  },
                ]
              : [],
          warnings: [],
          budget: budget(0),
        }),
    ),
  );
};

export { forbidden as _forbidden, parseUri as _parseUri };
