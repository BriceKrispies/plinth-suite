import { randomBytes } from "node:crypto";
import { newId } from "./ids";
import { Effect, Either, Schema as S, SchemaAST as AST } from "effect";
import { canonicalize, sha256, sha256Hex, tokenHash } from "@plinth/core";
import {
  ACTIONS,
  DomainError,
  actionByName,
  compactJsonSchema,
  decodeIssueToDomainError,
  didYouMean,
  type ActionDef,
  type Surface,
} from "@plinth/spec";
import { AppConfig } from "../config";
import { PlinthClock } from "../clock";
import { Authorizer, forbidden } from "../authz";
import { ControlStore, store } from "../control-store";
import { StoreError } from "../errors";
import { Identity, type Principal } from "../identity";
import { asValidationFailed } from "../suite-validate";
import { announceDecision, closeHeld, fileActionApproval, loadHeld } from "./approvals-core";
import { HANDLERS } from "./handlers";
import { touchSession } from "./sessions";
import {
  isHeldRequest,
  type ActionCtx,
  type HandlerError,
  type HeldOutcome,
  type PreviewOutcome,
  type SuiteEnv,
} from "./types";

/**
 * The one action dispatcher (CONTRACT.md section 5). The per-action HTTP routes, `GET /suite/actions`,
 * `POST /suite/actions/:name` and the MCP tools `action.list` and `action.invoke` all call `invoke` and `listActions`,
 * so a person and an agent reach the same code, permission checks and events. `invoke`:
 *
 *  1. resolves the registry entry and checks the session (K8) and the agent policy (`deny`, `preview`, `approval`);
 *  2. authorises the permission on `plinth://<ws>/suite/<module>` (the decision, with its row predicate, goes to the handler);
 *  3. for a mutating call: a dry run returns an `ActionPreview` and a single-use `preview_token`; a commit runs in ONE
 *     SQL transaction that consumes the token, checks idempotency (`action_idempotency`), runs the handler found in the
 *     handler registry and records the result. An agent's `approval` action is not run but filed in `action_approvals`;
 *  4. encodes the output with the registry schema.
 *
 * Handlers append domain events (`emitFrom`) and notifications inside that transaction; the NOTIFY is delivered at COMMIT.
 */

export interface InvokeRequest {
  readonly actor: {
    readonly principal: Principal;
    readonly surface: Surface;
    readonly sessionId?: string | undefined;
    readonly sessionLabel?: string | undefined;
  };
  readonly name: string;
  /** Path, query and body parameters already merged into one object (see `coerceInput` for query strings). */
  readonly input?: Readonly<Record<string, unknown>> | undefined;
  readonly dryRun?: boolean | undefined;
  readonly previewToken?: string | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly reason?: string | undefined;
  /** Override the virtual time of the command (the seed replays history at each command's own timestamp). */
  readonly at?: Date | undefined;
}

export type InvokeOutcome =
  | { readonly kind: "result"; readonly action: string; readonly data: unknown; readonly replayed: boolean }
  | {
      readonly kind: "preview";
      readonly preview: {
        readonly action: string;
        readonly decision: "auto" | "approval";
        readonly effect: string;
        readonly facts: Readonly<Record<string, unknown>>;
        readonly input_hash: string;
        readonly preview_token: string;
        readonly expires_in_s: number;
      };
    }
  | {
      readonly kind: "pending_approval";
      readonly action: string;
      readonly approval_id: string;
      readonly approver_permission: string;
    };

type Failure = HandlerError;

const dom = (
  code: DomainError["code"],
  path: string,
  message: string,
  extra?: Partial<ConstructorParameters<typeof DomainError>[0]>,
) => new DomainError({ code, path, message, ...extra });

// ---- input ---------------------------------------------------------------------------------------------------------

type Kind = "number" | "boolean" | "array" | "string";

