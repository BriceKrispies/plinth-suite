// Single viewport screenshot: tsx scripts/snap.ts <out.png> <path> [width] [height]
import { chromium } from "playwright";
const [, , out = "shots/snap.png", path = "/d/ops-board", w = "1280", h = "1180"] = process.argv;
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: Number(w), height: Number(h) } })).newPage();
await p.goto((process.env.PLINTH_WEB_URL ?? "http://localhost:5173") + path);
await p.waitForLoadState("networkidle");
await p.waitForTimeout(1200);
await p.screenshot({ path: out });
await b.close();
