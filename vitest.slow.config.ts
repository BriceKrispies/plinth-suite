import { defineConfig } from "vitest/config";
import base, { SLOW_TESTS } from "./vitest.config";

// `pnpm test:slow`: only the slow files that the default run excludes (same isolation and settings).
// Built by hand rather than with mergeConfig, which concatenates arrays and would keep the default run's exclude.
export default defineConfig({
  ...base,
  test: { ...base.test, include: SLOW_TESTS, exclude: ["**/node_modules/**"] },
});