const kindOf = (ast: AST.AST): Kind => {
  switch (ast._tag) {
    case "NumberKeyword":
      return "number";
    case "BooleanKeyword":
      return "boolean";
    case "TupleType":
      return "array";
    case "Literal":
      return typeof ast.literal === "number"
        ? "number"
        : typeof ast.literal === "boolean"
          ? "boolean"
          : "string";
    case "Refinement":
      return kindOf(ast.from);
    case "Transformation":
      return kindOf(ast.from);
    case "Suspend":
      return kindOf(ast.f());
    case "Union": {
      const kinds = ast.types.map((t) => kindOf(t));
      const first = kinds.find((k) => k !== "string");
      return first !== undefined &&
        kinds.every((k) => k === first || k === "string") &&
        !kinds.includes("string")
        ? first
        : kinds.includes("string")
          ? "string"
          : (first ?? "string");
    }
    default:
      return "string";
  }
};

const elementKind = (ast: AST.AST): Kind => {
  if (ast._tag === "TupleType") {
    const el = ast.rest[0]?.type ?? ast.elements[0]?.type;
    return el ? kindOf(el) : "string";
  }
  if (ast._tag === "Refinement" || ast._tag === "Transformation")
    return elementKind(ast._tag === "Refinement" ? ast.from : ast.from);
  if (ast._tag === "Union") {
    for (const t of ast.types) if (t._tag === "TupleType") return elementKind(t);
  }
  return "string";
};

const props = (ast: AST.AST): ReadonlyArray<AST.PropertySignature> => {
  if (ast._tag === "TypeLiteral") return ast.propertySignatures;
  if (ast._tag === "Refinement" || ast._tag === "Transformation")
    return props(ast._tag === "Refinement" ? ast.from : ast.from);
  if (ast._tag === "Suspend") return props(ast.f());
  return [];
};

const num = (s: string): number | string => (s.trim() !== "" && Number.isFinite(Number(s)) ? Number(s) : s);

/**
 * Query strings are text. Coerce each value to the type the input schema declares for that key: numbers, booleans, and
 * comma-separated arrays (`status=placed,approved`). Unknown keys and string fields stay as they are, so a field that
 * is a string keeps a numeric-looking value intact.
 */
export const coerceInput = (
  schema: S.Schema.AnyNoContext,
  params: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const byKey = new Map(props(schema.ast).map((p) => [String(p.name), p.type] as const));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    const t = byKey.get(k);
    if (typeof v !== "string" || t === undefined) {
      out[k] = v;
      continue;
    }
    const kind = kindOf(t);
    if (kind === "number") out[k] = num(v);
    else if (kind === "boolean") out[k] = v === "true" ? true : v === "false" ? false : v;
    else if (kind === "array") {
      const ek = elementKind(t);
      const parts = v === "" ? [] : v.split(",");
      out[k] =
        ek === "number"
          ? parts.map(num)
          : ek === "boolean"
            ? parts.map((x) => (x === "true" ? true : x === "false" ? false : x))
            : parts;
    } else out[k] = v;
  }
  return out;
};

const decodeInput = (def: ActionDef, raw: unknown): Effect.Effect<unknown, DomainError> =>
  S.decodeUnknown(def.input, { onExcessProperty: "error", errors: "first" })(raw ?? {}).pipe(
    Effect.mapError((e) => asValidationFailed(decodeIssueToDomainError(def.input, raw ?? {}, e))),
  );

const encodeOutput = (def: ActionDef, value: unknown): Effect.Effect<unknown, StoreError> =>
  S.encodeUnknown(def.output, { onExcessProperty: "ignore" })(value).pipe(
    Effect.mapError(
      (e) =>
        new StoreError({
          message: `output of ${def.name} does not match its schema: ${String(e.message).slice(0, 300)}`,
        }),
    ),
  );

const jsonRoundTrip = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null));

// ---- context -------------------------------------------------------------------------------------------------------

