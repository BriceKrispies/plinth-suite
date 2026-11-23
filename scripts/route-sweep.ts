// Visual QA sweep: screenshot every route (desktop and phone) and record console errors and widget error states.
//   tsx scripts/route-sweep.ts [outDir=shots/sweep] [as=maya-ortiz]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [, , outDir = "shots/sweep", as = "maya-ortiz"] = process.argv;
mkdirSync(outDir, { recursive: true });
const base = process.env.PLINTH_WEB_URL ?? "http://localhost:5173";
const routes = [
  "/", "/admin", "/admin/grants", "/admin/program", "/admin/roles", "/approvals", "/audit", "/automations",
  "/automations/new", "/badges", "/calendar", "/content", "/content/new", "/ledger", "/messages", "/messages/new",
  "/news", "/notifications", "/people", "/people/ana-silva", "/points", "/points/award", "/profile", "/promotions",
  "/promotions/new", "/reports", "/search?q=fleece", "/segments", "/segments/new", "/settings", "/store",
  "/store/cart", "/store/inventory", "/store/manage", "/store/orders", "/store/wishlist", "/tasks", "/tasks/all",
];
const browser = await chromium.launch();
const report: Record<string, { errors: string[]; widgetErrors: string[] }> = {};
for (const r of routes) {
  const name = r === "/" ? "home" : r.slice(1).replace(/[/?=]/g, "_");
  report[r] = { errors: [], widgetErrors: [] };
  for (const vp of [
    { tag: "desk", width: 1440, height: 900 },
    { tag: "phone", width: 390, height: 844 },
  ]) {
    const page = await (await browser.newContext({ viewport: { width: vp.width, height: vp.height } })).newPage();
    page.on("console", (m) => {
      if (m.type() === "error") report[r]!.errors.push(`[${vp.tag}] ${m.text()}`);
    });
    page.on("pageerror", (e) => report[r]!.errors.push(`[${vp.tag}] pageerror: ${e.message}`));
    const sep = r.includes("?") ? "&" : "?";
    await page.goto(`${base}${r}${sep}as=${as}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);
    if (vp.tag === "desk") {
      const texts = await page
        .locator('[data-state="error"], .state--error, [role="alert"]')
        .allInnerTexts()
        .catch(() => [] as string[]);
      report[r]!.widgetErrors = texts.map((t) => t.replace(/\s+/g, " ").slice(0, 200));
    }
    await page.screenshot({ path: join(outDir, `${name}-${vp.tag}.png`), fullPage: vp.tag === "desk" });
    await page.context().close();
  }
  console.log(r, "errors:", report[r]!.errors.length, "widget errors:", report[r]!.widgetErrors.length);
}
await browser.close();
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
