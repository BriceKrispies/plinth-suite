import { createHash } from "node:crypto";
import type { Json, Op } from "@plinth/spec";
import { canonicalize } from "./canonical";

export const sha256 = (data: string | Uint8Array): Buffer => createHash("sha256").update(data).digest();
export const sha256Hex = (data: string | Uint8Array): string => sha256(data).toString("hex");

/** Genesis `prev_hash` of every workspace chain: 32 zero bytes (spec 02 section 3.9.9). */
export const GENESIS_HASH: Buffer = Buffer.alloc(32);

/**
 * `body_hash = sha256(JCS(B))` where B holds only apiVersion, kind, metadata and spec (spec 02 section 3.9.4).
 * Server-owned fields are not part of the body that reaches this function, and any stray key is dropped.
 */
export const bodyHash = (body: Json): Buffer => {
  const b = (body ?? {}) as { [k: string]: Json };
  const meta = (b["metadata"] ?? {}) as { [k: string]: Json };
  const B: { [k: string]: Json } = {
    apiVersion: b["apiVersion"] ?? null,
    kind: b["kind"] ?? null,
    metadata: {
      id: meta["id"] ?? null,
      slug: meta["slug"] ?? null,
      title: meta["title"] ?? null,
      labels: meta["labels"] ?? null,
    },
    spec: b["spec"] ?? null,
  };
  return sha256(canonicalize(B));
};

/**
 * Per-node change hash (spec 02 section 3.9.8): `sha256(JCS({target, ops, base_revisions}))`. It excludes surface,
 * actor, session, idempotency key, `replay_of` and every timestamp.
 */
export const changeHash = (target: string, ops: ReadonlyArray<Op>, baseRevision: number | null): Buffer =>
  sha256(canonicalize({ target, ops, base_revisions: { [target]: baseRevision } }));

/** Whole-request hash (05 section 8.4 step P0c): `sha256(canonical({targets, ops, base_revisions}))`. */
export const requestChangeHash = (
  changes: ReadonlyArray<{
    readonly target: string;
    readonly ops: ReadonlyArray<Op>;
    readonly base_revision: number | null;
  }>,
): Buffer =>
  sha256(
    canonicalize({
      targets: changes.map((c) => c.target),
      ops: changes.map((c) => c.ops),
      base_revisions: Object.fromEntries(changes.map((c) => [c.target, c.base_revision])),
    }),
  );

/** The fields of a change row that are hashed into the chain beyond `change_hash` (05 section 8.4 step 9). */
export interface ChainRowFields {
  readonly surface: string;
  readonly actor_id: string;
  readonly on_behalf_of: string | null;
  readonly approved_by: string | null;
  readonly approval_id: string | null;
  readonly session_id: string | null;
  readonly rule_id: ReadonlyArray<string>;
  readonly replay_of: string | null;
  readonly replay_change_hash: string | null;
  readonly recorded_actor: string | null;
  readonly reason: string | null;
  /** ISO 8601 UTC with millisecond precision, as stored. */
  readonly created_at: string;
  readonly virtual_at: string | null;
  readonly kind: string;
}

/** `hash = sha256(prev_hash || change_hash || canonical({...}))` (05 section 8.4 step 9; 05 owns this formula). */
export const chainRowHash = (prevHash: Uint8Array, change: Uint8Array, fields: ChainRowFields): Buffer =>
  sha256(Buffer.concat([prevHash, change, Buffer.from(canonicalize(fields), "utf8")]));

/** Preview and commit tokens: `pvt_` plus 43 URL-safe characters (256 bits). Only the hash is stored. */
export const tokenHash = (token: string): Buffer => sha256(token);
