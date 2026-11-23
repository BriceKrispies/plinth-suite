// Screenshot routes in each site look: tsx scripts/look-shots.ts <outDir> <looks,comma> <routes,comma> [as] [theme]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const [, , out = "shots/looks", looks = "calm", routes = "/", as = "maya-ortiz", theme = ""] = process.argv;
mkdirSync(out, { recursive: true });
const base = process.env.PLINTH_WEB_URL ?? "http://localhost:5173";
const b = await chromium.launch();
for (const look of looks.split(",")) for (const r of routes.split(",")) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme === "dark" ? "dark" : "light" });
  const p = await ctx.newPage();
  const errs: string[] = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await p.addInitScript({ content: `(function(){var l=${JSON.stringify(look)};function s(){var d=document.documentElement;if(d&&d.dataset.look!==l)d.dataset.look=l}var i=setInterval(s,50);s();setTimeout(function(){clearInterval(i)},20000)})()` });
  await p.goto(`${base}${r}${r.includes("?") ? "&" : "?"}as=${as}`);
  await p.waitForLoadState("networkidle").catch(() => {});
  await p.waitForTimeout(2500);
  const name = `${look}${theme ? "-" + theme : ""}-${r === "/" ? "home" : r.slice(1).replace(/[/?=&]/g, "_")}.png`;
  await p.screenshot({ path: `${out}/${name}` });
  console.log(name, errs.length ? errs.slice(0, 3) : "ok");
  await ctx.close();
}
await b.close();
