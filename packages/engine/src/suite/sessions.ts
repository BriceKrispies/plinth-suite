import { Effect } from "effect";
import { DomainError } from "@plinth/spec";
import { ControlStore, store } from "../control-store";
import type { StoreError } from "../errors";
import type { Principal } from "../identity";

/**
 * Sessions (CONTRACT.md 1.1, K8): a browser tab sends `X-Plinth-Session: ses_<22 chars>`; the API upserts a
 * `member_sessions` row on first sight and refuses a revoked session with `UNAUTHENTICATED` and
 * `details.reason = "SESSION_REVOKED"`. A session belongs to the principal that first used it.
 */
export const SESSION_ID = /^ses_[A-Za-z0-9_-]{16,40}$/;

export const touchSession = (
  principal: Pick<Principal, "id" | "workspaceId">,
  sessionId: string,
  surface: "ui" | "mcp" | "api",
  label: string,
): Effect.Effect<void, DomainError | StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    if (!SESSION_ID.test(sessionId))
      return yield* Effect.fail(
        new DomainError({
          code: "VALIDATION_FAILED",
          path: "/x-plinth-session",
          message: "malformed session id",
        }),
      );
    yield* store(
      sql`INSERT INTO member_sessions (session_id, workspace_id, principal_id, surface, label)
          VALUES (${sessionId}, ${principal.workspaceId}, ${principal.id}, ${surface}, ${label.slice(0, 120)})
          ON CONFLICT (session_id) DO UPDATE SET last_seen_at = now()`,
    );
    const rows = yield* store(
      sql<{ principal_id: string; revoked_at: string | null }>`
        SELECT principal_id, revoked_at::text AS revoked_at FROM member_sessions WHERE session_id = ${sessionId}`,
    );
    const r = rows[0];
    if (!r || r.principal_id !== principal.id)
      return yield* Effect.fail(
        new DomainError({
          code: "UNAUTHENTICATED",
          path: "",
          message: "this session belongs to another principal",
        }),
      );
    if (r.revoked_at !== null)
      return yield* Effect.fail(
        new DomainError({
          code: "UNAUTHENTICATED",
          path: "",
          message: "this session was revoked",
          details: { reason: "SESSION_REVOKED" },
          fix_hint: "Sign in again.",
        }),
      );
  });

/** Is the session revoked? (The rt gateway asks on `session.revoked` and at hello.) */
export const sessionRevoked = (sessionId: string): Effect.Effect<boolean, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{
        revoked: boolean;
      }>`SELECT (revoked_at IS NOT NULL) AS revoked FROM member_sessions WHERE session_id = ${sessionId}`,
    );
    return rows[0]?.revoked ?? false;
  });
