// Record the live look switch: tsx scripts/look-tour.ts <outDir> [looks=nocturne,strata,folio,lattice,calm] [as=maya-ortiz]
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const [, , out = "shots/look-tour", looks = "nocturne,strata,folio,lattice,calm", as = "maya-ortiz"] = process.argv;
mkdirSync(out, { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } });
const p = await ctx.newPage();
const errs: string[] = [];
p.on("pageerror", (e) => errs.push(e.message));
await p.goto(`${process.env.PLINTH_WEB_URL ?? "http://localhost:5173"}/?as=${as}`);
await p.waitForTimeout(3000);
for (const look of looks.split(",")) {
  execFileSync(process.execPath, ["--import", "tsx", "scripts/mcp-call.ts", "action.invoke", JSON.stringify({ action: "site.appearance.set", input: { look }, idempotency_key: `tour-${look}-${Date.now()}` })]);
  await p.waitForTimeout(2600);
}
console.log("page errors:", errs);
await ctx.close();
await b.close();
