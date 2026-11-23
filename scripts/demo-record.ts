// Records the seeded stack's API traffic for the static GitHub Pages demo (packages/demo-data/recordings).
//   tsx scripts/demo-record.ts [outDir=packages/demo-data/recordings]
// Needs the live local stack (make up, make demo-reset, make dev, and the town dev server behind /town):
//   PLINTH_WEB_URL (default http://localhost:5173), PLINTH_API_URL (default http://localhost:8782).
//
// 1. Browse: for each persona, every classic route (the route-sweep list), the identity picker, sub-routes found in
//    links (people, products, threads, ...), and every town route, with light interaction (tabs, one "Load more",
//    one expanded row, the command palette). Every /api request and its JSON response is captured; domain events
//    arriving on /rt are kept as material for the demo's live loop.
// 2. Fill gaps: every read seen for any persona is replayed for every persona, and every non-mutating registry
//    action is called with `{}` for every persona, straight against the API.
// 3. Write: <persona>.json (requests -> response hashes, plus responses only that persona uses), shared.json
//    (responses two or more personas use) and manifest.json (personas, routes, empty shapes, sample events).
// Writes the UI makes while browsing reach the API but are not recorded; the demo simulates writes itself.
import { chromium, type BrowserContext, type Page } from "playwright";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [, , outDir = "packages/demo-data/recordings"] = process.argv;
const WEB = (process.env.PLINTH_WEB_URL ?? "http://localhost:5173").replace(/\/$/, "");
const API = (process.env.PLINTH_API_URL ?? "http://localhost:8782").replace(/\/$/, "");

/** Ops lead + admin, marketing, member, finance, admin (IT), regional manager, content editor. */
const PERSONAS = [
  "maya-ortiz",
  "tomas-alvarez",
  "ana-silva",
  "priya-nair",
  "samir-haddad",
  "jonas-becker",
  "leah-okafor",
];
const DEFAULT_PERSONA = "maya-ortiz";

// prettier-ignore
const CLASSIC_ROUTES = [
  "/", "/admin", "/admin/grants", "/admin/program", "/admin/roles", "/approvals", "/audit", "/automations",
  "/automations/new", "/badges", "/calendar", "/content", "/content/new", "/ledger", "/messages", "/messages/new",
  "/news", "/notifications", "/people", "/people/ana-silva", "/points", "/points/award", "/profile", "/promotions",
  "/promotions/new", "/reports", "/search?q=fleece", "/segments", "/segments/new", "/settings", "/store",
  "/store/cart", "/store/inventory", "/store/manage", "/store/orders", "/store/wishlist", "/tasks", "/tasks/all",
];
const BOROUGHS = ["insight", "admin", "engage", "rewards", "square", "personal", "operate", "newtown"];
const TOWN_ROUTES = [
  "/town/",
  ...BOROUGHS.map((b) => `/town/city/b/${b}`),
  "/town/points",
  "/town/points/statement",
  "/town/points/transfer",
];
/** Discovered sub-routes: at most this many per pattern and per persona. */
const PER_PATTERN = 3;
const DISCOVERED_MAX = 80;
/** Gap fill: at most this many distinct inputs per action. */
const INPUTS_PER_ACTION = 40;
const VOLATILE = new Set(["trace_id", "traceId", "call_id", "callId", "request_id", "requestId"]);

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
interface Route {
  readonly method: string;
  readonly path: string;
  readonly mutating: boolean;
}
interface Entry {
  m: string;
  p: string;
  q: string;
  b: Json;
  h: string;
}
interface Stored {
  s: number;
  j: Json;
}
interface DomainItem {
  type: string;
  payload: Json;
}

const routesModule = (await import(
  pathToFileURL(resolve("packages/web/src/core/action-routes.js")).href
)) as { ACTION_ROUTES: Record<string, Route> };
const ROUTES = routesModule.ACTION_ROUTES;
const compiled = Object.entries(ROUTES).map(([name, r]) => {
  const rx = new RegExp(
    `^${r.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:([a-z_]+)/g, "([^/]+)")}$`,
  );
  return { name, ...r, rx };
});

// ---------------------------------------------------------------- normalisation

