// Generic MCP client for driving Plinth by hand, the way an agent would.
//   tsx scripts/mcp-call.ts list                 -> tool names, descriptions and input schemas
//   tsx scripts/mcp-call.ts <tool> '<json args>' -> one tool call, prints the envelope
// Env: PLINTH_MCP_URL (default http://localhost:8790/mcp), PLINTH_MCP_TOKEN (default dev agent token).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.env.PLINTH_MCP_URL ?? "http://localhost:8790/mcp");
const token = process.env.PLINTH_MCP_TOKEN ?? "dev-agent-claude-code";
const [, , tool, rawArgs] = process.argv;

const transport = new StreamableHTTPClientTransport(url, {
  requestInit: { headers: { authorization: `Bearer ${token}` } },
});
const client = new Client({ name: "plinth-mcp-call", version: "0.1.0" });
await client.connect(transport);

if (!tool || tool === "list") {
  const { tools } = await client.listTools();
  for (const t of tools) {
    console.log(`## ${t.name}\n${t.description ?? ""}\n${JSON.stringify(t.inputSchema)}\n`);
  }
} else {
  const result = await client.callTool({ name: tool, arguments: rawArgs ? JSON.parse(rawArgs) : {} });
  for (const c of (result.content as Array<{ type: string; text?: string }>) ?? []) {
    if (c.type === "text" && c.text !== undefined) {
      try {
        console.log(JSON.stringify(JSON.parse(c.text), null, 2));
      } catch {
        console.log(c.text);
      }
    }
  }
}
await client.close();
