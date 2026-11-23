/**
 * QueryEngine: DuckDB over the published Parquet partitions (spec 05 section 8.8 and 8.9). The partition list is
 * read once from `source_partitions WHERE published`, rows after `as_of` are excluded by an injected predicate, and
 * the workspace predicate is always injected by the compiler.
 */
import { Context, Effect, Either, Layer, Redacted } from "effect";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DomainError,
  SUITE_SOURCE_VIEWS,
  SourceSpec,
  didYouMean,
  type QueryAst,
  type QueryResult,
  withPath,
} from "@plinth/spec";
import { Schema } from "effect";
import { canonicalize, nodeId, nodeUri, parseUri, sha256Hex } from "@plinth/core";
import { compileQuery } from "@plinth/query";
import { AppConfig } from "./config";
import { PlinthClock } from "./clock";
import { ControlStore, store } from "./control-store";
import { EngineError, StoreError, messageOf } from "./errors";
import type { Principal } from "./identity";
import { Authorizer, forbidden } from "./authz";

export interface QueryRequest {
  readonly principal: Principal;
  readonly ast: QueryAst;
  readonly params?: Readonly<Record<string, string | number | boolean | null>> | undefined;
  readonly asOf?: Date | undefined;
  readonly limit?: number | undefined;
  readonly timeoutMs?: number | undefined;
  /** The Dashboard the query runs for (URI, kind:slug or slug). Its grants and parameter defaults apply. */
  readonly dashboard?: string | undefined;
  /**
   * Internal: evaluate under this policy instead of the caller's grants. Used by grant.check to count rows under a
   * proposed grant. Never reachable from a tool or HTTP input.
   */
  readonly policyOverride?:
    { readonly rowPredicate: string | null; readonly maskedColumns: ReadonlyArray<string> } | undefined;
}

export interface ExplainResult {
  readonly compiled_sql: string;
  readonly injected_predicates: ReadonlyArray<{
    source: string;
    kind: "workspace" | "row" | "mask" | "event_time";
    predicate: string;
  }>;
  readonly masked_columns: ReadonlyArray<string>;
  readonly lineage: ReadonlyArray<{ source: string; field: string }>;
  readonly columns: ReadonlyArray<{ name: string; type: string }>;
  readonly policy_hash: string;
  readonly mask_version: number;
  readonly grant_index_version: number;
  readonly as_of: string;
  readonly plan_summary: QueryResult["plan_summary"];
}

export interface SourceInfo {
  readonly slug: string;
  readonly title: string;
  readonly domain: string | null;
  readonly watermark: string | null;
  readonly rowEstimate: number;
  readonly fields: ReadonlyArray<{
    readonly name: string;
    readonly type: string;
    readonly nullable: boolean;
    readonly description: string;
  }>;
}

export class QueryEngine extends Context.Tag("plinth/QueryEngine")<
  QueryEngine,
  {
    readonly run: (req: QueryRequest) => Effect.Effect<QueryResult, DomainError | StoreError | EngineError>;
    /** Compile without executing: the SQL, the injected predicates, the masked columns and the policy hash. */
    readonly explain: (
      req: QueryRequest,
    ) => Effect.Effect<ExplainResult, DomainError | StoreError | EngineError>;
    readonly sources: (
      p: Principal,
      filter?: { domain?: string; slug?: string },
    ) => Effect.Effect<ReadonlyArray<SourceInfo>, StoreError>;
    /** Readiness: the bundled extensions loaded and a trivial query runs. */
    readonly ping: Effect.Effect<void, EngineError>;
  }
>() {}

const sqlString = (s: string): string => `'${s.replace(/'/g, "''")}'`;

const roundSig = (x: number, digits = 6): number =>
  x === 0 || !Number.isFinite(x) ? x : Number(x.toPrecision(digits));

const toIso = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(v) && !v.endsWith("Z")
    ? v.replace(" ", "T") + (v.length === 19 ? ".000Z" : "Z")
    : v;
};

