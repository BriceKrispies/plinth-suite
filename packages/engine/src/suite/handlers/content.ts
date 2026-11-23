import { Effect } from "effect";
import {
  type ContentSpec,
  type ContentStatus,
  type MemberFacts,
  CONTENT_STATUSES,
  REACTIONS,
  SuiteContent,
} from "@plinth/spec";
import { ChangeLog } from "../../change-log";
import { ControlStore, store } from "../../control-store";
import { emitFrom } from "../domain-events";
import { memberFactsFor } from "../segments";
import {
  decodeCursor,
  dom,
  encodeCursor,
  iso,
  loadNodes,
  nodeLinkOf,
  nodeUriOf,
  personBySubjectSafe,
  requireNode,
} from "../marketing/common";
import {
  checkTransition,
  diffBlocks,
  diffFields,
  displayStatus,
  emptyEngagement,
  loadEngagement,
  mayRead,
  personsFor,
  publishedAt,
  reactionTotal,
  segmentMatches,
  servedSpec,
  transitionContent,
  type ContentNode,
  type Engagement,
} from "../marketing/content-core";
import type { ActionCtx, ActionHandler } from "../types";
import type { HandlerTable } from "./stub";

type In<K extends keyof typeof SuiteContent> = (typeof SuiteContent)[K] extends { Type: infer T } ? T : never;
type Reaction = (typeof REACTIONS)[number];

const viewerId = (ctx: ActionCtx): string => ctx.onBehalfOf?.id ?? ctx.principal.id;

const updatedAtMap = (ws: string) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{ node_id: string; at: Date }>`
        SELECT n.node_id, coalesce(c.virtual_at, c.created_at) AS at FROM nodes n
        JOIN changes c ON c.workspace_id = n.workspace_id AND c.seq = n.updated_seq
        WHERE n.workspace_id = ${ws} AND n.kind = 'Content' AND n.deleted_at IS NULL`,
    );
    return new Map(rows.map((r) => [r.node_id, iso(r.at)] as const));
  });

// ---- list ------------------------------------------------------------------------------------------------------

const list: ActionHandler<In<"ContentListIn">, In<"ContentListOut">> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const wsSlug = ctx.principal.workspaceSlug;
      const nodes = yield* loadNodes<ContentSpec>(ws, "Content");
      const eng = yield* loadEngagement(ws, undefined);
      const upd = yield* updatedAtMap(ws);
      const counts = Object.fromEntries(CONTENT_STATUSES.map((s) => [s, 0])) as Record<ContentStatus, number>;
      for (const n of nodes) counts[n.spec.status] += 1;
      const q = input.q?.toLowerCase();
      const me = ctx.principal.subject;
      const author = input.author;
      const filtered = nodes.filter((n) => {
        const s = n.spec;
        if (input.status && !input.status.includes(s.status)) return false;
        if (input.type && s.type !== input.type) return false;
        if (input.tag && !s.tags.includes(input.tag)) return false;
        if (author && s.author !== author && s.author !== `user:${author}`) return false;
        if (input.awaiting_my_review === true && !(s.status === "in_review" && s.reviewers.includes(me)))
          return false;
        if (q && !n.title.toLowerCase().includes(q) && !s.summary.toLowerCase().includes(q)) return false;
        return true;
      });
      const sorted = [...filtered].sort((a, b) => {
        const ua = upd.get(a.id) ?? "";
        const ub = upd.get(b.id) ?? "";
        return ua === ub ? (a.slug < b.slug ? -1 : 1) : ua < ub ? 1 : -1;
      });
      const limit = input.limit ?? 50;
      const start = decodeCursor<{ i: number }>(input.cursor)?.i ?? 0;
      const page = sorted.slice(start, start + limit);
      const people = yield* personsFor(
        ws,
        page.flatMap((n) => [n.spec.author, ...n.spec.reviewers]),
      );
      const items = page.map((n) => {
        const e = eng.get(n.id) ?? emptyEngagement;
        return {
          node: nodeLinkOf(wsSlug, ws, "Content", n),
          type: n.spec.type,
          status: n.spec.status,
          display_status: displayStatus(n.spec, ctx.now),
          summary: n.spec.summary,
          hero: n.spec.hero,
          tags: [...n.spec.tags],
          author: people.get(n.spec.author)!,
          reviewers: n.spec.reviewers.map((r) => people.get(r)!),
          updated_at: upd.get(n.id) ?? iso(ctx.now),
          publish_at: n.spec.schedule.publish_at ?? null,
          published_revision: n.spec.published_revision,
          views: e.views,
          reactions: reactionTotal(e),
        };
      });
      return {
        items,
        next_cursor: start + limit < sorted.length ? encodeCursor({ i: start + limit }) : null,
        status_counts: counts,
      };
    }),
};

