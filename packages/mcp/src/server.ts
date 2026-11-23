import { Effect, Runtime } from "effect";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { type Principal } from "@plinth/engine";
import { TOOLS, callTool, type ToolDeps } from "./tools";

type Deps = ToolDeps;

/**
 * Wrap the official MCP SDK at the edge (ruling 22): every handler is an Effect run on the application runtime.
 * Domain refusals are envelopes with `ok: false`; only protocol problems (unknown tool) are JSON-RPC errors.
 */
export const makeServer = (principal: Principal, runtime: Runtime.Runtime<Deps>): Server => {
  const server = new Server({ name: "plinth", version: "0.1.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as { type: "object" },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, (req) =>
    Runtime.runPromise(runtime)(
      callTool(principal, req.params.name, req.params.arguments).pipe(
        Effect.map((env) => ({
          content: [{ type: "text" as const, text: JSON.stringify(env) }],
          isError: !env.ok,
        })),
        Effect.catchAll((e) =>
          (e as { _tag?: string })._tag === "UnknownTool"
            ? Effect.fail(new McpError(ErrorCode.MethodNotFound, `unknown tool '${req.params.name}'`))
            : Effect.fail(new McpError(ErrorCode.InternalError, "internal error")),
        ),
      ),
    ),
  );
  return server;
};