/**
 * The permission the dispatcher itself checks. A few registry entries describe a rule rather than one permission
 * (`approval:decide + approver permission`, `varies (...)`); for those the dispatcher checks the baseline and the handler
 * enforces the rest (the approver permission, the per-transition permission).
 */
const baselinePermission = (def: ActionDef): string =>
  def.permission.startsWith("approval:decide")
    ? "approval:decide"
    : def.permission.startsWith("varies")
      ? "suite:use"
      : def.permission;

const moduleResource = (p: Principal, def: ActionDef): string =>
  `plinth://${p.workspaceSlug}/suite/${def.module}`;

const delegatorOf = (
  p: Principal,
): Effect.Effect<Principal | undefined, DomainError | StoreError, Identity> =>
  p.kind === "agent" && p.delegatorSubject
    ? Identity.pipe(Effect.flatMap((id) => id.bySubject(p.delegatorSubject as string)))
    : Effect.succeed(undefined);

const defaultPreview = (def: ActionDef): PreviewOutcome => ({
  effect: `Run ${def.name}`,
  facts: { action: def.name },
});

const keyOf = (req: InvokeRequest, input: unknown): string | undefined => {
  const fromInput = (input as { idempotency_key?: unknown } | null)?.idempotency_key;
  return req.idempotencyKey ?? (typeof fromInput === "string" ? fromInput : undefined);
};

// ---- the held-action decision --------------------------------------------------------------------------------------

/**
 * Approve a held action: separation of duties and the approver permission are checked, then the stored input runs as
 * the original requester (`ctx.approvedBy` set, `ctx.approvalId` set), inside a savepoint so a refusing handler leaves
 * the approval `failed` instead of rolling the decision back. Called through `ActionCtx.executeHeld`.
 */
const executeHeldImpl =
  (base: { readonly surface: Surface; readonly sessionId: string | undefined; readonly now: Date }) =>
  (approvalId: string, approver: Principal): Effect.Effect<HeldOutcome, Failure, SuiteEnv> =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const authz = yield* Authorizer;
      const identity = yield* Identity;
      const ws = approver.workspaceId;
      const held = yield* loadHeld(ws, approvalId, base.now);
      if (held.status !== "pending_approval")
        return yield* Effect.fail(
          dom("CONFLICT", "/approval_id", `approval is already ${held.status}`, {
            details: { reason: "INVALID_TRANSITION", from: held.status, allowed: [] },
          }),
        );
      const ids = yield* store(
        sql<{ principal_id: string; subject: string; kind: Principal["kind"] }>`
          SELECT principal_id, subject, kind FROM principals
          WHERE workspace_id = ${ws} AND principal_id IN (${held.requester_id}, ${held.on_behalf_of ?? held.requester_id})`,
      );
      const requesterRow = ids.find((x) => x.principal_id === held.requester_id);
      const behalfRow = held.on_behalf_of ? ids.find((x) => x.principal_id === held.on_behalf_of) : undefined;
      if (!requesterRow)
        return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/approval_id", "the requester no longer exists"));
      const resource = `plinth://${approver.workspaceSlug}/suite/approvals`;
      const denied = yield* authz.checkApprover(approver, {
        requesterSubject: requesterRow.subject,
        requesterKind: requesterRow.kind,
        onBehalfOfSubject: behalfRow?.subject ?? null,
        resource,
        approverPermission: held.approver_permission,
      });
      if (denied)
        return yield* Effect.fail(
          new DomainError({
            ...forbidden(denied, resource),
            message:
              denied.reason === "sod_violation"
                ? `separation of duties: ${approver.subject} may not decide this (${denied.policy})`
                : `${approver.subject} lacks ${denied.permission ?? "the permission"} (${denied.reason})`,
            details: { reason: denied.reason, policy: denied.policy, permission: denied.permission },
          }),
        );
      if (held.expired) {
        yield* store(sql`UPDATE action_approvals SET status = 'expired' WHERE approval_id = ${approvalId}`);
        return yield* Effect.fail(
          dom("CONFLICT", "/approval_id", "the approval expired", {
            details: { reason: "INVALID_TRANSITION", from: "expired" },
          }),
        );
      }
      const def = actionByName(held.action);
      const handler = def ? HANDLERS[def.name] : undefined;
      if (!def || !handler)
        return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/action", `no handler for '${held.action}'`));
      const requester = yield* identity.bySubject(requesterRow.subject);
      const behalf = behalfRow ? yield* identity.bySubject(behalfRow.subject) : undefined;
      const ctx = yield* makeCtx(def, requester, behalf, base, undefined, approver, approvalId, undefined);
      const input = yield* decodeInput(def, held.input);
      const ran = yield* Effect.either(
        sql.withTransaction(handler.run(input, ctx)).pipe(Effect.mapError((e) => e as Failure)),
      );
      const emitCtx = {
        principal: approver,
        surface: base.surface,
        sessionId: base.sessionId,
        now: base.now,
      };
      if (Either.isLeft(ran)) {
        const err =
          ran.left instanceof DomainError
            ? { code: ran.left.code, message: ran.left.message }
            : { code: "INTERNAL", message: "handler failed" };
        yield* store(
          sql`UPDATE action_approvals SET status = 'failed', decided_by = ${approver.id}, decided_at = ${base.now.toISOString()}::timestamptz,
                     error = ${JSON.stringify(err)}::jsonb WHERE approval_id = ${approvalId}`,
        );
        yield* announceDecision(emitCtx, held, "approve", "failed", approver);
        return { status: "failed", error: err } satisfies HeldOutcome;
      }
      const result = isHeldRequest(ran.right)
        ? { status: "pending_approval" }
        : yield* encodeOutput(def, ran.right);
      yield* store(
        sql`UPDATE action_approvals SET status = 'approved', decided_by = ${approver.id}, decided_at = ${base.now.toISOString()}::timestamptz,
                   result = ${JSON.stringify(jsonRoundTrip(result))}::jsonb WHERE approval_id = ${approvalId}`,
      );
      yield* announceDecision(emitCtx, held, "approve", "approved", approver);
      return { status: "approved", result } satisfies HeldOutcome;
    });

