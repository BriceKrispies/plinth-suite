// Walks the demo beats with real browser windows and real MCP/API calls, saving screenshots.
//   tsx scripts/demo-capture.ts [outDir=shots/demo]
// Windows: Ops board (ops-lead), Exec view (emea-lead, same board), Finance (finance-analyst on finance-board).
import { chromium, type Page } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const [, , outDir = "shots/demo"] = process.argv;
mkdirSync(outDir, { recursive: true });
const web = process.env.PLINTH_WEB_URL ?? "http://localhost:5173";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const open = async (path: string, w = 1280, h = 900): Promise<Page> => {
  const p = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  p.on("pageerror", (e) => console.log(`[pageerror ${path}]`, e.message));
  await p.goto(web + path);
  await p.waitForLoadState("networkidle").catch(() => {});
  return p;
};
const shot = async (p: Page, name: string, full = false) => {
  await p.screenshot({ path: join(outDir, `${name}.png`), fullPage: full });
  console.log("shot", name);
};

const ops = await open("/d/ops-board?as=ops-lead");
const exec = await open("/d/ops-board?as=emea-lead");
const fin = await open("/d/finance-board?as=finance-analyst");
await sleep(2500);
await shot(ops, "01-ops-empty");
await shot(fin, "01-finance");

// Beat 2-3: the agent builds the ops board over MCP while the windows are open.
console.log(execFileSync("npx", ["-y", "tsx", "scripts/agent-build.ts", "1200"], { encoding: "utf8", shell: true }));
await sleep(1500);
await shot(ops, "02-ops-built");
await shot(ops, "02-ops-built-full", true);
await shot(exec, "02-exec-emea-view");

// Beat 5: the agent proposes a restricted grant; the finance analyst must approve it.
const mcp = new Client({ name: "demo-capture", version: "0.1.0" });
await mcp.connect(
  new StreamableHTTPClientTransport(new URL("http://localhost:8790/mcp"), {
    requestInit: { headers: { authorization: "Bearer dev-agent-claude-code" } },
  }),
);
const call = async (name: string, args: unknown) =>
  JSON.parse(
    ((await mcp.callTool({ name, arguments: args as Record<string, unknown> })).content as Array<{ text: string }>)[0]!
      .text,
  );
const before = await call("grant.check", {
  resource: "finance-board",
  action: "node:read",
  principal: "user:emea-lead",
  with_counts: true,
});
console.log("grant.check emea-lead before:", JSON.stringify(before.data ?? before.error));
const pv = await call("node.preview", {
  kind: "Grant",
  body: { principal: "user:emea-lead", actions: ["node:read"], resource: "finance-board", row_predicate: "region = 'EMEA'" },
});
const cm = await call("node.commit", { preview_token: pv.data.preview_token, idempotency_key: "demo-capture:grant" });
console.log("grant commit:", JSON.stringify(cm.data ?? cm.error));
await mcp.close();

const execFin = await open("/d/finance-board?as=emea-lead");
await sleep(2500);
await fin.reload();
await fin.waitForLoadState("networkidle").catch(() => {});
await sleep(2000);
await shot(fin, "03-finance-approval-pending");
await shot(execFin, "03-exec-finance-before");

// The finance analyst clicks Approve in her own window.
const approve = fin.getByRole("button", { name: /approve/i }).first();
if (await approve.count()) {
  await approve.click();
  console.log("clicked Approve");
} else {
  console.log("no Approve button found; approving through the API");
  await fetch("http://localhost:8782/approvals/" + cm.data.approval_id + "/decision", {
    method: "POST",
    headers: { authorization: "Bearer dev-finance-analyst", "content-type": "application/json" },
    body: JSON.stringify({ decision: "approve" }),
  });
}
await sleep(3000);
await shot(fin, "04-finance-approved");
await shot(execFin, "04-exec-finance-after");

// Beat 8: the presenter triggers the live fault; the feed slows EMEA/Crane handoffs.
const cue = await fetch("http://127.0.0.1:8795/control/fault/cue", {
  method: "POST",
  headers: { authorization: "Bearer dev-presenter-token", "content-type": "application/json" },
  body: "{}",
});
console.log("fault cue:", (await cue.text()).slice(0, 160));
await sleep(45_000);
await shot(ops, "05-ops-after-fault");

// Phone and wall views of the finished board.
const phone = await open("/d/ops-board?as=ops-lead", 390, 844);
await sleep(2500);
await shot(phone, "06-phone");
const wall = await open("/d/ops-board?as=ops-lead", 1920, 1080);
await sleep(2500);
await shot(wall, "06-wall");
await browser.close();
