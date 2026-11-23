import { Effect } from "effect";
import { nodeId, nodeUri, principalId } from "@plinth/core";
import {
  DomainError,
  type CondTree,
  type NodeLink,
  type PersonRef,
  type Tier,
  SuitePeople,
} from "@plinth/spec";
import { ControlStore, store } from "../../control-store";
import type { StoreError } from "../../errors";
import { personRefOf } from "../people";

/** Shared helpers of the marketing and content modules (promotions, automation, content, segments, calendar). */

export const dom = (
  code: DomainError["code"],
  path: string,
  message: string,
  extra?: Partial<ConstructorParameters<typeof DomainError>[0]>,
) => new DomainError({ code, path, message, ...extra });

export const iso = (v: Date | string): string => new Date(v).toISOString();

export const DAY_MS = 86_400_000;

/** `<lowercased kind>:<slug>` reference to the bare slug. */
export const refSlug = (r: string): string => {
  const i = r.indexOf(":");
  return i >= 0 ? r.slice(i + 1) : r;
};

export interface SuiteNode<S = Record<string, unknown>> {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly revision: number;
  readonly spec: S;
  readonly updatedSeq: number;
}

interface RawNode {
  node_id: string;
  slug: string;
  revision: string;
  body: { metadata?: { title?: string }; spec?: unknown };
  updated_seq: string;
}

const toNode = <S>(r: RawNode): SuiteNode<S> => ({
  id: r.node_id,
  slug: r.slug,
  title: r.body.metadata?.title ?? r.slug,
  revision: Number(r.revision),
  spec: (r.body.spec ?? {}) as S,
  updatedSeq: Number(r.updated_seq),
});

/** Every live node of a kind, ordered by slug. */
export const loadNodes = <S = Record<string, unknown>>(
  ws: string,
  kind: string,
): Effect.Effect<ReadonlyArray<SuiteNode<S>>, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<RawNode>`
        SELECT node_id, slug, revision::text AS revision, body, updated_seq::text AS updated_seq FROM nodes
        WHERE workspace_id = ${ws} AND kind = ${kind} AND deleted_at IS NULL ORDER BY slug`,
    );
    return rows.map((r) => toNode<S>(r));
  });

export const loadNode = <S = Record<string, unknown>>(
  ws: string,
  kind: string,
  slug: string,
): Effect.Effect<SuiteNode<S> | undefined, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<RawNode>`
        SELECT node_id, slug, revision::text AS revision, body, updated_seq::text AS updated_seq FROM nodes
        WHERE workspace_id = ${ws} AND kind = ${kind} AND slug = ${slug} AND deleted_at IS NULL`,
    );
    return rows[0] ? toNode<S>(rows[0]) : undefined;
  });

export const requireNode = <S = Record<string, unknown>>(
  ws: string,
  kind: string,
  slug: string,
): Effect.Effect<SuiteNode<S>, DomainError | StoreError, ControlStore> =>
  loadNode<S>(ws, kind, slug).pipe(
    Effect.flatMap((n) =>
      n
        ? Effect.succeed(n)
        : Effect.fail(
            dom("UNKNOWN_REFERENCE", "/slug", `no ${kind} '${slug}'`, { fix_hint: `List ${kind}s first.` }),
          ),
    ),
  );

export const nodeUriOf = (wsSlug: string, ws: string, kind: string, slug: string): string =>
  nodeUri(wsSlug, kind as never, nodeId(ws, kind as never, slug));

export const nodeLinkOf = (wsSlug: string, ws: string, kind: string, n: SuiteNode): NodeLink => ({
  uri: nodeUriOf(wsSlug, ws, kind, n.slug),
  kind,
  slug: n.slug,
  title: n.title,
  revision: n.revision,
});

/** `PersonRef` of a subject (`user:ops-lead`), by the deterministic principal id. */
export const personBySubject = (
  ws: string,
  subject: string,
): Effect.Effect<PersonRef, DomainError | StoreError, ControlStore> =>
  personRefOf(ws, principalId(ws, subject));

