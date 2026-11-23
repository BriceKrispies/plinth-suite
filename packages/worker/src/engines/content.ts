import { Effect } from "effect";
import { ControlStore, Identity, store, transitionContent } from "@plinth/engine";
import type { TickHook } from "../hooks";

/**
 * Content scheduling (CONTRACT.md section 10.3). At each virtual minute publish the `approved` Content whose
 * `schedule.publish_at` has passed, and archive the `published` whose `schedule.unpublish_at` has passed. Both commit
 * through the change log as `service:scheduler` with `managed: { by: "content.transition" }`, append the review log
 * entry and emit `content.state_changed` (and `content.published`, with its notifications). Idempotent: once published
 * the item no longer matches the query.
 */
export const contentSchedule: TickHook = (_tick, ctx) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const identity = yield* Identity;
    const now = ctx.now.toISOString();
    const due = yield* store(
      sql<{ slug: string; revision: string; action: "publish" | "archive" }>`
        SELECT slug, revision::text AS revision, 'publish' AS action FROM nodes
        WHERE workspace_id = ${ctx.workspaceId} AND kind = 'Content' AND deleted_at IS NULL
          AND body -> 'spec' ->> 'status' = 'approved' AND body -> 'spec' -> 'schedule' ->> 'publish_at' IS NOT NULL
          AND (body -> 'spec' -> 'schedule' ->> 'publish_at')::timestamptz <= ${now}::timestamptz
        UNION ALL
        SELECT slug, revision::text AS revision, 'archive' AS action FROM nodes
        WHERE workspace_id = ${ctx.workspaceId} AND kind = 'Content' AND deleted_at IS NULL
          AND body -> 'spec' ->> 'status' = 'published' AND body -> 'spec' -> 'schedule' ->> 'unpublish_at' IS NOT NULL
          AND (body -> 'spec' -> 'schedule' ->> 'unpublish_at')::timestamptz <= ${now}::timestamptz
        ORDER BY 3, 1`,
    );
    if (due.length === 0) return;
    const scheduler = yield* identity.bySubject("service:scheduler");
    for (const d of due)
      yield* transitionContent(
        { principal: scheduler, surface: "system", now: ctx.now },
        { slug: d.slug, action: d.action, base_revision: Number(d.revision) },
        false,
      );
  });
