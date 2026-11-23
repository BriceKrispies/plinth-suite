// Keyboard walk: for each route, check the skip link, tab order (accessible names and visible focus), the widget
// options menu (Enter opens, focus enters, Escape returns) and, on /tasks, dialog focus trapping.
//   tsx scripts/keyboard-walk.ts [as=maya-ortiz]
// Exits 1 when any check fails. Environment: PLINTH_WEB_URL (default http://localhost:5173).
import { chromium, type Page } from "playwright";

const as = process.argv[2] ?? "maya-ortiz";
const base = process.env.PLINTH_WEB_URL ?? "http://localhost:5173";
const routes = ["/", "/store", "/tasks", "/approvals", "/messages/new", "/admin/roles"];
const MAX_STOPS = 60;

type Stop = { index: number; role: string; name: string; focusVisible: boolean };
type Result = { route: string; stops: Stop[]; notes: string[]; failures: string[] };

// Describes the focused element: tag, role, accessible-ish name, an identity key, and the style signature of the
// focused state. Then it blurs the element, reads the rest-state signature and refocuses it, so the two compare.
const describeFocused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const implicit: Record<string, string> = {
      A: "link",
      BUTTON: "button",
      SELECT: "combobox",
      TEXTAREA: "textbox",
      SUMMARY: "button",
    };
    const input = el as HTMLInputElement;
    let role = el.getAttribute("role") ?? implicit[el.tagName] ?? "";
    if (!role && el.tagName === "INPUT")
      role = input.type === "checkbox" ? "checkbox" : input.type === "radio" ? "radio" : "textbox";
    if (!role) role = el.hasAttribute("tabindex") ? "generic" : el.tagName.toLowerCase();
    const byId = (ids: string | null) =>
      (ids ?? "")
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
    const labels = input.labels
      ? Array.from(input.labels)
          .map((l) => l.textContent?.trim() ?? "")
          .join(" ")
      : "";
    const name = (
      el.getAttribute("aria-label") ||
      byId(el.getAttribute("aria-labelledby")) ||
      labels ||
      el.getAttribute("alt") ||
      el.getAttribute("title") ||
      el.getAttribute("placeholder") ||
      el.textContent ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();
    const sig = () => {
      const cs = getComputedStyle(el);
      return [
        cs.outlineStyle,
        cs.outlineWidth,
        cs.outlineColor,
        cs.boxShadow,
        cs.borderColor,
        cs.backgroundColor,
        cs.textDecorationLine,
      ].join("|");
    };
    const focusedSig = sig();
    const cs = getComputedStyle(el);
    const hasOutline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
    // blurring and refocusing a segmented date/time input sends focus back to its first segment, which would make
    // the walk cycle inside it; those inputs are judged by their focused outline alone
    const segmented = /^(date|time|datetime-local|month|week)$/.test((el as HTMLInputElement).type ?? "");
    let restSig = focusedSig;
    if (!segmented) {
      el.blur();
      restSig = sig();
      el.focus({ preventScroll: true });
    } else if (hasOutline) restSig = "";
    const r = el.getBoundingClientRect();
    return {
      role,
      name,
      differs: focusedSig !== restSig,
      hasOutline,
      visible: r.width > 0 && r.height > 0,
      // element identity: same-named controls (three "Details" buttons) are different stops
      key:
        (el as HTMLElement).dataset.kwStop ??
        ((el as HTMLElement).dataset.kwStop = String(Math.random()).slice(2)),
    };
  });

const activeKey = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el
      ? `${el.tagName}#${el.id}.${el.className}|${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}`
      : "";
  });

