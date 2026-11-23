import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderAll } from "../scripts/schemas";

// AC-FND-3 schema_no_drift: the committed JSON Schema equals what the Effect schemas generate now.
describe("schema_no_drift", () => {
  it("generated JSON Schema files match the schemas", () => {
    for (const [file, text] of Object.entries(renderAll())) {
      const committed = readFileSync(join(__dirname, "..", "generated", file), "utf8");
      expect(committed, `${file} is stale: run pnpm schema:gen`).toBe(text);
    }
  });
});