/** Reject or withdraw a held action (no handler runs): used by `approvals.decide` and `approvals.withdraw`. */
export const closeHeldAction = (
  actor: Principal,
  approvalId: string,
  how: "reject" | "withdraw",
  reason: string | undefined,
  base: { readonly surface: Surface; readonly sessionId: string | undefined; readonly now: Date },
): Effect.Effect<{ status: "rejected" | "withdrawn" }, Failure, SuiteEnv> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const authz = yield* Authorizer;
    const ws = actor.workspaceId;
    const held = yield* loadHeld(ws, approvalId, base.now);
    if (held.status !== "pending_approval")
      return yield* Effect.fail(
        dom("CONFLICT", "/approval_id", `approval is already ${held.status}`, {
          details: { reason: "INVALID_TRANSITION", from: held.status, allowed: [] },
        }),
      );
    if (how === "withdraw" && held.requester_id !== actor.id)
      return yield* Effect.fail(
        dom("FORBIDDEN", "/approval_id", "only the requester may withdraw", {
          details: { reason: "not_requester" },
        }),
      );
    if (how === "reject") {
      const ids = yield* store(
        sql<{
          subject: string;
          kind: Principal["kind"];
        }>`SELECT subject, kind FROM principals WHERE principal_id = ${held.requester_id}`,
      );
      const behalf = held.on_behalf_of
        ? yield* store(
            sql<{
              subject: string;
            }>`SELECT subject FROM principals WHERE principal_id = ${held.on_behalf_of}`,
          )
        : [];
      const resource = `plinth://${actor.workspaceSlug}/suite/approvals`;
      const denied = yield* authz.checkApprover(actor, {
        requesterSubject: ids[0]?.subject ?? "",
        requesterKind: ids[0]?.kind ?? "agent",
        onBehalfOfSubject: behalf[0]?.subject ?? null,
        resource,
        approverPermission: held.approver_permission,
      });
      if (denied) return yield* Effect.fail(forbidden(denied, resource));
    }
    const status = how === "reject" ? ("rejected" as const) : ("withdrawn" as const);
    const emitCtx = { principal: actor, surface: base.surface, sessionId: base.sessionId, now: base.now };
    yield* closeHeld(emitCtx, held, status, actor, reason);
    yield* announceDecision(emitCtx, held, how, status, actor);
    return { status };
  });