/** Like `personBySubject` but never fails: an unknown subject becomes a plain placeholder person. */
export const personBySubjectSafe = (
  ws: string,
  subject: string,
): Effect.Effect<PersonRef, StoreError, ControlStore> =>
  personBySubject(ws, subject).pipe(
    Effect.catchTag("DomainError", () =>
      Effect.succeed({
        subject,
        handle: subject.startsWith("user:") ? subject.slice(5) : null,
        display_name: subject,
        kind: subject.startsWith("agent:") ? "agent" : subject.startsWith("service:") ? "service" : "human",
        avatar: {
          initials: subject.slice(subject.indexOf(":") + 1, subject.indexOf(":") + 3).toUpperCase(),
          hue: 0,
        },
      } as PersonRef),
    ),
  );

// ---- member cards ----------------------------------------------------------------------------------------------

export type MemberCardRow = typeof SuitePeople.MemberCard.Type;

const initialsOf = (name: string): string => {
  const parts = name.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "?";
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : (parts[0]?.[1] ?? "");
  return (a + b).toUpperCase();
};

/** `MemberCard`s for member ids, in the order of `ids`. */
export const memberCardsFor = (
  ws: string,
  ids: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<MemberCardRow>, StoreError, ControlStore> =>
  Effect.gen(function* () {
    if (ids.length === 0) return [];
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{
        member_id: string;
        subject: string;
        display_name: string;
        handle: string;
        title: string;
        department: string;
        region: string;
        avatar_hue: number;
        tier: string | null;
        last_active_at: Date | null;
        disabled: boolean;
        badges: string;
      }>`
        SELECT m.member_id, p.subject, p.display_name, m.handle, m.title, m.department, m.region, m.avatar_hue,
               a.tier, m.last_active_at, (p.disabled_at IS NOT NULL) AS disabled,
               (SELECT count(*) FROM badge_awards b WHERE b.member_id = m.member_id AND b.revoked_at IS NULL)::text AS badges
        FROM members m
        JOIN principals p ON p.principal_id = m.member_id
        LEFT JOIN ledger_accounts a ON a.member_id = m.member_id
        WHERE m.workspace_id = ${ws} AND m.member_id IN ${sql.in([...ids])}`,
    );
    const by = new Map(rows.map((r) => [r.member_id, r] as const));
    const out: MemberCardRow[] = [];
    for (const id of ids) {
      const r = by.get(id);
      if (!r) continue;
      out.push({
        person: {
          subject: r.subject,
          handle: r.handle,
          display_name: r.display_name,
          kind: "human",
          avatar: { initials: initialsOf(r.display_name), hue: r.avatar_hue },
        } as PersonRef,
        title: r.title,
        department: r.department,
        region: r.region as MemberCardRow["region"],
        tier: (r.tier ?? "bronze") as Tier,
        badges_count: Number(r.badges),
        last_active_at: r.last_active_at ? iso(r.last_active_at) : null,
        status: r.disabled ? "disabled" : "active",
      });
    }
    return out;
  });

// ---- cursors ---------------------------------------------------------------------------------------------------

export const encodeCursor = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString("base64url");
export const decodeCursor = <T>(c: string | undefined): T | undefined => {
  if (!c) return undefined;
  try {
    return JSON.parse(Buffer.from(c, "base64url").toString("utf8")) as T;
  } catch {
    return undefined;
  }
};

// ---- text ------------------------------------------------------------------------------------------------------

/** Every `segment:` reference inside a condition tree is never needed; a rule is plain data. */
export const isCondTree = (x: unknown): x is CondTree => typeof x === "object" && x !== null;

export const pgTextArray = (xs: ReadonlyArray<string>): string =>
  "{" + xs.map((s) => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"').join(",") + "}";
