// Screenshot every design prototype at three sizes and record console errors.
//   tsx scripts/proto-shots.ts [outDir=shots/proto] [ids...]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [, , outDir = "shots/proto", ...only] = process.argv;
const ids = only.length ? only : ["meridian", "nocturne", "folio", "lattice", "strata"];
const base = process.env.PLINTH_WEB_URL ?? "http://localhost:5173";
const sizes = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 },
  { name: "wall", width: 1920, height: 1080 },
];
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const report: Record<string, string[]> = {};
for (const id of ids) {
  report[id] = [];
  for (const s of sizes) {
    const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height } });
    const page = await ctx.newPage();
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") report[id]!.push(`[${s.name}] ${m.type()}: ${m.text()}`);
    });
    page.on("pageerror", (e) => report[id]!.push(`[${s.name}] pageerror: ${e.message}`));
    await page.goto(`${base}/proto/${id}/index.html?d=ops-board`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(outDir, `${id}-${s.name}.png`) });
    await ctx.close();
  }
}
await browser.close();
writeFileSync(join(outDir, "console.json"), JSON.stringify(report, null, 2));
for (const [id, errs] of Object.entries(report)) console.log(id, errs.length, "issues", errs.slice(0, 4).join(" | "));
