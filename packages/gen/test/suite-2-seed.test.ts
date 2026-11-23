import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { workspaceId } from "@plinth/core";
import { ControlStore, StoreLive, resetAndSeed, store, verifyDomainChain } from "@plinth/engine";
import { ALL_STEPS, runSuiteSeed } from "../src/suite";

// Needs Postgres (plinth_test) and the whole seed: the catalogue and badge steps must have landed, because promotions
// and content reference categories, products and badges. The marketing and content part of the seeded world (CONTRACT 11).

const WS = workspaceId("northwind");

const counts = <K extends string>(rows: ReadonlyArray<{ k: K; n: string }>) =>
  Object.fromEntries(rows.map((r) => [r.k, Number(r.n)]));

describe("the seeded marketing and content world", () => {
  it.effect("6 segments, 8 promotions, 10 automations and 25 content items in their seeded states", () =>
    Effect.gen(function* () {
      yield* resetAndSeed;
      yield* runSuiteSeed({ steps: ALL_STEPS });
      const { sql } = yield* ControlStore;
      const by = (kind: string, field: string) =>
        store(
          sql<{ k: string; n: string }>`
            SELECT body -> 'spec' ->> ${field} AS k, count(*)::text AS n FROM nodes
            WHERE kind = ${kind} AND deleted_at IS NULL GROUP BY 1`,
        );
      const n = (kind: string) =>
        store(
          sql<{
            n: string;
          }>`SELECT count(*)::text AS n FROM nodes WHERE kind = ${kind} AND deleted_at IS NULL`,
        ).pipe(Effect.map((r) => Number(r[0]?.n)));
      expect(yield* n("Segment")).toBe(6);
      expect(yield* n("Promotion")).toBe(8);
      expect(yield* n("Automation")).toBe(10);
      expect(yield* n("Content")).toBe(25);

      expect(counts((yield* by("Promotion", "status")) as never)).toEqual({
        active: 3,
        scheduled: 1,
        paused: 1,
        draft: 2,
        ended: 1,
      });
      expect(counts((yield* by("Automation", "enabled")) as never)).toEqual({ true: 8, false: 2 });
      expect(counts((yield* by("Content", "status")) as never)).toEqual({
        published: 12,
        approved: 3,
        in_review: 3,
        draft: 4,
        archived: 3,
      });
      const authors = counts((yield* by("Content", "author")) as never);
      expect(authors).toEqual({
        "user:content-editor": 15,
        "user:marketing-lead": 5,
        "user:ops-lead": 3,
        "agent:claude-code": 2,
      });

      // the activation of black-friday-tech stays held, requested by the agent for Maya
      const held = yield* store(
        sql<{ status: string; requester: string; behalf: string; rules: string[] }>`
          SELECT a.status, r.subject AS requester, o.subject AS behalf, a.rule_id AS rules
          FROM change_approvals a JOIN principals r ON r.principal_id = a.requester_id
          LEFT JOIN principals o ON o.principal_id = a.on_behalf_of
          WHERE a.status = 'pending_approval' AND a.rule_id @> ARRAY['R-PROMO-ACTIVATE']::text[]`,
      );
      expect(held).toEqual([
        {
          status: "pending_approval",
          requester: "agent:claude-code",
          behalf: "user:ops-lead",
          rules: ["R-PROMO-ACTIVATE"],
        },
      ]);

      // one item is scheduled for 2026-11-21 09:00, one published page is being revised
      const sched = yield* store(
        sql<{ slug: string }>`
          SELECT slug FROM nodes WHERE kind = 'Content' AND body -> 'spec' ->> 'status' = 'approved'
            AND body -> 'spec' -> 'schedule' ->> 'publish_at' = '2026-11-21T09:00:00Z'`,
      );
      expect(sched).toHaveLength(1);
      const revising = yield* store(
        sql<{ slug: string }>`
          SELECT slug FROM nodes WHERE kind = 'Content' AND body -> 'spec' ->> 'status' = 'draft'
            AND body -> 'spec' ->> 'published_revision' IS NOT NULL`,
      );
      expect(revising).toHaveLength(1);

      // 10 to 38 views per published item
      const views = yield* store(
        sql<{ slug: string; v: string }>`
          SELECT n.slug, coalesce(sum(e.views), 0)::text AS v FROM nodes n
          LEFT JOIN content_engagement e ON e.content_id = n.node_id
          WHERE n.kind = 'Content' AND n.body -> 'spec' ->> 'status' = 'published' GROUP BY n.slug`,
      );
      expect(views).toHaveLength(12);
      for (const v of views) {
        expect(Number(v.v), v.slug).toBeGreaterThanOrEqual(10);
        expect(Number(v.v), v.slug).toBeLessThanOrEqual(38);
      }
      // peak-season-store-15 sits at 78 % of its budget
      const usage = yield* store(
        sql<{ cost: string }>`
          SELECT u.cost_points::text AS cost FROM promotion_usage u JOIN nodes n ON n.node_id = u.promotion_id
          WHERE n.slug = 'peak-season-store-15'`,
      );
      expect(Number(usage[0]?.cost)).toBeGreaterThanOrEqual(Math.round(120_000 * 0.78));
      expect((yield* verifyDomainChain(WS)).ok).toBe(true);
    }).pipe(Effect.provide(StoreLive)),
  );
});
