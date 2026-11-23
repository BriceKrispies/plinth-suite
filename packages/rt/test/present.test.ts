import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import WebSocket from "ws";
import { AppConfig, ControlStore, EngineLive, PRESENT_CHANNEL, resetAndSeed } from "@plinth/engine";
import { gateway } from "../src/gateway";

// ui.present reaches browsers (CONTRACT 6.3): the gateway LISTENs on plinth_present and sends a `present` frame to
// the sockets of the addressed principal that can read the node. Needs Postgres (plinth_test).
const PORT = 59377;
const TOKENS = { ops: "dev-ops-lead", emea: "dev-emea-lead", fin: "dev-finance-analyst" };

interface Client {
  readonly frames: Array<Record<string, any>>;
  /** Resolves with the first present frame whose canonical node URI contains `node` (a `/Kind/` segment). */
  readonly present: (node: string) => Promise<Record<string, any>>;
  readonly close: () => void;
}

const connect = (token: string) =>
  Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<Client>((resolve) => {
          const ws = new WebSocket(`ws://127.0.0.1:${PORT}/rt`);
          const frames: Array<Record<string, any>> = [];
          const waiters: Array<(f: Record<string, any>) => boolean> = [];
          ws.on("message", (d) => {
            const f = JSON.parse(d.toString());
            frames.push(f);
            if (f.t === "welcome")
              resolve({
                frames,
                close: () => ws.close(),
                present: (node) =>
                  new Promise((res) => {
                    const hit = frames.find((x) => x.t === "present" && x.node.includes(node));
                    if (hit) return res(hit);
                    waiters.push((x) =>
                      x.t === "present" && x.node.includes(node) ? (res(x), true) : false,
                    );
                  }),
              });
            for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i]?.(f)) waiters.splice(i, 1);
          });
          ws.on("open", () => ws.send(JSON.stringify({ t: "hello", protocol: 1, token })));
        }),
    ),
    (c) => Effect.sync(() => c.close()),
  );

describe("ui.present over the realtime gateway", () => {
  it.scoped("reaches the addressed principal's socket and never one that cannot read the node", () =>
    Effect.gen(function* () {
      yield* resetAndSeed;
      const cfg = yield* AppConfig;
      const { sql } = yield* ControlStore;
      yield* Effect.forkScoped(
        gateway.pipe(Effect.provideService(AppConfig, { ...cfg, ports: { ...cfg.ports, rt: PORT } })),
      );
      const ws =
        (yield* sql<{ workspace_id: string }>`SELECT workspace_id FROM workspaces LIMIT 1`)[0]
          ?.workspace_id ?? "";

      const ops = yield* connect(TOKENS.ops);
      const emea = yield* connect(TOKENS.emea);
      const fin = yield* connect(TOKENS.fin);

      const notify = (node: string, target: string) =>
        sql`SELECT pg_notify(${PRESENT_CHANNEL}, ${JSON.stringify({
          ws,
          node,
          target,
          focus: { parameter: "region", value: "EMEA" },
          by: "agent:claude-code",
          owners: ["user:ops-lead", "user:emea-lead"],
        })})`;

      // frames name the canonical node URI (plinth://ws/Kind/<node id>), not the slug.
      // a Grant node: the ops lead can read it, the EMEA lead has no grant on Grants, the analyst is not an owner
      yield* notify("grant:ops-lead-all", "all");
      const got = yield* Effect.promise(() => ops.present("/Grant/"));
      expect(got["by"]).toBe("agent:claude-code");
      expect(got["focus"]).toEqual({ parameter: "region", value: "EMEA" });
      expect(Number.isNaN(Date.parse(got["at"]))).toBe(false);

      // a node both owners can read, addressed to the EMEA lead alone
      yield* notify("dashboard:ops-board", "principal:user:emea-lead");
      yield* Effect.promise(() => emea.present("/Dashboard/"));

      // frames arrive in order on one socket: having seen the second, the first would already be here
      expect(emea.frames.some((f) => f.t === "present" && f.node.includes("/Grant/"))).toBe(false);
      expect(fin.frames.some((f) => f.t === "present")).toBe(false);
      expect(ops.frames.some((f) => f.t === "present" && f.node.includes("/Dashboard/"))).toBe(false);
    }).pipe(Effect.provide(EngineLive)),
  );
});