export const QueryEngineLive = Layer.scoped(
  QueryEngine,
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const { sql } = yield* ControlStore;
    const clock = yield* PlinthClock;

    const wrap = <A>(label: string, f: () => Promise<A>) =>
      Effect.tryPromise({
        try: f,
        catch: (e) => new EngineError({ message: `${label}: ${messageOf(e)}`, cause: e }),
      });

    const conn = yield* Effect.acquireRelease(
      wrap("duckdb init", async () => {
        mkdirSync(cfg.duckdb.tempDir, { recursive: true });
        const instance = await DuckDBInstance.create(":memory:", {
          threads: String(cfg.duckdb.threads),
          memory_limit: cfg.duckdb.memoryLimit,
          temp_directory: cfg.duckdb.tempDir,
        });
        const c = await DuckDBConnection.create(instance);
        if (cfg.duckdb.extensionDir._tag === "Some")
          await c.run(`SET extension_directory = ${sqlString(cfg.duckdb.extensionDir.value)}`);
        if (cfg.duckdb.autoinstall) await c.run("INSTALL httpfs");
        await c.run("LOAD httpfs");
        const url = new URL(cfg.s3.endpoint);
        await c.run(
          `CREATE OR REPLACE SECRET plinth_s3 (TYPE S3, KEY_ID ${sqlString(cfg.s3.accessKey)}, SECRET ${sqlString(Redacted.value(cfg.s3.secretKey))}, ` +
            `REGION ${sqlString(cfg.s3.region)}, ENDPOINT ${sqlString(url.host)}, URL_STYLE ${cfg.s3.forcePathStyle ? "'path'" : "'vhost'"}, ` +
            `USE_SSL ${url.protocol === "https:" ? "true" : "false"})`,
        );
        return { instance, c };
      }),
      ({ c, instance }) =>
        Effect.sync(() => {
          c.closeSync();
          instance.closeSync();
        }),
    ).pipe(Effect.map((x) => x.c));

    // DuckDB runs one statement at a time per connection.
    const gate = yield* Effect.makeSemaphore(1);

    const exec = (
      sqlText: string,
      values: ReadonlyArray<string | number | boolean | null>,
      timeoutMs: number,
      prelude?: () => Promise<void>,
    ) =>
      gate
        .withPermits(1)(
          wrap("query", async () => {
            if (prelude) await prelude();
            const reader = await conn.runAndReadAll(sqlText, [...values]);
            return { names: reader.columnNames(), rows: reader.getRowsJson() as unknown[][] };
          }),
        )
        .pipe(
          Effect.timeoutFail({
            duration: timeoutMs,
            onTimeout: () =>
              new DomainError({
                code: "QUERY_TIMEOUT",
                path: "",
                message: `the query exceeded ${timeoutMs} ms`,
                details: { budget: { timeout_ms: timeoutMs } },
              }),
          }),
          Effect.onInterrupt(() => Effect.sync(() => conn.interrupt())),
        );

    const loadSource = (p: Principal, slug: string) =>
      store(
        sql<{ body: { metadata: { title: string }; spec: unknown } }>`
          SELECT body FROM nodes WHERE workspace_id = ${p.workspaceId} AND kind = 'Source' AND slug = ${slug} AND deleted_at IS NULL`,
      ).pipe(
        Effect.flatMap((rows) => {
          const r = rows[0];
          if (!r) {
            return store(
              sql<{
                slug: string;
              }>`SELECT slug FROM nodes WHERE workspace_id = ${p.workspaceId} AND kind = 'Source' AND deleted_at IS NULL ORDER BY slug LIMIT 5`,
            ).pipe(
              Effect.flatMap((all) =>
                Effect.fail(
                  new DomainError({
                    code: "UNKNOWN_REFERENCE",
                    path: "/query/from",
                    message: `no Source '${slug}'`,
                    allowed: all.map((a) => a.slug),
                  }),
                ),
              ),
            );
          }
          const spec = Schema.decodeUnknownEither(SourceSpec)(r.body.spec);
          return Either.isRight(spec)
            ? Effect.succeed({ spec: spec.right, title: r.body.metadata.title })
            : Effect.fail(new StoreError({ message: `stored Source '${slug}' is invalid` }));
        }),
      );

    const watermarkOf = (slug: string) =>
      store(
        sql<{ wm: string | null }>`
          SELECT CASE WHEN isfinite(watermark) THEN to_char(watermark AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS wm
          FROM source_watermark WHERE source_id = ${slug}`,
      ).pipe(Effect.map((r) => r[0]?.wm ?? null));

    const authz = yield* Authorizer;

    const duckTypeOf = (t: string): string =>
      t === "int" || t === "duration"
        ? "BIGINT"
        : t === "float"
          ? "DOUBLE"
          : t === "bool"
            ? "BOOLEAN"
            : t === "timestamp"
              ? "TIMESTAMP"
              : "VARCHAR";

    /** audit.changes rows from the change log, with `workspace_id`, as JSON records (spec 02 section 3.6.3). */
    const auditRows = (p: Principal, asOf: Date) =>
      store(
        sql<Record<string, unknown>>`
          SELECT ${p.workspaceId}::text AS workspace_id, c.seq::bigint AS seq,
                 to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS') AS created_at,
                 to_char(coalesce(c.virtual_at, c.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS') AS virtual_at,
                 'plinth://' || ${p.workspaceSlug}::text || '/' || nd.kind || '/' || c.node_id::text AS node_uri,
                 nd.kind AS node_kind, nd.slug AS node_slug, a.subject AS actor, o.subject AS on_behalf_of,
                 ap.subject AS approved_by, c.surface, c.session_id,
                 c.base_revision::bigint AS base_revision, c.result_revision::bigint AS result_revision,
                 encode(c.change_hash, 'hex') AS change_hash, array_to_string(c.rule_id, ',') AS rule_id,
                 array_to_string(c.paths, ',') AS paths, c.reason, c.undo_of::bigint AS undo_of, c.replay_of,
                 c.contains_untrusted
          FROM changes c
          JOIN nodes nd ON nd.workspace_id = c.workspace_id AND nd.node_id = c.node_id
          JOIN principals a ON a.principal_id = c.actor_id
          LEFT JOIN principals o ON o.principal_id = c.on_behalf_of
          LEFT JOIN principals ap ON ap.principal_id = c.approved_by
          WHERE c.workspace_id = ${p.workspaceId} AND c.kind = 'change'
            AND coalesce(c.virtual_at, c.created_at) <= ${asOf.toISOString()}::timestamptz
          ORDER BY c.seq LIMIT 200000`,
      );

    /**
     * Suite reporting sources (K9): the rows of the curated `rpt_*` view behind the source (SUITE_SOURCE_VIEWS), up to
     * `as_of` on the time column, with every timestamp formatted UTC like `audit.changes`. The view and column names come
     * from a closed map and the source's declared fields (checked as identifiers); the compiler then applies grants,
     * row predicates and masks to the relation exactly as for any metadata source.
     */
    const suiteRows = (p: Principal, slug: string, spec: SourceSpec, asOf: Date) => {
      const view = SUITE_SOURCE_VIEWS[slug];
      const ident = /^[a-z_][a-z0-9_]*$/;
      if (
        view === undefined ||
        !spec.fields.every((f) => ident.test(f.name)) ||
        !ident.test(spec.time_column)
      )
        return Effect.succeed([] as ReadonlyArray<Record<string, unknown>>);
      const cols = spec.fields
        .map((f) =>
          f.type === "timestamp"
            ? `to_char(${f.name} AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS') AS ${f.name}`
            : f.type === "int"
              ? `${f.name}::bigint AS ${f.name}`
              : f.name,
        )
        .join(", ");
      return store(
        sql.unsafe<Record<string, unknown>>(
          `SELECT workspace_id::text AS workspace_id, ${cols} FROM ${view}
           WHERE workspace_id = $1 AND ${spec.time_column} <= $2::timestamptz
           ORDER BY ${spec.time_column} LIMIT 200000`,
          [p.workspaceId, asOf.toISOString()],
        ),
      );
    };

    const metaRows = (p: Principal, slug: string, spec: SourceSpec, asOf: Date) =>
      slug === "audit.changes" ? auditRows(p, asOf) : suiteRows(p, slug, spec, asOf);

    const resolveDashboard = (p: Principal, ref: string | undefined) =>
      Effect.gen(function* () {
        if (ref === undefined) return undefined;
        let id: string | undefined;
        if (ref.startsWith("plinth://")) id = parseUri(ref)?.id;
        else {
          const slug = ref.includes(":") ? ref.slice(ref.indexOf(":") + 1) : ref;
          id = nodeId(p.workspaceId, "Dashboard", slug);
        }
        const rows = id
          ? yield* store(
              sql<{
                body: { spec?: { parameters?: Record<string, { default?: string | number | boolean }> } };
              }>`
                SELECT body FROM nodes WHERE workspace_id = ${p.workspaceId} AND node_id = ${id} AND kind = 'Dashboard' AND deleted_at IS NULL`,
            )
          : [];
        const r = rows[0];
        if (!r || id === undefined)
          return yield* Effect.fail(
            new DomainError({
              code: "UNKNOWN_REFERENCE",
              path: "/dashboard",
              message: `no Dashboard '${ref}'`,
              expected: "a Dashboard URI, dashboard:slug or slug",
            }),
          );
        const defaults: Record<string, string | number | boolean> = {};
        for (const [k, v] of Object.entries(r.body.spec?.parameters ?? {}))
          if (v.default !== undefined) defaults[k] = v.default;
        return { uri: nodeUri(p.workspaceSlug, "Dashboard", id), defaults };
      });

    /** Authorize, resolve the as-of and the partitions, and compile with the policy injected. */
    const prepare = (req: QueryRequest) =>
      Effect.gen(function* () {
        const p = req.principal;
        if (!req.ast.from.startsWith("source:"))
          return yield* Effect.fail(
            new DomainError({
              code: "VALIDATION_FAILED",
              path: "/query/from",
              message: "subqueries are not available in this layer",
              expected: "source:<slug>",
            }),
          );
        const slug = req.ast.from.slice("source:".length);
        const { spec } = yield* loadSource(p, slug);
        const dash = yield* resolveDashboard(p, req.dashboard);
        const decision = req.policyOverride
          ? ({
              kind: "allow",
              rowPredicate: req.policyOverride.rowPredicate,
              columnMask: req.policyOverride.maskedColumns,
              grantIds: [],
              policyHash: "sha256:override",
              effectivePrincipal: p.subject,
            } as const)
          : yield* authz.authorize(
              p,
              "query:run",
              nodeUri(p.workspaceSlug, "Source", nodeId(p.workspaceId, "Source", slug)),
              dash ? { dashboard: dash.uri } : undefined,
            );
        if (decision.kind === "deny") return yield* Effect.fail(forbidden(decision, `source:${slug}`));
        const timeoutMs = Math.min(req.timeoutMs ?? cfg.query.defaultTimeoutMs, cfg.query.maxTimeoutMs);
        const virtualNow = yield* clock.virtualNow;
        if (req.asOf && req.asOf.getTime() > virtualNow.getTime())
          return yield* Effect.fail(
            new DomainError({
              code: "VALIDATION_FAILED",
              path: "/as_of",
              message: "as_of is later than the virtual now",
              expected: `<= ${virtualNow.toISOString()}`,
            }),
          );
        const metadata = spec.kind === "metadata";
        let wm: string | null = null;
        let asOf: Date;
        if (metadata) {
          asOf = req.asOf ?? virtualNow;
          wm = virtualNow.toISOString();
        } else {
          // As-of wait (05 section 8.8): wait for the watermark to reach an explicit as_of; the default follows it.
          wm = yield* watermarkOf(slug);
          if (req.asOf) {
            const target = req.asOf.getTime();
            const waitMs = Math.min(cfg.query.watermarkWaitMs, timeoutMs);
            if (wm === null || new Date(wm).getTime() < target) {
              for (let i = 0; i < Math.ceil(waitMs / 200); i++) {
                yield* Effect.sleep("200 millis");
                wm = yield* watermarkOf(slug);
                if (wm !== null && new Date(wm).getTime() >= target) break;
              }
            }
            if (wm === null || new Date(wm).getTime() < target)
              return yield* Effect.fail(
                new DomainError({
                  code: "SOURCE_STALE",
                  path: "",
                  message: `source '${slug}' has not reached as_of`,
                  details: { source: slug, watermark: wm, as_of: req.asOf.toISOString() },
                }),
              );
          } else if (wm === null) {
            return yield* Effect.fail(
              new DomainError({
                code: "SOURCE_STALE",
                path: "",
                message: `source '${slug}' has no published partitions`,
                details: { source: slug, watermark: null },
              }),
            );
          }
          asOf = req.asOf ?? new Date(Math.min(virtualNow.getTime(), new Date(wm ?? 0).getTime()));
        }
        let files: string[] = [];
        let pruned = 0;
        if (!metadata) {
          const parts = yield* store(
            sql<{ object_key: string; included: boolean }>`
              SELECT object_key, (event_min <= ${asOf.toISOString()}::timestamptz) AS included
              FROM source_partitions WHERE source_id = ${slug} AND published ORDER BY shard, shard_seq`,
          );
          files = parts.filter((x) => x.included).map((x) => `s3://${cfg.s3.bucket}/${x.object_key}`);
          pruned = parts.length - files.length;
        }
        const limit = Math.min(req.limit ?? 200, 1000);
        const params = { ...(dash?.defaults ?? {}), ...(req.params ?? {}) };
        const compiled = compileQuery({
          ast: req.ast,
          source: spec,
          sourceSlug: slug,
          workspaceId: p.workspaceId,
          asOf,
          params,
          files,
          limit,
          rowPredicate: decision.rowPredicate,
          maskedColumns: decision.columnMask,
          ...(metadata ? { relation: "plinth_meta" } : {}),
        });
        if (Either.isLeft(compiled))
          return yield* Effect.fail(withPath(compiled.left, "/query" + compiled.left.path));
        return {
          slug,
          compiled: compiled.right,
          asOf,
          wm,
          metadata,
          files,
          pruned,
          policyHash: decision.policyHash,
          spec,
          params,
          timeoutMs,
          limit,
        };
      });

    const cache = new Map<string, QueryResult>();

    const run: Context.Tag.Service<typeof QueryEngine>["run"] = (req) =>
      Effect.gen(function* () {
        const p = req.principal;
        const pr = yield* prepare(req);
        const c = pr.compiled;
        // the result-cache key includes the policy hash, so principals with different rows never share an entry
        const cacheKey = pr.metadata
          ? undefined
          : sha256Hex(
              canonicalize({
                q: req.ast,
                policy_hash: pr.policyHash,
                params: pr.params,
                as_of: pr.asOf.toISOString(),
                limit: pr.limit,
                ws: p.workspaceId,
              }),
            );
        const hit = cacheKey === undefined ? undefined : cache.get(cacheKey);
        if (hit) return { ...hit, cache: "hit" as const };
        const prelude = pr.metadata
          ? yield* metaRows(p, pr.slug, pr.spec, pr.asOf).pipe(
              Effect.map((rows) => async () => {
                const dir = cfg.duckdb.tempDir;
                mkdirSync(dir, { recursive: true });
                const file = join(dir, `meta-${Date.now()}-${Math.random().toString(36).slice(2)}.ndjson`);
                try {
                  const typeOf = (t: string) => duckTypeOf(t.startsWith("enum(") ? "string" : t);
                  const cols = pr.spec.fields
                    .map((f) => `'${f.name}': '${typeOf(f.type)}'`)
                    .concat(["'workspace_id': 'VARCHAR'"])
                    .join(", ");
                  writeFileSync(
                    file,
                    rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""),
                  );
                  const norm = file.split("\\").join("/").replace(/'/g, "''");
                  const empty = pr.spec.fields
                    .map((f) => `CAST(NULL AS ${typeOf(f.type)}) AS "${f.name}"`)
                    .concat([`CAST(NULL AS VARCHAR) AS "workspace_id"`])
                    .join(", ");
                  await conn.run(
                    rows.length === 0
                      ? `CREATE OR REPLACE TEMP TABLE plinth_meta AS SELECT ${empty} WHERE FALSE`
                      : `CREATE OR REPLACE TEMP TABLE plinth_meta AS SELECT * FROM read_json('${norm}', format = 'newline_delimited', columns = {${cols}})`,
                  );
                } finally {
                  rmSync(file, { force: true });
                }
              }),
            )
          : undefined;
        const out = yield* exec(c.sql, c.values, pr.timeoutMs, prelude).pipe(
          Effect.catchTag("EngineError", (e) =>
            Effect.fail(
              new DomainError({
                code: "VALIDATION_FAILED",
                path: "/query",
                message: `the query could not be executed: ${e.message.replace(/\s+/g, " ").slice(0, 200)}`,
                expected: "a query the engine can run; try query.explain, or simplify the expressions",
                retryable: false,
              }),
            ),
          ),
        );

        const truncated = out.rows.length > c.limit;
        const types = c.columns.map((col) => col.type);
        const rows = out.rows.slice(0, c.limit).map((r) =>
          r.map((v, i) => {
            if (v === null || v === undefined) return null;
            const t = types[i];
            if (t === "int" || t === "duration") return Number(v);
            if (t === "float") return Number(v);
            if (t === "timestamp") return toIso(v);
            return v;
          }),
        );
        const ordered = (req.ast.order ?? []).length > 0;
        const hashRows = rows.map((r) => r.map((v) => (typeof v === "number" ? roundSig(v) : v)));
        const sortedRows = ordered
          ? hashRows
          : [...hashRows].sort((a, b) => (canonicalize(a) < canonicalize(b) ? -1 : 1));
        const resultHash = sha256Hex(canonicalize({ columns: c.columns, rows: sortedRows }));
        const result: QueryResult = {
          columns: c.columns.map((col) => ({ name: col.name, type: col.type })),
          rows,
          row_count: rows.length,
          truncated,
          as_of: pr.asOf.toISOString(),
          watermarks: [{ source: pr.slug, watermark: pr.wm ?? "" }],
          plan_summary: {
            sources: [pr.slug],
            partitions_read: pr.files.length,
            partitions_pruned: pr.pruned,
          },
          result_hash: `sha256:${resultHash}`,
          policy_hash: pr.policyHash,
          cache: "miss",
          next_cursor: null,
        };
        if (cacheKey !== undefined) {
          if (cache.size >= 200) cache.delete(cache.keys().next().value as string);
          cache.set(cacheKey, result);
        }
        return result;
      });

    const explain: Context.Tag.Service<typeof QueryEngine>["explain"] = (req) =>
      Effect.gen(function* () {
        const pr = yield* prepare(req);
        const snap = yield* authz.snapshot(req.principal);
        const result: ExplainResult = {
          compiled_sql: pr.compiled.sql.replace(
            /read_parquet\(\[[^\]]*\]/,
            `read_parquet([/* ${pr.files.length} published partitions */]`,
          ),
          injected_predicates: pr.compiled.injected.map((i) => ({
            source: pr.slug,
            kind: i.kind,
            predicate: i.predicate,
          })),
          masked_columns: pr.compiled.maskedColumns,
          lineage: pr.compiled.lineage,
          columns: pr.compiled.columns.map((x) => ({ name: x.name, type: x.type })),
          policy_hash: pr.policyHash,
          mask_version: snap.maskVersion,
          grant_index_version: snap.grantIndexVersion,
          as_of: pr.asOf.toISOString(),
          plan_summary: {
            sources: [pr.slug],
            partitions_read: pr.files.length,
            partitions_pruned: pr.pruned,
          },
        };
        return result;
      });

    const sources: Context.Tag.Service<typeof QueryEngine>["sources"] = (p, filter) =>
      store(
        sql<{ slug: string; body: { metadata: { title: string }; spec: unknown } }>`
          SELECT slug, body FROM nodes WHERE workspace_id = ${p.workspaceId} AND kind = 'Source' AND deleted_at IS NULL ORDER BY slug`,
      ).pipe(
        Effect.flatMap((rows) =>
          Effect.forEach(
            rows.filter((r) => filter?.slug === undefined || r.slug === filter.slug),
            (r) =>
              Effect.gen(function* () {
                const spec = Schema.decodeUnknownEither(SourceSpec)(r.body.spec);
                if (Either.isLeft(spec)) return undefined;
                if (filter?.domain !== undefined && spec.right.domain !== filter.domain) return undefined;
                const d = yield* authz.authorize(
                  p,
                  "node:read",
                  nodeUri(p.workspaceSlug, "Source", nodeId(p.workspaceId, "Source", r.slug)),
                );
                if (d.kind === "deny") return undefined;
                const hidden = new Set(d.columnMask);
                const meta = spec.right.kind === "metadata";
                const wm = meta ? (yield* clock.virtualNow).toISOString() : yield* watermarkOf(r.slug);
                const cnt = meta
                  ? [{ n: "0" }]
                  : yield* store(
                      sql<{
                        n: string;
                      }>`SELECT coalesce(sum(row_count), 0) AS n FROM source_partitions WHERE source_id = ${r.slug} AND published`,
                    );
                const info: SourceInfo = {
                  rowEstimate: Number(cnt[0]?.n ?? 0),
                  slug: r.slug,
                  title: r.body.metadata.title,
                  domain: spec.right.domain ?? null,
                  watermark: wm,
                  fields: spec.right.fields
                    .filter((f) => f.masked !== true && !hidden.has(f.name))
                    .map((f) => ({
                      name: f.name,
                      type: f.type,
                      nullable: f.nullable,
                      description: f.description ?? "",
                    })),
                };
                return info;
              }),
          ),
        ),
        Effect.map((xs) => xs.filter((x): x is SourceInfo => x !== undefined)),
      );

    const ping = gate
      .withPermits(1)(wrap("ping", () => conn.run("SELECT 1")))
      .pipe(Effect.asVoid);

    return QueryEngine.of({ run, explain, sources, ping });
  }),
);
