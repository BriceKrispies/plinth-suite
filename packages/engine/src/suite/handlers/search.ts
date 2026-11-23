import { Effect, Schema as S } from "effect";
import { SuiteDiscovery } from "@plinth/spec";

const SEARCH_TYPES = SuiteDiscovery.SEARCH_TYPES;
import { Authorizer } from "../../authz";
import type { ActionCtx, ActionHandler, HandlerError, SuiteEnv } from "../types";
import type { HandlerTable } from "./stub";
import { q, toPersonRef } from "./util3";

/**
 * Module `search` (CONTRACT.md 12.10): grouped search over people, groups, products, badges, content, promotions,
 * automations, segments, orders, tasks, threads and dashboards, each filtered by what the viewer may see. Prefix matches
 * rank over word-start matches over substring matches; at most `limit` hits per type (default 5), with the full `total`.
 */

type Out = S.Schema.Type<typeof SuiteDiscovery.SearchOut>;
type Hit = Out["groups"][number]["items"][number];
type SType = (typeof SuiteDiscovery.SEARCH_TYPES)[number];

const esc = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const score = (text: string, needle: string): number => {
  const t = text.toLowerCase();
  if (t.startsWith(needle)) return 3;
  if (t.split(/[\s._/-]+/).some((w) => w.startsWith(needle))) return 2;
  return t.includes(needle) ? 1 : 0;
};

const canDo = (ctx: ActionCtx, perm: string, module = "search") =>
  Effect.gen(function* () {
    const authz = yield* Authorizer;
    const d = yield* authz.authorize(
      ctx.principal,
      perm,
      `plinth://${ctx.principal.workspaceSlug}/suite/${module}`,
    );
    return d.kind === "allow";
  });

interface Raw {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly href: string;
  readonly icon: Hit["icon"];
  readonly avatar?: Hit["avatar"];
  readonly artwork?: Hit["artwork"];
  readonly extra?: string;
}

