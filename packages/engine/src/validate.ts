import { Effect, Either, ParseResult, Schema } from "effect";
import {
  DomainError,
  L1_KINDS,
  decodeIssueToDomainError,
  NODE_KINDS,
  bodySchemaFor,
  type DashboardBody,
  type GrantBody,
  type Kind,
  type NodeBody,
  type PanelBody,
  type SourceBody,
  type SourceSpec,
  type SuiteNodeBody,
  suiteBodySchemaFor,
  withPath,
} from "@plinth/spec";
import { parseExpr, typecheckQuery } from "@plinth/query";
import type { StoreError } from "./errors";
import { asValidationFailed, checkSuiteSemantics } from "./suite-validate";

/** A decoded body of any of the 28 node kinds. */
export type AnyNodeBody = NodeBody | SuiteNodeBody;

/** Validation order (spec 02 section 3.2): apiVersion, kind, envelope, spec, references, types. */

const pointer = (path: ReadonlyArray<PropertyKey>): string =>
  path.map((p) => "/" + String(p).replace(/~/g, "~0").replace(/\//g, "~1")).join("");

export const decodeBody = (body: unknown): Either.Either<AnyNodeBody, DomainError> => {
  const kind = (body as { kind?: unknown } | null)?.kind;
  if (typeof kind !== "string" || !(NODE_KINDS as ReadonlyArray<string>).includes(kind)) {
    return Either.left(
      new DomainError({
        code: "VALIDATION_FAILED",
        path: "/kind",
        message: `kind must be one of the ${NODE_KINDS.length} node kinds`,
        expected: "one of " + NODE_KINDS.join(", "),
        allowed: [...NODE_KINDS],
      }),
    );
  }
  const schema = bodySchemaFor(kind as Kind) ?? suiteBodySchemaFor(kind);
  if (!schema) {
    return Either.left(
      new DomainError({
        code: "VALIDATION_FAILED",
        path: "/kind",
        message: `kind ${kind} is not available in this layer`,
        allowed: [...L1_KINDS],
      }),
    );
  }
  const r = Schema.decodeUnknownEither(schema as Schema.Schema<AnyNodeBody, AnyNodeBody>, {
    onExcessProperty: "error",
    errors: "first",
  })(body);
  if (Either.isRight(r)) return Either.right(r.right);
  const err = decodeIssueToDomainError(schema, body, r.left);
  return Either.left(suiteBodySchemaFor(kind) !== undefined ? asValidationFailed(err) : err);
};

/** What semantic checks need to know about the rest of the workspace. */
export interface Lookup {
  readonly slugs: (kind: Kind) => Effect.Effect<ReadonlyArray<string>, StoreError>;
  readonly source: (slug: string) => Effect.Effect<SourceSpec | undefined, StoreError>;
  /** The stored (or same-commit) body of a node, or undefined. */
  readonly body: (kind: Kind, slug: string) => Effect.Effect<unknown, StoreError>;
  /** Every stored node body of a kind, with the same-commit nodes overlaid. */
  readonly bodies: (kind: Kind) => Effect.Effect<ReadonlyArray<{ slug: string; body: unknown }>, StoreError>;
  /** The member handle of a subject (named people keep a kernel subject such as user:ops-lead), or undefined. */
  readonly handleOf: (subject: string) => Effect.Effect<string | undefined, StoreError>;
  /** The subjects (of the given) that are not existing human principals. */
  readonly missingHumans: (
    subjects: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<string>, StoreError>;
}

const fail = (
  code: DomainError["code"],
  path: string,
  message: string,
  extra?: Partial<ConstructorParameters<typeof DomainError>[0]>,
) => Effect.fail(new DomainError({ code, path, message, ...extra }));

const refSlug = (ref: string, token: string): string | undefined =>
  ref.startsWith(token + ":") ? ref.slice(token.length + 1) : undefined;

const checkDashboard = (b: DashboardBody, lookup: Lookup) =>
  Effect.gen(function* () {
    const cols = b.spec.layout.columns ?? 12;
    const items = b.spec.layout.items;
    const seen = new Set<string>();
    const panels = yield* lookup.slugs("Panel");
    for (const [i, it] of items.entries()) {
      const slug = refSlug(it.panel, "panel");
      if (slug === undefined)
        return yield* fail(
          "VALIDATION_FAILED",
          `/spec/layout/items/${i}/panel`,
          `'${it.panel}' is not a panel reference`,
          { expected: "panel:<slug>" },
        );
      if (seen.has(slug))
        return yield* fail(
          "VALIDATION_FAILED",
          `/spec/layout/items/${i}/panel`,
          `panel '${slug}' appears twice in the layout`,
        );
      seen.add(slug);
      if (!panels.includes(slug))
        return yield* fail(
          "UNKNOWN_REFERENCE",
          `/spec/layout/items/${i}/panel`,
          `no Panel with slug '${slug}'`,
          { allowed: panels.slice(0, 5) },
        );
      if (it.at.x + it.at.w > cols)
        return yield* fail(
          "VALIDATION_FAILED",
          `/spec/layout/items/${i}/at`,
          `x + w exceeds the ${cols} columns`,
          { expected: `x + w <= ${cols}` },
        );
      for (const [j, other] of items.entries()) {
        if (j >= i) break;
        const a = it.at;
        const o = other.at;
        if (a.x < o.x + o.w && o.x < a.x + a.w && a.y < o.y + o.h && o.y < a.y + a.h)
          return yield* fail(
            "VALIDATION_FAILED",
            `/spec/layout/items/${i}/at`,
            `overlaps layout item ${j} (${other.panel})`,
            {
              details: { items: [other.panel, it.panel] },
            },
          );
      }
    }
  });

const checkPanel = (b: PanelBody, lookup: Lookup) =>
  Effect.gen(function* () {
    const q = b.spec.query;
    if (typeof q === "string")
      return yield* fail(
        "UNKNOWN_REFERENCE",
        "/spec/query",
        `Query nodes are not available in this layer; use an inline query`,
        { allowed: [] },
      );
    const slug = refSlug(q.from, "source");
    if (slug === undefined)
      return yield* fail(
        "VALIDATION_FAILED",
        "/spec/query/from",
        "subqueries are not available in this layer",
        { expected: "source:<slug>" },
      );
    const source = yield* lookup.source(slug);
    if (!source) {
      const all = yield* lookup.slugs("Source");
      return yield* fail("UNKNOWN_REFERENCE", "/spec/query/from", `no Source with slug '${slug}'`, {
        allowed: all.slice(0, 5),
      });
    }
    const cols = typecheckQuery(q, source, slug);
    if (Either.isLeft(cols)) {
      const e = cols.left;
      return yield* Effect.fail(withPath(e, "/spec/query" + e.path));
    }
    const byName = new Map(cols.right.map((c) => [c.name, c.type] as const));
    // Every field a visual maps must be a query output column (all visual types).
    const visual = b.spec.visual;
    const mapped: Array<readonly [string, string]> =
      visual.type === "table"
        ? visual.columns.map((f, i) => [`columns/${i}`, f] as const)
        : Object.entries(visual.channels as Record<string, unknown>).flatMap(([ch, f]) =>
            typeof f === "string" ? [[`channels/${ch}`, f] as const] : [],
          );
    for (const [at, f] of mapped) {
      if (!byName.has(f))
        return yield* fail(
          "UNKNOWN_FIELD",
          `/spec/visual/${at}`,
          `${at} maps '${f}', which the query does not output`,
          { allowed: [...byName.keys()].slice(0, 20) },
        );
    }
    if (visual.type === "bar") {
      const { x, y } = visual.channels;
      if (byName.get(x) === "timestamp")
        return yield* fail(
          "TYPE_MISMATCH",
          "/spec/visual/channels/x",
          "a bar panel cannot use a timestamp on x; use a line panel",
          {
            expected: "string or int",
            details: { got: "timestamp" },
          },
        );
      const yt = byName.get(y);
      if (yt !== "int" && yt !== "float" && yt !== "duration")
        return yield* fail("TYPE_MISMATCH", "/spec/visual/channels/y", "a bar panel needs a numeric y", {
          expected: "int|float",
          details: { got: String(yt) },
        });
    }
  });

const checkSource = (b: SourceBody) =>
  Effect.gen(function* () {
    const fields = new Map(b.spec.fields.map((f) => [f.name, f] as const));
    const tc = fields.get(b.spec.time_column);
    if (!tc || tc.type !== "timestamp")
      return yield* fail(
        "VALIDATION_FAILED",
        "/spec/time_column",
        "time_column must name a timestamp field",
        { expected: "a timestamp field" },
      );
    for (const [i, k] of b.spec.primary_key.entries()) {
      const f = fields.get(k);
      if (!f)
        return yield* fail("UNKNOWN_FIELD", `/spec/primary_key/${i}`, `unknown field '${k}'`, {
          allowed: [...fields.keys()],
        });
      if (f.nullable)
        return yield* fail(
          "VALIDATION_FAILED",
          `/spec/primary_key/${i}`,
          `primary key field '${k}' must not be nullable`,
        );
    }
  });

const checkGrant = (b: GrantBody) =>
  Effect.gen(function* () {
    const rp = b.spec.row_predicate;
    if (rp) {
      if (/[$]|now\s*[(]/.test(rp))
        return yield* fail(
          "VALIDATION_FAILED",
          "/spec/row_predicate",
          "a row predicate takes literal values only: no $parameters and no now()",
          { expected: "for example region = 'EMEA' or (region = 'EMEA' or region = 'NA')" },
        );
      const parsed = parseExpr(rp);
      if (Either.isLeft(parsed))
        return yield* fail(
          "VALIDATION_FAILED",
          "/spec/row_predicate",
          `cannot parse row predicate: ${parsed.left.message}`,
          { expected: "an expression such as region = 'EMEA'" },
        );
    }
  });

/** References, types and cross-field rules: the stages after the schema check. */
export const checkSemantics = (
  body: AnyNodeBody,
  lookup: Lookup,
): Effect.Effect<void, DomainError | StoreError> => {
  if (suiteBodySchemaFor(body.kind) !== undefined) return checkSuiteSemantics(body as SuiteNodeBody, lookup);
  const core = body as NodeBody;
  switch (core.kind) {
    case "Dashboard":
      return checkDashboard(core, lookup);
    case "Panel":
      return checkPanel(core, lookup);
    case "Source":
      return checkSource(core);
    case "Grant":
      return checkGrant(core);
  }
};
