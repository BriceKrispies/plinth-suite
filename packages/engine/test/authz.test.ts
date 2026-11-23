import { describe, expect, it } from "vitest";
import { workspaceId } from "@plinth/core";
import { SUITE_COMMIT_RULES } from "@plinth/spec";
import { COMMIT_RULE_TABLE, classify } from "../src/rules";
import {
  authorize,
  canonicalResource,
  checkApprover,
  scopeAllows,
  type AuthzSnapshot,
  type AuthzSubject,
  type GrantRec,
} from "../src/authz-core";
import { AGENT_CEILING, seedGrants } from "../src/seed";
import { applyClockAction, virtualAt } from "../src/clock";
import type { Principal } from "../src/identity";

const wsId = workspaceId("northwind");
const base = { workspaceId: wsId, workspaceSlug: "northwind" };
const uri = (kind: string, slug: string) => canonicalResource(base, `plinth://northwind/${kind}/${slug}`);
const finance = uri("Dashboard", "finance-board");
const ops = uri("Dashboard", "ops-board");
const orders = uri("Source", "orders");

let seq = 0;
const grant = (over: Partial<GrantRec> & Pick<GrantRec, "principal" | "actions" | "resource">): GrantRec => ({
  id: `g${++seq}`,
  seq,
  effect: "allow",
  rowPredicate: null,
  columnMask: [],
  expiresAt: null,
  status: "active",
  ...over,
  resource: canonicalResource(base, over.resource),
});
const seeded = (): GrantRec[] =>
  seedGrants("northwind").map((g, i) =>
    grant({
      principal: g.spec.principal,
      actions: g.spec.actions,
      resource: g.spec.resource,
      rowPredicate: g.spec.row_predicate ?? null,
      seq: i + 1,
    }),
  );
const snap = (grants: GrantRec[], v = 1): AuthzSnapshot => ({
  ...base,
  grants,
  grantIndexVersion: v,
  maskVersion: 0,
  now: new Date("2026-11-20T14:30:00Z"),
});
const human = (subject: string): AuthzSubject => ({
  subject,
  kind: "human",
  delegatorSubject: null,
  ceiling: null,
  tokenScope: null,
});
const agent = (tokenScope: string[] | null = null): AuthzSubject => ({
  subject: "agent:claude-code",
  kind: "agent",
  delegatorSubject: "user:ops-lead",
  ceiling: AGENT_CEILING.permissions,
  tokenScope,
});

