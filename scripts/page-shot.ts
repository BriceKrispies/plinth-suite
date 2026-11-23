// Screenshot any app route and print console/page errors.
//   tsx scripts/page-shot.ts <out.png> <path> [width] [height] [full=1]
import { chromium } from "playwright";
const [, , out = "shots/page.png", path = "/", w = "1440", h = "900", full = "1"] = process.argv;
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: Number(w), height: Number(h) } })).newPage();
const errs: string[] = [];
p.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
await p.goto((process.env.PLINTH_WEB_URL ?? "http://localhost:5173") + path);
await p.waitForLoadState("networkidle").catch(() => {});
await p.waitForTimeout(2500);
await p.screenshot({ path: out, fullPage: full === "1" });
console.log(errs.length ? errs.slice(0, 8).join("\n") : "no errors");
await b.close();