const isObj = (v: unknown): v is Record<string, Json> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const canon = (v: Json | undefined): string => {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (isObj(v))
    return `{${Object.keys(v)
      .filter((k) => k !== "idempotency_key" && v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v ?? null);
};

const canonQuery = (q: string): string =>
  [...new URLSearchParams(q).entries()]
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

/** Drop volatile fields (trace and call ids) at any depth, and idempotency keys from request bodies. */
const scrub = (v: Json, dropKeys: Set<string>): Json => {
  if (Array.isArray(v)) return v.map((x) => scrub(x, dropKeys));
  if (isObj(v)) {
    const out: Record<string, Json> = {};
    for (const [k, x] of Object.entries(v)) if (!dropKeys.has(k)) out[k] = scrub(x, dropKeys);
    return out;
  }
  return v;
};
const REQUEST_DROP = new Set(["idempotency_key"]);

const hashOf = (r: Stored): string =>
  createHash("sha1")
    .update(`${r.s}|${canon(r.j)}`)
    .digest("hex")
    .slice(0, 16);

const keyOf = (m: string, p: string, q: string, b: Json): string =>
  `${m} ${p}?${q} ${b === null ? "" : canon(b)}`;

/** Is this request a read? (Invoke of a non-mutating action, a non-mutating REST route, a kernel GET or /query.) */
const isRead = (m: string, p: string): boolean => {
  const invoke = /^\/suite\/actions\/([^/?]+)$/.exec(p);
  if (invoke && m === "POST") return !(ROUTES[decodeURIComponent(invoke[1]!)]?.mutating ?? true);
  if (p.startsWith("/suite/")) {
    const r = compiled.find((c) => c.method === m && c.rx.test(p));
    return r ? !r.mutating : m === "GET";
  }
  if (m === "GET") return true;
  return m === "POST" && p === "/query";
};

const actionOf = (m: string, p: string): string | null => {
  const invoke = /^\/suite\/actions\/([^/?]+)$/.exec(p);
  if (invoke && m === "POST") return decodeURIComponent(invoke[1]!);
  return compiled.find((c) => c.method === m && c.rx.test(p))?.name ?? null;
};

// ---------------------------------------------------------------- state

const responses = new Map<string, Stored>();
const usedBy = new Map<string, Set<string>>();
const entries = new Map<string, Map<string, Entry>>(PERSONAS.map((p) => [p, new Map()]));
const events = new Map<string, DomainItem[]>(PERSONAS.map((p) => [p, []]));
/** Every read seen for any persona (key -> request), replayed for the others in the gap fill. */
const observed = new Map<string, { m: string; p: string; q: string; b: Json }>();

const record = (persona: string, m: string, p: string, q: string, b: Json, s: number, j: Json): void => {
  const stored: Stored = { s, j: scrub(j, VOLATILE) };
  const h = hashOf(stored);
  if (!responses.has(h)) responses.set(h, stored);
  const key = keyOf(m, p, q, b);
  const mine = entries.get(persona)!;
  if (mine.has(key)) return;
  mine.set(key, { m, p, q, b, h });
  if (!usedBy.has(h)) usedBy.set(h, new Set());
  usedBy.get(h)!.add(persona);
  observed.set(key, { m, p, q, b });
};

/** Capture every /api response of a context for a persona. Returns a drain that awaits the pending reads. */
const capture = (ctx: BrowserContext, persona: string): (() => Promise<void>) => {
  const pending: Promise<void>[] = [];
  ctx.on("response", (res) => {
    const req = res.request();
    const url = new URL(req.url());
    if (!url.pathname.startsWith("/api/")) return;
    const m = req.method();
    const p = url.pathname.slice(4);
    if (!isRead(m, p)) return;
    const q = canonQuery(url.search.slice(1));
    let b: Json = null;
    const raw = req.postData();
    if (raw) {
      try {
        b = scrub(JSON.parse(raw) as Json, REQUEST_DROP);
      } catch {
        return;
      }
    }
    pending.push(
      res
        .json()
        .then((j: Json) => record(persona, m, p, q, b, res.status(), j))
        .catch(() => undefined),
    );
  });
  return async () => {
    await Promise.all(pending);
  };
};

const watchRealtime = (page: Page, persona: string): void => {
  page.on("websocket", (ws) => {
    if (!ws.url().endsWith("/rt")) return;
    ws.on("framereceived", (f) => {
      try {
        const frame = JSON.parse(String(f.payload)) as { t?: string; items?: DomainItem[] };
        if (frame.t !== "domain") return;
        for (const it of frame.items ?? []) events.get(persona)!.push({ type: it.type, payload: it.payload });
      } catch {
        /* not JSON */
      }
    });
  });
};

// ---------------------------------------------------------------- browsing

const settle = async (page: Page, ms = 700): Promise<void> => {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(ms).catch(() => {});
};

const withParams = (path: string, params: Record<string, string>): string => {
  const [p, q = ""] = path.split("?");
  const s = new URLSearchParams(q);
  for (const [k, v] of Object.entries(params)) s.set(k, v);
  return `${p}?${s.toString()}`;
};

const tryStep = async (what: string, fn: () => Promise<unknown>): Promise<void> => {
  try {
    await fn();
  } catch (e) {
    if (process.env.DEMO_RECORD_VERBOSE) console.log(`  (${what}: ${(e as Error).message.split("\n")[0]})`);
  }
};

/** Light interaction on a classic page: two tabs, one "Load more", one expandable row. */
const interact = async (page: Page): Promise<void> => {
  const main = page.locator("#main");
  const tabs = main.getByRole("tab", { selected: false });
  const n = Math.min(2, await tabs.count().catch(() => 0));
  for (let i = 0; i < n; i++) {
    await tryStep("tab", () => tabs.nth(0).click({ timeout: 2_000 }));
    await settle(page, 400);
  }
  await tryStep("load more", async () => {
    const more = main.getByRole("button", { name: /^load more$/i }).first();
    if (await more.isVisible({ timeout: 500 })) {
      await more.click({ timeout: 2_000 });
      await settle(page, 400);
    }
  });
  await tryStep("expand", async () => {
    const row = main.locator('[aria-expanded="false"]').first();
    if (await row.isVisible({ timeout: 500 })) {
      await row.click({ timeout: 2_000 });
      await settle(page, 400);
      await page.keyboard.press("Escape");
    }
  });
};

const links = async (page: Page): Promise<string[]> =>
  page.$$eval("a[href]", (as) => as.map((a) => (a as HTMLAnchorElement).href)).catch(() => [] as string[]);

/** "/people/ana-silva" -> "/people/*"; "/store/p/fleece" -> "/store/p/*"; one-segment paths are their own. */
const patternOf = (path: string): string => {
  const parts = path.split("/").filter(Boolean);
  return parts.length < 2 ? path : `/${parts.slice(0, -1).join("/")}/*`;
};

const browsePersona = async (persona: string): Promise<void> => {
  const browser = await chromium.launch({
    channel: "chrome",
    args: ["--enable-unsafe-webgpu", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const drain = capture(ctx, persona);
  let page = await ctx.newPage();
  let crashed = false;
  const fresh = async (): Promise<void> => {
    if (!crashed && !page.isClosed()) return;
    console.log(`[${persona}] page crashed, opening a new one`);
    await page.close().catch(() => {});
    page = await ctx.newPage();
    crashed = false;
    page.on("crash", () => (crashed = true));
    watchRealtime(page, persona);
  };
  page.on("crash", () => (crashed = true));
  watchRealtime(page, persona);
  const visited = new Set<string>();
  const found = new Set<string>();

  const visitClassic = async (route: string): Promise<void> => {
    visited.add(route.split("?")[0]!);
    await fresh();
    await tryStep(`goto ${route}`, () =>
      page.goto(`${WEB}${withParams(route, { as: persona, experience: "classic" })}`, { timeout: 30_000 }),
    );
    await settle(page);
    await interact(page);
    for (const href of await links(page)) {
      const u = new URL(href);
      if (u.origin !== new URL(WEB).origin) continue;
      if (/^\/(town|styleguide|api|rt)(\/|$)/.test(u.pathname)) continue;
      found.add(u.pathname.replace(/\/+$/, "") || "/");
    }
  };

  console.log(`[${persona}] classic routes`);
  for (const r of CLASSIC_ROUTES) await visitClassic(r);

  // the identity picker and the command palette, once, from home
  await tryStep("home", () => page.goto(`${WEB}/?as=${persona}&experience=classic`, { timeout: 30_000 }));
  await settle(page);
  await tryStep("identity picker", async () => {
    await page.locator(".app__avatar button").first().click({ timeout: 3_000 });
    await page.getByRole("menuitem", { name: /switch to someone else/i }).click({ timeout: 3_000 });
    await settle(page, 600);
    await page.keyboard.press("Escape");
  });
  await tryStep("palette", async () => {
    await page.keyboard.press("Control+K");
    await settle(page, 600);
    await page.keyboard.type("store", { delay: 40 });
    await settle(page, 600);
    await page.keyboard.press("Escape");
  });

  // sub-routes discovered from links
  const perPattern = new Map<string, number>();
  let extra = 0;
  for (const path of [...found].sort()) {
    if (extra >= DISCOVERED_MAX) break;
    if (visited.has(path)) continue;
    const pattern = patternOf(path);
    const n = perPattern.get(pattern) ?? 0;
    if (n >= PER_PATTERN) continue;
    perPattern.set(pattern, n + 1);
    extra += 1;
    await visitClassic(path);
  }
  console.log(`[${persona}] ${extra} discovered sub-routes`);

  console.log(`[${persona}] town routes`);
  for (const r of TOWN_ROUTES) {
    await fresh();
    await tryStep(`goto ${r}`, () =>
      page.goto(`${WEB}${withParams(r, { as: persona, experience: "town" })}`, { timeout: 30_000 }),
    );
    await settle(page, 1_500);
    if (r === "/town/")
      await tryStep("command sheet", async () => {
        await page.keyboard.press("Control+K");
        await settle(page, 600);
        await page.keyboard.type("points", { delay: 40 });
        await settle(page, 600);
        await page.keyboard.press("Escape");
      });
  }
  // leave the town override behind for this persona's next visit
  await tryStep("reset override", () => page.goto(`${WEB}/?as=${persona}&experience=classic`));
  await settle(page, 300);

  await drain();
  await ctx.close();
  await browser.close();
  console.log(`[${persona}] ${entries.get(persona)!.size} requests recorded`);
};

// ---------------------------------------------------------------- gap fill (straight to the API)

const callApi = async (persona: string, m: string, p: string, q: string, b: Json): Promise<void> => {
  const key = keyOf(m, p, q, b);
  if (entries.get(persona)!.has(key)) return;
  try {
    const res = await fetch(`${API}${p}${q ? `?${q}` : ""}`, {
      method: m,
      headers: {
        authorization: `Bearer dev-user-${persona}`,
        ...(b === null ? {} : { "content-type": "application/json" }),
      },
      ...(b === null ? {} : { body: JSON.stringify(b) }),
    });
    // 400 and 422 are inputs that do not fit this persona (or no input at all); not worth keeping
    if (res.status >= 500 || res.status === 400 || res.status === 422) return;
    const j = (await res.json()) as Json;
    record(persona, m, p, q, b, res.status, j);
  } catch {
    /* unreachable or not JSON */
  }
};

