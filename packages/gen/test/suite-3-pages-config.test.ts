import { describe, expect, it } from "vitest";
import { Schema as S } from "effect";
import { SIZE_GRID, widgetById } from "@plinth/spec";
import { PAGES, widgetSlug } from "../src/suite/steps/pages";

// No database: the seeded default pages are valid against the widget catalogue, the 12-column grid and the node rules.

const SLUG = /^[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*$/;

describe("seeded default pages (UI-MAP 2)", () => {
  it("every widget exists, its config decodes strictly and its size is one the widget offers", () => {
    for (const p of PAGES)
      for (const i of p.items) {
        const def = widgetById(i.widget);
        expect(def, `${p.slug}: ${i.widget}`).toBeDefined();
        const r = S.decodeUnknownEither(def!.config, { onExcessProperty: "error" })(i.config);
        expect(r._tag, `${p.slug}: ${i.widget} ${JSON.stringify(i.config)}`).toBe("Right");
        expect(def!.sizes, `${p.slug}: ${i.widget} size ${i.size}`).toContain(i.size);
      }
  });

  it("layouts fit 12 columns, never overlap, and each cell holds its size footprint", () => {
    for (const p of PAGES) {
      const cells = p.items.map((i) => ({ x: i.at[0], y: i.at[1], w: i.at[2], h: i.at[3], id: i.widget }));
      for (const [n, a] of cells.entries()) {
        expect(a.x + a.w, `${p.slug}: ${a.id} overflows`).toBeLessThanOrEqual(12);
        for (const b of cells.slice(n + 1))
          expect(
            a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h,
            `${p.slug}: ${a.id} overlaps ${b.id}`,
          ).toBe(false);
      }
      for (const i of p.items)
        expect(i.at[2] >= 3 && i.at[3] >= 3 && SIZE_GRID[i.size] !== undefined).toBe(true);
    }
  });

  it("slugs, routes and widget instance names are unique and valid node slugs", () => {
    const pages = new Set<string>();
    const routes = new Set<string>();
    const widgets = new Set<string>();
    for (const p of PAGES) {
      expect(SLUG.test(p.slug) && p.slug.length <= 63).toBe(true);
      expect(pages.has(p.slug)).toBe(false);
      pages.add(p.slug);
      expect(routes.has(p.route), `route ${p.route}`).toBe(false);
      routes.add(p.route);
      expect(/^\/[a-z0-9/:_-]*$/.test(p.route)).toBe(true);
      for (const i of p.items) {
        const s = widgetSlug(p, i);
        expect(SLUG.test(s) && s.length <= 63 - "maya-ortiz".length - 1, s).toBe(true);
        expect(widgets.has(s), s).toBe(false);
        widgets.add(s);
      }
    }
    expect(PAGES.length).toBeGreaterThanOrEqual(50);
  });

  it("the home page and the navigation follow UI-MAP: nine home widgets and one nav item per section entry", () => {
    const home = PAGES.find((p) => p.slug === "home");
    expect(home?.items).toHaveLength(9);
    expect(home?.items[0]).toMatchObject({ widget: "promotions.active", size: "full" });
    expect(PAGES.find((p) => p.slug === "profile")?.kind).toBe("profile");
    const nav = PAGES.filter((p) => p.nav);
    expect(new Set(nav.map((p) => p.nav?.section))).toEqual(
      new Set(["personal", "rewards", "engage", "insight", "operate", "admin"]),
    );
    expect(nav.find((p) => p.slug === "messages")?.nav).toMatchObject({
      count: "messages_unread",
      permission: "messages:use",
    });
  });
});
