import { describe, expect, it } from "@effect/vitest";
import { Effect, Either } from "effect";
import { nodeId, nodeUri } from "@plinth/core";
import { DomainError, type NodeChange } from "@plinth/spec";
import { ChangeLog, ControlStore, Identity, StoreLive, resetAndSeed } from "../src";

// These tests need the compose stack (Postgres and MinIO). They reset the control store to the seed first.
const panelBody = (slug: string) => ({
  apiVersion: "plinth/v1",
  kind: "Panel",
  metadata: { slug, title: "P95 by region" },
  spec: {
    query: {
      from: "source:orders",
      where: [{ field: "placed_at", op: "gte", value: "now() - 24h" }],
      derive: { latency_ms: "ms(fulfilled_at - placed_at)" },
      group: ["region"],
      aggregate: { p95: "percentile(latency_ms, 0.95)" },
    },
    visual: { type: "bar", channels: { x: "region", y: "p95" }, options: { unit: "ms" } },
  },
});

const create = (ws: string, slug: string): NodeChange => ({
  target: nodeUri("northwind", "Panel", nodeId(ws, "Panel", slug)),
  base_revision: null,
  ops: [{ op: "create", kind: "Panel", slug, body: panelBody(slug) }],
});

const setup = Effect.gen(function* () {
  const { workspaceId } = yield* resetAndSeed;
  const id = yield* Identity;
  return {
    ws: workspaceId,
    human: yield* id.bySubject("user:ops-lead"),
    agent: yield* id.bySubject("agent:claude-code"),
  };
});

describe("commit path", () => {
  it.effect("chain_smoke: a commit links to the previous head and the chain verifies", () =>
    Effect.gen(function* () {
      const { ws, human } = yield* setup;
      const log = yield* ChangeLog;
      const { sql } = yield* ControlStore;
      const before = yield* log.headSeq(ws);
      yield* log.commit({
        actor: { principal: human, surface: "ui" },
        changes: [create(ws, "p95-by-region")],
      });
      const rows = yield* sql<{ seq: string; prev_hash: Buffer; hash: Buffer }>`
        SELECT seq, prev_hash, hash FROM changes WHERE workspace_id = ${ws} ORDER BY seq DESC LIMIT 2`;
      expect(Number(rows[0]?.seq)).toBe(before + 1);
      expect(rows[0]?.prev_hash.equals(rows[1]?.hash ?? Buffer.alloc(0))).toBe(true);
      const v = yield* log.verify(ws);
      expect(v.ok).toBe(true);
      expect(v.checked).toBe(before + 1);
    }).pipe(Effect.provide(StoreLive)),
  );

  it.effect("preview_required_smoke: an agent commit without a valid token fails with PREVIEW_REQUIRED", () =>
    Effect.gen(function* () {
      const { ws, agent } = yield* setup;
      const log = yield* ChangeLog;
      const actor = { principal: agent, surface: "mcp" as const };
      const noToken = yield* log
        .commit({ actor, changes: [create(ws, "p95-by-region")] })
        .pipe(Effect.either);
      expect(Either.isLeft(noToken) && noToken.left instanceof DomainError && noToken.left.code).toBe(
        "PREVIEW_REQUIRED",
      );

      const preview = yield* log.preview(actor, [create(ws, "p95-by-region")]);
      yield* log.commit({ actor, previewToken: preview.preview_token, idempotencyKey: "test:key:0001" });
      // the token is single use
      const again = yield* log
        .commit({ actor, previewToken: preview.preview_token, idempotencyKey: "test:key:0002" })
        .pipe(Effect.either);
      expect(Either.isLeft(again) && again.left instanceof DomainError && again.left.code).toBe(
        "PREVIEW_REQUIRED",
      );
    }).pipe(Effect.provide(StoreLive)),
  );
});
