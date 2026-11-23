import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest } from "@effect/platform";
import {
  ACTIONS,
  ActionInvokeIn,
  ActionsListIn,
  DiffInput,
  DomainError,
  type ActionDef,
  type Surface,
} from "@plinth/spec";
import {
  ChangeLog,
  coerceInput,
  invoke,
  listActions,
  type InvokeOutcome,
  type Principal,
} from "@plinth/engine";
import { authenticate, json, parseBody, queryParams, respond } from "./http";

/**
 * The Suite HTTP surface (CONTRACT.md section 5, K11): one route per registry entry at its own method and path, the
 * generic `GET /suite/actions` and `POST /suite/actions/:name`, and the kernel `GET /diff`. Every route calls the same
 * `invoke` as the MCP `action.invoke` tool, so a person and an agent reach the same code.
 */

const SESSION = /^ses_[A-Za-z0-9_-]{16,40}$/;

const bad = (path: string, message: string) => new DomainError({ code: "VALIDATION_FAILED", path, message });

/** `X-Plinth-Session` and a readable label from the User-Agent. Requests without the header are not tracked. */
const sessionOf = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest;
  const id = req.headers["x-plinth-session"];
  if (id === undefined) return { sessionId: undefined, sessionLabel: undefined, surface: "api" as Surface };
  if (!SESSION.test(id)) return yield* Effect.fail(bad("/x-plinth-session", "malformed session id"));
  const ua = req.headers["user-agent"] ?? "";
  const browser = /Firefox/.test(ua)
    ? "Firefox"
    : /Edg\//.test(ua)
      ? "Edge"
      : /Chrome/.test(ua)
        ? "Chrome"
        : /Safari/.test(ua)
          ? "Safari"
          : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Mac OS/.test(ua)
      ? "macOS"
      : /Linux/.test(ua)
        ? "Linux"
        : /Android/.test(ua)
          ? "Android"
          : /iPhone|iPad/.test(ua)
            ? "iOS"
            : "";
  return { sessionId: id, sessionLabel: os ? `${browser} on ${os}` : browser, surface: "ui" as Surface };
});

const bodyObject = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* req.text.pipe(Effect.mapError(() => bad("", "the request body could not be read")));
  if (text.trim() === "") return {} as Record<string, unknown>;
  const parsed = yield* Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: () => bad("", "request body is not valid JSON"),
  });
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    return yield* Effect.fail(bad("", "the request body must be a JSON object"));
  return parsed as Record<string, unknown>;
});

/** The wire form of an outcome on a per-action route: the output itself, or the held status. */
const dataOf = (o: InvokeOutcome): unknown => {
  switch (o.kind) {
    case "result":
      return o.replayed && o.data !== null && typeof o.data === "object" && !Array.isArray(o.data)
        ? { ...(o.data as Record<string, unknown>), replayed: true }
        : o.data;
    case "pending_approval":
      return {
        status: "pending_approval",
        approval_id: o.approval_id,
        approver_permission: o.approver_permission,
      };
    case "preview":
      return o.preview;
  }
};

const actionRoute = (def: ActionDef) =>
  HttpRouter.route(def.method)(
    def.path as `/${string}`,
    respond(
      Effect.gen(function* () {
        const p: Principal = yield* authenticate;
        const sess = yield* sessionOf;
        const params = (yield* HttpRouter.params) as Record<string, string | undefined>;
        const path: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(params)) if (v !== undefined) path[k] = decodeURIComponent(v);
        let input: Record<string, unknown>;
        if (def.method === "GET" || def.method === "DELETE") {
          const q = yield* queryParams;
          const raw: Record<string, unknown> = {};
          for (const [k, v] of q.entries()) raw[k] = v;
          input = { ...coerceInput(def.input, raw), ...coerceInput(def.input, path) };
        } else {
          const body = yield* bodyObject;
          input = { ...body, ...coerceInput(def.input, path) };
        }
        const out = yield* invoke({
          actor: {
            principal: p,
            surface: sess.surface,
            sessionId: sess.sessionId,
            sessionLabel: sess.sessionLabel,
          },
          name: def.name,
          input,
        });
        return json(200, { ok: true, data: dataOf(out) });
      }),
    ),
  );

const bool = (v: string | null): boolean | undefined => (v === null ? undefined : v === "true");

export const suiteRouter = ACTIONS.reduce(
  (r, def) => r.pipe(HttpRouter.concat(HttpRouter.empty.pipe(actionRoute(def)))),
  HttpRouter.empty.pipe(
    // the catalogue, filtered by what the viewer may call
    HttpRouter.get(
      "/suite/actions",
      respond(
        Effect.gen(function* () {
          const p = yield* authenticate;
          yield* sessionOf;
          const q = yield* queryParams;
          const input = yield* Schema.decodeUnknown(ActionsListIn, { onExcessProperty: "error" })({
            ...(q.get("module") ? { module: q.get("module") } : {}),
            ...(q.get("name") ? { name: q.get("name") } : {}),
            ...(q.get("include_schemas") ? { include_schemas: bool(q.get("include_schemas")) } : {}),
          }).pipe(Effect.mapError(() => bad("/", "invalid catalogue query")));
          return json(200, { ok: true, data: yield* listActions(p, input) });
        }),
      ),
    ),
    // invoke any entry by name, with the agent discipline (dry run, preview token, idempotency key)
    HttpRouter.post(
      "/suite/actions/:name",
      respond(
        Effect.gen(function* () {
          const p = yield* authenticate;
          const sess = yield* sessionOf;
          const { name } = yield* HttpRouter.params;
          const body = yield* parseBody(ActionInvokeIn);
          const out = yield* invoke({
            actor: {
              principal: p,
              surface: sess.surface,
              sessionId: sess.sessionId,
              sessionLabel: sess.sessionLabel,
            },
            name: decodeURIComponent(name ?? ""),
            input: body.input,
            dryRun: body.dry_run,
            previewToken: body.preview_token,
            idempotencyKey: body.idempotency_key,
            reason: body.reason,
          });
          return json(200, { ok: true, data: out });
        }),
      ),
    ),
    // the kernel diff, for the history screens: GET /diff?a=<node>@<rev>&b=<node>@<rev>
    HttpRouter.get(
      "/diff",
      respond(
        Effect.gen(function* () {
          const p = yield* authenticate;
          const q = yield* queryParams;
          const input = yield* Schema.decodeUnknown(DiffInput, { onExcessProperty: "error" })({
            a: q.get("a") ?? "",
            b: q.get("b") ?? "",
          }).pipe(Effect.mapError(() => bad("/a", "a and b look like dashboard:ops-board@3")));
          const split = (s: string) => ({
            ref: s.slice(0, s.lastIndexOf("@")),
            revision: Number(s.slice(s.lastIndexOf("@") + 1)),
          });
          const [a, b] = [split(input.a), split(input.b)];
          const log = yield* ChangeLog;
          const [na, nb] = [yield* log.resolve(p, a.ref), yield* log.resolve(p, b.ref)];
          const d = yield* log.diffRevisions(
            p,
            { uri: na.uri, revision: a.revision },
            { uri: nb.uri, revision: b.revision },
          );
          return json(200, { ok: true, data: d });
        }),
      ),
    ),
  ),
);