const makeCtx = (
  def: ActionDef,
  principal: Principal,
  onBehalfOf: Principal | undefined,
  base: { readonly surface: Surface; readonly sessionId: string | undefined; readonly now: Date },
  allow: ActionCtx["allow"],
  approvedBy: Principal | undefined,
  approvalId: string | undefined,
  idempotencyKey: string | undefined,
): Effect.Effect<ActionCtx> =>
  Effect.succeed({
    action: def,
    principal,
    onBehalfOf,
    surface: base.surface,
    sessionId: base.sessionId,
    now: base.now,
    allow,
    approvedBy,
    approvalId,
    idempotencyKey,
    executeHeld: executeHeldImpl(base),
  });

// ---- invoke --------------------------------------------------------------------------------------------------------

const consumeToken = (
  ws: string,
  principalId: string,
  token: string,
  consumer: string,
): Effect.Effect<
  | {
      action: string;
      input: unknown;
      effect: string;
      decision: "auto" | "approval";
      approver_permission?: string;
    }
  | undefined,
  StoreError,
  ControlStore
> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{
        payload: {
          kind?: string;
          action?: string;
          input?: unknown;
          effect?: string;
          decision?: "auto" | "approval";
          approver_permission?: string;
        };
      }>`
        UPDATE preview_tokens SET consumed_at = now(), consumed_by = ${consumer}
        WHERE token_hash = ${tokenHash(token)} AND workspace_id = ${ws} AND principal_id = ${principalId}
          AND consumed_at IS NULL AND expires_at > now()
        RETURNING payload`,
    );
    const p = rows[0]?.payload;
    if (!p || p.kind !== "action" || typeof p.action !== "string") return undefined;
    return {
      action: p.action,
      input: p.input,
      effect: p.effect ?? "",
      decision: p.decision ?? "auto",
      ...(p.approver_permission !== undefined ? { approver_permission: p.approver_permission } : {}),
    };
  });

