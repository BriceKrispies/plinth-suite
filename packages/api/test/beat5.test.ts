import { createServer } from "node:http";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { HttpServer } from "@effect/platform";
import { NodeHttpServer } from "@effect/platform-node";
import { nodeId, nodeUri } from "@plinth/core";
import { ChangeLog, EngineLive, Identity, resetAndSeed } from "@plinth/engine";
import { router } from "../src/app";

// Beat 5 and 7 over HTTP: the agent's grant is held, the delegator and the EMEA lead are refused, the finance analyst
// approves, the grant is listed, and the presenter undoes it. Needs Postgres (plinth_test) and object storage.
const Live = HttpServer.serve(router).pipe(
  Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: 0, host: "127.0.0.1" })),
  Layer.provideMerge(EngineLive),
);

const TOKENS = {
  ops: "dev-ops-lead",
  emea: "dev-emea-lead",
  fin: "dev-finance-analyst",
  agent: "dev-agent-claude-code",
};

describe("beat 5 over HTTP", () => {
  it.scoped("a grant naming the board by slug is approved by the finance analyst only", () =>
    Effect.gen(function* () {
      const { workspaceId: ws } = yield* resetAndSeed;
      const server = yield* HttpServer.HttpServer;
      const port = (server.address as { port: number }).port;
      const http = (who: keyof typeof TOKENS, method: string, path: string, body?: unknown) =>
        Effect.promise(async () => {
          const res = await fetch(`http://127.0.0.1:${port}${path}`, {
            method,
            headers: { authorization: `Bearer ${TOKENS[who]}`, "content-type": "application/json" },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
          return { status: res.status, json: (await res.json()) as any };
        });

      const log = yield* ChangeLog;
      const agent = yield* (yield* Identity).bySubject("agent:claude-code");
      const body = {
        apiVersion: "plinth/v1",
        kind: "Grant",
        metadata: { slug: "emea-finance-rows", title: "EMEA rows" },
        spec: {
          principal: "user:emea-lead",
          actions: ["node:read"],
          resource: "finance-board",
          row_predicate: "region = 'EMEA'",
        },
      };
      const actor = { principal: agent, surface: "mcp" as const };
      const pv = yield* log.preview(actor, [
        {
          target: nodeUri("northwind", "Grant", nodeId(ws, "Grant", "emea-finance-rows")),
          base_revision: null,
          ops: [{ op: "create", kind: "Grant", slug: "emea-finance-rows", body }],
        },
      ]);
      const held = yield* log.commit({ actor, previewToken: pv.preview_token, idempotencyKey: "claude-code:http:1" });
      expect(held.status).toBe("pending_approval");
      const id = held.approval_id ?? "";

      for (const who of ["ops", "emea", "agent"] as const) {
        const r = yield* http(who, "POST", `/approvals/${id}/decision`, { decision: "approve" });
        expect(r.status, who).toBe(403);
        expect(r.json.error.code).toBe("FORBIDDEN");
        expect(r.json.error.message.length).toBeGreaterThan(10);
      }
      const sod = yield* http("ops", "POST", `/approvals/${id}/decision`, { decision: "approve" });
      expect(sod.json.error.details.reason).toBe("sod_violation");

      const ok = yield* http("fin", "POST", `/approvals/${id}/decision`, { decision: "approve" });
      expect(ok.status, JSON.stringify(ok.json)).toBe(200);
      expect(ok.json.data.status).toBe("approved");
      const st = yield* http("agent", "GET", `/approvals/${id}`);
      expect(st.json.data.status).toBe("approved");
      expect(st.json.data.approver.principal).toBe("user:finance-analyst");

      const grants = yield* http("fin", "GET", "/nodes?kind=Grant&slug=emea-finance-rows");
      expect(grants.json.data.items).toHaveLength(1);
      expect(grants.json.data.items[0].body.spec.resource).toBe(
        nodeUri("northwind", "Dashboard", nodeId(ws, "Dashboard", "finance-board")),
      );
      const hidden = yield* http("emea", "GET", "/nodes?kind=Grant");
      expect(hidden.json.data.items).toEqual([]);

      const hist = yield* http("ops", "GET", `/history?uri=${encodeURIComponent(grants.json.data.items[0].uri)}`);
      const seq = hist.json.data.items[0].seq as number;
      const undo = yield* http("ops", "POST", `/changes/${seq}/undo`, { reason: "undo the grant" });
      expect(undo.status, JSON.stringify(undo.json)).toBe(200);
      const after = yield* http("fin", "GET", "/nodes?kind=Grant&slug=emea-finance-rows");
      expect(after.json.data.items).toEqual([]);
    }).pipe(Effect.provide(Live)),
  );
});
