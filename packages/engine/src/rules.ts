import { Either } from "effect";
import {
  DomainError,
  SITE_MANAGED_ACTIONS,
  SITE_MANAGED_KINDS,
  SUITE_COMMIT_RULES,
  type Kind,
} from "@plinth/spec";
import type { Principal } from "./identity";

/**
 * The closed commit-rule table (spec 03 section 6, README ruling 5): every write by an agent principal is
 * classified by exactly one row. `R-GRANT` applies to every principal, including humans, except for the system
 * surface (the seed). Other principals commit under `R-HUMAN-DIRECT` and are authorised by grants alone.
 */
export type RuleClass = "auto" | "approval" | "refused";

export const COMMIT_RULE_TABLE: ReadonlyArray<{ readonly id: string; readonly class: RuleClass }> = [
  { id: "R-DASH-CREATE", class: "auto" },
  { id: "R-PANEL-CREATE", class: "auto" },
  { id: "R-PANEL-EDIT", class: "auto" },
  { id: "R-LAYOUT", class: "auto" },
  { id: "R-PARAM-BIND", class: "auto" },
  { id: "R-QUERY-CREATE", class: "auto" },
  { id: "R-RULE-CREATE", class: "auto" },
  { id: "R-RULE-THRESHOLD", class: "approval" },
  { id: "R-RULE-ACTION", class: "refused" },
  { id: "R-FORM-CREATE", class: "auto" },
  { id: "R-FORM-REBIND", class: "approval" },
  { id: "R-GRANT", class: "approval" },
  { id: "R-GRANT-UNDO", class: "auto" },
  { id: "R-DELETE-SESSION", class: "auto" },
  { id: "R-DELETE-OTHER", class: "approval" },
  { id: "R-UNDO-OWN", class: "auto" },
  { id: "R-UNDO-FOREIGN", class: "approval" },
  { id: "R-ACTION-EXTERNAL", class: "approval" },
  { id: "R-PRINCIPAL", class: "refused" },
  { id: "R-SOURCE", class: "refused" },
  { id: "R-NO-MATCH", class: "refused" },
  ...SUITE_COMMIT_RULES.map((r) => ({ id: r.id, class: r.class as RuleClass })),
];

export interface RuleInput {
  readonly kind: Kind;
  readonly create: boolean;
  readonly deleted: boolean;
  readonly paths: ReadonlyArray<string>;
  /** Set when the change is the inverse of an earlier change. */
  readonly undo?: { readonly ofKind: Kind; readonly ownChange: boolean } | undefined;
  /** The node was created by this principal (the closest available notion of "this session"). */
  readonly createdByActor?: boolean | undefined;
  readonly surface?: string | undefined;
  /** The node body before this change (undefined on create) and after it. Used by the Suite rules. */
  readonly before?: unknown;
  readonly after?: unknown;
  /** The action that commits the change (K6): only managed fields may be written, only by their action. */
  readonly managedBy?: string | undefined;
}

export interface Classified {
  readonly rule_id: ReadonlyArray<string>;
  readonly decision: "auto" | "approval";
}

const refuse = (rule: string, kind: Kind, why: string) =>
  Either.left(
    new DomainError({
      code: "RULE_REFUSED",
      path: "",
      message: `${rule}: ${why}`,
      details: {
        rule_id: rule,
        kind,
        reason: rule === "R-NO-MATCH" ? "no_commit_rule" : "ceiling_denies",
      },
      fix_hint: "Change the operation, or ask a person to make this change in the UI.",
    }),
  );

const ok = (rule: string, decision: "auto" | "approval" = "auto") =>
  Either.right<Classified>({ rule_id: [rule], decision });

const spec = (b: unknown): Record<string, unknown> =>
  ((b as { spec?: Record<string, unknown> } | null | undefined)?.spec ?? {}) as Record<string, unknown>;
const touches = (paths: ReadonlyArray<string>, ...prefixes: ReadonlyArray<string>): boolean =>
  paths.some((x) => prefixes.some((q) => x === q || x.startsWith(q + "/")));
const hasWebhook = (b: unknown): boolean =>
  Array.isArray(spec(b)["steps"]) &&
  (spec(b)["steps"] as Array<{ type?: string }>).some((st) => st.type === "webhook");

/** Promotion status movement committed by promotions.transition or the scheduler. */
const promoMove = (c: RuleInput): { from: string; to: string } | undefined => {
  const from = spec(c.before)["status"];
  const to = spec(c.after)["status"];
  return typeof from === "string" && typeof to === "string" && from !== to ? { from, to } : undefined;
};

/**
 * Suite classification (CONTRACT.md 3.8, K5). Rows marked `applies: all` also classify humans (they may hold a change
 * for approval); `agent` rows apply to agent principals only; `system` rows to the system surface.
 * Returns undefined when no Suite row speaks for this change.
 */