describe("authorize: combination rules (03 section 3)", () => {
  it("no allow, no access", () => {
    const d = authorize(
      { principal: human("user:nobody"), action: "query:run", resource: orders },
      snap(seeded()),
    );
    expect(d).toMatchObject({ kind: "deny", reason: "no_grant" });
  });
  it("the EMEA lead reads the Ops board with the EMEA predicate, via the dashboard context", () => {
    const d = authorize(
      {
        principal: human("user:emea-lead"),
        action: "query:run",
        resource: orders,
        context: { dashboard: ops },
      },
      snap(seeded()),
    );
    expect(d.kind === "allow" && d.rowPredicate).toBe("(region = 'EMEA')");
  });
  it("without a dashboard context the EMEA lead cannot query a source", () => {
    const d = authorize(
      { principal: human("user:emea-lead"), action: "query:run", resource: orders },
      snap(seeded()),
    );
    expect(d.kind).toBe("deny");
  });
  it("a newer grant on the same principal and resource supersedes the older one (beat 5)", () => {
    const grants = [
      ...seeded(),
      grant({
        principal: "user:emea-lead",
        actions: ["node:read"],
        resource: "plinth://northwind/Dashboard/finance-board",
        rowPredicate: "region = 'EMEA'",
      }),
    ];
    const before = authorize(
      {
        principal: human("user:emea-lead"),
        action: "query:run",
        resource: orders,
        context: { dashboard: finance },
      },
      snap(seeded()),
    );
    const after = authorize(
      {
        principal: human("user:emea-lead"),
        action: "query:run",
        resource: orders,
        context: { dashboard: finance },
      },
      snap(grants, 2),
    );
    expect(before.kind === "allow" && before.rowPredicate).toBeNull();
    expect(after.kind === "allow" && after.rowPredicate).toBe("(region = 'EMEA')");
    // two principals, two policy hashes, and a changed grant index changes the key (cache isolation)
    const finDecision = authorize(
      {
        principal: human("user:finance-analyst"),
        action: "query:run",
        resource: orders,
        context: { dashboard: finance },
      },
      snap(grants, 2),
    );
    expect(
      finDecision.kind === "allow" && after.kind === "allow" && finDecision.policyHash !== after.policyHash,
    ).toBe(true);
    expect(before.kind === "allow" && after.kind === "allow" && before.policyHash !== after.policyHash).toBe(
      true,
    );
  });
  it("deny overrides allow (deny_precedence)", () => {
    const grants = [
      ...seeded(),
      grant({
        principal: "user:finance-analyst",
        effect: "deny",
        actions: ["query:run"],
        resource: "plinth://northwind/Source/orders",
      }),
    ];
    const d = authorize(
      { principal: human("user:finance-analyst"), action: "query:run", resource: orders },
      snap(grants),
    );
    expect(d).toMatchObject({ kind: "deny", reason: "explicit_deny" });
  });
  it("a deny predicate subtracts rows", () => {
    const grants = [
      ...seeded(),
      grant({
        principal: "user:finance-analyst",
        effect: "deny",
        actions: ["query:run"],
        resource: "plinth://northwind/Source/orders",
        rowPredicate: "region = 'APAC'",
      }),
    ];
    const d = authorize(
      { principal: human("user:finance-analyst"), action: "query:run", resource: orders },
      snap(grants),
    );
    expect(d.kind === "allow" && d.rowPredicate).toBe("not (region = 'APAC')");
  });
  it("column masks only restrict (mask_monotone)", () => {
    const grants = [
      ...seeded(),
      grant({
        principal: "user:finance-analyst",
        actions: ["query:run"],
        resource: "plinth://northwind/Source/orders",
        seq: 99,
      }),
      grant({
        principal: "user:finance-analyst",
        effect: "deny",
        actions: ["query:run"],
        resource: "plinth://northwind/Source/orders",
        rowPredicate: "region = 'X'",
        columnMask: ["carrier"],
      }),
    ];
    const d = authorize(
      { principal: human("user:finance-analyst"), action: "query:run", resource: orders },
      snap(grants),
    );
    expect(d.kind === "allow" && d.columnMask).toEqual(["carrier"]);
  });
  it("a pending_approval grant is inert (pending_grant_inert)", () => {
    const pending = grant({
      principal: "user:emea-lead",
      actions: ["query:run"],
      resource: "plinth://northwind/Source/orders",
      status: "pending_approval",
    });
    const without = authorize(
      { principal: human("user:emea-lead"), action: "query:run", resource: orders },
      snap(seeded()),
    );
    const withPending = authorize(
      { principal: human("user:emea-lead"), action: "query:run", resource: orders },
      snap([...seeded(), pending]),
    );
    expect(withPending).toEqual(without);
  });
  it("an expired grant does not match", () => {
    const g = grant({
      principal: "user:emea-lead",
      actions: ["query:run"],
      resource: "plinth://northwind/Source/orders",
      expiresAt: "2026-11-20T14:00:00Z",
    });
    const d = authorize(
      { principal: human("user:emea-lead"), action: "query:run", resource: orders },
      snap([g]),
    );
    expect(d.kind).toBe("deny");
  });
  it("is deterministic", () => {
    const req = { principal: human("user:ops-lead"), action: "query:run", resource: orders };
    const s = snap(seeded());
    expect(authorize(req, s)).toEqual(authorize(req, s));
  });
});

