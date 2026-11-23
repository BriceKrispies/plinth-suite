// Accessibility sweep with axe-core (WCAG 2.2 A/AA): every route in calm light and dark, key routes in every look.
//   tsx scripts/a11y-sweep.ts [outFile=shots/a11y.json] [as=maya-ortiz]
// Exits 1 when any violation is found.
import { chromium, type Browser } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { writeFileSync } from "node:fs";

const [, , outFile = "shots/a11y.json", as = "maya-ortiz"] = process.argv;
const base = process.env.PLINTH_WEB_URL ?? "http://localhost:5173";
const ROUTES = [
  "/",
  "/admin",
  "/admin/grants",
  "/admin/program",
  "/admin/roles",
  "/approvals",
  "/audit",
  "/automations",
  "/automations/new",
  "/badges",
  "/calendar",
  "/content",
  "/content/new",
  "/ledger",
  "/messages",
  "/messages/new",
  "/news",
  "/notifications",
  "/people",
  "/people/ana-silva",
  "/points",
  "/points/award",
  "/profile",
  "/promotions",
  "/promotions/new",
  "/reports",
  "/search?q=fleece",
  "/segments",
  "/segments/new",
  "/settings",
  "/store",
  "/store/cart",
  "/store/inventory",
  "/store/manage",
  "/store/orders",
  "/store/wishlist",
  "/tasks",
  "/tasks/all",
];
const ONLY = process.env.PLINTH_A11Y_ROUTES?.split(",");
const KEY = ["/", "/store", "/tasks", "/admin/roles", "/people"];
const LOOKS = ["calm", "meridian", "nocturne", "folio", "lattice", "strata"];

type Hit = {
  id: string;
  impact: string;
  help: string;
  route: string;
  look: string;
  theme: string;
  targets: string[];
};
const hits: Hit[] = [];

const check = async (b: Browser, route: string, look: string, theme: "light" | "dark") => {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
  await ctx.addInitScript({
    content: `(function(){var l=${JSON.stringify(look)};function s(){var d=document.documentElement;if(d&&d.dataset.look!==l)d.dataset.look=l}var i=setInterval(s,50);s();setTimeout(function(){clearInterval(i)},30000)})()`,
  });
  const p = await ctx.newPage();
  await p.goto(`${base}${route}${route.includes("?") ? "&" : "?"}as=${as}`);
  await p.waitForLoadState("networkidle").catch(() => {});
  await p.waitForTimeout(1800);
  const r = await new AxeBuilder({ page: p })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  for (const v of r.violations)
    hits.push({
      id: v.id,
      impact: v.impact ?? "",
      help: v.help,
      route,
      look,
      theme,
      targets: v.nodes.slice(0, 4).map((n) => n.target.join(" ")),
    });
  await ctx.close();
};

const b = await chromium.launch();
for (const r of ONLY ?? ROUTES) for (const t of ["light", "dark"] as const) await check(b, r, "calm", t);
for (const l of LOOKS.filter((x) => x !== "calm"))
  for (const r of KEY) for (const t of ["light", "dark"] as const) await check(b, r, l, t);
await b.close();

const byRule = new Map<
  string,
  { impact: string; help: string; count: number; where: Set<string>; targets: Set<string> }
>();
for (const h of hits) {
  const e = byRule.get(h.id) ?? {
    impact: h.impact,
    help: h.help,
    count: 0,
    where: new Set(),
    targets: new Set(),
  };
  e.count += 1;
  e.where.add(`${h.look}/${h.theme} ${h.route}`);
  h.targets.forEach((t) => e.targets.size < 12 && e.targets.add(t));
  byRule.set(h.id, e);
}
const summary = [...byRule].map(([id, e]) => ({
  id,
  impact: e.impact,
  help: e.help,
  pages: e.count,
  where: [...e.where].slice(0, 15),
  targets: [...e.targets],
}));
writeFileSync(outFile, JSON.stringify({ summary, hits }, null, 2));
for (const s of summary)
  console.log(`${s.impact.padEnd(9)} ${s.id.padEnd(28)} ${String(s.pages).padStart(3)} page-runs  ${s.help}`);
console.log(
  `${hits.length} violations across ${new Set(hits.map((h) => h.look + h.theme + h.route)).size} page-runs`,
);
process.exit(hits.length ? 1 : 0);