// ---- transitions -----------------------------------------------------------------------------------------------

const transition: ActionHandler<In<"ContentTransitionIn">, unknown> = {
  preview: (input, ctx) =>
    Effect.gen(function* () {
      const n = yield* requireNode<ContentSpec>(ctx.principal.workspaceId, "Content", input.slug);
      yield* checkTransition(ctx, n, input, true);
      return {
        effect: `${input.action} content ${n.slug} (${n.spec.status} to ${
          input.action === "publish" ? "published" : n.spec.status
        })`,
        facts: { content: n.slug, action: input.action, from: n.spec.status },
      };
    }),
  run: (input, ctx) =>
    Effect.gen(function* () {
      const res = yield* transitionContent(ctx, input, true);
      return {
        status: res.status,
        ...(res.approval_id !== undefined ? { approval_id: res.approval_id } : {}),
        ...(res.change_seq !== undefined ? { change_seq: res.change_seq } : {}),
        ...(res.revision !== undefined ? { revision: res.revision } : {}),
        rule_id: res.rule_id,
      };
    }),
};

// ---- feed ------------------------------------------------------------------------------------------------------

interface Served {
  readonly node: ContentNode;
  readonly spec: ContentSpec;
}

/** Published content the viewer may read, with the spec at its published revision. */
const servedFor = (ctx: ActionCtx, facts: MemberFacts | undefined) =>
  Effect.gen(function* () {
    const ws = ctx.principal.workspaceId;
    const wsSlug = ctx.principal.workspaceSlug;
    const nodes = (yield* loadNodes<ContentSpec>(ws, "Content")).filter(
      (n) => n.spec.published_revision !== null && n.spec.status !== "archived",
    );
    const segs = yield* segmentMatches(
      ws,
      nodes.map((n) => n.spec),
      facts,
    );
    const out: Served[] = [];
    for (const n of nodes) {
      const spec = yield* servedSpec(ws, n);
      if (mayRead(spec, facts, segs)) out.push({ node: n, spec });
    }
    return out;
  });

const feedItem = (
  s: Served,
  author: In<"FeedOut">["items"][number]["author"],
  e: Engagement,
  at: string,
): In<"FeedOut">["items"][number] => ({
  slug: s.node.slug,
  title: s.node.title,
  type: s.spec.type,
  summary: s.spec.summary,
  hero: s.spec.hero,
  tags: [...s.spec.tags],
  author,
  published_at: publishedAt(s.spec, at),
  pinned: s.spec.pinned,
  views: e.views,
  reactions: e.reactions,
  my_reaction: e.mine,
  seen: e.seen,
});

const factsOfViewer = (ctx: ActionCtx) =>
  memberFactsFor(ctx.principal.workspaceId, ctx.now, [viewerId(ctx)]).pipe(Effect.map((r) => r[0]?.facts));

const feed: ActionHandler<In<"FeedIn">, In<"FeedOut">> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const facts = yield* factsOfViewer(ctx);
      const eng = yield* loadEngagement(ws, viewerId(ctx));
      const upd = yield* updatedAtMap(ws);
      const served = (yield* servedFor(ctx, facts)).filter(
        (s) => (!input.type || s.spec.type === input.type) && (!input.tag || s.spec.tags.includes(input.tag)),
      );
      const withAt = served.map((s) => ({ s, at: publishedAt(s.spec, upd.get(s.node.id) ?? iso(ctx.now)) }));
      withAt.sort((a, b) =>
        a.s.spec.pinned !== b.s.spec.pinned
          ? a.s.spec.pinned
            ? -1
            : 1
          : a.at < b.at
            ? 1
            : a.at > b.at
              ? -1
              : 0,
      );
      const limit = input.limit ?? 50;
      const start = decodeCursor<{ i: number }>(input.cursor)?.i ?? 0;
      const page = withAt.slice(start, start + limit);
      const people = yield* personsFor(
        ws,
        page.map((p) => p.s.spec.author),
      );
      return {
        items: page.map((p) =>
          feedItem(p.s, people.get(p.s.spec.author)!, eng.get(p.s.node.id) ?? emptyEngagement, p.at),
        ),
        next_cursor: start + limit < withAt.length ? encodeCursor({ i: start + limit }) : null,
      };
    }),
};

