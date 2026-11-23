// Demo driver: rebuild the Plinth Suite site piece by piece over MCP, the way an agent would, while people watch.
//   tsx scripts/rebuild-live.ts [--clear] [--look <calm|meridian|nocturne|folio|lattice|strata>] [--delay <ms>]
//     --clear   dry-run then commit site.clear first (the whole site goes to nothing)
//     --look    the site look to set (default calm)
//     --delay   milliseconds between steps (default 1200)
// Steps: set the look; create the home page empty; add its widgets one at a time; then restore the remaining default
// pages in small batches. Every step is a real action.invoke call. Env: PLINTH_MCP_URL (default
// http://localhost:8790/mcp), PLINTH_MCP_TOKEN (default dev agent token), as in scripts/mcp-call.ts.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { PAGES } from "../packages/spec/src/suite/default-pages";

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(`--${name}`);
const value = (name: string, dflt: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? (args[i + 1] as string) : dflt;
};
const delay = Number(value("delay", "1200"));
const look = value("look", "calm");
const BATCH = 4;

const url = new URL(process.env.PLINTH_MCP_URL ?? "http://localhost:8790/mcp");
const token = process.env.PLINTH_MCP_TOKEN ?? "dev-agent-claude-code";
const client = new Client({ name: "plinth-rebuild-live", version: "0.1.0" });
await client.connect(
  new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${token}` } } }),
);

interface Envelope {
  ok: boolean;
  data?: { kind: string; data?: unknown; preview?: { effect: string; preview_token: string } };
  error?: unknown;
}
const call = async (name: string, a: Record<string, unknown>): Promise<Envelope> => {
  const r = await client.callTool({ name, arguments: a });
  const text = (r.content as Array<{ type: string; text?: string }>)[0]?.text ?? "{}";
  return JSON.parse(text) as Envelope;
};
let n = 0;
const key = () => `rebuild-${Date.now()}-${++n}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (what: string, env: Envelope): never => {
  console.error(`${what} failed: ${JSON.stringify(env.error ?? env)}`);
  process.exit(1);
};

/** Run a direct action and print the step. */
const step = async (label: string, action: string, input: Record<string, unknown>) => {
  const env = await call("action.invoke", { action, input, idempotency_key: key() });
  if (!env.ok) fail(label, env);
  console.log(`${label}\n  ${JSON.stringify(env.data?.data)}`);
  await sleep(delay);
};

if (flag("clear")) {
  const dry = await call("action.invoke", { action: "site.clear", input: {}, dry_run: true });
  const preview = dry.data?.preview;
  if (!dry.ok || !preview) fail("site.clear dry run", dry);
  console.log(`site.clear dry run: ${preview?.effect}`);
  const done = await call("action.invoke", {
    action: "site.clear",
    preview_token: preview?.preview_token,
    idempotency_key: key(),
  });
  if (!done.ok) fail("site.clear", done);
  console.log(`site.clear committed: ${JSON.stringify(done.data?.data)}`);
  await sleep(delay * 2);
}

await step(`look: ${look}`, "site.appearance.set", { look });

const home = PAGES.find((p) => p.slug === "home");
if (!home) throw new Error("no default home page");
await step("page: home (empty)", "site.page.put", {
  slug: home.slug,
  title: home.title,
  route: home.route,
  description: home.description,
  kind: "home",
  ...(home.nav ? { nav: home.nav } : {}),
  items: [],
});
for (const item of home.items) {
  await step(`home + ${item.widget}`, "site.widget.add", {
    page: home.slug,
    widget: item.widget,
    config: item.config,
    size: item.size,
    at: { x: item.at[0], y: item.at[1], w: item.at[2], h: item.at[3] },
  });
}

const rest = PAGES.filter((p) => p.slug !== home.slug).map((p) => p.slug);
for (let i = 0; i < rest.length; i += BATCH) {
  const pages = rest.slice(i, i + BATCH);
  await step(`restore: ${pages.join(", ")}`, "site.restore", { pages });
}

console.log("done");
await client.close();
