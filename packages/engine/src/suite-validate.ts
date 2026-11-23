import { Effect, Either } from "effect";
import {
  DOMAIN_EVENT_PAYLOADS,
  DomainError,
  MEMBER_FACTS,
  type CondTree,
  type DomainEventType,
  type Kind,
  type SuiteNodeBody,
} from "@plinth/spec";
import { typecheckQuery } from "@plinth/query";
import type { StoreError } from "./errors";
import type { Lookup } from "./validate";

/**
 * Semantic validation of the 13 Suite kinds (CONTRACT.md section 2.3), run after schema decoding. A failure is
 * `VALIDATION_FAILED`, `UNKNOWN_REFERENCE` or `RULE_REFUSED`, with the JSON pointer of the offending value.
 */

/**
 * CONTRACT 1.1: on Suite bodies and action inputs a wrong or unknown field is VALIDATION_FAILED with the pointer in
 * `path` (and `allowed` / `did_you_mean`), not the kernel's UNKNOWN_FIELD.
 */
export const asValidationFailed = (e: DomainError): DomainError =>
  e.code === "UNKNOWN_FIELD" ? new DomainError({ ...e, code: "VALIDATION_FAILED" }) : e;

const fail = (
  code: DomainError["code"],
  path: string,
  message: string,
  extra?: Partial<ConstructorParameters<typeof DomainError>[0]>,
) => Effect.fail(new DomainError({ code, path, message, ...extra }));

type Check = Effect.Effect<void, DomainError | StoreError>;

const refSlug = (ref: string): { kind: string; slug: string } | undefined => {
  const i = ref.indexOf(":");
  return i < 0 ? undefined : { kind: ref.slice(0, i), slug: ref.slice(i + 1) };
};

const KIND_OF_PREFIX: Readonly<Record<string, Kind>> = {
  product: "Product",
  category: "Category",
  badge: "Badge",
  promotion: "Promotion",
  automation: "Automation",
  content: "Content",
  segment: "Segment",
  group: "Group",
  role: "Role",
  panel: "Panel",
  widget: "Widget",
  page: "Page",
};

/** Every `<kind>:<slug>` reference must name an existing (or same-commit) node. */
const resolveRef = (ref: string, path: string, lookup: Lookup): Check =>
  Effect.gen(function* () {
    const r = refSlug(ref);
    const kind = r ? KIND_OF_PREFIX[r.kind] : undefined;
    if (!r || !kind) return yield* fail("VALIDATION_FAILED", path, `'${ref}' is not a node reference`);
    const slugs = yield* lookup.slugs(kind);
    if (!slugs.includes(r.slug))
      return yield* fail("UNKNOWN_REFERENCE", path, `no ${kind} with slug '${r.slug}'`, {
        allowed: slugs.slice(0, 5),
      });
  });

const resolveAll = (refs: ReadonlyArray<string> | undefined, path: string, lookup: Lookup): Check =>
  Effect.forEach(refs ?? [], (r, i) => resolveRef(r, `${path}/${i}`, lookup), { discard: true });

// ---- conditions ---------------------------------------------------------------------------------------

const leaves = (
  t: CondTree,
  at: string,
  out: Array<{ field: string; op: string; at: string }>,
  depth = 1,
) => {
  if ("all" in t) t.all.forEach((c, i) => leaves(c, `${at}/all/${i}`, out, depth + 1));
  else if ("any" in t) t.any.forEach((c, i) => leaves(c, `${at}/any/${i}`, out, depth + 1));
  else if ("not" in t) leaves(t.not, `${at}/not`, out, depth + 1);
  else out.push({ field: t.field, op: t.op, at });
  return depth;
};

const depthOf = (t: CondTree): number =>
  "all" in t
    ? 1 + Math.max(...t.all.map(depthOf))
    : "any" in t
      ? 1 + Math.max(...t.any.map(depthOf))
      : "not" in t
        ? 1 + depthOf(t.not)
        : 1;