const gapFill = async (): Promise<void> => {
  // inputs per action, capped; other reads (kernel nodes, query, history) as they were seen
  const perAction = new Map<string, number>();
  const replay: { m: string; p: string; q: string; b: Json }[] = [];
  for (const r of observed.values()) {
    const a = actionOf(r.m, r.p);
    if (a) {
      const n = perAction.get(a) ?? 0;
      if (n >= INPUTS_PER_ACTION) continue;
      perAction.set(a, n + 1);
    }
    replay.push(r);
  }
  for (const [name, r] of Object.entries(ROUTES))
    if (!r.mutating)
      replay.push({ m: "POST", p: `/suite/actions/${encodeURIComponent(name)}`, q: "", b: { input: {} } });
  console.log(`gap fill: ${replay.length} requests x ${PERSONAS.length} personas`);
  for (const persona of PERSONAS) {
    const before = entries.get(persona)!.size;
    const queue = [...replay];
    const workers = Array.from({ length: 4 }, async () => {
      for (let r = queue.shift(); r; r = queue.shift()) await callApi(persona, r.m, r.p, r.q, r.b);
    });
    await Promise.all(workers);
    console.log(`[${persona}] +${entries.get(persona)!.size - before} from the gap fill`);
  }
};

// ---------------------------------------------------------------- output

