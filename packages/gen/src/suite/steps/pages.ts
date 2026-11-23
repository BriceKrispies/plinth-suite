import { Effect } from "effect";
import { nodeId, nodeUri } from "@plinth/core";
import { PAGES, defaultNavOrders, pageBody, widgetBody, widgetSlug, type Cell } from "@plinth/spec";
import type { SeedStep } from "../seed";

export { PAGES, widgetSlug };

/**
 * Seed step `pages` (CONTRACT.md 5A, 12.11; UI-MAP.md section 2). Every default page (the table lives in the spec
 * package, `default-pages.ts`, shared with `site.restore`) as a system Page with its Widget instances, and the personal
 * page `home.maya-ortiz` (created through the real `pages.personalize` handler, then rearranged).
 */

/** Where each widget of the base `home` page sits on Maya's personal copy. */
const MAYA_CELLS: Record<string, Cell> = {
  "approvals.inbox": [0, 0, 6, 5],
  "tasks.list": [6, 0, 6, 5],
  "reporting.suite-kpis": [0, 5, 12, 4],
  "points.balance": [0, 9, 4, 5],
  "badges.progress": [4, 9, 4, 5],
  "notifications.feed": [8, 9, 4, 8],
  "messaging.unread": [4, 14, 4, 3],
  "promotions.active": [0, 17, 12, 3],
  "content.feed": [0, 20, 8, 8],
};

export const pagesStep: SeedStep = {
  name: "pages",
  spec: "5A, 12.11",
  run: (ctx) =>
    Effect.gen(function* () {
      yield* ctx.commitNodes(
        PAGES.flatMap((p) => p.items.map((i) => ctx.create("Widget", widgetSlug(p, i), widgetBody(p, i)))),
        "seed: default page widgets",
      );
      // nav order within each section follows the table order
      const orders = defaultNavOrders();
      yield* ctx.commitNodes(
        PAGES.map((p) => ctx.create("Page", p.slug, pageBody(p, orders.get(p.slug) ?? 10))),
        "seed: system pages",
      );
      // Maya's personal home: the real handler copies the page and its widgets, then she rearranges it
      const maya = yield* ctx.principal("user:ops-lead");
      const made = (yield* ctx.act(
        maya,
        "pages.personalize",
        { page: "home" },
        { at: new Date(ctx.demoNow.getTime() - 21 * 86_400_000) },
      )) as {
        page: { revision: number; slug: string };
      };
      const home = PAGES.find((p) => p.slug === "home");
      if (!home) return;
      yield* ctx.commitNodes(
        [
          {
            target: nodeUri(ctx.workspaceSlug, "Page", nodeId(ctx.workspaceId, "Page", made.page.slug)),
            base_revision: made.page.revision,
            ops: [
              {
                op: "set",
                path: "/spec/layout",
                value: {
                  columns: 12,
                  items: home.items.map((i) => {
                    const at = MAYA_CELLS[i.widget] ?? i.at;
                    return {
                      item: `widget:${widgetSlug(home, i)}.maya-ortiz`,
                      at: { x: at[0], y: at[1], w: at[2], h: at[3] },
                      size: i.size,
                    };
                  }),
                },
              },
            ],
          },
        ],
        "seed: rearrange the personal home page of maya-ortiz",
      );
    }),
};
