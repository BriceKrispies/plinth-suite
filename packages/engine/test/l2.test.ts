import { describe, expect, it } from "@effect/vitest";
import { Effect, Either } from "effect";
import { nodeId, nodeUri } from "@plinth/core";
import { DomainError, PANEL_EXAMPLES, type Kind, type NodeChange } from "@plinth/spec";
import { Authorizer, ChangeLog, Identity, StoreLive, resetAndSeed, type Principal } from "../src";

// These tests need Postgres (the plinth_test database, created by the global setup). They reset it to the seed.
const WS = "northwind";
const uri = (ws: string, kind: Kind, slug: string) => nodeUri(WS, kind, nodeId(ws, kind, slug));
const panelBody = (slug: string, title = "Orders by region") => ({
  ...PANEL_EXAMPLES.bar,
  metadata: { slug, title },
});
const create = (ws: string, kind: Kind, slug: string, body: unknown): NodeChange => ({
  target: uri(ws, kind, slug),
  base_revision: null,
  ops: [{ op: "create", kind, slug, body }],
});
const setPath = (target: string, base: number, path: string, value: unknown): NodeChange => ({
  target,
  base_revision: base,
  ops: [{ op: "set", path, value }],
});

const setup = Effect.gen(function* () {
  const { workspaceId } = yield* resetAndSeed;
  const id = yield* Identity;
  return {
    ws: workspaceId,
    ops: yield* id.bySubject("user:ops-lead"),
    emea: yield* id.bySubject("user:emea-lead"),
    fin: yield* id.bySubject("user:finance-analyst"),
    agent: yield* id.bySubject("agent:claude-code"),
  };
});

const fails = <A>(eff: Effect.Effect<A, unknown, unknown>) =>
  Effect.gen(function* () {
    const r = yield* (eff as Effect.Effect<A, unknown, never>).pipe(Effect.either);
    if (Either.isRight(r)) throw new Error("expected a failure");
    expect(r.left).toBeInstanceOf(DomainError);
    return r.left as DomainError;
  });

const mcp = (p: Principal) => ({ principal: p, surface: "mcp" as const });
const ui = (p: Principal) => ({ principal: p, surface: "ui" as const });

describe("merge rule (spec 05 section 8.4; stale_base_beat)", () => {
  it.effect("disjoint paths rebase, an intersecting path conflicts, an identical edit is a no-op", () =>
    Effect.gen(function* () {
      const { ws, ops, agent } = yield* setup;
      const log = yield* ChangeLog;
      const p = uri(ws, "Panel", "p95-panel");
      yield* log.commit({
        actor: ui(ops),
        changes: [create(ws, "Panel", "p95-panel", panelBody("p95-panel"))],
      });
      // the agent holds revision 1 with a title edit and an options edit
      const held = yield* log.preview(mcp(agent), [
        {
          target: p,
          base_revision: 1,
          ops: [
            { op: "set", path: "/metadata/title", value: "Agent title" },
            { op: "set", path: "/spec/visual/options", value: { unit: "ms" } },
          ],
        },
      ]);
      // the presenter edits the title: revision 2
      yield* log.commit({
        actor: ui(ops),
        changes: [setPath(p, 1, "/metadata/title", "Fulfilment p95, live")],
      });
      const conflict = yield* fails(
        log.commit({
          actor: mcp(agent),
          previewToken: held.preview_token,
          idempotencyKey: "claude-code:s1:6.1",
        }),
      );
      expect(conflict.code).toBe("CONFLICT");
      expect(conflict.details).toMatchObject({
        conflicting_paths: ["/metadata/title"],
        head_revision: 2,
        head_values_at_paths: { "/metadata/title": "Fulfilment p95, live" },
        your_values_at_paths: { "/metadata/title": "Agent title" },
      });
      // the token stays unconsumed after a CONFLICT: no row was written
      const head = yield* log.getNode(ops, p);
      expect(head.revision).toBe(2);
      // the agent re-previews only the disjoint path from its stale base and the commit rebases
      const second = yield* log.preview(mcp(agent), [setPath(p, 1, "/spec/visual/options", { unit: "ms" })]);
      const done = yield* log.commit({
        actor: mcp(agent),
        previewToken: second.preview_token,
        idempotencyKey: "claude-code:s1:6.2",
      });
      expect(done.merged_from).toMatchObject({ base: 1, head: 2, rebased_paths: ["/spec/visual/options"] });
      const after = yield* log.getNode(ops, p);
      expect(after.revision).toBe(3);
      expect((after.body as { metadata: { title: string } }).metadata.title).toBe("Fulfilment p95, live");
      // identical edit: nothing to write
      const same = yield* log.preview(mcp(agent), [setPath(p, 1, "/metadata/title", "Fulfilment p95, live")]);
      const noop = yield* log.commit({
        actor: mcp(agent),
        previewToken: same.preview_token,
        idempotencyKey: "claude-code:s1:6.3",
      });
      expect(noop.nodes).toEqual([]);
      expect((yield* log.getNode(ops, p)).revision).toBe(3);
      expect((yield* log.verify(ws)).ok).toBe(true);
    }).pipe(Effect.provide(StoreLive)),
  );
});

