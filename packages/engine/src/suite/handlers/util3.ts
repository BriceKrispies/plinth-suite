import { Effect } from "effect";
import { DomainError, type PersonRef } from "@plinth/spec";
import { ControlStore, store } from "../../control-store";
import type { StoreError } from "../../errors";

/**
 * Small helpers shared by the communications and administration handlers (messages, notifications, people, me, tasks,
 * approvals, audit, admin, pages, search): raw parameterised queries, ISO timestamp formatting, opaque cursors and a
 * batched `PersonRef` lookup. Nothing here emits events or writes rows.
 */

/** `to_char` of a timestamptz column as an RFC 3339 UTC string with milliseconds. */
export const ISO = (col: string): string =>
  `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** A text[] / uuid[] literal for `$n::uuid[]` parameters. */
export const pgArr = (xs: ReadonlyArray<string>): string =>
  "{" + xs.map((s) => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"').join(",") + "}";

/** Run one parameterised query. */
export const q = <T extends object>(
  text: string,
  params: ReadonlyArray<unknown> = [],
): Effect.Effect<ReadonlyArray<T>, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    return yield* store(sql.unsafe<T>(text, params as never));
  });

export const dom = (
  code: DomainError["code"],
  path: string,
  message: string,
  extra?: Partial<ConstructorParameters<typeof DomainError>[0]>,
): DomainError => new DomainError({ code, path, message, ...extra });

export const refusal = (
  code: DomainError["code"],
  reason: string,
  message: string,
  details: Record<string, unknown> = {},
): DomainError =>
  new DomainError({
    code,
    path: "",
    message,
    details: { reason, ...details },
    retryable: false,
  });

// ---- cursors -------------------------------------------------------------------------------------------

export const encodeCursor = (parts: ReadonlyArray<string | number>): string =>
  Buffer.from(JSON.stringify(parts)).toString("base64url");

export const decodeCursor = (c: string | undefined): ReadonlyArray<string> | undefined => {
  if (c === undefined || c === "") return undefined;
  try {
    const v = JSON.parse(Buffer.from(c, "base64url").toString("utf8")) as unknown;
    return Array.isArray(v) ? v.map(String) : undefined;
  } catch {
    return undefined;
  }
};

export const limitOf = (l: number | undefined, dflt = 50): number => Math.max(1, Math.min(200, l ?? dflt));

// ---- people --------------------------------------------------------------------------------------------

const initialsOf = (name: string): string => {
  const parts = name.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "?";
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : (parts[0]?.[1] ?? "");
  return (a + b).toUpperCase();
};

interface RefRow {
  principal_id: string;
  subject: string;
  kind: PersonRef["kind"];
  display_name: string;
  handle: string | null;
  avatar_hue: number | null;
}

export const toPersonRef = (r: RefRow): PersonRef =>
  ({
    subject: r.subject,
    handle: r.handle,
    display_name: r.display_name,
    kind: r.kind,
    avatar:
      r.kind === "agent"
        ? { initials: "AI", hue: 265 }
        : r.kind === "service"
          ? { initials: (r.subject.split(":")[1] ?? "sv").slice(0, 2).toUpperCase(), hue: 210 }
          : { initials: initialsOf(r.display_name), hue: r.avatar_hue ?? 0 },
  }) as PersonRef;

/** `PersonRef` of every principal id in one query. Unknown ids are absent from the map. */
export const personRefs = (
  ws: string,
  ids: ReadonlyArray<string>,
): Effect.Effect<Map<string, PersonRef>, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const uniq = [...new Set(ids)];
    const out = new Map<string, PersonRef>();
    if (uniq.length === 0) return out;
    const rows = yield* q<RefRow>(
      `SELECT p.principal_id, p.subject, p.kind, p.display_name, m.handle, m.avatar_hue
       FROM principals p LEFT JOIN members m ON m.member_id = p.principal_id
       WHERE p.workspace_id = $1 AND p.principal_id = ANY($2::uuid[])`,
      [ws, pgArr(uniq)],
    );
    for (const r of rows) out.set(r.principal_id, toPersonRef(r));
    return out;
  });

/** `PersonRef` of every subject in one query, keyed by subject. */
export const personRefsBySubject = (
  ws: string,
  subjects: ReadonlyArray<string>,
): Effect.Effect<Map<string, PersonRef & { id: string }>, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const uniq = [...new Set(subjects)];
    const out = new Map<string, PersonRef & { id: string }>();
    if (uniq.length === 0) return out;
    const rows = yield* q<RefRow>(
      `SELECT p.principal_id, p.subject, p.kind, p.display_name, m.handle, m.avatar_hue
       FROM principals p LEFT JOIN members m ON m.member_id = p.principal_id
       WHERE p.workspace_id = $1 AND p.subject = ANY($2::text[])`,
      [ws, pgArr(uniq)],
    );
    for (const r of rows) out.set(r.subject, { ...toPersonRef(r), id: r.principal_id });
    return out;
  });

export const ref = (m: Map<string, PersonRef>, id: string | null | undefined): PersonRef => {
  const r = id ? m.get(id) : undefined;
  return (
    r ??
    ({
      subject: "service:unknown",
      handle: null,
      display_name: "Unknown",
      kind: "service",
      avatar: { initials: "UN", hue: 210 },
    } as PersonRef)
  );
};

/** `@handle` tokens of a plain-text body (CONTRACT.md 1.7). */
export const mentionHandles = (body: string): ReadonlyArray<string> => [
  ...new Set([...body.matchAll(/(?:^|[^a-z0-9_])@([a-z][a-z0-9-]{1,39})/g)].map((m) => m[1] as string)),
];

export const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);
