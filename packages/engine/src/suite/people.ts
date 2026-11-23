import { Effect } from "effect";
import { DomainError, type PersonRef } from "@plinth/spec";
import { ControlStore, store } from "../control-store";
import type { StoreError } from "../errors";
import type { PrincipalRef } from "./domain-events";

/** A member joined to its principal and ledger account (the facts most handlers need about a person). */
export interface MemberRow {
  readonly id: string;
  readonly subject: string;
  readonly handle: string;
  readonly displayName: string;
  readonly region: string;
  readonly department: string;
  readonly tier: string;
  readonly avatarHue: number;
  readonly disabled: boolean;
  readonly joinedAt: string;
  readonly lastActiveAt: string | null;
}

interface Raw {
  member_id: string;
  subject: string;
  handle: string;
  display_name: string;
  region: string;
  department: string;
  tier: string | null;
  avatar_hue: number;
  disabled: boolean;
  joined_at: string;
  last_active_at: string | null;
}

const SELECT = `
  SELECT m.member_id, p.subject, m.handle, p.display_name, m.region, m.department, a.tier, m.avatar_hue,
         (p.disabled_at IS NOT NULL) AS disabled, to_char(m.joined_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS joined_at,
         to_char(m.last_active_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_active_at
  FROM members m
  JOIN principals p ON p.principal_id = m.member_id
  LEFT JOIN ledger_accounts a ON a.member_id = m.member_id`;

const toRow = (r: Raw): MemberRow => ({
  id: r.member_id,
  subject: r.subject,
  handle: r.handle,
  displayName: r.display_name,
  region: r.region,
  department: r.department,
  tier: r.tier ?? "bronze",
  avatarHue: r.avatar_hue,
  disabled: r.disabled,
  joinedAt: r.joined_at,
  lastActiveAt: r.last_active_at,
});

const unknownMember = (what: string) =>
  new DomainError({ code: "UNKNOWN_REFERENCE", path: "", message: `no member ${what}` });

const find = (ws: string, column: "m.handle" | "p.subject" | "m.member_id", value: string, what: string) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql.unsafe<Raw>(`${SELECT} WHERE m.workspace_id = $1 AND ${column} = $2`, [ws, value]),
    );
    const r = rows[0];
    return r ? toRow(r) : yield* Effect.fail(unknownMember(what));
  });

export const memberByHandle = (
  ws: string,
  handle: string,
): Effect.Effect<MemberRow, DomainError | StoreError, ControlStore> =>
  find(ws, "m.handle", handle, `'${handle}'`);

export const memberBySubject = (
  ws: string,
  subject: string,
): Effect.Effect<MemberRow, DomainError | StoreError, ControlStore> =>
  find(ws, "p.subject", subject, `'${subject}'`);

export const memberById = (
  ws: string,
  id: string,
): Effect.Effect<MemberRow, DomainError | StoreError, ControlStore> => find(ws, "m.member_id", id, `'${id}'`);

export const memberRef = (m: MemberRow): PrincipalRef => ({ id: m.id, subject: m.subject });

const initialsOf = (name: string): string => {
  const parts = name.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "?";
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : (parts[0]?.[1] ?? "");
  return (a + b).toUpperCase();
};

/** The `PersonRef` of any principal: members use their stored hue; agents hue 265 "AI"; services hue 210. */
export const personRefOf = (
  ws: string,
  principalId: string,
): Effect.Effect<PersonRef, DomainError | StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{
        subject: string;
        kind: PersonRef["kind"];
        display_name: string;
        handle: string | null;
        avatar_hue: number | null;
      }>`
        SELECT p.subject, p.kind, p.display_name, m.handle, m.avatar_hue
        FROM principals p LEFT JOIN members m ON m.member_id = p.principal_id
        WHERE p.workspace_id = ${ws} AND p.principal_id = ${principalId}`,
    );
    const r = rows[0];
    if (!r) return yield* Effect.fail(unknownMember(`'${principalId}'`));
    const avatar =
      r.kind === "agent"
        ? { initials: "AI", hue: 265 }
        : r.kind === "service"
          ? { initials: (r.subject.split(":")[1] ?? "sv").slice(0, 2).toUpperCase(), hue: 210 }
          : { initials: initialsOf(r.display_name), hue: r.avatar_hue ?? 0 };
    return {
      subject: r.subject,
      handle: r.handle,
      display_name: r.display_name,
      kind: r.kind,
      avatar,
    } as PersonRef;
  });

/** Subjects of the humans who hold a role (Role node membership), for audience lists. */
export const roleSubjects = (
  ws: string,
  role: string,
): Effect.Effect<ReadonlyArray<string>, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{ body: { spec?: { members?: Array<{ subject?: string }> } } }>`
        SELECT body FROM nodes WHERE workspace_id = ${ws} AND kind = 'Role' AND slug = ${role} AND deleted_at IS NULL`,
    );
    return (rows[0]?.body.spec?.members ?? []).flatMap((m) => (m.subject ? [m.subject] : []));
  });