const notEligible = (slug: string) =>
  dom("RULE_REFUSED", "/slug", `content '${slug}' is not published to you`, {
    details: { reason: "NOT_ELIGIBLE" },
    fix_hint: "Only published content in your audience can be read.",
  });

const published: ActionHandler<In<"PublishedIn">, In<"PublishedOut">> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const n = yield* requireNode<ContentSpec>(ws, "Content", input.slug);
      const facts = yield* factsOfViewer(ctx);
      const served = (yield* servedFor(ctx, facts)).find((s) => s.node.slug === n.slug);
      if (!served) return yield* Effect.fail(notEligible(input.slug));
      const eng = yield* loadEngagement(ws, viewerId(ctx));
      const upd = yield* updatedAtMap(ws);
      const author = yield* personBySubjectSafe(ws, served.spec.author);
      return {
        item: feedItem(served, author, eng.get(n.id) ?? emptyEngagement, upd.get(n.id) ?? iso(ctx.now)),
        revision: n.spec.published_revision!,
        blocks: [...served.spec.blocks],
      };
    }),
};

// ---- engagement ------------------------------------------------------------------------------------------------

const engage: ActionHandler<In<"EngageIn">, In<"EngageOut">> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const n = yield* requireNode<ContentSpec>(ws, "Content", input.slug);
      const member = viewerId(ctx);
      const facts = yield* factsOfViewer(ctx);
      if (!facts) return yield* Effect.fail(notEligible(input.slug));
      const served = (yield* servedFor(ctx, facts)).find((s) => s.node.slug === n.slug);
      if (!served) return yield* Effect.fail(notEligible(input.slug));
      if (input.reaction !== undefined && input.reaction !== null) {
        const allowed = served.spec.reactions_enabled ?? [...REACTIONS];
        if (!served.spec.allow_reactions || !allowed.includes(input.reaction))
          return yield* Effect.fail(
            dom("RULE_REFUSED", "/reaction", "reactions are not enabled for this content", {
              details: { reason: "NOT_ELIGIBLE" },
            }),
          );
      }
      const at = ctx.now.toISOString();
      if (input.view === true)
        yield* store(
          sql`INSERT INTO content_engagement (content_id, member_id, workspace_id, first_viewed_at, last_viewed_at, views)
              VALUES (${n.id}, ${member}, ${ws}, ${at}::timestamptz, ${at}::timestamptz, 1)
              ON CONFLICT (content_id, member_id) DO UPDATE SET views = content_engagement.views + 1, last_viewed_at = ${at}::timestamptz`,
        );
      if (input.reaction !== undefined) {
        yield* store(
          sql`INSERT INTO content_engagement (content_id, member_id, workspace_id, first_viewed_at, last_viewed_at, views, reaction, reacted_at)
              VALUES (${n.id}, ${member}, ${ws}, ${at}::timestamptz, ${at}::timestamptz, 1, ${input.reaction},
                      ${input.reaction === null ? null : at}::timestamptz)
              ON CONFLICT (content_id, member_id) DO UPDATE SET reaction = ${input.reaction},
                reacted_at = ${input.reaction === null ? null : at}::timestamptz`,
        );
      }
      const e = (yield* loadEngagement(ws, member)).get(n.id) ?? emptyEngagement;
      const handle = facts.handle;
      const subject = ctx.onBehalfOf?.subject ?? ctx.principal.subject;
      if (input.view !== undefined || input.reaction !== undefined)
        yield* emitFrom(ctx, "content.engaged", {
          audience: ["*"],
          subject: { kind: "content", id: n.slug },
          member: { id: member, subject },
          payload: {
            content: n.slug,
            member: handle,
            viewed: input.view === true,
            reaction: e.mine,
            views: e.views,
            reactions: reactionTotal(e),
          },
        });
      return { views: e.views, reactions: e.reactions as Record<Reaction, number>, my_reaction: e.mine };
    }),
};