/** A Segment rule or promotion filter addresses only MEMBER_FACTS, with operators valid for each fact. */
const checkMemberCond = (tree: CondTree, at: string): Check =>
  Effect.gen(function* () {
    if (depthOf(tree) > 4) return yield* fail("VALIDATION_FAILED", at, "conditions may nest at most 4 deep");
    const out: Array<{ field: string; op: string; at: string }> = [];
    leaves(tree, at, out);
    for (const l of out) {
      const fact = MEMBER_FACTS.find((f) => f.path === l.field);
      if (!fact)
        return yield* fail("VALIDATION_FAILED", `${l.at}/field`, `'${l.field}' is not a member fact`, {
          allowed: MEMBER_FACTS.map((f) => f.path),
        });
      if (l.op !== "exists" && l.op !== "not_exists" && !(fact.ops as ReadonlyArray<string>).includes(l.op))
        return yield* fail(
          "VALIDATION_FAILED",
          `${l.at}/op`,
          `operator '${l.op}' does not apply to fact '${l.field}'`,
          { allowed: [...fact.ops] },
        );
    }
  });

/** Facts the badge engine derives for some events and that filters may address (CONTRACT 11.4 note). */
const DERIVED_EVENT_FACTS: Record<string, ReadonlyArray<string>> = {
  "order.placed": ["categories"],
  "content.engaged": ["minutes_since_publish"],
};

const payloadFields = (event: string): ReadonlyArray<string> => {
  const schema = (DOMAIN_EVENT_PAYLOADS as Record<string, { fields?: Record<string, unknown> }>)[event];
  return [...Object.keys(schema?.fields ?? {}), ...(DERIVED_EVENT_FACTS[event] ?? [])];
};

/** Automation conditions and badge filters: `event.<payload field>` of the named event, `member.<fact>`, or `now`. */
const checkEventCond = (tree: CondTree, event: string | undefined, at: string): Check =>
  Effect.gen(function* () {
    if (depthOf(tree) > 4) return yield* fail("VALIDATION_FAILED", at, "conditions may nest at most 4 deep");
    const out: Array<{ field: string; op: string; at: string }> = [];
    leaves(tree, at, out);
    for (const l of out) {
      if (l.field === "now") continue;
      if (l.field.startsWith("member.")) {
        const name = l.field.slice("member.".length);
        if (!MEMBER_FACTS.some((f) => f.path === name))
          return yield* fail("VALIDATION_FAILED", `${l.at}/field`, `'${name}' is not a member fact`, {
            allowed: MEMBER_FACTS.map((f) => `member.${f.path}`),
          });
        continue;
      }
      if (l.field.startsWith("event.")) {
        const name = l.field.slice("event.".length).split(".")[0] ?? "";
        const fields = event ? payloadFields(event) : [];
        if (event && fields.length > 0 && !fields.includes(name))
          return yield* fail(
            "VALIDATION_FAILED",
            `${l.at}/field`,
            `'${name}' is not a field of the ${event} payload`,
            { allowed: fields.map((x) => `event.${x}`) },
          );
        continue;
      }
      return yield* fail(
        "VALIDATION_FAILED",
        `${l.at}/field`,
        `'${l.field}' must start with event., member. or be now`,
      );
    }
  });

// ---- cron ---------------------------------------------------------------------------------------------

const RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [1, 7],
];

/** Five-field cron: `*`, `n`, `a-b`, lists, and `*\/n` or `a-b/n` steps. */
export const parseCronField = (field: string, lo: number, hi: number): ReadonlyArray<number> | undefined => {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) return undefined;
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1) return undefined;
    let a = lo;
    let b = hi;
    if (m[1] !== "*") {
      const [x, y] = (m[1] ?? "").split("-");
      a = Number(x);
      b = y === undefined ? (m[2] === undefined ? a : hi) : Number(y);
    }
    if (a < lo || b > hi || a > b) return undefined;
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return [...out].sort((p, q) => p - q);
};

export const parseCron = (cron: string): ReadonlyArray<ReadonlyArray<number>> | undefined => {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return undefined;
  const parsed = fields.map((f, i) => parseCronField(f, RANGES[i]?.[0] ?? 0, RANGES[i]?.[1] ?? 0));
  return parsed.every((x) => x !== undefined) ? (parsed as ReadonlyArray<ReadonlyArray<number>>) : undefined;
};

// ---- templates ----------------------------------------------------------------------------------------

const TEMPLATE_ROOTS = new Set(["event", "member", "run", "now"]);