/** Run one action. See the module comment for the contract. */
export const invoke = (req: InvokeRequest): Effect.Effect<InvokeOutcome, Failure, SuiteEnv> =>
  Effect.gen(function* () {
    const def = actionByName(req.name);
    if (!def) {
      const names = ACTIONS.map((a) => a.name);
      return yield* Effect.fail(
        dom("UNKNOWN_REFERENCE", "/action", `no action '${req.name}'`, {
          allowed: names.slice(0, 20),
          did_you_mean: didYouMean(req.name, names),
          fix_hint: "action.list returns the registry.",
        }),
      );
    }
    const p = req.actor.principal;
    const cfg = yield* AppConfig;
    const clock = yield* PlinthClock;
    const authz = yield* Authorizer;
    const { sql } = yield* ControlStore;
    const now = req.at ?? (yield* clock.virtualNow);
    const base = { surface: req.actor.surface, sessionId: req.actor.sessionId, now };

    if (req.actor.sessionId)
      yield* touchSession(
        p,
        req.actor.sessionId,
        req.actor.surface === "mcp" ? "mcp" : req.actor.surface === "ui" ? "ui" : "api",
        req.actor.sessionLabel ?? (req.actor.surface === "mcp" ? "MCP" : "Browser"),
      );
    if (def.permission === "none" && !cfg.devOpenTokens)
      return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/action", "not found"));

    const agent = p.kind === "agent";
    if (agent && def.agent === "deny")
      return yield* Effect.fail(
        dom("FORBIDDEN", "", `${def.name} is not available to agents`, {
          details: { reason: "ceiling_denies", permission: def.permission, action: def.name },
          fix_hint: "Do not retry. A person must do this in the UI.",
          retryable: false,
        }),
      );
    const allow =
      def.permission === "authenticated" || def.permission === "none"
        ? undefined
        : yield* authz.require(p, baselinePermission(def), moduleResource(p, def));
    const handler = HANDLERS[def.name];
    if (!handler)
      return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/action", `no handler registered for ${def.name}`));
    const onBehalfOf = def.mutating || agent ? yield* delegatorOf(p) : undefined;

    // ---- reads: no transaction, no idempotency ---------------------------------------------------------------------
    if (!def.mutating) {
      const input = yield* decodeInput(def, req.input);
      const ctx = yield* makeCtx(def, p, onBehalfOf, base, allow, undefined, undefined, undefined);
      const out = yield* handler.run(input, ctx);
      if (isHeldRequest(out))
        return yield* Effect.fail(dom("VALIDATION_FAILED", "", "a read cannot be held"));
      return {
        kind: "result",
        action: def.name,
        data: yield* encodeOutput(def, out),
        replayed: false,
      } as const;
    }

    const gated = agent && (def.agent === "preview" || def.agent === "approval");

    // ---- dry run ---------------------------------------------------------------------------------------------------
    if (req.dryRun === true) {
      const input = yield* decodeInput(def, req.input);
      const ctx = yield* makeCtx(def, p, onBehalfOf, base, allow, undefined, undefined, keyOf(req, input));
      const outcome = handler.preview ? yield* handler.preview(input, ctx) : defaultPreview(def);
      const decision: "auto" | "approval" =
        agent && def.agent === "approval" ? "approval" : (outcome.decision ?? "auto");
      const token = "pvt_" + randomBytes(32).toString("base64url");
      const stored = jsonRoundTrip(input);
      yield* store(
        sql`INSERT INTO preview_tokens (token_hash, workspace_id, principal_id, change_hash, base_revisions, payload, expires_at)
            VALUES (${tokenHash(token)}, ${p.workspaceId}, ${p.id}, ${sha256(canonicalize(stored))}, '{}'::jsonb,
                    ${JSON.stringify({ kind: "action", action: def.name, input: stored, effect: outcome.effect, decision, ...(outcome.approverPermission ? { approver_permission: outcome.approverPermission } : {}) })}::jsonb,
                    now() + make_interval(secs => ${cfg.previewTtlS}))`,
      );
      return {
        kind: "preview",
        preview: {
          action: def.name,
          decision,
          effect: outcome.effect,
          facts: outcome.facts,
          input_hash: sha256Hex(canonicalize(stored)),
          preview_token: token,
          expires_in_s: cfg.previewTtlS,
        },
      } as const;
    }

    // an agent never commits a gated action without a token
    if (gated && !req.previewToken)
      return yield* Effect.fail(
        dom("PREVIEW_REQUIRED", "", `${def.name} needs a dry run first`, {
          suggestion: {
            kind: "call",
            tool: "action.invoke",
            arguments: { action: def.name, input: req.input ?? {}, dry_run: true },
          },
        }),
      );
    if (gated && !req.idempotencyKey)
      return yield* Effect.fail(
        dom("VALIDATION_FAILED", "/idempotency_key", "an idempotency_key is required to commit", {
          expected: "8 to 128 of [A-Za-z0-9:._-]",
        }),
      );

    // ---- commit: one transaction -----------------------------------------------------------------------------------
    const commit = Effect.gen(function* () {
      let raw: unknown = req.input;
      let decision: "auto" | "approval" = "auto";
      let summary = `Run ${def.name}`;
      let approverPermission: string | undefined;
      if (req.previewToken) {
        const t = yield* consumeToken(p.workspaceId, p.id, req.previewToken, newId());
        if (!t || t.action !== def.name)
          return yield* Effect.fail(
            dom(
              "PREVIEW_REQUIRED",
              "",
              "the preview token is missing, spent, expired, for another action or principal",
              {
                suggestion: {
                  kind: "call",
                  tool: "action.invoke",
                  arguments: { action: def.name, input: req.input ?? {}, dry_run: true },
                },
              },
            ),
          );
        raw = t.input;
        decision = t.decision;
        summary = t.effect || summary;
        approverPermission = t.approver_permission;
      }
      const input = yield* decodeInput(def, raw);
      const key = keyOf(req, input);

      // idempotency (lock order position 2): insert-or-skip, then lock the row
      const reqHash = sha256(canonicalize({ action: def.name, input: stripKey(input) }));
      let replay: InvokeOutcome | undefined;
      if (key !== undefined) {
        yield* store(
          sql`INSERT INTO action_idempotency (workspace_id, principal_id, idempotency_key, action, request_hash, result)
              VALUES (${p.workspaceId}, ${p.id}, ${key}, ${def.name}, ${reqHash}, '{}'::jsonb)
              ON CONFLICT DO NOTHING`,
        );
        const rec = yield* store(
          sql<{ action: string; request_hash: Buffer; result: Record<string, unknown> }>`
            SELECT action, request_hash, result FROM action_idempotency
            WHERE workspace_id = ${p.workspaceId} AND principal_id = ${p.id} AND idempotency_key = ${key} FOR UPDATE`,
        );
        const r = rec[0];
        if (r && Object.keys(r.result).length > 0) {
          if (r.action !== def.name || Buffer.compare(r.request_hash, reqHash) !== 0)
            return yield* Effect.fail(
              dom(
                "IDEMPOTENCY_KEY_REUSED",
                "",
                "this idempotency key was already used with a different request",
                {
                  expected: "a new key for a new request, or the same request again",
                },
              ),
            );
          replay = r.result as unknown as InvokeOutcome;
        }
      }
      if (replay) {
        return replay.kind === "result" ? ({ ...replay, replayed: true } as InvokeOutcome) : replay;
      }

      const ctx = yield* makeCtx(def, p, onBehalfOf, base, allow, undefined, undefined, key);
      let outcome: InvokeOutcome;
      if (gated && (def.agent === "approval" || decision === "approval")) {
        const perm = approverPermission ?? "grant:write";
        const filed = yield* fileActionApproval(ctx, {
          action: def.name,
          input: jsonRoundTrip(input),
          approverPermission: perm,
          summary,
          idempotencyKey: key ?? newId(),
        });
        outcome = {
          kind: "pending_approval",
          action: def.name,
          approval_id: filed.approvalId,
          approver_permission: perm,
        };
      } else {
        const out = yield* handler.run(input, ctx);
        if (isHeldRequest(out)) {
          const filed = yield* fileActionApproval(ctx, {
            action: def.name,
            input: jsonRoundTrip(input),
            approverPermission: out.approverPermission,
            summary: out.summary,
            idempotencyKey: key ?? newId(),
          });
          outcome = {
            kind: "pending_approval",
            action: def.name,
            approval_id: filed.approvalId,
            approver_permission: out.approverPermission,
          };
        } else {
          outcome = {
            kind: "result",
            action: def.name,
            data: yield* encodeOutput(def, out),
            replayed: false,
          };
        }
      }
      if (key !== undefined)
        yield* store(
          sql`UPDATE action_idempotency SET result = ${JSON.stringify(jsonRoundTrip(outcome))}::jsonb
              WHERE workspace_id = ${p.workspaceId} AND principal_id = ${p.id} AND idempotency_key = ${key}`,
        );
      return outcome;
    });

    return yield* store(sql.withTransaction(commit)).pipe(
      Effect.catchIf(
        (e) =>
          e._tag === "StoreError" &&
          (e as StoreError).sqlstate === "23514" &&
          String(e.message).includes("balance"),
        () =>
          Effect.fail(
            dom("CONFLICT", "", "the debit would take a balance below zero", {
              details: { reason: "INSUFFICIENT_POINTS" },
            }),
          ),
      ),
    );
  });