const open = async (page: Page, route: string) => {
  const sep = route.includes("?") ? "&" : "?";
  await page.goto(`${base}${route}${sep}as=${as}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
};

async function walkRoute(page: Page, route: string): Promise<Result> {
  const res: Result = { route, stops: [], notes: [], failures: [] };
  const fail = (m: string) => res.failures.push(m);

  // 1. Skip link: the first Tab reaches it, activating it focuses #main.
  await open(page, route);
  await page.keyboard.press("Tab");
  const first = await describeFocused(page);
  if (!first || !/skip to content/i.test(first.name)) {
    fail(`first Tab reached "${first?.name ?? "nothing"}", not the "Skip to content" link`);
  } else {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    const mainFocused = await page.evaluate(() => document.activeElement?.id === "main");
    if (!mainFocused) fail("activating Skip to content did not focus #main");
    else res.notes.push("skip link focuses #main");
  }

  // 2. Tab walk from the top of a fresh load.
  await open(page, route);
  const seen = new Set<string>();
  let last = "";
  let inner = 0;
  for (let i = 1; i <= MAX_STOPS; i++) {
    await page.keyboard.press("Tab");
    const d = await describeFocused(page);
    if (!d) {
      res.notes.push(`focus left the document after ${i - 1} stops`);
      break;
    }
    // native date/time inputs take several Tabs across their own fields: the same element, consecutively
    if (d.key === last && inner < 10) {
      inner += 1;
      i -= 1;
      continue;
    }
    inner = 0;
    last = d.key;
    if (seen.has(d.key)) {
      res.notes.push(`tab order wrapped after ${i - 1} stops`);
      break;
    }
    seen.add(d.key);
    const indicator = d.differs;
    res.stops.push({ index: i, role: d.role, name: d.name, focusVisible: indicator });
    if (!d.name) fail(`stop ${i} role=${d.role} has no accessible name`);
    if (d.visible && !indicator) fail(`stop ${i} ${d.role} "${d.name}" has no visible focus indicator`);
  }

  // 3. First widget options menu: Enter opens, focus enters the menu, Escape returns to the trigger.
  await open(page, route);
  const trigger = page.locator('.c-widget__menu [aria-haspopup="menu"], .c-widget__menu button').first();
  if ((await trigger.count()) === 0) {
    res.notes.push("no widget options menu on this route");
  } else {
    await trigger.focus();
    const before = await activeKey(page);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(250);
    const inMenu = await page.evaluate(
      () => !!document.activeElement?.closest('[role="menu"], .c-menu, [popover]'),
    );
    if (!inMenu) fail("Enter on the widget options trigger did not move focus into the menu");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    const after = await activeKey(page);
    if (after !== before)
      fail(`Escape did not return focus to the options trigger (was ${before}, now ${after})`);
    else if (inMenu) res.notes.push("options menu: focus enters, Escape returns to the trigger");
  }

  // 4. Dialog focus trap on /tasks.
  if (route === "/tasks") {
    await open(page, route);
    const buttons = page.locator("main button:visible");
    const n = Math.min(await buttons.count(), 40);
    let opened = false;
    for (let i = 0; i < n && !opened; i++) {
      const b = buttons.nth(i);
      const label = ((await b.getAttribute("aria-label")) ?? (await b.innerText().catch(() => ""))).trim();
      if (/^(menu|more|options)/i.test(label)) continue;
      await b.focus();
      const key = await activeKey(page);
      await b.click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(300);
      const dialogs = page.locator('dialog[open], [role="dialog"]:visible, [role="alertdialog"]:visible');
      if ((await dialogs.count()) === 0) continue;
      opened = true;
      res.notes.push(`dialog opened by "${label}"`);
      let trapped = true;
      for (let t = 0; t < 25; t++) {
        await page.keyboard.press("Tab");
        // inside any open, rendered dialog; leaving to the browser chrome (activeElement is body) is what a native
        // modal dialog allows and is not an escape into the page behind
        const inside = await page.evaluate(() => {
          const a = document.activeElement;
          if (!a || a === document.body) return true;
          const open = [
            ...document.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"]'),
          ].filter((d) => (d as HTMLElement).offsetParent !== null || (d as HTMLDialogElement).open);
          return open.some((d) => d.contains(a));
        });
        if (!inside) {
          trapped = false;
          break;
        }
      }
      if (!trapped) fail(`dialog from "${label}": Tab moved focus outside the dialog`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      if ((await page.locator('dialog[open], [role="dialog"]:visible').count()) > 0)
        fail(`dialog from "${label}": Escape did not close it`);
      else if ((await activeKey(page)) !== key)
        fail(`dialog from "${label}": focus did not return to the opener`);
      else if (trapped) res.notes.push("dialog traps Tab, Escape closes and returns focus");
    }
    if (!opened) res.notes.push("no button on /tasks opened a dialog");
  }
  return res;
}

const browser = await chromium.launch();
const results: Result[] = [];
for (const route of routes) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // tsx compiles with keepNames, so functions passed to page.evaluate call a __name helper the page lacks
  await context.addInitScript({ content: "window.__name = function (f) { return f; };" });
  const page = await context.newPage();
  try {
    results.push(await walkRoute(page, route));
  } catch (e) {
    results.push({ route, stops: [], notes: [], failures: [`script error: ${(e as Error).message}`] });
  }
  await context.close();
}
await browser.close();

let failed = 0;
for (const r of results) {
  console.log(`\n== ${r.route}?as=${as}  (${r.stops.length} stops, ${r.failures.length} failures)`);
  for (const s of r.stops)
    console.log(
      `  ${String(s.index).padStart(2)} ${s.role.padEnd(10)} ${s.focusVisible ? "ring" : "NONE"}  ${s.name || "(no name)"}`,
    );
  for (const note of r.notes) console.log(`  note: ${note}`);
  for (const f of r.failures) console.log(`  FAIL: ${f}`);
  failed += r.failures.length;
}
console.log(failed ? `\n${failed} keyboard failure(s)` : "\nkeyboard walk clean");
process.exit(failed ? 1 : 0);
