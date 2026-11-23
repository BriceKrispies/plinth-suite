import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Effect, Either, Layer, Logger, LogLevel, Runtime } from "effect";
import { NodeRuntime } from "@effect/platform-node";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AppConfig, EngineLive, Identity, parseDevTokens } from "@plinth/engine";
import type { ToolDeps } from "./tools";
import { makeServer } from "./server";

/**
 * Entrypoints:
 *   mcp --stdio --principal agent:claude-code   stdio; the token comes from PLINTH_MCP_TOKEN (dev: looked up
 *                                               from PLINTH_DEV_TOKENS); the flag is a startup assertion.
 *   mcp                                          Streamable HTTP on PLINTH_MCP_PORT (default 8790), path /mcp.
 */
const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const stdio = argv.includes("--stdio");
const asserted = flag("--principal");

const program = Effect.scoped(
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const identity = yield* Identity;
    const runtime = (yield* Effect.runtime<ToolDeps>()) as Runtime.Runtime<ToolDeps>;

    if (stdio) {
      const tokens = parseDevTokens(cfg.devTokens);
      const devToken = asserted ? [...tokens].find(([, subject]) => subject === asserted)?.[0] : undefined;
      const token = cfg.mcp.stdioToken._tag === "Some" ? cfg.mcp.stdioToken.value : devToken;
      const principal = yield* identity.authenticate(token);
      if (asserted && principal.subject !== asserted)
        return yield* Effect.die(new Error(`token belongs to ${principal.subject}, not ${asserted}`));
      const server = makeServer(principal, runtime);
      yield* Effect.promise(() => server.connect(new StdioServerTransport()));
      return yield* Effect.never;
    }

    const allowedOrigin = (o: string | undefined): boolean =>
      o === undefined || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
    const readBody = (req: IncomingMessage): Promise<unknown> =>
      new Promise((resolve) => {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            resolve(undefined);
          }
        });
      });
    const reply = (
      res: ServerResponse,
      status: number,
      body: unknown,
      headers: Record<string, string> = {},
    ) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    const handler = async (req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/healthz") return reply(res, 200, { status: "ok" });
      if (req.url !== "/mcp") return reply(res, 404, { error: "not found" });
      if (!allowedOrigin(req.headers.origin)) return reply(res, 403, { error: "origin not allowed" });
      if (req.method !== "POST") return reply(res, 405, { error: "method not allowed" }, { allow: "POST" });
      const who = await Runtime.runPromise(runtime)(
        identity.authenticate(req.headers.authorization).pipe(Effect.either),
      );
      if (Either.isLeft(who))
        return reply(
          res,
          401,
          { code: "UNAUTHENTICATED", message: "missing or unknown bearer token" },
          { "www-authenticate": 'Bearer realm="plinth"' },
        );
      const body = await readBody(req);
      const server = makeServer(who.right, runtime);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    };
    const http = createServer((req, res) => void handler(req, res));
    yield* Effect.acquireRelease(
      Effect.async<typeof http>(
        (resume) => void http.listen(cfg.ports.mcp, "0.0.0.0", () => resume(Effect.succeed(http))),
      ),
      (s) => Effect.async<void>((resume) => void s.close(() => resume(Effect.void))),
    );
    yield* Effect.logInfo(`plinth mcp listening on :${cfg.ports.mcp}/mcp`);
    return yield* Effect.never;
  }),
);

// stdout is the protocol channel in stdio mode, so the default logger is silenced there.
const quiet = stdio ? Logger.minimumLogLevel(LogLevel.None) : Layer.empty;
NodeRuntime.runMain(program.pipe(Effect.provide(EngineLive), Effect.provide(quiet)));
