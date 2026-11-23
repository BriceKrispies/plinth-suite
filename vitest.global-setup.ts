import { ensureTestDatabase } from "./packages/engine/src/test-db";

/** Create the isolated test database if it is missing. Refuses to run against the demo database. */
export default async function setup(): Promise<void> {
  if (process.env["PLINTH_DB_NAME"] !== "plinth_test")
    throw new Error("tests must run with PLINTH_DB_NAME=plinth_test; set it in vitest.config.ts");
  await ensureTestDatabase("plinth_test");
}
