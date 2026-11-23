// Record a browser while scripts/rebuild-live.ts clears and rebuilds the site over MCP.
//   tsx scripts/rebuild-capture.ts <outDir> [look=strata] [delayMs=900] [as=maya-ortiz]
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
const [, , out = "shots/rebuild", look = "strata", delay = "900", as = "maya-ortiz"] = process.argv;
mkdirSync(out, { recursive: true });
const base = process.env.PLINTH_WEB_URL ?? "http://localhost:5173";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } });
const p = await ctx.newPage();
const errs: string[] = [];
p.on("pageerror", (e) => errs.push(e.message));
await p.goto(`${base}/?as=${as}`);
await p.waitForLoadState("networkidle").catch(() => {});
await p.waitForTimeout(2500);
await p.screenshot({ path: `${out}/00-before.png` });
const child = spawn(process.execPath, ["--import", "tsx", "scripts/rebuild-live.ts", "--clear", "--look", look, "--delay", delay], { stdio: ["ignore", "pipe", "inherit"] });
let frame = 0;
let done = false;
child.stdout.on("data", (d: Buffer) => process.stdout.write(d));
child.on("exit", () => (done = true));
while (!done) {
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/${String(++frame).padStart(2, "0")}.png` });
}
await p.waitForTimeout(2500);
await p.screenshot({ path: `${out}/99-after.png` });
console.log("page errors:", errs);
await ctx.close();
await b.close();