const stripKey = (input: unknown): unknown => {
  if (input === null || typeof input !== "object") return input;
  const { idempotency_key: _k, ...rest } = input as Record<string, unknown>;
  return rest;
};

// ---- catalogue -----------------------------------------------------------------------------------------------------

export interface CatalogEntry {
  readonly name: string;
  readonly module: string;
  readonly method: string;
  readonly path: string;
  readonly permission: string;
  readonly mutating: boolean;
  readonly agent: "direct" | "preview" | "approval" | "deny";
  readonly summary: string;
  readonly reasons: ReadonlyArray<string>;
  readonly events: ReadonlyArray<string>;
  readonly input_schema?: unknown;
  readonly output_schema?: unknown;
}

/**
 * The catalogue the viewer may call: every registry entry whose permission the viewer holds (`authenticated` entries
 * always), and for an agent only entries whose policy is not `deny`. `name` or `include_schemas` adds the JSON Schemas.
 */
export const listActions = (
  p: Principal,
  q: {
    readonly module?: string | undefined;
    readonly name?: string | undefined;
    readonly include_schemas?: boolean | undefined;
  },
): Effect.Effect<{ items: ReadonlyArray<CatalogEntry> }, Failure, Authorizer | AppConfig> =>
  Effect.gen(function* () {
    const authz = yield* Authorizer;
    const cfg = yield* AppConfig;
    const withSchemas = q.include_schemas ?? q.name !== undefined;
    const cache = new Map<string, boolean>();
    const items: CatalogEntry[] = [];
    for (const def of ACTIONS) {
      if (q.module !== undefined && def.module !== q.module) continue;
      if (q.name !== undefined && def.name !== q.name) continue;
      if (p.kind === "agent" && def.agent === "deny") continue;
      if (def.permission === "none" && !cfg.devOpenTokens) continue;
      if (def.permission !== "authenticated" && def.permission !== "none") {
        const k = `${baselinePermission(def)}|${def.module}`;
        let ok = cache.get(k);
        if (ok === undefined) {
          const d = yield* authz.authorize(p, baselinePermission(def), moduleResource(p, def));
          ok = d.kind === "allow";
          cache.set(k, ok);
        }
        if (!ok) continue;
      }
      items.push({
        name: def.name,
        module: def.module,
        method: def.method,
        path: def.path,
        permission: def.permission,
        mutating: def.mutating,
        agent: def.agent,
        summary: def.summary,
        reasons: def.reasons,
        events: def.events,
        ...(withSchemas
          ? {
              input_schema: compactJsonSchema(def.input, false),
              output_schema: compactJsonSchema(def.output, false),
            }
          : {}),
      });
    }
    return { items };
  });

/**
 * Convenience for engines, the worker and the seed: run an action as `principal` on the system (or any) surface,
 * failing if it is held or is a preview. Returns the encoded output.
 */
export const callAction = (
  principal: Principal,
  name: string,
  input: Readonly<Record<string, unknown>>,
  opts?: { readonly surface?: Surface; readonly at?: Date; readonly idempotencyKey?: string },
): Effect.Effect<unknown, Failure, SuiteEnv> =>
  invoke({
    actor: { principal, surface: opts?.surface ?? "system" },
    name,
    input,
    at: opts?.at,
    idempotencyKey: opts?.idempotencyKey,
  }).pipe(
    Effect.flatMap((o) =>
      o.kind === "result"
        ? Effect.succeed(o.data)
        : Effect.fail(
            dom("CONFLICT", "", `${name} did not complete: ${o.kind}`, {
              details: { reason: "HELD", outcome: o.kind },
            }),
          ),
    ),
  );
