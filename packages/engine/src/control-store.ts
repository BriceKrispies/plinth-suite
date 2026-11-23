import { Context, Effect, Layer } from "effect";
import { PgClient } from "@effect/sql-pg";
import type { SqlError } from "@effect/sql/SqlError";
import { AppConfig } from "./config";
import { StoreError } from "./errors";

/**
 * The control store: PostgreSQL is the only authority (spec 05 section 8.1). The service exposes the typed
 * `@effect/sql` client; repository code in this package runs queries and transactions through it.
 */
export class ControlStore extends Context.Tag("plinth/ControlStore")<
  ControlStore,
  {
    readonly sql: PgClient.PgClient;
    readonly ping: Effect.Effect<void, StoreError>;
  }
>() {}

export const toStoreError = (e: SqlError): StoreError => {
  const cause = (e as { cause?: unknown }).cause as { code?: string } | undefined;
  return new StoreError({
    message: e.message,
    cause: e,
    ...(cause?.code !== undefined ? { sqlstate: cause.code } : {}),
  });
};

/** Run a SQL effect and move its `SqlError` into the typed `StoreError` channel. */
export const store = <A, E, R>(
  eff: Effect.Effect<A, E | SqlError, R>,
): Effect.Effect<A, Exclude<E, SqlError> | StoreError, R> =>
  eff.pipe(
    Effect.catchIf(
      (e): e is SqlError =>
        typeof e === "object" && e !== null && (e as { _tag?: string })._tag === "SqlError",
      (e) => Effect.fail(toStoreError(e)),
    ),
  ) as Effect.Effect<A, Exclude<E, SqlError> | StoreError, R>;

const PgLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    return PgClient.layer({
      host: cfg.db.host,
      port: cfg.db.port,
      database: cfg.db.name,
      username: cfg.db.user,
      password: cfg.db.password,
      maxConnections: cfg.db.poolMax,
      applicationName: "plinth",
    });
  }),
);

export const ControlStoreLive = Layer.effect(
  ControlStore,
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    return ControlStore.of({ sql, ping: store(sql`SELECT 1`.pipe(Effect.asVoid)) });
  }),
).pipe(Layer.provide(PgLive));