describe("the agent's effective permissions (03 section 5)", () => {
  it("is the intersection of delegator grants, ceiling and token scope", () => {
    const g = seeded();
    expect(authorize({ principal: agent(), action: "query:run", resource: orders }, snap(g)).kind).toBe(
      "allow",
    );
    expect(
      authorize({ principal: agent(["node:read"]), action: "query:run", resource: orders }, snap(g)),
    ).toMatchObject({ kind: "deny", reason: "token_scope_denies" });
    // ops-lead holds grant:write; the agent ceiling never does
    expect(
      authorize({ principal: human("user:ops-lead"), action: "grant:write", resource: finance }, snap(g))
        .kind,
    ).toBe("allow");
    expect(
      authorize({ principal: agent(), action: "grant:write", resource: finance }, snap(g)),
    ).toMatchObject({ kind: "deny", reason: "ceiling_denies", permission: "grant:write" });
    expect(
      authorize({ principal: agent(), action: "approval:decide", resource: finance }, snap(g)),
    ).toMatchObject({ kind: "deny", reason: "ceiling_denies" });
  });
  it("a node:write ceiling entry is kind-specific", () => {
    expect(scopeAllows(AGENT_CEILING.permissions, "node:write", "Panel")).toBe(true);
    expect(scopeAllows(AGENT_CEILING.permissions, "node:write", "Source")).toBe(false);
    expect(scopeAllows(AGENT_CEILING.permissions, "node:write", "Grant")).toBe(false);
  });
  it("a revoked delegation denies", () => {
    expect(
      authorize(
        { principal: { ...agent(), delegatorSubject: null }, action: "query:run", resource: orders },
        snap(seeded()),
      ),
    ).toMatchObject({ reason: "delegation_revoked" });
  });
  it("ceiling_covers: the ceiling holds grant:inspect and grant:propose and not grant:write or approval:decide", () => {
    expect(AGENT_CEILING.permissions).toEqual(expect.arrayContaining(["grant:inspect", "grant:propose"]));
    expect(AGENT_CEILING.permissions).not.toContain("grant:write");
    expect(AGENT_CEILING.permissions).not.toContain("approval:decide");
  });
});

describe("separation of duties (03 section 7.2)", () => {
  const held = {
    requesterSubject: "agent:claude-code",
    requesterKind: "agent" as const,
    onBehalfOfSubject: "user:ops-lead",
    resource: finance,
  };
  const s = () => snap(seeded());
  it("the finance analyst may approve", () => {
    expect(checkApprover(human("user:finance-analyst"), held, s())).toBeUndefined();
  });
  it("the delegator is refused with sod_violation", () => {
    expect(checkApprover(human("user:ops-lead"), held, s())).toMatchObject({ reason: "sod_violation" });
  });
  it("the requester, an agent, and a service are refused", () => {
    expect(checkApprover(agent(), held, s())).toMatchObject({ reason: "sod_violation" });
    expect(checkApprover({ ...human("service:replay-driver"), kind: "service" }, held, s())).toMatchObject({
      reason: "sod_violation",
    });
    expect(checkApprover(human("agent:claude-code"), held, s())).toMatchObject({ reason: "sod_violation" });
  });
  it("an approver without approval:decide and grant:write on the resource is refused (approver_needs_grant_write)", () => {
    const d = checkApprover(human("user:emea-lead"), held, s());
    expect(d).toMatchObject({ kind: "deny" });
  });
});

