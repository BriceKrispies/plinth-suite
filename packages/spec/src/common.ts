import { Schema } from "effect";
import { SUITE_NODE_KINDS } from "./suite/kinds";

/** The kernel node kinds (spec 02 section 3.1). */
export const CORE_NODE_KINDS = [
  "Dashboard",
  "Panel",
  "Query",
  "Source",
  "Parameter",
  "Rule",
  "Action",
  "Form",
  "Workflow",
  "Grant",
  "Metric",
  "Template",
  "Export",
  "Annotation",
  "Comment",
] as const;

/** Closed list of node kinds: the kernel kinds, then the Suite kinds (docs/suite/CONTRACT.md section 2.1). */
export const NODE_KINDS = [...CORE_NODE_KINDS, ...SUITE_NODE_KINDS] as const;
export const Kind = Schema.Literal(...NODE_KINDS);
export type Kind = typeof Kind.Type;

/** Kinds that L1 validates. The other kinds are in the closed list but refused until their layer lands. */
export const L1_KINDS = ["Dashboard", "Panel", "Source", "Grant"] as const;

export const SLUG_PATTERN = /^[a-z][a-z0-9_]*(?:[-.][a-z0-9_]+)*$/;
export const Slug = Schema.String.pipe(
  Schema.minLength(2),
  Schema.maxLength(63),
  Schema.pattern(SLUG_PATTERN),
  Schema.annotations({ identifier: "Slug" }),
);

const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const URI_PATTERN = new RegExp(`^plinth://[a-z0-9-]+/(${NODE_KINDS.join("|")})/${UUID_RE}$`);
export const Uri = Schema.String.pipe(Schema.pattern(URI_PATTERN), Schema.annotations({ identifier: "Uri" }));
export type Uri = typeof Uri.Type;

/** What a tool accepts where a node is named: a canonical URI, `kind:slug` (dashboard:ops-board) or a bare slug. */
export const NodeRef = Schema.String.pipe(
  Schema.minLength(2),
  Schema.maxLength(200),
  Schema.annotations({
    identifier: "NodeRef",
    description:
      "A node: plinth://<ws>/<Kind>/<uuid>, kind:slug (e.g. dashboard:ops-board), or a bare slug when unambiguous.",
  }),
);
export type NodeRef = typeof NodeRef.Type;

export const Revision = Schema.Int.pipe(
  Schema.greaterThanOrEqualTo(1),
  Schema.annotations({ identifier: "Revision" }),
);
export const ChangeSeq = Schema.Int.pipe(
  Schema.greaterThanOrEqualTo(1),
  Schema.annotations({ identifier: "ChangeSeq" }),
);

export const Sha256Hex = Schema.String.pipe(Schema.pattern(/^[0-9a-f]{64}$/));

/** A node reference inside a document: `<kind>:<slug>` (spec 02 section 3.1). */
export const Ref = Schema.String.pipe(
  Schema.pattern(/^[a-z]+:[a-z][a-z0-9_]*(?:[-.][a-z0-9_]+)*$/),
  Schema.annotations({ identifier: "Ref" }),
);

export type Json = null | boolean | number | string | ReadonlyArray<Json> | { readonly [k: string]: Json };
export const JsonValue: Schema.Schema<Json> = Schema.Unknown as unknown as Schema.Schema<Json>;

export const Surface = Schema.Literal("ui", "api", "mcp", "driver", "system", "cli");
export type Surface = typeof Surface.Type;

export const PrincipalKind = Schema.Literal("human", "service", "agent");
export type PrincipalKind = typeof PrincipalKind.Type;

/** Constant namespace for UUIDv5 node and principal identifiers (spec 02 section 3.9.5). */
export const PLINTH_NS = "6f0a7d2e-5b1c-4c1e-9d3a-7c2f4a1b8e90";