describe("idempotency", () => {
  it.effect(
    "the same key and request replays; the same key with another request is IDEMPOTENCY_KEY_REUSED",
    () =>
      Effect.gen(function* () {
        const { ws, agent } = yield* setup;
        const log = yield* ChangeLog;
        const a = yield* log.preview(mcp(agent), [create(ws, "Panel", "idem-a", panelBody("idem-a"))]);
        const first = yield* log.commit({
          actor: mcp(agent),
          previewToken: a.preview_token,
          idempotencyKey: "claude-code:idem:1",
        });
        const again = yield* log.commit({
          actor: mcp(agent),
          previewToken: a.preview_token,
          idempotencyKey: "claude-code:idem:1",
        });
        expect(again.replayed).toBe(true);
        expect(again.change_seq).toBe(first.change_seq);
        const b = yield* log.preview(mcp(agent), [create(ws, "Panel", "idem-b", panelBody("idem-b"))]);
        const reused = yield* fails(
          log.commit({
            actor: mcp(agent),
            previewToken: b.preview_token,
            idempotencyKey: "claude-code:idem:1",
          }),
        );
        expect(reused.code).toBe("IDEMPOTENCY_KEY_REUSED");
      }).pipe(Effect.provide(StoreLive)),
  );
});

describe("commit rules and authorization at preview", () => {
  it.effect("an agent change to a Source is RULE_REFUSED (R-SOURCE)", () =>
    Effect.gen(function* () {
      const { ws, agent } = yield* setup;
      const log = yield* ChangeLog;
      const e = yield* fails(
        log.preview(mcp(agent), [setPath(uri(ws, "Source", "orders"), 1, "/spec/domain", "x")]),
      );
      expect(e.code).toBe("RULE_REFUSED");
      expect(e.details).toMatchObject({ rule_id: "R-SOURCE" });
    }).pipe(Effect.provide(StoreLive)),
  );
  it.effect("a preview reports the rule id and an auto decision for a panel create", () =>
    Effect.gen(function* () {
      const { ws, agent } = yield* setup;
      const log = yield* ChangeLog;
      const r = yield* log.preview(mcp(agent), [create(ws, "Panel", "rule-p", panelBody("rule-p"))]);
      expect(r.rule_id).toEqual(["R-PANEL-CREATE"]);
      expect(r.decision).toBe("auto");
    }).pipe(Effect.provide(StoreLive)),
  );
  it.effect("a human without node:write is FORBIDDEN, and cannot read what they have no grant for", () =>
    Effect.gen(function* () {
      const { ws, emea, fin, ops } = yield* setup;
      const log = yield* ChangeLog;
      const e = yield* fails(
        log.commit({ actor: ui(emea), changes: [create(ws, "Panel", "no-write", panelBody("no-write"))] }),
      );
      expect(e.code).toBe("FORBIDDEN");
      expect(e.details).toMatchObject({ permission: "node:write" });
      // reads follow grants: the EMEA lead sees two dashboards and no Grant nodes; finance sees the finance board only
      expect((yield* log.listNodes(emea, "Dashboard")).map((d) => d.slug).sort()).toEqual([
        "finance-board",
        "ops-board",
      ]);
      expect((yield* log.listNodes(fin, "Dashboard")).map((d) => d.slug)).toEqual(["finance-board"]);
      expect(yield* log.listNodes(emea, "Grant")).toEqual([]);
      expect((yield* log.listNodes(ops, "Grant")).length).toBeGreaterThan(0);
      const hidden = yield* fails(log.getNode(fin, uri(ws, "Dashboard", "ops-board")));
      expect(hidden.code).toBe("UNKNOWN_REFERENCE");
    }).pipe(Effect.provide(StoreLive)),
  );
  it.effect("resolve accepts kind:slug and a bare slug, and reports ambiguity and near misses", () =>
    Effect.gen(function* () {
      const { ops } = yield* setup;
      const log = yield* ChangeLog;
      expect((yield* log.resolve(ops, "dashboard:ops-board")).slug).toBe("ops-board");
      expect((yield* log.resolve(ops, "ops-board")).kind).toBe("Dashboard");
      const miss = yield* fails(log.resolve(ops, "ops-bard"));
      expect(miss.did_you_mean).toContain("ops-board");
      const bad = yield* fails(log.resolve(ops, "dashbord:ops-board"));
      expect(bad.did_you_mean).toContain("Dashboard");
      const found = yield* log.search(ops, { text: "finance" });
      expect(found.map((f) => f.slug)).toEqual(
        expect.arrayContaining(["finance-board", "finance-revenue-by-region"]),
      );
    }).pipe(Effect.provide(StoreLive)),
  );
});

