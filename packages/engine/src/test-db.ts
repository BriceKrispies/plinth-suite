import { Effect } from "effect";
import { PgClient } from "@effect/sql-pg";
import { Redacted } from "effect";

/**
 * Create the named database through the maintenance database if it does not exist. Test support only: the global
 * setup of the root vitest config calls it before any test opens the control store.
 */
export const ensureTestDatabase = (name: string): Promise<void> => {
  if (!/^[a-z][a-z0-9_]*$/.test(name) || name === "plinth")
    throw new Error(`refusing database name '${name}'`);
  const layer = PgClient.layer({
    host: process.env["PLINTH_DB_HOST"] ?? "127.0.0.1",
    port: Number(process.env["PLINTH_DB_PORT"] ?? 55432),
    database: "postgres",
    username: process.env["PLINTH_DB_USER"] ?? "plinth",
    password: Redacted.make(process.env["PLINTH_DB_PASSWORD"] ?? "plinth"),
  });
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        const rows = yield* sql<{ n: number }>`SELECT 1 AS n FROM pg_database WHERE datname = ${name}`;
        if (rows.length === 0) yield* sql.unsafe(`CREATE DATABASE ${name}`);
      }).pipe(Effect.provide(layer)),
    ),
  );
};
