import { NODE_KINDS } from "./common";
import type { SourceBody } from "./nodes";

/**
 * The `audit.changes` metadata Source (spec 02 section 3.6.3). The engine reads the rows from the change log and
 * exposes them through the same compiler as a landed source: same grants, same masks, same predicates.
 * Departure from the table in 02: `rule_id`, `paths` and `approved_by` are added (arrays are comma-joined strings).
 */
export const AUDIT_SOURCE_SLUG = "audit.changes";

export const AUDIT_SURFACES = ["ui", "api", "mcp", "driver", "system", "cli"] as const;

export const auditSourceBody = (): SourceBody => ({
  apiVersion: "plinth/v1",
  kind: "Source",
  metadata: { slug: AUDIT_SOURCE_SLUG, title: "Audit: changes" },
  spec: {
    kind: "metadata",
    domain: "platform",
    time_column: "virtual_at",
    primary_key: ["seq"],
    enums: { kind: [...NODE_KINDS], surface: [...AUDIT_SURFACES] },
    fields: [
      { name: "seq", type: "int", nullable: false, description: "Workspace chain sequence." },
      { name: "created_at", type: "timestamp", nullable: false, description: "Wall time of the change." },
      {
        name: "virtual_at",
        type: "timestamp",
        nullable: false,
        description: "Virtual-clock time of the change. Audit-window queries filter on it.",
      },
      { name: "node_uri", type: "string", nullable: false },
      { name: "node_kind", type: "enum(kind)", nullable: false },
      { name: "node_slug", type: "string", nullable: true },
      { name: "actor", type: "string", nullable: false, description: "Principal, e.g. agent:claude-code." },
      { name: "on_behalf_of", type: "string", nullable: true },
      { name: "approved_by", type: "string", nullable: true },
      { name: "surface", type: "enum(surface)", nullable: false },
      { name: "session_id", type: "string", nullable: true },
      { name: "base_revision", type: "int", nullable: false },
      { name: "result_revision", type: "int", nullable: false },
      { name: "change_hash", type: "string", nullable: false, description: "Hex SHA-256." },
      { name: "rule_id", type: "string", nullable: true, description: "Commit rule ids, comma-joined." },
      { name: "paths", type: "string", nullable: true, description: "Touched JSON pointers, comma-joined." },
      { name: "reason", type: "string", nullable: true, "x-untrusted": true },
      { name: "undo_of", type: "int", nullable: true },
      { name: "replay_of", type: "string", nullable: true },
      { name: "contains_untrusted", type: "bool", nullable: false },
    ],
  },
});