const templateErrors = (value: unknown, at: string, out: Array<{ at: string; token: string }>): void => {
  if (typeof value === "string") {
    for (const m of value.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) {
      const token = m[1] ?? "";
      const root = token.split(".")[0] ?? "";
      if (!TEMPLATE_ROOTS.has(root) || (root === "run" && token !== "run.id")) out.push({ at, token });
    }
  } else if (Array.isArray(value)) value.forEach((v, i) => templateErrors(v, `${at}/${i}`, out));
  else if (value !== null && typeof value === "object")
    for (const [k, v] of Object.entries(value)) templateErrors(v, `${at}/${k}`, out);
};

// ---- per kind -----------------------------------------------------------------------------------------

const PRICE_OK = (b: { spec: { status: string; price_points: number } }) =>
  b.spec.status !== "active" || b.spec.price_points >= 1;

const checkOne = (body: SuiteNodeBody, lookup: Lookup): Check =>
  Effect.gen(function* () {
    switch (body.kind) {
      case "Product": {
        yield* resolveRef(body.spec.category, "/spec/category", lookup);
        if (!PRICE_OK(body))
          return yield* fail(
            "VALIDATION_FAILED",
            "/spec/price_points",
            "an active product needs price_points >= 1",
          );
        return;
      }
      case "Category":
        return;
      case "Badge": {
        const c = body.spec.criteria;
        if ("filter" in c && c.filter !== undefined)
          yield* checkEventCond(c.filter, "event" in c ? c.event : undefined, "/spec/criteria/filter");
        return;
      }
      case "Promotion": {
        const s = body.spec;
        if (Date.parse(s.schedule.ends_at) <= Date.parse(s.schedule.starts_at))
          return yield* fail(
            "VALIDATION_FAILED",
            "/spec/schedule/ends_at",
            "ends_at must be after starts_at",
          );
        const e = s.eligibility;
        yield* resolveAll(e.categories, "/spec/eligibility/categories", lookup);
        yield* resolveAll(e.products, "/spec/eligibility/products", lookup);
        yield* resolveAll(e.segments, "/spec/eligibility/segments", lookup);
        yield* resolveAll(e.groups, "/spec/eligibility/groups", lookup);
        if (e.filter !== undefined) yield* checkMemberCond(e.filter, "/spec/eligibility/filter");
        for (const [i, fx] of s.effects.entries()) {
          if (fx.type === "store_discount") {
            yield* resolveAll(fx.categories, `/spec/effects/${i}/categories`, lookup);
            yield* resolveAll(fx.products, `/spec/effects/${i}/products`, lookup);
          }
          if (fx.type === "free_item") {
            yield* resolveRef(fx.product, `/spec/effects/${i}/product`, lookup);
            const slug = refSlug(fx.product)?.slug ?? "";
            const p = yield* lookup.body("Product", slug);
            const status = (p as { spec?: { status?: string } } | undefined)?.spec?.status;
            if (status !== undefined && status !== "active")
              return yield* fail(
                "VALIDATION_FAILED",
                `/spec/effects/${i}/product`,
                `free_item product '${slug}' must be active`,
              );
          }
        }
        const channels = e.channels;
        const applies = (c: string) => channels === undefined || channels.includes(c as never);
        const ok = s.effects.some((fx) =>
          fx.type === "bonus_points"
            ? applies(fx.on === "purchase" ? "store" : "recognition")
            : fx.type === "points_multiplier"
              ? applies("recognition") || applies("automation")
              : applies("store"),
        );
        if (!ok)
          return yield* fail(
            "VALIDATION_FAILED",
            "/spec/effects",
            "no effect applies to any of the eligibility channels",
          );
        if (s.stack_group !== undefined && s.stacking !== "stack")
          return yield* fail("VALIDATION_FAILED", "/spec/stack_group", "stack_group needs stacking: stack");
        return;
      }
      case "Automation": {
        const s = body.spec;
        const ids = new Set<string>();
        for (const [i, st] of s.steps.entries()) {
          if (ids.has(st.id))
            return yield* fail("VALIDATION_FAILED", `/spec/steps/${i}/id`, `duplicate step id '${st.id}'`);
          ids.add(st.id);
          const bad: Array<{ at: string; token: string }> = [];
          templateErrors(st, `/spec/steps/${i}`, bad);
          if (bad[0])
            return yield* fail(
              "VALIDATION_FAILED",
              bad[0].at,
              `template '{{${bad[0].token}}}' may only use event.*, member.*, run.id or now`,
            );
          if (st.when !== undefined)
            yield* checkEventCond(
              st.when,
              s.trigger.type === "event" ? s.trigger.event : undefined,
              `/spec/steps/${i}/when`,
            );
          if (st.type === "apply_promotion")
            yield* resolveRef(st.promotion, `/spec/steps/${i}/promotion`, lookup);
        }
        const t = s.trigger;
        if (t.type === "event" && t.filter !== undefined)
          yield* checkEventCond(t.filter, t.event, "/spec/trigger/filter");
        if (s.conditions !== undefined)
          yield* checkEventCond(s.conditions, t.type === "event" ? t.event : undefined, "/spec/conditions");
        if (t.type === "schedule" && parseCron(t.cron) === undefined)
          return yield* fail("VALIDATION_FAILED", "/spec/trigger/cron", `cannot parse cron '${t.cron}'`, {
            expected: "five fields: minute hour day-of-month month day-of-week",
          });
        if (t.type === "metric") {
          const q = t.query;
          if (typeof q === "string" || typeof q.from !== "string")
            return yield* fail(
              "VALIDATION_FAILED",
              "/spec/trigger/query",
              "a metric query must be inline over a source",
            );
          const slug = refSlug(q.from)?.slug ?? "";
          const source = yield* lookup.source(slug);
          if (!source)
            return yield* fail("UNKNOWN_REFERENCE", "/spec/trigger/query/from", `no Source '${slug}'`);
          const cols = typecheckQuery(q, source, slug);
          if (Either.isLeft(cols)) return yield* Effect.fail(cols.left);
          if (!cols.right.some((c) => c.name === t.value_column))
            return yield* fail(
              "VALIDATION_FAILED",
              "/spec/trigger/value_column",
              `the query does not output '${t.value_column}'`,
              { allowed: cols.right.map((c) => c.name).slice(0, 20) },
            );
        }
        return;
      }
      case "Content": {
        const s = body.spec;
        for (const [i, b] of s.blocks.entries()) {
          if (b.type === "panel") yield* resolveRef(b.panel, `/spec/blocks/${i}/panel`, lookup);
          if (b.type === "products") yield* resolveAll(b.products, `/spec/blocks/${i}/products`, lookup);
          if (b.type === "badge") yield* resolveRef(b.badge, `/spec/blocks/${i}/badge`, lookup);
        }
        for (const [i, r] of s.reviewers.entries())
          if (r === s.author)
            return yield* fail(
              "VALIDATION_FAILED",
              `/spec/reviewers/${i}`,
              "a reviewer cannot be the author",
            );
        yield* resolveAll(s.audience.segments, "/spec/audience/segments", lookup);
        yield* resolveAll(s.audience.groups, "/spec/audience/groups", lookup);
        return;
      }
      case "Segment":
        return yield* checkMemberCond(body.spec.rule, "/spec/rule");
      case "Group": {
        const missing = yield* lookup.missingHumans([...body.spec.members, ...body.spec.managers]);
        if (missing[0] !== undefined)
          return yield* fail(
            "UNKNOWN_REFERENCE",
            "/spec/members",
            `'${missing[0]}' is not a human principal`,
          );
        return;
      }
      case "Role": {
        const seen = new Set<string>();
        for (const [i, m] of body.spec.members.entries()) {
          if (seen.has(m.subject))
            return yield* fail(
              "VALIDATION_FAILED",
              `/spec/members/${i}/subject`,
              `duplicate member '${m.subject}'`,
            );
          seen.add(m.subject);
        }
        const missing = yield* lookup.missingHumans(body.spec.members.map((m) => m.subject));
        if (missing[0] !== undefined)
          return yield* fail(
            "UNKNOWN_REFERENCE",
            "/spec/members",
            `'${missing[0]}' is not a human principal`,
          );
        return;
      }
      case "Preference": {
        const owner = body.spec.owner;
        const handle = (yield* lookup.handleOf(owner)) ?? (owner.startsWith("user:") ? owner.slice(5) : "");
        if (handle === "" || body.metadata.slug !== `prefs.${handle}`)
          return yield* fail(
            "VALIDATION_FAILED",
            "/metadata/slug",
            "a Preference slug is prefs.<handle> of its owner",
            { expected: `prefs.${handle}` },
          );
        return;
      }
      case "Program": {
        if (body.metadata.slug !== "rewards")
          return yield* fail("VALIDATION_FAILED", "/metadata/slug", "the Program slug is 'rewards'", {
            expected: "rewards",
          });
        const order = ["bronze", "silver", "gold", "platinum"];
        let prev = -1;
        for (const [i, t] of body.spec.tiers.entries()) {
          if (t.tier !== order[i])
            return yield* fail("VALIDATION_FAILED", `/spec/tiers/${i}/tier`, `tier ${i} must be ${order[i]}`);
          if (i === 0 && t.min_lifetime_points !== 0)
            return yield* fail(
              "VALIDATION_FAILED",
              "/spec/tiers/0/min_lifetime_points",
              "bronze starts at 0",
            );
          if (t.min_lifetime_points <= prev)
            return yield* fail(
              "VALIDATION_FAILED",
              `/spec/tiers/${i}/min_lifetime_points`,
              "tier thresholds must strictly increase",
            );
          prev = t.min_lifetime_points;
        }
        return;
      }
      case "Widget": {
        const owner = (body.spec as { owner?: string }).owner;
        void owner;
        return;
      }
      case "Page": {
        const s = body.spec;
        const seen: Array<{ x: number; y: number; w: number; h: number; item: string }> = [];
        for (const [i, it] of s.layout.items.entries()) {
          yield* resolveRef(it.item, `/spec/layout/items/${i}/item`, lookup);
          const a = it.at;
          if (a.x + a.w > 12)
            return yield* fail(
              "VALIDATION_FAILED",
              `/spec/layout/items/${i}/at`,
              "x + w exceeds the 12 columns",
            );
          for (const o of seen)
            if (a.x < o.x + o.w && o.x < a.x + a.w && a.y < o.y + o.h && o.y < a.y + a.h)
              return yield* fail("VALIDATION_FAILED", `/spec/layout/items/${i}/at`, `overlaps ${o.item}`);
          seen.push({ ...a, item: it.item });
        }
        if (s.kind === "personal") {
          if (s.owner === undefined || s.based_on === undefined)
            return yield* fail(
              "VALIDATION_FAILED",
              "/spec/owner",
              "a personal page needs owner and based_on",
            );
          const handle =
            (yield* lookup.handleOf(s.owner)) ?? (s.owner.startsWith("user:") ? s.owner.slice(5) : "");
          const base = refSlug(s.based_on)?.slug ?? "";
          if (body.metadata.slug !== `${base}.${handle}`)
            return yield* fail(
              "VALIDATION_FAILED",
              "/metadata/slug",
              "a personal page slug is <based_on slug>.<handle>",
              {
                expected: `${base}.${handle}`,
              },
            );
        } else if (s.route !== undefined) {
          const others = yield* lookup.bodies("Page");
          for (const o of others) {
            const os = (o.body as { spec?: { route?: string; kind?: string } }).spec;
            if (o.slug !== body.metadata.slug && os?.kind !== "personal" && os?.route === s.route)
              return yield* fail(
                "VALIDATION_FAILED",
                "/spec/route",
                `route '${s.route}' is used by page '${o.slug}'`,
              );
          }
        }
        return;
      }
    }
  });

