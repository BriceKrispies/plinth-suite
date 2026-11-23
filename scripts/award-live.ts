// Cross-widget live demo: Ana's points page is open; Maya awards her points through the action API.
import { chromium } from "playwright";
const web = process.env.PLINTH_WEB_URL ?? "http://localhost:5173";
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto(`${web}/points?as=ana-silva`);
await p.waitForLoadState("networkidle").catch(() => {});
await p.waitForTimeout(2500);
await p.screenshot({ path: "shots/suite/live-award-before.png" });
const res = await fetch("http://localhost:8782/suite/actions/points.award", {
  method: "POST",
  headers: { authorization: "Bearer dev-user-maya-ortiz", "content-type": "application/json" },
  body: JSON.stringify({ input: { to: ["ana-silva"], points: 500, category: "recognition", reason: "Covered the Saturday dock shift", idempotency_key: `live-award-${Date.now()}` } }),
});
console.log("award:", (await res.text()).slice(0, 220));
await p.waitForTimeout(1200);
await p.screenshot({ path: "shots/suite/live-award-after.png" });
await b.close();
