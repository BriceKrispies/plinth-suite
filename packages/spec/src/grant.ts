import { Schema } from "effect";
import { Field } from "./query-ast";
import { SUITE_PERMISSIONS } from "./suite/permissions";

/** The closed permission vocabulary (spec 03 section 2). `action:<name>` carries a registry name. */
const KERNEL_PERMISSION_SOURCE =
  "node:(read|write|delete)|query:run|source:write|action:[a-z][a-z0-9_-]*|workflow:(read|acknowledge)|approval:decide|grant:(propose|write|inspect)|ui:present|principal:admin|delegation:admin|driver:execute";

/** The closed permission vocabulary (spec 03 section 2), extended with the Suite permissions (CONTRACT.md 3.1). */
export const PERMISSION_PATTERN = new RegExp(
  `^(${KERNEL_PERMISSION_SOURCE}|${SUITE_PERMISSIONS.join("|")})$`,
);

export const Permission = Schema.String.pipe(
  Schema.pattern(PERMISSION_PATTERN),
  Schema.annotations({
    identifier: "Permission",
    description:
      "node:read node:write node:delete query:run action:<name> workflow:read workflow:acknowledge approval:decide grant:propose grant:write grant:inspect ui:present",
  }),
);

export const GRANT_STATUSES = ["active", "pending_approval", "rejected", "revoked", "expired"] as const;

/**
 * Grant spec (spec 02 section 3.3.10, 03 section 3). `resource` is a node URI (UUID or slug form), a URI prefix ending
 * in `/`, or a source slug. `row_predicate` is an expression over source fields with literal values only.
 */
export const GrantSpec = Schema.Struct({
  principal: Schema.String.pipe(
    Schema.pattern(/^((user|agent|service):[a-z0-9][a-z0-9._-]*|role:[a-z][a-z0-9-]*)$/),
    Schema.annotations({ description: "A principal, or role:<slug> for every member of that Role node" }),
  ),
  effect: Schema.optional(Schema.Literal("allow", "deny")),
  actions: Schema.Array(Permission).pipe(Schema.minItems(1), Schema.maxItems(16)),
  resource: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(300)),
  row_predicate: Schema.optional(Schema.NullOr(Schema.String.pipe(Schema.maxLength(512)))),
  column_mask: Schema.optional(Schema.Array(Field).pipe(Schema.maxItems(64))),
  expires_at: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.Literal(...GRANT_STATUSES)),
  /** Matches only nodes whose `spec.owner` is the effective principal (Preference nodes). CONTRACT.md 3.4. */
  owner_only: Schema.optional(Schema.Boolean),
}).annotations({ identifier: "GrantSpec" });
export type GrantSpec = typeof GrantSpec.Type;
