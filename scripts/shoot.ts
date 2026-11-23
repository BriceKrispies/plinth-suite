// Screenshot harness: opens two live windows of a dashboard side by side (two independent browser
// contexts, like two people), takes a "before" shot, then waits until the given number of panels is
// rendered in BOTH windows without reloading, and takes an "after" shot.
//   tsx scripts/shoot.ts <outDir> <name> <expectPanels> [path=/d/ops-board] [timeoutS=120]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const [, , outDir = "shots", name = "shot", expectRaw = "1", path = "/d/ops-board", timeoutRaw = "120"] =
  process.argv;
const expect = Number(expectRaw);
const base = process.env.PLINTH_WEB_URL ?? "http://localhost:5173";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const viewport = { width: 1280, height: 860 };
const left = await (await browser.newContext({ viewport, deviceScaleFactor: 1 })).newPage();
const right = await (await browser.newContext({ viewport, deviceScaleFactor: 1 })).newPage();
await Promise.all([left.goto(base + path), right.goto(base + (process.env.RIGHT_PATH ?? path))]);
await Promise.all([left.waitForLoadState("networkidle"), right.waitForLoadState("networkidle")]);

const snap = async (suffix: string) => {
  await left.screenshot({ path: join(outDir, `${name}-${suffix}-left.png`), fullPage: true });
  await right.screenshot({ path: join(outDir, `${name}-${suffix}-right.png`), fullPage: true });
};
await snap("before");
console.log("READY before-shot taken; waiting for", expect, "panel(s)");

const panels = (p: typeof left) => p.locator("[data-panel], .panel").count();
const deadline = Date.now() + Number(timeoutRaw) * 1000;
while (Date.now() < deadline) {
  const [a, b] = await Promise.all([panels(left), panels(right)]);
  if (a >= expect && b >= expect) break;
  await left.waitForTimeout(250);
}
await left.waitForTimeout(1500); // let charts finish their entry animation
await snap("after");
console.log("DONE", await panels(left), await panels(right));
await browser.close();
