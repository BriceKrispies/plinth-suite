import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { Clock, Effect, Either, PubSub, Queue, Runtime, Schedule, Schema, Stream } from "effect";
import { WebSocketServer, type WebSocket } from "ws";
import {
  COUNT_AFFECTING_EVENTS,
  ClientFrame,
  DomainError,
  PresentNotice,
  presentAddresses,
  toErrorBody,
  type DomainEventType,
  type ServerFrame,
} from "@plinth/spec";
import {
  AppConfig,
  Authorizer,
  CHANGES_CHANNEL,
  ChangeLog,
  ControlStore,
  DOMAIN_CHANNEL,
  Identity,
  PRESENT_CHANNEL,
  audienceOf,
  domainEventsSince,
  domainHead,
  navCounts,
  sessionRevoked,
  type Principal,
} from "@plinth/engine";

/**
 * Realtime gateway (spec 05 section 9.5): WebSocket `/rt`. Fan-out comes from Postgres: commits `NOTIFY plinth_changes`,
 * the gateway holds one dedicated LISTEN connection, and on every wake-up (plus a 1 s poll as the loss-proof
 * fallback) each subscription re-reads `changes` from its own cursor. Nothing in a notification carries authority.
 * `plinth_present` (ui.present) is forwarded as a `present` frame to the addressed principal's sockets, if it can read the node.
 */

interface Sub {
  /** "changes" (the change log, today's behaviour) or "domain" (CONTRACT.md 6.1). */
  stream: "changes" | "domain";
  nodes: ReadonlySet<string>;
  /** Domain stream only: deliver only these event types. */
  types: ReadonlyArray<DomainEventType> | undefined;
  through: number;
}

const decodeFrame = Schema.decodeUnknownEither(ClientFrame);
const decodeNotice = Schema.decodeUnknownEither(Schema.parseJson(PresentNotice));