describe("undo (appends inverse ops)", () => {
  it.effect("undoes the agent's own create, refuses when a later change touched the same paths", () =>
    Effect.gen(function* () {
      const { ws, ops, agent } = yield* setup;
      const log = yield* ChangeLog;
      const make = yield* log.preview(mcp(agent), [create(ws, "Panel", "undo-me", panelBody("undo-me"))]);
      const made = yield* log.commit({
        actor: mcp(agent),
        previewToken: make.preview_token,
        idempotencyKey: "claude-code:undo:1",
      });
      const seq = made.change_seq ?? 0;
      const target = uri(ws, "Panel", "undo-me");
      const edit = yield* log.commit({
        actor: ui(ops),
        changes: [setPath(target, 1, "/metadata/title", "Edited")],
      });
      expect(edit.nodes?.[0]?.result_revision).toBe(2);
      const blocked = yield* fails(log.buildUndo(agent, seq));
      expect(blocked.code).toBe("CONFLICT");
      expect(blocked.details).toMatchObject({ later_change_seq: edit.change_seq });
      // an edit with no later change undoes cleanly
      const e2 = yield* log.preview(mcp(agent), [setPath(target, 2, "/spec/visual/options", { unit: "ms" })]);
      const c2 = yield* log.commit({
        actor: mcp(agent),
        previewToken: e2.preview_token,
        idempotencyKey: "claude-code:undo:2",
      });
      const inverse = yield* log.buildUndo(agent, c2.change_seq ?? 0);
      const pv = yield* log.preview(mcp(agent), [inverse], { undoOf: c2.change_seq ?? 0 });
      expect(pv.rule_id).toEqual(["R-UNDO-OWN"]);
      yield* log.commit({
        actor: mcp(agent),
        previewToken: pv.preview_token,
        idempotencyKey: "claude-code:undo:3",
        expect: { undoOf: c2.change_seq ?? 0 },
      });
      const hist = yield* log.history(ops, { uri: target });
      expect(hist[0]?.undo_of).toBe(c2.change_seq);
      expect((yield* log.verify(ws)).ok).toBe(true);
    }).pipe(Effect.provide(StoreLive)),
  );
});

