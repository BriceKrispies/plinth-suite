// Beat 5 only: agent proposes a grant over MCP; the finance analyst approves it by clicking in her window.
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const web = process.env.PLINTH_WEB_URL ?? "http://localhost:5173";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch();
const fin = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await fin.goto(`${web}/d/finance-board?as=finance-analyst`);
await fin.waitForLoadState("networkidle").catch(() => {});
await sleep(1500);
const mcp = new Client({ name: "beat5", version: "0.1.0" });
await mcp.connect(new StreamableHTTPClientTransport(new URL("http://localhost:8790/mcp"), {
  requestInit: { headers: { authorization: "Bearer dev-agent-claude-code" } } }));
const call = async (n: string, a: unknown) => JSON.parse(((await mcp.callTool({ name: n, arguments: a as Record<string, unknown> })).content as Array<{ text: string }>)[0]!.text);
const pv = await call("node.preview", { kind: "Grant", body: { principal: "user:ops-lead", actions: ["node:read"], resource: "finance-board", row_predicate: "region = 'APAC'" } });
if (!pv.ok) { console.log("preview refused", JSON.stringify(pv.error)); process.exit(1); }
const cm = await call("node.commit", { preview_token: pv.data.preview_token, idempotency_key: `beat5:${Date.now()}` });
console.log("commit", JSON.stringify(cm.data ?? cm.error));
await mcp.close();
const btn = fin.getByRole("button", { name: /^approve/i }).first();
await btn.waitFor({ timeout: 15000 });
await fin.screenshot({ path: "shots/demo/07-approval-banner.png" });
await btn.click();
await sleep(2500);
await fin.screenshot({ path: "shots/demo/08-approved-by-click.png" });
console.log("approved by click");
await b.close();