const classifySuite = (p: Principal, c: RuleInput): Either.Either<Classified, DomainError> | undefined => {
  const agent = p.kind === "agent";
  const move = promoMove(c);
  switch (c.kind) {
    case "Promotion": {
      if (c.surface === "system" && c.managedBy !== undefined && move) return ok("R-PROMO-SCHEDULE");
      if (c.create) return agent ? ok("R-PROMO-CREATE") : undefined;
      if (move && c.managedBy === "promotions.transition") {
        if (move.from === "draft" && (move.to === "scheduled" || move.to === "active"))
          return ok("R-PROMO-ACTIVATE", "approval");
        return ok("R-PROMO-CONTROL");
      }
      const live = ["scheduled", "active", "paused"].includes(String(spec(c.before)["status"]));
      if (live && touches(c.paths, "/spec/eligibility", "/spec/effects", "/spec/budget", "/spec/schedule"))
        return ok("R-PROMO-ACTIVATE", "approval");
      return ok("R-PROMO-EDIT");
    }
    case "Automation": {
      const enabled = spec(c.after)["enabled"] === true;
      if (
        enabled &&
        hasWebhook(c.after) &&
        (c.create || !hasWebhook(c.before) || spec(c.before)["enabled"] !== true)
      )
        return ok("R-AUTOMATION-EXTERNAL", "approval");
      if (!agent) return undefined;
      if (c.create)
        return enabled
          ? refuse("R-AUTOMATION-CREATE", c.kind, "an agent may only create an Automation with enabled=false")
          : ok("R-AUTOMATION-CREATE");
      if (enabled || spec(c.before)["enabled"] === true) return ok("R-AUTOMATION-ENABLE", "approval");
      return ok("R-AUTOMATION-EDIT");
    }
    case "Content":
      if (c.managedBy === "content.transition") return ok("R-CONTENT-STATUS");
      if (!agent) return undefined;
      return ok(c.create ? "R-CONTENT-CREATE" : "R-CONTENT-EDIT");
    case "Role":
      return c.surface === "system" ? undefined : ok("R-ROLE", "approval");
    case "Program":
      return c.surface === "system" ? undefined : ok("R-PROGRAM", "approval");
    case "Preference":
      return ok("R-PREFERENCE");
    case "Product":
      if (!agent) return undefined;
      if (c.create)
        return ok(
          spec(c.after)["status"] === "draft" ? "R-PRODUCT-CREATE" : "R-PRODUCT-PRICE",
          spec(c.after)["status"] === "draft" ? "auto" : "approval",
        );
      return touches(c.paths, "/spec/price_points", "/spec/cash_price_cents", "/spec/status")
        ? ok("R-PRODUCT-PRICE", "approval")
        : ok("R-PRODUCT-EDIT");
    case "Category":
      return agent ? ok("R-PRODUCT-CREATE") : undefined;
    case "Badge":
      if (!agent) return undefined;
      if (c.create && spec(c.after)["status"] === "draft") return ok("R-BADGE-CREATE");
      return ok("R-BADGE-EDIT", "approval");
    case "Segment":
      return agent ? ok("R-SEGMENT") : undefined;
    case "Group":
      return agent ? ok("R-GROUP") : undefined;
    case "Widget":
      return agent ? ok("R-WIDGET") : undefined;
    case "Page":
      if (!agent) return undefined;
      return spec(c.before)["system"] === true || spec(c.after)["system"] === true
        ? ok("R-PAGE-SYSTEM", "approval")
        : ok("R-PAGE");
    default:
      return undefined;
  }
};

/**
 * True when the commit comes from one of the `site.*` actions and touches a kind they manage. `managed` is set only by
 * action handlers (never by POST /changes or the MCP node verbs), and the action's own permission has been checked.
 */
export const isSiteManaged = (by: string | undefined, kind: string): boolean =>
  by !== undefined &&
  (SITE_MANAGED_ACTIONS as ReadonlyArray<string>).includes(by) &&
  (SITE_MANAGED_KINDS as ReadonlyArray<string>).includes(kind);

export const classify = (p: Principal, c: RuleInput): Either.Either<Classified, DomainError> => {
  if (isSiteManaged(c.managedBy, c.kind)) return ok("R-SITE");
  const grantTouch = c.kind === "Grant" || c.undo?.ofKind === "Grant";
  if (c.undo && c.undo.ofKind === "Grant") return ok("R-GRANT-UNDO");
  if (p.kind !== "agent") {
    if (c.kind === "Grant" && c.surface !== "system") return ok("R-GRANT", "approval");
    // rows marked `applies: all` classify humans too (R-PROMO-CONTROL, R-CONTENT-STATUS, R-PREFERENCE, ...)
    const s = c.deleted ? undefined : classifySuite(p, c);
    if (s !== undefined && Either.isRight(s)) return s;
    if (c.deleted && c.kind === "Role" && c.surface !== "system") return ok("R-ROLE", "approval");
    return ok("R-HUMAN-DIRECT");
  }
  if (c.undo) return c.undo.ownChange ? ok("R-UNDO-OWN") : ok("R-UNDO-FOREIGN", "approval");
  if (grantTouch) return ok("R-GRANT", "approval");
  if (c.kind === "Source" || c.kind === "Action")
    return refuse("R-SOURCE", c.kind, "agents may not change a Source or the action registry");
  if (c.deleted) return c.createdByActor ? ok("R-DELETE-SESSION") : ok("R-DELETE-OTHER", "approval");
  const suite = classifySuite(p, c);
  if (suite !== undefined) return suite;
  switch (c.kind) {
    case "Dashboard":
      if (c.create) return ok("R-DASH-CREATE");
      if (c.paths.every((x) => x.startsWith("/spec/layout"))) return ok("R-LAYOUT");
      if (c.paths.every((x) => x.startsWith("/spec/parameters"))) return ok("R-PARAM-BIND");
      return refuse("R-NO-MATCH", c.kind, "only layout and parameter paths of a Dashboard may be edited");
    case "Panel":
      return ok(c.create ? "R-PANEL-CREATE" : "R-PANEL-EDIT");
    case "Parameter":
      return ok("R-PARAM-BIND");
    case "Query":
      return c.create ? ok("R-QUERY-CREATE") : refuse("R-NO-MATCH", c.kind, "a Query may only be created");
    case "Rule":
      return c.create ? ok("R-RULE-CREATE") : ok("R-RULE-THRESHOLD", "approval");
    case "Form":
      return c.create ? ok("R-FORM-CREATE") : ok("R-FORM-REBIND", "approval");
    default:
      return refuse("R-NO-MATCH", c.kind, `no commit rule matches a change to ${c.kind}`);
  }
};