// ---- versions, diff, preview ----------------------------------------------------------------------------------

const versions: ActionHandler<In<"VersionsIn">, In<"VersionsOut">> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const log = yield* ChangeLog;
      const ws = ctx.principal.workspaceId;
      const wsSlug = ctx.principal.workspaceSlug;
      const n = yield* requireNode<ContentSpec>(ws, "Content", input.slug);
      const uri = nodeUriOf(wsSlug, ws, "Content", n.slug);
      const rows = yield* store(
        sql<{
          seq: string;
          result_revision: string;
          actor_id: string;
          at: Date;
          paths: string[];
          reason: string | null;
          subject: string;
        }>`
          SELECT c.seq::text AS seq, c.result_revision::text AS result_revision, c.actor_id, coalesce(c.virtual_at, c.created_at) AS at,
                 c.paths, c.reason, p.subject
          FROM changes c JOIN principals p ON p.principal_id = c.actor_id
          WHERE c.workspace_id = ${ws} AND c.node_id = ${n.id} AND c.kind = 'change' ORDER BY c.result_revision DESC`,
      );
      const people = yield* personsFor(
        ws,
        rows.map((r) => r.subject),
      );
      const items: Array<In<"VersionsOut">["items"][number]> = [];
      for (const r of rows) {
        const rev = Number(r.result_revision);
        const body = yield* log.bodyAt(ctx.principal, uri, rev).pipe(Effect.orElseSucceed(() => undefined));
        const status = ((body as { spec?: { status?: ContentStatus } } | undefined)?.spec?.status ??
          n.spec.status) as ContentStatus;
        items.push({
          revision: rev,
          change_seq: Number(r.seq),
          actor: people.get(r.subject)!,
          at: iso(r.at),
          status,
          paths: [...r.paths],
          reason: r.reason,
          published: n.spec.published_revision === rev,
        });
      }
      return { items, head: n.revision, published_revision: n.spec.published_revision };
    }),
};

const diff: ActionHandler<In<"ContentDiffIn">, In<"ContentDiffOut">> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const log = yield* ChangeLog;
      const ws = ctx.principal.workspaceId;
      const wsSlug = ctx.principal.workspaceSlug;
      const n = yield* requireNode<ContentSpec>(ws, "Content", input.slug);
      const uri = nodeUriOf(wsSlug, ws, "Content", n.slug);
      const d = yield* log.diffRevisions(
        ctx.principal,
        { uri, revision: input.from },
        { uri, revision: input.to },
      );
      const a = ((yield* log.bodyAt(ctx.principal, uri, input.from)) as { spec: ContentSpec }).spec;
      const b = ((yield* log.bodyAt(ctx.principal, uri, input.to)) as { spec: ContentSpec }).spec;
      return {
        from: input.from,
        to: input.to,
        changed_paths: [...d.changed_paths],
        human_summary: d.human_summary,
        fields: diffFields(a, b),
        blocks: diffBlocks(a.blocks, b.blocks),
      };
    }),
};

const preview: ActionHandler<In<"ContentPreviewIn">, In<"ContentPreviewOut">> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const log = yield* ChangeLog;
      const ws = ctx.principal.workspaceId;
      const wsSlug = ctx.principal.workspaceSlug;
      const n = yield* requireNode<ContentSpec>(ws, "Content", input.slug);
      const uri = nodeUriOf(wsSlug, ws, "Content", n.slug);
      const revision = input.revision ?? n.revision;
      const spec =
        revision === n.revision
          ? n.spec
          : ((yield* log.bodyAt(ctx.principal, uri, revision)) as { spec: ContentSpec }).spec;
      return { node: nodeLinkOf(wsSlug, ws, "Content", n), spec, revision };
    }),
};

export const contentHandlers = {
  "content.list": list,
  "content.transition": transition,
  "content.feed": feed,
  "content.published": published,
  "content.engage": engage,
  "content.versions": versions,
  "content.diff": diff,
  "content.preview": preview,
} satisfies HandlerTable;
