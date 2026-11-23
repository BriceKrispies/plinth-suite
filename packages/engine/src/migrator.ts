import { Effect } from "effect";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { ControlStore, store } from "./control-store";
import { StoreError, messageOf } from "./errors";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations/", import.meta.url));

const loadMigrations = Effect.try({
  try: () =>
    readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => ({ id: f.replace(/\.sql$/, ""), text: readFileSync(join(MIGRATIONS_DIR, f), "utf8") })),
  catch: (e) => new StoreError({ message: `cannot read migrations: ${messageOf(e)}`, cause: e }),
});

/**
 * Apply every SQL file in `migrations/` that has not run, in file order, each in its own transaction under an
 * advisory lock so concurrent starters serialise. Returns the ids applied by this call.
 */
export const migrate = Effect.gen(function* () {
  const { sql } = yield* ControlStore;
  const files = yield* loadMigrations;
  yield* store(
    sql`CREATE TABLE IF NOT EXISTS plinth_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const applied: string[] = [];
  for (const m of files) {
    const ran = yield* store(
      sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(727274)`;
          const rows = yield* sql<{ id: string }>`SELECT id FROM plinth_migrations WHERE id = ${m.id}`;
          if (rows.length > 0) return false;
          yield* sql.unsafe(m.text);
          yield* sql`INSERT INTO plinth_migrations (id) VALUES (${m.id})`;
          return true;
        }),
      ),
    );
    if (ran) applied.push(m.id);
  }
  return applied as ReadonlyArray<string>;
});

/** Highest migration id on disk, compared by readiness against the database. */
export const expectedSchemaVersion = loadMigrations.pipe(Effect.map((ms) => ms[ms.length - 1]?.id ?? ""));

export const schemaVersion = Effect.gen(function* () {
  const { sql } = yield* ControlStore;
  const rows = yield* store(sql<{ id: string }>`SELECT id FROM plinth_migrations ORDER BY id DESC LIMIT 1`);
  return rows[0]?.id ?? "";
});
