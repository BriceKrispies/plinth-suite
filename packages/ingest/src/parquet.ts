import { Context, Effect, Layer } from "effect";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EngineError, messageOf } from "@plinth/engine";

export type ColumnType = "VARCHAR" | "BIGINT" | "DOUBLE" | "TIMESTAMP" | "BOOLEAN";
export interface ColumnDef {
  readonly name: string;
  readonly type: ColumnType;
}

/** Writes rows to a Parquet file using a private in-memory DuckDB. Rows are JSON-safe records. */
export class ParquetWriter extends Context.Tag("plinth/ParquetWriter")<
  ParquetWriter,
  {
    readonly write: (
      columns: ReadonlyArray<ColumnDef>,
      rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
    ) => Effect.Effect<Uint8Array, EngineError>;
  }
>() {}

const q = (id: string): string => `"${id.replace(/"/g, '""')}"`;
const lit = (s: string): string => `'${s.split(String.fromCharCode(92)).join("/").replace(/'/g, "''")}'`;

export const ParquetWriterLive = Layer.scoped(
  ParquetWriter,
  Effect.gen(function* () {
    const wrap = <A>(label: string, f: () => Promise<A>) =>
      Effect.tryPromise({
        try: f,
        catch: (e) => new EngineError({ message: `${label}: ${messageOf(e)}`, cause: e }),
      });
    const { instance, conn } = yield* Effect.acquireRelease(
      wrap("parquet writer init", async () => {
        const instance = await DuckDBInstance.create(":memory:", { threads: "1" });
        const conn = await DuckDBConnection.create(instance);
        return { instance, conn };
      }),
      ({ instance, conn }) =>
        Effect.sync(() => {
          conn.closeSync();
          instance.closeSync();
        }),
    );
    void instance;
    const gate = yield* Effect.makeSemaphore(1);
    return ParquetWriter.of({
      write: (columns, rows) =>
        gate.withPermits(1)(
          wrap("write parquet", async () => {
            const dir = mkdtempSync(join(tmpdir(), "plinth-parquet-"));
            try {
              const out = join(dir, "part.parquet");
              if (rows.length === 0) {
                const sel = columns.map((c) => `CAST(NULL AS ${c.type}) AS ${q(c.name)}`).join(", ");
                await conn.run(
                  `COPY (SELECT ${sel} WHERE FALSE) TO ${lit(out)} (FORMAT PARQUET, COMPRESSION ZSTD)`,
                );
              } else {
                const src = join(dir, "rows.ndjson");
                writeFileSync(src, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
                const cols = columns.map((c) => `${lit(c.name)}: ${lit(c.type)}`).join(", ");
                await conn.run(
                  `COPY (SELECT ${columns.map((c) => q(c.name)).join(", ")} FROM read_json(${lit(src)}, format = 'newline_delimited', columns = {${cols}})) ` +
                    `TO ${lit(out)} (FORMAT PARQUET, COMPRESSION ZSTD)`,
                );
              }
              return new Uint8Array(readFileSync(out));
            } finally {
              rmSync(dir, { recursive: true, force: true });
            }
          }),
        ),
    });
  }),
);