export const gateway = Effect.gen(function* () {
  const cfg = yield* AppConfig;
  const log = yield* ChangeLog;
  const identity = yield* Identity;
  const authz = yield* Authorizer;
  const cs = yield* ControlStore;
  const runtime = yield* Effect.runtime<never>();
  const fork = Runtime.runFork(runtime);
  const runPromise = Runtime.runPromise(runtime);

  // one wake-up signal for the whole process
  const wake = yield* PubSub.unbounded<number>();
  yield* Effect.forkScoped(
    Stream.mergeAll(
      [
        cs.sql.listen(CHANGES_CHANNEL).pipe(
          Stream.catchAll(() => Stream.empty),
          Stream.map(() => 1),
        ),
        cs.sql.listen(DOMAIN_CHANNEL).pipe(
          Stream.catchAll(() => Stream.empty),
          Stream.map(() => 1),
        ),
        Stream.fromSchedule(Schedule.spaced("1 second")).pipe(Stream.map(() => 1)),
      ],
      { concurrency: 3 },
    ).pipe(Stream.runForEach(() => PubSub.publish(wake, 1))),
  );

  // `ui.present` notices (CONTRACT 6.3): every connection filters them for its own principal
  const presentBus = yield* PubSub.unbounded<PresentNotice>();
  yield* Effect.forkScoped(
    cs.sql.listen(PRESENT_CHANNEL).pipe(
      Stream.catchAll(() => Stream.empty),
      Stream.runForEach((raw) => {
        const n = decodeNotice(raw);
        return Either.isRight(n) ? PubSub.publish(presentBus, n.right) : Effect.void;
      }),
    ),
  );

  const connection = (ws: WebSocket) =>
    Effect.scoped(
      Effect.gen(function* () {
        const inbox = yield* Queue.unbounded<string>();
        const lock = yield* Effect.makeSemaphore(1);
        const subs = new Map<string, Sub>();
        let principal: Principal | undefined;
        /** The tab's `member_sessions` id (hello.client_id): revoking it closes this socket with 4401. */
        let clientId: string | undefined;
        let audience: { at: number; entries: ReadonlyArray<string> } | undefined;
        const audienceNow = (p: Principal) =>
          Effect.gen(function* () {
            if (audience && Date.now() - audience.at < 5000) return audience.entries;
            const entries = yield* audienceOf(p).pipe(Effect.provideService(Authorizer, authz));
            audience = { at: Date.now(), entries };
            return entries;
          });
        const sendCounts = (p: Principal) =>
          navCounts(p).pipe(
            Effect.provideService(Authorizer, authz),
            Effect.provideService(ControlStore, cs),
            Effect.flatMap((counts) => send({ t: "counts", counts })),
          );

        const send = (f: ServerFrame) =>
          Effect.sync(() => {
            if (ws.readyState === 1) ws.send(JSON.stringify(f));
          });
        const sendError = (e: DomainError, sub?: string) =>
          send({ t: "error", code: e.code, message: e.message, ...(sub !== undefined ? { sub } : {}) });

        ws.on("message", (d) => void fork(Queue.offer(inbox, d.toString())));
        ws.on("close", () => void fork(Queue.shutdown(inbox)));
        ws.on("error", () => void fork(Queue.shutdown(inbox)));
        // the first frame must be hello within 5 s
        yield* Effect.forkScoped(
          Effect.sleep("5 seconds").pipe(
            Effect.flatMap(() =>
              Effect.sync(() => (principal === undefined ? ws.close(4401, "hello required") : undefined)),
            ),
          ),
        );

        const flushDomain = (id: string, s: Sub) =>
          Effect.gen(function* () {
            for (;;) {
              const p = principal;
              if (!p) return;
              const aud = yield* audienceNow(p);
              const { items, through } = yield* domainEventsSince(p.workspaceId, aud, s.through, {
                types: s.types,
              }).pipe(Effect.provideService(ControlStore, cs));
              if (through <= s.through) return;
              const prev = s.through;
              s.through = through;
              if (items.length === 0) yield* send({ t: "progress", sub: id, through });
              else {
                yield* send({ t: "domain", sub: id, prev_through: prev, through, items });
                // a revoked session closes its own socket (4401)
                if (clientId !== undefined)
                  for (const e of items)
                    if (e.type === "session.revoked" && e.payload.session_id === clientId)
                      return yield* Effect.sync(() => ws.close(4401, "session revoked"));
                if (items.some((e) => COUNT_AFFECTING_EVENTS.includes(e.type))) yield* sendCounts(p);
              }
              const head = yield* domainHead(p.workspaceId).pipe(Effect.provideService(ControlStore, cs));
              if (through >= head) return;
            }
          });

        const flush = (id: string, s: Sub) =>
          s.stream === "domain" ? flushDomain(id, s) : flushChanges(id, s);

        const flushChanges = (id: string, s: Sub) =>
          Effect.gen(function* () {
            for (;;) {
              const p = principal;
              if (!p) return;
              const rows = yield* log.changesSince(p.workspaceId, p.workspaceSlug, s.through, 500);
              if (rows.length === 0) return;
              const prev = s.through;
              const through = rows[rows.length - 1]?.seq ?? prev;
              const items = rows.filter((r) => s.nodes.size === 0 || s.nodes.has(r.node));
              s.through = through;
              yield* send(
                items.length > 0
                  ? { t: "events", sub: id, prev_through: prev, through, items }
                  : { t: "progress", sub: id, through },
              );
              if (rows.length < 500) return;
            }
          });

        // suspend: the subscription set must be read at each wake, not once when this effect is built
        const flushAll = Effect.suspend(() =>
          Effect.forEach([...subs], ([id, s]) => flush(id, s), { discard: true }),
        ).pipe(
          Effect.catchAll((e) =>
            Effect.logWarning(`rt flush failed: ${(e as { message?: string }).message ?? e}`),
          ),
        );

        const handle = (raw: string) =>
          Effect.gen(function* () {
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw);
            } catch {
              return yield* sendError(
                new DomainError({ code: "VALIDATION_FAILED", path: "", message: "frame is not JSON" }),
              );
            }
            const frame = decodeFrame(parsed);
            if (Either.isLeft(frame))
              return yield* sendError(
                new DomainError({ code: "VALIDATION_FAILED", path: "", message: "malformed frame" }),
              );
            const f = frame.right;
            if (f.t === "hello") {
              const who = yield* identity.authenticate(f.token).pipe(Effect.either);
              if (Either.isLeft(who)) {
                yield* send({ t: "error", code: "UNAUTHENTICATED", message: "unknown bearer token" });
                return yield* Effect.sync(() => ws.close(4401, "unauthenticated"));
              }
              principal = who.right;
              clientId = f.client_id;
              if (
                clientId !== undefined &&
                (yield* sessionRevoked(clientId).pipe(Effect.provideService(ControlStore, cs)))
              ) {
                yield* send({ t: "error", code: "UNAUTHENTICATED", message: "this session was revoked" });
                return yield* Effect.sync(() => ws.close(4401, "session revoked"));
              }
              const head = yield* log.headSeq(principal.workspaceId);
              const domainSeq = yield* domainHead(principal.workspaceId).pipe(
                Effect.provideService(ControlStore, cs),
              );
              return yield* send({
                t: "welcome",
                session_id: clientId ?? randomUUID(),
                principal: principal.subject,
                head_seq: head,
                domain_head_seq: domainSeq,
              });
            }
            const p = principal;
            if (!p)
              return yield* sendError(
                new DomainError({ code: "UNAUTHENTICATED", path: "", message: "send hello first" }),
              );
            if (f.t === "unsubscribe") {
              subs.delete(f.sub);
              return;
            }
            const stream = f.stream ?? "changes";
            const nodes = new Set(f.nodes ?? f.uris ?? []);
            const since = f.since_seq ?? f.last_seq;
            const head =
              stream === "domain"
                ? yield* domainHead(p.workspaceId).pipe(Effect.provideService(ControlStore, cs))
                : yield* log.headSeq(p.workspaceId);
            const resume = since !== undefined && since <= head;
            const s: Sub = {
              stream,
              nodes,
              types: stream === "domain" ? f.types : undefined,
              through: resume ? since : head,
            };
            subs.set(f.sub, s);
            yield* send({
              t: "subscribed",
              sub: f.sub,
              mode: resume ? "resume" : "snapshot",
              from_seq: s.through,
              through_seq: head,
            });
            // the shell's counts are sent once when a domain subscription starts
            if (stream === "domain") yield* sendCounts(p);
            yield* flush(f.sub, s);
          }).pipe(
            Effect.catchAll((e) =>
              e instanceof DomainError
                ? sendError(e)
                : Effect.logWarning(`rt: ${(e as { message?: string }).message ?? e}`).pipe(
                    Effect.zipRight(
                      sendError(
                        new DomainError({
                          code: "RATE_LIMITED",
                          path: "",
                          message: "temporary failure, retry",
                          retryable: true,
                        }),
                      ),
                    ),
                  ),
            ),
          );

        // subscribe before the first read of the socket so no notice after `hello` is missed
        const presents = yield* PubSub.subscribe(presentBus);
        const deliverPresent = (n: PresentNotice) =>
          Effect.gen(function* () {
            const p = principal;
            if (!p || p.workspaceId !== n.ws || !presentAddresses(n, p.subject)) return;
            // the same read authorisation as change frames: an unreadable node is never named to this socket
            const readable = yield* log.resolve(p, n.node).pipe(Effect.either);
            if (Either.isLeft(readable)) return;
            const at = new Date(yield* Clock.currentTimeMillis).toISOString();
            yield* send({
              t: "present",
              node: readable.right.uri,
              target: n.target,
              focus: n.focus,
              by: n.by,
              at,
            });
          }).pipe(Effect.catchAll(() => Effect.void));
        yield* Effect.forkScoped(Stream.fromQueue(presents).pipe(Stream.runForEach(deliverPresent)));
        yield* Effect.forkScoped(
          Stream.fromPubSub(wake).pipe(Stream.runForEach(() => lock.withPermits(1)(flushAll))),
        );
        yield* Stream.fromQueue(inbox).pipe(Stream.runForEach((raw) => lock.withPermits(1)(handle(raw))));
      }),
    ).pipe(Effect.catchAllCause((c) => Effect.logDebug(`rt connection ended: ${String(c)}`)));

  const onHttp = (req: IncomingMessage, res: ServerResponse) => {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/healthz") return reply(200, { status: "ok" });
    if (req.url === "/readyz") {
      void runPromise(cs.ping.pipe(Effect.either)).then((r) =>
        Either.isRight(r)
          ? reply(200, { status: "ready", checks: { controlstore: { ok: true } } })
          : reply(503, { status: "not_ready", checks: { controlstore: { ok: false } } }),
      );
      return;
    }
    reply(404, {
      ok: false,
      error: toErrorBody(new DomainError({ code: "UNKNOWN_REFERENCE", path: "", message: "not found" })),
    });
  };

  const server = yield* Effect.acquireRelease(
    Effect.sync(() => createServer(onHttp)),
    (s) => Effect.async<void>((resume) => void s.close(() => resume(Effect.void))),
  );
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if ((req.url ?? "").split("?")[0] === "/rt")
      wss.handleUpgrade(req, socket, head, (ws) => void fork(connection(ws)));
    else socket.destroy();
  });
  yield* Effect.async<void>(
    (resume) => void server.listen(cfg.ports.rt, "0.0.0.0", () => resume(Effect.void)),
  );
  yield* Effect.logInfo(`plinth rt listening on :${cfg.ports.rt}/rt`);
  return yield* Effect.never;
});
