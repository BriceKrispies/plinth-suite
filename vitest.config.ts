import { configDefaults, defineConfig } from "vitest/config";

// Tests that touch Postgres or object storage need the compose stack (make up). They run against an isolated
// database (`plinth_test`, created by the global setup) and the `test-runs` prefix, never the demo's `plinth`
// database. They share that one database, so files run serially.
// Force the isolation for the global setup too: it reads process.env, which a sourced .env may have set
// to the demo database.
process.env["PLINTH_DB_NAME"] = "plinth_test";
process.env["PLINTH_RUN_PREFIX_ROOT"] = "test-runs";

// The determinism suite replays the whole seed twice (the slowest file by far), so the default run leaves it out;
// `pnpm test:slow` (vitest.slow.config.ts) runs only the files listed here.
export const SLOW_TESTS = ["packages/*/test/*determinism*.test.ts"];

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    exclude: [...configDefaults.exclude, ...SLOW_TESTS],
    globalSetup: ["./vitest.global-setup.ts"],
    env: {
      PLINTH_DB_NAME: "plinth_test",
      PLINTH_RUN_PREFIX_ROOT: "test-runs",
    },
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    maxWorkers: 2,
  },
});