describe("approval flow (beat 5 and 7)", () => {
  it.effect(
    "the agent's grant is held, only the finance analyst can approve, the grant narrows the Exec view, undo restores it",
    () =>
      Effect.gen(function* () {
        const { ws, ops, emea, fin, agent } = yield* setup;
        const log = yield* ChangeLog;
        const authz = yield* Authorizer;
        const financeBoard = uri(ws, "Dashboard", "finance-board");
        const orders = uri(ws, "Source", "orders");
        const rowsFor = (p: Principal) =>
          authz
            .authorize(p, "query:run", orders, { dashboard: financeBoard })
            .pipe(
              Effect.map((d) =>
                d.kind === "allow" ? { predicate: d.rowPredicate, hash: d.policyHash } : undefined,
              ),
            );
        const beforeEmea = yield* rowsFor(emea);
        expect(beforeEmea?.predicate).toBeNull();

        const grantBody = {
          apiVersion: "plinth/v1",
          kind: "Grant",
          metadata: { slug: "emea-finance-rows", title: "EMEA rows on finance" },
          spec: {
            principal: "user:emea-lead",
            effect: "allow",
            actions: ["node:read"],
            resource: "plinth://northwind/Dashboard/finance-board",
            row_predicate: "region = 'EMEA'",
          },
        };
        const pv = yield* log.preview(mcp(agent), [create(ws, "Grant", "emea-finance-rows", grantBody)]);
        expect(pv.decision).toBe("approval");
        expect(pv.rule_id).toEqual(["R-GRANT"]);
        const held = yield* log.commit({
          actor: mcp(agent),
          previewToken: pv.preview_token,
          idempotencyKey: "claude-code:grant:1",
        });
        expect(held.status).toBe("pending_approval");
        expect(held.approval_id).toBeDefined();
        expect(held.nodes).toBeUndefined();
        expect(yield* log.findBySlug(ops, "Grant", "emea-finance-rows")).toBeUndefined(); // agent_grant_held
        expect((yield* rowsFor(emea))?.predicate).toBeNull(); // pending_grant_inert
        const approvalId = held.approval_id ?? "";
        expect((yield* log.status(agent, { approval_id: approvalId })).status).toBe("pending_approval");

        // separation of duties: the delegator, the agent and the EMEA lead are refused; the grant stays held
        for (const who of [ops, agent, emea]) {
          const e = yield* fails(log.decideApproval(who, approvalId, "approve"));
          expect(e.code).toBe("FORBIDDEN");
        }
        const sod = yield* fails(log.decideApproval(ops, approvalId, "approve"));
        expect(sod.details).toMatchObject({ reason: "sod_violation" });
        expect(yield* log.findBySlug(ops, "Grant", "emea-finance-rows")).toBeUndefined();

        // the finance analyst approves: the grant commits as a Change by the approver
        const decided = yield* log.decideApproval(fin, approvalId, "approve");
        expect(decided.status).toBe("approved");
        const st = yield* log.status(agent, { approval_id: approvalId });
        expect(st.status).toBe("approved");
        expect(st.approver?.principal).toBe("user:finance-analyst");
        const grant = yield* log.findBySlug(ops, "Grant", "emea-finance-rows");
        expect(grant).toBeDefined();
        const hist = yield* log.history(ops, { uri: grant?.uri });
        expect(hist[0]).toMatchObject({
          actor: "user:finance-analyst",
          approved_by: "user:finance-analyst",
          on_behalf_of: "agent:claude-code",
        });

        // the per-principal cache key: the EMEA lead's policy changed, the analyst's did not
        const afterEmea = yield* rowsFor(emea);
        expect(afterEmea?.predicate).toBe("(region = 'EMEA')");
        expect(afterEmea?.hash).not.toBe(beforeEmea?.hash);
        expect((yield* rowsFor(fin))?.predicate).toBeNull();
        expect((yield* rowsFor(fin))?.hash).not.toBe(afterEmea?.hash);

        // a second decision on a decided approval conflicts
        const twice = yield* fails(log.decideApproval(fin, approvalId, "approve"));
        expect(twice.code).toBe("CONFLICT");

        // the agent cannot undo it (R-GRANT-UNDO needs grant:write); the presenter can, without a second approval
        const seq = hist[0]?.seq ?? 0;
        const agentUndo = yield* fails(
          log
            .buildUndo(agent, seq)
            .pipe(Effect.flatMap((c) => log.preview(mcp(agent), [c], { undoOf: seq }))),
        );
        expect(agentUndo.code).toBe("FORBIDDEN");
        expect(agentUndo.details).toMatchObject({ permission: "grant:write" });
        const inverse = yield* log.buildUndo(ops, seq);
        const undone = yield* log.commit({ actor: ui(ops), changes: [inverse], undoOf: seq, reason: "undo" });
        expect(undone.status).toBe("committed");
        expect((yield* rowsFor(emea))?.predicate).toBeNull();
        const undoRow = (yield* log.history(ops, { uri: grant?.uri }))[0];
        expect(undoRow).toMatchObject({ undo_of: seq, rule_id: ["R-GRANT-UNDO"] });
        expect((yield* log.verify(ws)).ok).toBe(true);
      }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("a rejected approval applies nothing, and a human's grant is held too", () =>
    Effect.gen(function* () {
      const { ws, ops, fin } = yield* setup;
      const log = yield* ChangeLog;
      const body = {
        apiVersion: "plinth/v1",
        kind: "Grant",
        metadata: { slug: "ops-extra", title: "extra" },
        spec: {
          principal: "user:emea-lead",
          actions: ["node:read"],
          resource: "plinth://northwind/Dashboard/finance-board",
        },
      };
      const held = yield* log.commit({ actor: ui(ops), changes: [create(ws, "Grant", "ops-extra", body)] });
      expect(held.status).toBe("pending_approval");
      const r = yield* log.decideApproval(fin, held.approval_id ?? "", "reject", "not now");
      expect(r.status).toBe("rejected");
      expect(yield* log.findBySlug(ops, "Grant", "ops-extra")).toBeUndefined();
      expect((yield* log.status(ops, { approval_id: held.approval_id ?? "" })).status).toBe("rejected");
    }).pipe(Effect.provide(StoreLive)),
  );
});

describe("history, diff, revisions", () => {
  it.effect("replays revisions and diffs them", () =>
    Effect.gen(function* () {
      const { ws, ops } = yield* setup;
      const log = yield* ChangeLog;
      const target = uri(ws, "Panel", "rev-panel");
      yield* log.commit({
        actor: ui(ops),
        changes: [create(ws, "Panel", "rev-panel", panelBody("rev-panel", "One"))],
      });
      yield* log.commit({ actor: ui(ops), changes: [setPath(target, 1, "/metadata/title", "Two")] });
      const v1 = yield* log.bodyAt(ops, target, 1);
      expect((v1 as { metadata: { title: string } }).metadata.title).toBe("One");
      const d = yield* log.diffRevisions(ops, { uri: target, revision: 1 }, { uri: target, revision: 2 });
      expect(d.changed_paths).toEqual(["/metadata/title"]);
      const hist = yield* log.history(ops, { uri: target });
      expect(hist.map((h) => h.ops_summary)).toEqual(["set /metadata/title (1)", "create (1)"]);
    }).pipe(Effect.provide(StoreLive)),
  );
});