const unwrap = (j: Json): Json => {
  if (!isObj(j) || j["ok"] !== true) return null;
  const d = j["data"] ?? null;
  return isObj(d) && d["kind"] === "result" && "data" in d ? (d["data"] ?? null) : d;
};

/** A recorded output with its rows removed: arrays empty, cursors null, counts zero. */
const emptied = (v: Json, key = ""): Json => {
  if (key === "next_cursor" || key === "next") return null;
  if (Array.isArray(v)) return [];
  if (isObj(v)) {
    const out: Record<string, Json> = {};
    for (const [k, x] of Object.entries(v)) out[k] = emptied(x, k);
    return out;
  }
  if (typeof v === "number") return 0;
  return v;
};

const write = (name: string, value: unknown): number => {
  const text = JSON.stringify(value);
  writeFileSync(join(outDir, name), text);
  return text.length;
};

const output = (): void => {
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (f.endsWith(".json")) rmSync(join(outDir, f));

  const shared: Record<string, Stored> = {};
  for (const [h, who] of usedBy) if (who.size > 1) shared[h] = responses.get(h)!;

  // empty shapes per read action, from the default persona's ok responses first
  const empty: Record<string, Json> = {};
  for (const persona of [DEFAULT_PERSONA, ...PERSONAS])
    for (const e of entries.get(persona)!.values()) {
      const a = actionOf(e.m, e.p);
      if (!a || a in empty) continue;
      const data = unwrap(responses.get(e.h)!.j);
      if (isObj(data)) empty[a] = emptied(data);
    }

  const people: { handle: string; name: string; title: string | null; roles: string[] }[] = [];
  let total = 0;
  for (const persona of PERSONAS) {
    const mine = [...entries.get(persona)!.values()];
    const own: Record<string, Stored> = {};
    for (const e of mine) if (!(e.h in shared)) own[e.h] = responses.get(e.h)!;
    const seen = new Set<string>();
    const evs = events
      .get(persona)!
      .filter((ev) => {
        const k = `${ev.type}|${canon(ev.payload)}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(-30);
    const bytes = write(`${persona}.json`, { persona, entries: mine, responses: own, events: evs });
    total += bytes;
    console.log(
      `${persona}.json: ${mine.length} requests, ${Object.keys(own).length} own responses, ${bytes} bytes`,
    );

    const me = mine.find((e) => e.p === "/suite/actions/me.get" && canon(e.b) === canon({ input: {} }));
    const meData = me ? unwrap(responses.get(me.h)!.j) : null;
    const principal = isObj(meData) && isObj(meData["principal"]) ? meData["principal"] : null;
    const member = isObj(meData) && isObj(meData["member"]) ? meData["member"] : null;
    const roles = isObj(meData) && Array.isArray(meData["roles"]) ? meData["roles"] : [];
    people.push({
      handle: persona,
      name: typeof principal?.["display_name"] === "string" ? principal["display_name"] : persona,
      title: typeof member?.["title"] === "string" ? member["title"] : null,
      roles: roles.flatMap((r) => (isObj(r) && typeof r["role"] === "string" ? [r["role"]] : [])),
    });
  }
  const sharedBytes = write("shared.json", { responses: shared });
  total += sharedBytes;
  console.log(`shared.json: ${Object.keys(shared).length} responses, ${sharedBytes} bytes`);

  // sample domain events for the live loop: what arrived on /rt, deduped across personas
  const sample: DomainItem[] = [];
  const seen = new Set<string>();
  for (const list of events.values())
    for (const ev of list) {
      const k = `${ev.type}|${canon(ev.payload)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      sample.push(ev);
    }
  const manifestBytes = write("manifest.json", {
    format: 1,
    recorded_at: new Date().toISOString(),
    default_persona: DEFAULT_PERSONA,
    personas: people,
    routes: ROUTES,
    empty,
    events: sample.slice(-40),
  });
  total += manifestBytes;
  console.log(
    `manifest.json: ${manifestBytes} bytes; total ${(total / 1024 / 1024).toFixed(2)} MB in ${outDir}`,
  );
};

// ---------------------------------------------------------------- run

// two personas at a time; each has its own browser
{
  const queue = [...PERSONAS];
  const worker = async (): Promise<void> => {
    for (let p = queue.shift(); p !== undefined; p = queue.shift()) await browsePersona(p);
  };
  await Promise.all([worker(), worker()]);
}
await gapFill();
output();