const search: ActionHandler<S.Schema.Type<typeof SuiteDiscovery.SearchIn>, Out> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const needle = input.q.trim().toLowerCase();
      const pattern = `%${esc(needle)}%`;
      const per = input.limit ?? 5;
      const types: ReadonlyArray<SType> = input.types && input.types.length > 0 ? input.types : SEARCH_TYPES;
      const me = ctx.principal.id;
      const authz = yield* Authorizer;

      const nodeRows = (kind: string, extraWhere = "", extra: unknown[] = []) =>
        q<{ slug: string; title: string; spec: Record<string, unknown> }>(
          `SELECT slug, body -> 'metadata' ->> 'title' AS title, body -> 'spec' AS spec FROM nodes
           WHERE workspace_id = $1 AND kind = $2 AND deleted_at IS NULL
             AND (lower(body -> 'metadata' ->> 'title') LIKE $3 OR slug LIKE $3) ${extraWhere} ORDER BY slug LIMIT 100`,
          [ws, kind, pattern, ...extra],
        );

      const gather = (type: SType): Effect.Effect<ReadonlyArray<Raw>, HandlerError, SuiteEnv> => {
        switch (type) {
          case "person":
            return Effect.gen(function* () {
              const rows = yield* q<{
                member_id: string;
                handle: string;
                display_name: string;
                title: string;
                avatar_hue: number;
              }>(
                `SELECT m.member_id, m.handle, p.display_name, m.title, m.avatar_hue FROM members m JOIN principals p ON p.principal_id = m.member_id
                 WHERE m.workspace_id = $1 AND p.disabled_at IS NULL
                   AND (lower(p.display_name) LIKE $2 OR m.handle LIKE $2 OR lower(m.title) LIKE $2) ORDER BY lower(p.display_name) LIMIT 100`,
                [ws, pattern],
              );
              return rows.map((r) => ({
                id: r.handle,
                title: r.display_name,
                subtitle: r.title,
                href: `/people/${r.handle}`,
                icon: "user" as const,
                avatar: toPersonRef({
                  principal_id: r.member_id,
                  subject: "",
                  kind: "human",
                  display_name: r.display_name,
                  handle: r.handle,
                  avatar_hue: r.avatar_hue,
                }).avatar,
                extra: r.handle,
              }));
            });
          case "group":
            return nodeRows("Group").pipe(
              Effect.map((rows) =>
                rows.map((r) => ({
                  id: r.slug,
                  title: r.title ?? r.slug,
                  subtitle: `${(r.spec["members"] as unknown[] | undefined)?.length ?? 0} members`,
                  href: `/groups/${r.slug}`,
                  icon: "group" as const,
                  artwork: r.spec["artwork"] as Hit["artwork"],
                })),
              ),
            );
          case "product":
            return nodeRows("Product", "AND body -> 'spec' ->> 'status' = 'active'").pipe(
              Effect.map((rows) =>
                rows.map((r) => ({
                  id: r.slug,
                  title: r.title ?? r.slug,
                  subtitle: `${Number(r.spec["price_points"] ?? 0).toLocaleString("en-US")} points`,
                  href: `/store/p/${r.slug}`,
                  icon: "bag" as const,
                  artwork: r.spec["artwork"] as Hit["artwork"],
                })),
              ),
            );
          case "badge":
            return nodeRows(
              "Badge",
              "AND body -> 'spec' ->> 'status' = 'active' AND NOT coalesce((body -> 'spec' ->> 'hidden')::boolean, false)",
            ).pipe(
              Effect.map((rows) =>
                rows.map((r) => ({
                  id: r.slug,
                  title: r.title ?? r.slug,
                  subtitle: String(r.spec["rarity"] ?? "badge"),
                  href: "/badges",
                  icon: "trophy" as const,
                })),
              ),
            );
          case "content":
            return Effect.gen(function* () {
              const author = yield* canDo(ctx, "content:author", "content");
              const rows = yield* nodeRows(
                "Content",
                author
                  ? ""
                  : `AND (body -> 'spec' ->> 'status' = 'published' AND (coalesce((body -> 'spec' -> 'audience' ->> 'everyone')::boolean, false) OR body -> 'spec' ->> 'author' = $4))`,
                author ? [] : [ctx.principal.subject],
              );
              return rows.map((r) => ({
                id: r.slug,
                title: r.title ?? r.slug,
                subtitle: `${String(r.spec["type"] ?? "content")} · ${String(r.spec["status"] ?? "")}`,
                href:
                  String(r.spec["status"]) === "published" && !author
                    ? `/read/${r.slug}`
                    : author
                      ? `/content/${r.slug}`
                      : `/read/${r.slug}`,
                icon: "article" as const,
                artwork: r.spec["hero"] as Hit["artwork"],
              }));
            });
          case "promotion":
            return Effect.gen(function* () {
              if (!(yield* canDo(ctx, "promotions:simulate", "promotions"))) return [];
              const rows = yield* nodeRows("Promotion");
              return rows.map((r) => ({
                id: r.slug,
                title: r.title ?? r.slug,
                subtitle: String(r.spec["status"] ?? ""),
                href: `/promotions/${r.slug}`,
                icon: "percent" as const,
              }));
            });
          case "automation":
            return Effect.gen(function* () {
              if (!(yield* canDo(ctx, "automation:manage", "automation"))) return [];
              const rows = yield* nodeRows("Automation");
              return rows.map((r) => ({
                id: r.slug,
                title: r.title ?? r.slug,
                subtitle: r.spec["enabled"] === true ? "enabled" : "disabled",
                href: `/automations/${r.slug}`,
                icon: "workflow" as const,
              }));
            });
          case "segment":
            return Effect.gen(function* () {
              if (!(yield* canDo(ctx, "segments:preview", "segments"))) return [];
              const rows = yield* nodeRows("Segment");
              return rows.map((r) => ({
                id: r.slug,
                title: r.title ?? r.slug,
                subtitle: String(r.spec["description"] ?? "").slice(0, 80),
                href: `/segments/${r.slug}`,
                icon: "segment" as const,
              }));
            });
          case "order":
            return Effect.gen(function* () {
              const all = yield* canDo(ctx, "store:orders", "store");
              const rows = yield* q<{
                order_id: string;
                order_no: string;
                status: string;
                total_points: string;
                handle: string;
              }>(
                `SELECT o.order_id, o.order_no, o.status, o.total_points::text AS total_points, m.handle
                 FROM store_orders o JOIN members m ON m.member_id = o.member_id
                 WHERE o.workspace_id = $1 AND lower(o.order_no) LIKE $2 ${all ? "" : "AND o.member_id = $3"} ORDER BY o.placed_at DESC LIMIT 100`,
                all ? [ws, pattern] : [ws, pattern, me],
              );
              return rows.map((r) => ({
                id: r.order_id,
                title: r.order_no,
                subtitle: `${r.status} · ${Number(r.total_points).toLocaleString("en-US")} points · ${r.handle}`,
                href: `/store/orders/${r.order_id}`,
                icon: "box" as const,
              }));
            });
          case "task":
            return Effect.gen(function* () {
              const all = yield* canDo(ctx, "tasks:manage", "tasks");
              const rows = yield* q<{ task_id: string; task_no: number; title: string; status: string }>(
                `SELECT task_id, task_no, title, status FROM tasks
                 WHERE workspace_id = $1 AND lower(title) LIKE $2 ${all ? "" : "AND (assignee_id = $3 OR created_by = $3)"} ORDER BY task_no DESC LIMIT 100`,
                all ? [ws, pattern] : [ws, pattern, me],
              );
              return rows.map((r) => ({
                id: r.task_id,
                title: r.title,
                subtitle: `Task #${r.task_no} · ${r.status}`,
                href: "/tasks",
                icon: "task" as const,
              }));
            });
          case "thread":
            return Effect.gen(function* () {
              const rows = yield* q<{
                thread_id: string;
                subject: string;
                kind: string;
                message_count: number;
              }>(
                `SELECT t.thread_id, t.subject, t.kind, t.message_count FROM message_threads t
                 JOIN thread_participants tp ON tp.thread_id = t.thread_id AND tp.principal_id = $3
                 WHERE t.workspace_id = $1 AND lower(t.subject) LIKE $2 ORDER BY t.last_message_at DESC LIMIT 100`,
                [ws, pattern, me],
              );
              return rows.map((r) => ({
                id: r.thread_id,
                title: r.subject,
                subtitle: `${r.kind} thread · ${r.message_count} messages`,
                href: `/messages/t/${r.thread_id}`,
                icon: "inbox" as const,
              }));
            });
          case "dashboard":
            return Effect.gen(function* () {
              const d = yield* authz.authorize(
                ctx.principal,
                "node:read",
                `plinth://${ctx.principal.workspaceSlug}/Dashboard/`,
              );
              if (d.kind !== "allow") return [];
              const rows = yield* nodeRows("Dashboard");
              return rows.map((r) => ({
                id: r.slug,
                title: r.title ?? r.slug,
                subtitle: "Dashboard",
                href: `/reports/${r.slug}`,
                icon: "chart" as const,
              }));
            });
        }
      };

      const groups: Out["groups"][number][] = [];
      for (const type of types) {
        const raw = yield* gather(type);
        const ranked = raw
          .map((r) => ({
            r,
            s: Math.max(
              score(r.title, needle),
              r.extra ? score(r.extra, needle) : 0,
              score(r.subtitle, needle) / 2,
            ),
          }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s || a.r.title.localeCompare(b.r.title));
        groups.push({
          type,
          total: ranked.length,
          items: ranked.slice(0, per).map((x): Hit => ({
            type,
            id: x.r.id,
            title: x.r.title,
            subtitle: x.r.subtitle,
            href: x.r.href,
            icon: x.r.icon,
            avatar: x.r.avatar ?? null,
            artwork: x.r.artwork ?? null,
            score: x.s,
          })),
        });
      }
      return { q: input.q, groups: groups.filter((g) => g.total > 0) };
    }),
};

export const searchHandlers = { "search.global": search } satisfies HandlerTable;