describe("the commit-rule table (03 section 6)", () => {
  const agentP = { kind: "agent", id: "a" } as Principal;
  const humanP = { kind: "human", id: "h" } as Principal;
  it("has the 21 rows of the closed table with unique ids", () => {
    // 21 kernel rows (ruling 5) plus the Suite rows of CONTRACT 3.8; the table stays closed: every id is unique
    const kernel = COMMIT_RULE_TABLE.filter((r) => !SUITE_COMMIT_RULES.some((s) => s.id === r.id));
    expect(kernel).toHaveLength(21);
    expect(COMMIT_RULE_TABLE).toHaveLength(21 + SUITE_COMMIT_RULES.length);
    expect(new Set(COMMIT_RULE_TABLE.map((r) => r.id)).size).toBe(COMMIT_RULE_TABLE.length);
  });
  const run = (p: Principal, input: Parameters<typeof classify>[1]) => classify(p, input);
  it("classifies each reachable agent write by exactly one row", () => {
    const cases: Array<[Parameters<typeof classify>[1], string, string]> = [
      [{ kind: "Dashboard", create: true, deleted: false, paths: [""] }, "R-DASH-CREATE", "auto"],
      [
        { kind: "Dashboard", create: false, deleted: false, paths: ["/spec/layout/items/0/at"] },
        "R-LAYOUT",
        "auto",
      ],
      [{ kind: "Panel", create: true, deleted: false, paths: [""] }, "R-PANEL-CREATE", "auto"],
      [{ kind: "Panel", create: false, deleted: false, paths: ["/metadata/title"] }, "R-PANEL-EDIT", "auto"],
      [{ kind: "Grant", create: true, deleted: false, paths: [""] }, "R-GRANT", "approval"],
      [
        {
          kind: "Grant",
          create: false,
          deleted: true,
          paths: [""],
          undo: { ofKind: "Grant", ownChange: false },
        },
        "R-GRANT-UNDO",
        "auto",
      ],
      [
        { kind: "Panel", create: false, deleted: true, paths: [""], createdByActor: true },
        "R-DELETE-SESSION",
        "auto",
      ],
      [
        { kind: "Panel", create: false, deleted: true, paths: [""], createdByActor: false },
        "R-DELETE-OTHER",
        "approval",
      ],
      [
        {
          kind: "Panel",
          create: false,
          deleted: false,
          paths: ["/x"],
          undo: { ofKind: "Panel", ownChange: true },
        },
        "R-UNDO-OWN",
        "auto",
      ],
      [
        {
          kind: "Panel",
          create: false,
          deleted: false,
          paths: ["/x"],
          undo: { ofKind: "Panel", ownChange: false },
        },
        "R-UNDO-FOREIGN",
        "approval",
      ],
    ];
    for (const [input, id, decision] of cases) {
      const r = run(agentP, input);
      expect(r._tag, id).toBe("Right");
      if (r._tag === "Right") {
        expect(r.right.rule_id).toEqual([id]);
        expect(r.right.decision).toBe(decision);
      }
    }
  });
  it("refuses a Source change (R-SOURCE) and an unmatched Dashboard edit (R-NO-MATCH) with RULE_REFUSED", () => {
    const a = run(agentP, { kind: "Source", create: false, deleted: false, paths: ["/spec"] });
    const b = run(agentP, { kind: "Dashboard", create: false, deleted: false, paths: ["/metadata/title"] });
    for (const r of [a, b]) {
      expect(r._tag).toBe("Left");
      if (r._tag === "Left") expect(r.left.code).toBe("RULE_REFUSED");
    }
    expect(a._tag === "Left" && a.left.details?.["rule_id"]).toBe("R-SOURCE");
    expect(b._tag === "Left" && b.left.details?.["rule_id"]).toBe("R-NO-MATCH");
  });
  it("holds a human's Grant change too (R-GRANT applies to every principal) but not on the system surface", () => {
    const h = run(humanP, { kind: "Grant", create: true, deleted: false, paths: [""] });
    expect(h._tag === "Right" && h.right.decision).toBe("approval");
    const s = run(humanP, { kind: "Grant", create: true, deleted: false, paths: [""], surface: "system" });
    expect(s._tag === "Right" && s.right.decision).toBe("auto");
    const other = run(humanP, { kind: "Panel", create: true, deleted: false, paths: [""] });
    expect(other._tag === "Right" && other.right.rule_id).toEqual(["R-HUMAN-DIRECT"]);
  });
});

describe("the virtual clock", () => {
  const s0 = {
    virtualRefMs: Date.parse("2026-11-20T14:30:00Z"),
    wallRefMs: 1_000_000,
    speed: 6,
    paused: false,
  };
  it("runs at the configured speed", () => {
    expect(virtualAt(s0, 1_000_000 + 10_000).toISOString()).toBe("2026-11-20T14:31:00.000Z");
  });
  it("pause freezes and resume continues without a jump", () => {
    const paused = applyClockAction(s0, { action: "pause" }, 1_000_000 + 10_000);
    expect(virtualAt(paused, 1_000_000 + 99_000).toISOString()).toBe("2026-11-20T14:31:00.000Z");
    const resumed = applyClockAction(paused, { action: "resume" }, 1_000_000 + 99_000);
    expect(virtualAt(resumed, 1_000_000 + 99_000 + 10_000).toISOString()).toBe("2026-11-20T14:32:00.000Z");
  });
  it("a speed change re-anchors at the current virtual time", () => {
    const fast = applyClockAction(s0, { action: "speed", speed: 12 }, 1_000_000 + 10_000);
    expect(virtualAt(fast, 1_000_000 + 10_000).toISOString()).toBe("2026-11-20T14:31:00.000Z");
    expect(virtualAt(fast, 1_000_000 + 20_000).toISOString()).toBe("2026-11-20T14:33:00.000Z");
  });
});

describe("resource forms", () => {
  it("a slug URI and kind:slug canonicalise to the UUID URI the grant index matches", () => {
    const canonical = canonicalResource(base, "plinth://northwind/Dashboard/finance-board");
    expect(canonicalResource(base, "dashboard:finance-board")).toBe(canonical);
    expect(canonicalResource(base, canonical)).toBe(canonical);
    expect(canonical).toMatch(/^plinth:\/\/northwind\/Dashboard\/[0-9a-f-]{36}$/);
  });
});
