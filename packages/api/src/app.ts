import { Effect } from "effect";
import { HttpRouter } from "@effect/platform";
import { Schema } from "effect";
import { CommitRequest, DomainError, NODE_KINDS, QueryRunInput, type Kind } from "@plinth/spec";
import { nodeUri } from "@plinth/core";
import {
  BlobStore,
  ChangeLog,
  ControlStore,
  QueryEngine,
  expectedSchemaVersion,
  schemaVersion,
  store,
} from "@plinth/engine";
import { authenticate, json, parseBody, queryParams, respond } from "./http";
import { suiteRouter } from "./suite";

const UndoRequest = Schema.Struct({
  idempotency_key: Schema.optional(Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9:._-]{8,128}$/))),
  reason: Schema.optional(Schema.String.pipe(Schema.maxLength(280))),
});
const DecisionRequest = Schema.Struct({
  decision: Schema.Literal("approve", "reject"),
  reason: Schema.optional(Schema.String.pipe(Schema.maxLength(280))),
});

const check = <A, E>(name: string, eff: Effect.Effect<A, E>) =>
  eff.pipe(
    Effect.timeout("2 seconds"),
    Effect.map(() => [name, { ok: true }] as const),
    Effect.catchAll((e) =>
      Effect.succeed([name, { ok: false, error: String((e as { message?: string }).message ?? e) }] as const),
    ),
  );

/**
 * The HTTP API (spec 05 section 7.3). Built on `@effect/platform` `HttpRouter` with `Schema` decoding at the
 * boundary; routes: /healthz, /readyz, GET /nodes, GET /nodes/:id, POST /changes, POST /query, GET /audit/verify.
 */