export const checkSuiteSemantics = (body: SuiteNodeBody, lookup: Lookup): Check => checkOne(body, lookup);

/** Deletion rules: a system Role or Page cannot be deleted; a Category with active products cannot be deleted. */
export const checkSuiteDelete = (
  kind: Kind,
  before: unknown,
  slug: string,
  lookup: Lookup,
  managedBy?: string,
): Check =>
  Effect.gen(function* () {
    const spec = (before as { spec?: { system?: boolean } } | undefined)?.spec;
    // the one exception: `site.clear` empties the site, system pages included
    if (
      (kind === "Role" || kind === "Page") &&
      spec?.system === true &&
      !(kind === "Page" && managedBy === "site.clear")
    )
      return yield* fail("RULE_REFUSED", "", `a system ${kind} cannot be deleted`, {
        details: { reason: "system" },
      });
    if (kind === "Program")
      return yield* fail("RULE_REFUSED", "", "the Program cannot be deleted", {
        details: { reason: "system" },
      });
    if (kind === "Category") {
      const products = yield* lookup.bodies("Product");
      const used = products.find((p) => {
        const s = (p.body as { spec?: { category?: string; status?: string } }).spec;
        return s?.category === `category:${slug}` && s?.status === "active";
      });
      if (used)
        return yield* fail("RULE_REFUSED", "", `category '${slug}' has active products`, {
          details: { reason: "in_use", product: used.slug },
        });
    }
  });

export type { DomainEventType };
