import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { PANEL_EXAMPLES } from "@plinth/spec";
import { EngineLive, Identity, resetAndSeed, type Principal } from "@plinth/engine";
import { callTool } from "../src/tools";

// Drives the tools as the agent does, through the envelope. Needs Postgres (plinth_test); no object storage reads.
interface Data {
  readonly [k: string]: any;
}
const call = (p: Principal, tool: string, args: unknown) =>
  callTool(p, tool, args).pipe(
    Effect.map((env) => ({ env, data: (env.data ?? {}) as Data, error: env.error })),
  );

const setup = Effect.gen(function* () {
  yield* resetAndSeed;
  const id = yield* Identity;
  return {
    agent: yield* id.bySubject("agent:claude-code"),
    ops: yield* id.bySubject("user:ops-lead"),
    fin: yield* id.bySubject("user:finance-analyst"),
  };
});

const panelSpec = (title: string) => ({ metadata: { slug: title, title }, spec: PANEL_EXAMPLES.bar.spec });
let n = 0;
const key = () => `claude-code:flow:${++n}`;

describe("the agent loop over MCP tools", () => {
  it.effect("schema.describe lists kinds and serves a complete Panel example", () =>
    Effect.gen(function* () {
      const { agent } = yield* setup;
      const kinds = yield* call(agent, "schema.describe", {});
      expect(kinds.env.ok).toBe(true);
      expect(kinds.data["kinds"]).toHaveLength(28);
      const panel = yield* call(agent, "schema.describe", { kind: "Panel" });
      expect(panel.data["example"].spec.visual.type).toBe("line");
      expect(panel.data["examples_by_visual"].heatmap.spec.visual.type).toBe("heatmap");
      const bytes = Buffer.byteLength(JSON.stringify(panel.data));
      expect(bytes).toBeLessThan(16_384);
    }).pipe(Effect.provide(EngineLive)),
  );

  it.effect(
    "previews a panel without apiVersion, kind or place.at; auto-places panels one under the other",
    () =>
      Effect.gen(function* () {
        const { agent, ops } = yield* setup;
        for (const slug of ["first-panel", "second-panel"]) {
          const pv = yield* call(agent, "node.preview", {
            kind: "Panel",
            body: panelSpec(slug),
            place: { dashboard: "ops-board" },
          });
          expect(pv.env.ok, JSON.stringify(pv.error)).toBe(true);
          expect(pv.data["decision"]).toBe("auto");
          const done = yield* call(agent, "node.commit", {
            preview_token: pv.data["preview_token"],
            idempotency_key: key(),
          });
          expect(done.data["status"]).toBe("committed");
        }
        const board = yield* call(ops, "node.get", { uri: "dashboard:ops-board" });
        expect(board.data["body"].spec.layout.items.map((i: { at: unknown }) => i.at)).toEqual([
          { x: 0, y: 0, w: 12, h: 6 },
          { x: 0, y: 6, w: 12, h: 6 },
        ]);
        const old = yield* call(ops, "node.get", { uri: "ops-board", at_revision: 1 });
        expect(old.data["body"].spec.layout.items).toEqual([]);
        const found = yield* call(agent, "node.search", { text: "second" });
        expect(found.data["items"].map((i: { slug: string }) => i.slug)).toEqual(["second-panel"]);
      }).pipe(Effect.provide(EngineLive)),
  );

  it.effect("errors carry a message, expected, allowed and did_you_mean", () =>
    Effect.gen(function* () {
      const { agent } = yield* setup;
      const unknown = yield* call(agent, "node.preview", {
        kind: "Panel",
        body: {
          metadata: { slug: "bad-visual", title: "T" },
          spec: {
            ...PANEL_EXAMPLES.bar.spec,
            visual: { type: "bar", channels: { x: "region", y: "orders", colour: "x" } },
          },
        },
      });
      expect(unknown.error?.code).toBe("UNKNOWN_FIELD");
      expect(unknown.error?.message.length).toBeGreaterThan(10);
      expect(unknown.error?.allowed).toEqual(expect.arrayContaining(["x", "y"]));
      expect(unknown.error?.did_you_mean).toContain("color");
      const version = yield* call(agent, "node.preview", {
        kind: "Panel",
        body: { apiVersion: "v9", metadata: { slug: "x1", title: "T" }, spec: {} },
      });
      expect(version.error?.code).toBe("VALIDATION_FAILED");
      expect(version.error?.message).toContain("plinth/v1");
      const conflict = yield* call(agent, "node.preview", {
        kind: "Panel",
        body: { kind: "Dashboard", metadata: { slug: "x2", title: "T" }, spec: {} },
      });
      expect(conflict.error?.path).toBe("/body/kind");
      const topLevel = yield* call(agent, "node.preview", { kind: "Panel", bodyy: {} });
      expect(topLevel.error?.code).toBe("UNKNOWN_FIELD");
      expect(topLevel.error?.did_you_mean).toContain("body");
      const noPlace = yield* call(agent, "node.get", { uri: "no-such-board" });
      expect(noPlace.error?.code).toBe("UNKNOWN_REFERENCE");
      expect(noPlace.error?.allowed).toContain("ops-board");
      const refused = yield* call(agent, "node.preview", {
        kind: "Source",
        uri: "source:orders",
        base_revision: 1,
        patch: [{ op: "replace", path: "/spec/domain", value: "x" }],
      });
      expect(refused.error?.code).toBe("RULE_REFUSED");
    }).pipe(Effect.provide(EngineLive)),
  );

  it.effect(
    "a grant is held for a person; the agent follows it with change.status and cannot decide it",
    () =>
      Effect.gen(function* () {
        const { agent } = yield* setup;
        const pv = yield* call(agent, "node.preview", {
          kind: "Grant",
          body: {
            principal: "user:emea-lead",
            action: "node:read",
            resource: "dashboard:finance-board",
            row_predicate: "region = 'EMEA'",
          },
        });
        expect(pv.env.ok, JSON.stringify(pv.error)).toBe(true);
        expect(pv.data["decision"]).toBe("approval");
        expect(pv.data["rule_id"]).toEqual(["R-GRANT"]);
        const held = yield* call(agent, "node.commit", {
          preview_token: pv.data["preview_token"],
          idempotency_key: key(),
        });
        expect(held.data["status"]).toBe("pending_approval");
        expect(held.data["approval_id"]).toBeDefined();
        const st = yield* call(agent, "change.status", { approval_id: held.data["approval_id"] });
        expect(st.data["status"]).toBe("pending_approval");
        expect(st.data["requested_by"]).toBe("agent:claude-code");
        expect(st.data["on_behalf_of"]).toBe("user:ops-lead");
        const both = yield* call(agent, "change.status", {
          approval_id: held.data["approval_id"],
          change_id: 1,
        });
        expect(both.error?.code).toBe("VALIDATION_FAILED");
      }).pipe(Effect.provide(EngineLive)),
  );

  it.effect("grant.check has the same keys whether the target exists, is visible or withheld", () =>
    Effect.gen(function* () {
      const { agent } = yield* setup;
      const args = { resource: "dashboard:finance-board", action: "node:read" };
      const own = yield* call(agent, "grant.check", args);
      const other = yield* call(agent, "grant.check", { ...args, principal: "user:emea-lead" });
      const ghost = yield* call(agent, "grant.check", { ...args, principal: "user:nobody" });
      const keys = Object.keys(own.data).sort();
      expect(keys).toEqual([
        "action",
        "decision",
        "policy",
        "principal",
        "reason_code",
        "resource",
        "row_counts",
      ]);
      expect(Object.keys(other.data).sort()).toEqual(keys);
      expect(Object.keys(ghost.data).sort()).toEqual(keys);
      expect(own.data["decision"]).toBe("allow");
      // the agent holds grant:inspect through its ceiling and the delegator's grant on the workspace
      expect(other.data["decision"]).toBe("allow");
      const proposed = yield* call(agent, "grant.check", {
        ...args,
        principal: "user:emea-lead",
        proposed: { row_predicate: "region = 'EMEA'" },
      });
      expect(proposed.data["decision"]).toBe("allow_with");
      expect(proposed.data["row_counts"]).toBeNull();
    }).pipe(Effect.provide(EngineLive)),
  );

  it.effect("history, diff, delete and undo through tokens", () =>
    Effect.gen(function* () {
      const { agent } = yield* setup;
      const mk = yield* call(agent, "node.preview", { kind: "Panel", body: panelSpec("tmp-panel") });
      const made = yield* call(agent, "node.commit", {
        preview_token: mk.data["preview_token"],
        idempotency_key: key(),
      });
      const seq = made.data["change_seq"] as number;
      const ed = yield* call(agent, "node.preview", {
        kind: "Panel",
        uri: "panel:tmp-panel",
        base_revision: 1,
        patch: [{ op: "replace", path: "/metadata/title", value: "Renamed" }],
      });
      const edited = yield* call(agent, "node.commit", {
        preview_token: ed.data["preview_token"],
        idempotency_key: key(),
      });
      const d = yield* call(agent, "diff", { a: "panel:tmp-panel@1", b: "panel:tmp-panel@2" });
      expect(d.data["changed_paths"]).toEqual(["/metadata/title"]);
      const hist = yield* call(agent, "change.history", { uri: "panel:tmp-panel" });
      expect(hist.data["items"].map((i: { seq: number }) => i.seq)).toEqual([edited.data["change_seq"], seq]);
      const undo = yield* call(agent, "node.preview", { kind: "Panel", undo_of: edited.data["change_seq"] });
      expect(undo.data["rule_id"]).toEqual(["R-UNDO-OWN"]);
      const undone = yield* call(agent, "node.undo", {
        preview_token: undo.data["preview_token"],
        change_seq: edited.data["change_seq"],
        base_revision: 2,
        reason: "revert rename",
      });
      expect(undone.data["status"]).toBe("committed");
      const del = yield* call(agent, "node.preview", {
        kind: "Panel",
        uri: "panel:tmp-panel",
        base_revision: 3,
        delete: true,
      });
      expect(del.data["rule_id"]).toEqual(["R-DELETE-SESSION"]);
      const gone = yield* call(agent, "node.delete", {
        preview_token: del.data["preview_token"],
        uri: "panel:tmp-panel",
        base_revision: 3,
        reason: "cleanup",
      });
      expect(gone.data["deleted"]).toBe(true);
      const after = yield* call(agent, "node.get", { uri: "panel:tmp-panel" });
      expect(after.error?.code).toBe("UNKNOWN_REFERENCE");
      // a token that stages something else cannot be used for node.delete
      const other = yield* call(agent, "node.preview", { kind: "Panel", body: panelSpec("other-panel") });
      yield* call(agent, "node.commit", {
        preview_token: other.data["preview_token"],
        idempotency_key: key(),
      });
      const rename = yield* call(agent, "node.preview", {
        kind: "Panel",
        uri: "panel:other-panel",
        base_revision: 1,
        patch: [{ op: "replace", path: "/metadata/title", value: "Renamed" }],
      });
      const wrong = yield* call(agent, "node.delete", {
        preview_token: rename.data["preview_token"],
        uri: "panel:other-panel",
        base_revision: 1,
        reason: "x",
      });
      expect(wrong.error?.code).toBe("PREVIEW_REQUIRED");
    }).pipe(Effect.provide(EngineLive)),
  );

  it.effect("an agent write without a token is PREVIEW_REQUIRED", () =>
    Effect.gen(function* () {
      const { agent } = yield* setup;
      const r = yield* call(agent, "node.commit", { idempotency_key: key() });
      expect(r.error?.code).toBe("PREVIEW_REQUIRED");
      expect(r.env.next[0]?.tool).toBe("node.preview");
    }).pipe(Effect.provide(EngineLive)),
  );
});
