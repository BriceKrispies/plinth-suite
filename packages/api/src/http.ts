import { Effect, ParseResult, Schema } from "effect";
import { HttpServerRequest, HttpServerResponse } from "@effect/platform";
import { DomainError, decodeIssueToDomainError, httpStatusOf, toErrorBody } from "@plinth/spec";
import { Identity, type Principal } from "@plinth/engine";

/** Edge mapping (ruling 22): tagged errors become HTTP responses; domain codes map to the closed enum. */

export const json = (status: number, body: unknown) => HttpServerResponse.unsafeJson(body, { status });

export const parseBody = <A, I>(schema: Schema.Schema<A, I>) =>
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const raw = yield* req.json.pipe(
      Effect.mapError(
        () =>
          new DomainError({ code: "VALIDATION_FAILED", path: "", message: "request body is not valid JSON" }),
      ),
    );
    return yield* Schema.decodeUnknown(schema, { onExcessProperty: "error", errors: "first" })(raw).pipe(
      Effect.mapError((e: ParseResult.ParseError) => decodeIssueToDomainError(schema, raw, e)),
    );
  });

export const authenticate = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest;
  const identity = yield* Identity;
  return yield* identity.authenticate(req.headers["authorization"]);
});

export type Authed = Principal;

/** Turn any failure of a handler into a response. Infrastructure errors are 503/500 without leaking causes. */
export const respond = <R>(eff: Effect.Effect<HttpServerResponse.HttpServerResponse, unknown, R>) =>
  eff.pipe(
    Effect.catchAllDefect((d) =>
      Effect.logError(`defect: ${String((d as { message?: string }).message ?? d)}`).pipe(
        Effect.zipRight(
          Effect.fail(
            new DomainError({
              code: "VALIDATION_FAILED",
              path: "",
              message: "the request could not be processed",
              retryable: false,
            }),
          ),
        ),
      ),
    ),
    Effect.catchAll((e) => {
      if (e instanceof DomainError)
        return Effect.succeed(json(httpStatusOf(e.code), { ok: false, error: toErrorBody(e) }));
      const tag = (e as { _tag?: string })._tag ?? "Error";
      const msg = (e as { message?: string }).message ?? String(e);
      const status = tag === "StoreError" || tag === "BlobError" || tag === "EngineError" ? 503 : 500;
      return Effect.logError(`${tag}: ${msg}`).pipe(
        Effect.as(json(status, { ok: false, error: { code: tag, message: "internal error" } })),
      );
    }),
  );

export const queryParams = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest;
  return new URL(req.url, "http://localhost").searchParams;
});