const kernelRouter = HttpRouter.empty.pipe(
  HttpRouter.get("/healthz", Effect.succeed(json(200, { status: "ok" }))),

  HttpRouter.get(
    "/readyz",
    Effect.gen(function* () {
      const cs = yield* ControlStore;
      const blob = yield* BlobStore;
      const engine = yield* QueryEngine;
      const checks = yield* Effect.all(
        [
          check(
            "controlstore",
            Effect.gen(function* () {
              yield* cs.ping;
              const [have, want] = [
                yield* schemaVersion.pipe(Effect.provideService(ControlStore, cs)),
                yield* expectedSchemaVersion,
              ];
              if (have !== want) return yield* Effect.fail(new Error(`schema version ${have} != ${want}`));
            }),
          ),
          check("blobstore", blob.ping),
          check("engine", engine.ping),
        ],
        { concurrency: "unbounded" },
      );
      const map = Object.fromEntries(checks);
      const ok = checks.every(([, r]) => r.ok);
      return json(ok ? 200 : 503, { status: ok ? "ready" : "not_ready", checks: map });
    }),
  ),

  HttpRouter.get(
    "/nodes",
    respond(
      Effect.gen(function* () {
        const p = yield* authenticate;
        const q = yield* queryParams;
        const kind = q.get("kind");
        if (!kind || !(NODE_KINDS as ReadonlyArray<string>).includes(kind))
          return yield* Effect.fail(
            new DomainError({
              code: "VALIDATION_FAILED",
              path: "/kind",
              message: "kind query parameter is required",
              allowed: [...NODE_KINDS],
            }),
          );
        const log = yield* ChangeLog;
        const slug = q.get("slug");
        if (slug) {
          const one = yield* log.findBySlug(p, kind as Kind, slug);
          return json(200, { ok: true, data: { items: one ? [one] : [] } });
        }
        return json(200, { ok: true, data: { items: yield* log.listNodes(p, kind as Kind) } });
      }),
    ),
  ),

  HttpRouter.get(
    "/nodes/:id",
    respond(
      Effect.gen(function* () {
        const p = yield* authenticate;
        const { id } = yield* HttpRouter.params;
        const log = yield* ChangeLog;
        const { sql } = yield* ControlStore;
        const decoded = decodeURIComponent(id ?? "");
        let uri = decoded;
        if (
          !decoded.startsWith("plinth://") &&
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(decoded)
        )
          return json(200, { ok: true, data: yield* log.resolve(p, decoded) });
        if (!decoded.startsWith("plinth://")) {
          const rows = yield* store(
            sql<{
              kind: Kind;
            }>`SELECT kind FROM nodes WHERE workspace_id = ${p.workspaceId} AND node_id::text = ${decoded}`,
          );
          const row = rows[0];
          if (!row)
            return yield* Effect.fail(
              new DomainError({ code: "UNKNOWN_REFERENCE", path: "/id", message: `no node '${decoded}'` }),
            );
          uri = nodeUri(p.workspaceSlug, row.kind, decoded);
        }
        return json(200, { ok: true, data: yield* log.getNode(p, uri) });
      }),
    ),
  ),

  HttpRouter.post(
    "/changes",
    respond(
      Effect.gen(function* () {
        const p = yield* authenticate;
        const body = yield* parseBody(CommitRequest);
        const surface = body.surface ?? "ui";
        if (surface !== "ui" && surface !== "api" && surface !== "cli")
          return yield* Effect.fail(
            new DomainError({
              code: "FORBIDDEN",
              path: "/surface",
              message: `surface '${surface}' cannot be claimed over HTTP`,
            }),
          );
        const log = yield* ChangeLog;
        const result = yield* log.commit({
          actor: { principal: p, surface },
          changes: body.changes,
          previewToken: body.preview_token,
          idempotencyKey: body.idempotency_key,
          reason: body.reason,
        });
        return json(200, { ok: true, data: result });
      }),
    ),
  ),

  HttpRouter.post(
    "/query",
    respond(
      Effect.gen(function* () {
        const p = yield* authenticate;
        const body = yield* parseBody(QueryRunInput);
        if (typeof body.query === "string")
          return yield* Effect.fail(
            new DomainError({
              code: "VALIDATION_FAILED",
              path: "/query",
              message: "Query nodes are not available in this layer; send an inline AST",
            }),
          );
        const asOf = body.as_of ? new Date(body.as_of) : undefined;
        if (asOf && Number.isNaN(asOf.getTime()))
          return yield* Effect.fail(
            new DomainError({
              code: "VALIDATION_FAILED",
              path: "/as_of",
              message: "as_of is not a timestamp",
              expected: "RFC 3339",
            }),
          );
        const engine = yield* QueryEngine;
        const log = yield* ChangeLog;
        const dashboard = body.dashboard
          ? (yield* log.resolve(p, body.dashboard, ["Dashboard"])).uri
          : undefined;
        const result = yield* engine.run({
          principal: p,
          ast: body.query,
          params: body.params,
          asOf,
          limit: body.limit,
          timeoutMs: body.timeout_ms,
          dashboard,
        });
        return json(200, { ok: true, data: result });
      }),
    ),
  ),

  HttpRouter.get(
    "/audit/verify",
    respond(
      Effect.gen(function* () {
        const p = yield* authenticate;
        const log = yield* ChangeLog;
        const r = yield* log.verify(p.workspaceId);
        return json(r.ok ? 200 : 500, { ok: r.ok, data: r });
      }),
    ),
  ),
  HttpRouter.post(
    "/query/explain",
    respond(
      Effect.gen(function* () {
        const p = yield* authenticate;
        const body = yield* parseBody(QueryRunInput);
        if (typeof body.query === "string")
          return yield* Effect.fail(
            new DomainError({ code: "VALIDATION_FAILED", path: "/query", message: "send an inline AST" }),
          );
        const log = yield* ChangeLog;
        const dashboard = body.dashboard
          ? (yield* log.resolve(p, body.dashboard, ["Dashboard"])).uri
          : undefined;
        const engine = yield* QueryEngine;
        const asOf = body.as_of ? new Date(body.as_of) : undefined;
        return json(200, {
          ok: true,
          data: yield* engine.explain({
            principal: p,
            ast: body.query,
            params: body.params,
            asOf,
            dashboard,
          }),
        });
      }),
    ),
  ),

  HttpRouter.get(
    "/history",
    respond(
      Effect.gen(function* () {
        const p = yield* authenticate;
        const q = yield* queryParams;
        const log = yield* ChangeLog;
        const uriRef = q.get("uri");
        const uri = uriRef ? (yield* log.resolve(p, uriRef)).uri : undefined;
        const limit = q.get("limit");
        const items = yield* log.history(p, {
          uri,
          principal: q.get("principal") ?? undefined,
          since: q.get("since") ?? undefined,
          limit: limit ? Number(limit) : undefined,
        });
        return json(200, { ok: true, data: { items } });
      }),
    ),
  ),

  // Undo a recorded change as an inverse Change (the UI's Undo; R-GRANT-UNDO for a grant).
  HttpRouter.post(
    "/changes/:seq/undo",
    respond(
      Effect.gen(function* () {
        const p = yield* authenticate;
        const { seq } = yield* HttpRouter.params;
        const body = yield* parseBody(UndoRequest);
        const n = Number(seq);
        if (!Number.isInteger(n) || n < 1)
          return yield* Effect.fail(
            new DomainError({
              code: "VALIDATION_FAILED",
              path: "/seq",
              message: "seq must be a positive integer",
            }),
          );
        const log = yield* ChangeLog;
        const change = yield* log.buildUndo(p, n);
        const result = yield* log.commit({
          actor: { principal: p, surface: "ui" },
          changes: [change],
          undoOf: n,
          idempotencyKey: body.idempotency_key,
          reason: body.reason ?? "undo",
        });
        return json(200, { ok: true, data: result });
      }),
    ),
  ),

  HttpRouter.get(
    "/approvals",
    respond(
      Effect.gen(function* () {
        const p = yield* authenticate;
        const q = yield* queryParams;
        const log = yield* ChangeLog;
        return json(200, {
          ok: true,
          data: { items: yield* log.listApprovals(p, q.get("status") ?? undefined) },
        });
      }),
    ),
  ),

  HttpRouter.get(
    "/approvals/:id",
    respond(
      Effect.gen(function* () {
        const p = yield* authenticate;
        const { id } = yield* HttpRouter.params;
        const log = yield* ChangeLog;
        return json(200, { ok: true, data: yield* log.status(p, { approval_id: id ?? "" }) });
      }),
    ),
  ),

  // The approval decision (spec 03 section 7): a human with approval:decide and grant:write, never the requester.
  HttpRouter.post(
    "/approvals/:id/decision",
    respond(
      Effect.gen(function* () {
        const p = yield* authenticate;
        const { id } = yield* HttpRouter.params;
        const body = yield* parseBody(DecisionRequest);
        const log = yield* ChangeLog;
        const r = yield* log.decideApproval(p, id ?? "", body.decision, body.reason);
        return json(200, { ok: true, data: r });
      }),
    ),
  ),
);

/** The kernel routes plus the Suite surface (every registry action, the generic action routes and GET /diff). */
export const router = kernelRouter.pipe(HttpRouter.concat(suiteRouter));
