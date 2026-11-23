import { Effect, Schema as S } from "effect";
import {
  PAGES,
  SIZE_GRID,
  SuitePages,
  WIDGET_IDS,
  defaultNavOrders,
  pageBody,
  widgetBody,
  widgetById,
  type NodeChange,
  type WidgetSize,
} from "@plinth/spec";
import { ChangeLog } from "../../change-log";
import { loadProgram } from "../program";
import { loadNode, loadNodes, nodeUriOf } from "../marketing/common";
import type { ActionCtx, ActionHandler } from "../types";
import type { HandlerTable } from "./stub";
import { dom } from "./util3";

/**
 * The site build actions (CONTRACT.md 5A.5): clear the whole site, bring the default pages back, and rebuild it page by
 * page and widget by widget. Every write is an ordinary change-log commit, so realtime frames reach open browsers and
 * the audit trail records it. The actions pass `managed: { by }` (rule R-SITE): their `admin:settings` check stands in
 * for the per-node rules, and `site.clear` alone may delete system pages.
 */

type At = { x: number; y: number; w: number; h: number };
type LayoutItem = { item: string; at: At; size?: WidgetSize };
interface PageSpecLite {
  kind: string;
  description: string;
  route?: string;
  system: boolean;
  nav?: { section: string; order: number; [k: string]: unknown };
  layout: { columns: 12; items: LayoutItem[] };
}

const create = (ctx: ActionCtx, kind: "Page" | "Widget", slug: string, body: unknown): NodeChange => ({
  target: nodeUriOf(ctx.principal.workspaceSlug, ctx.principal.workspaceId, kind, slug),
  base_revision: null,
  ops: [{ op: "create" as const, kind, slug, body: body as never }],
});

const update = (
  ctx: ActionCtx,
  kind: "Page" | "Program",
  slug: string,
  base: number,
  sets: ReadonlyArray<readonly [string, unknown]>,
): NodeChange => ({
  target: nodeUriOf(ctx.principal.workspaceSlug, ctx.principal.workspaceId, kind, slug),
  base_revision: base,
  ops: sets.map(([path, value]) => ({ op: "set" as const, path, value: value as never })),
});

const remove = (ctx: ActionCtx, kind: "Page" | "Widget", slug: string, base: number): NodeChange => ({
  target: nodeUriOf(ctx.principal.workspaceSlug, ctx.principal.workspaceId, kind, slug),
  base_revision: base,
  ops: [{ op: "delete" as const }],
});

const commitAs = (ctx: ActionCtx, by: string, changes: ReadonlyArray<NodeChange>, reason: string) =>
  Effect.gen(function* () {
    const log = yield* ChangeLog;
    const res = yield* log.commit({
      actor: { principal: ctx.principal, surface: ctx.surface, sessionId: ctx.sessionId },
      changes,
      reason,
      managed: { by },
    });
    const revisions = new Map((res.nodes ?? []).map((n) => [n.uri, n.result_revision] as const));
    return {
      seq: res.change_seq ?? res.nodes?.[res.nodes.length - 1]?.change_seq ?? 0,
      revisionOf: (uri: string) => revisions.get(uri) ?? 1,
    };
  });

/** The first position of the 12-column grid where a w x h cell overlaps no placed item. */
const firstFree = (placed: ReadonlyArray<At>, w: number, h: number): At => {
  const cw = Math.min(w, 12);
  for (let y = 0; ; y++)
    for (let x = 0; x + cw <= 12; x++) {
      if (!placed.some((o) => x < o.x + o.w && o.x < x + cw && y < o.y + h && o.y < y + o.h))
        return { x, y, w: cw, h };
    }
};

const widgetOf = (id: string, path: string) => {
  const def = widgetById(id);
  return def
    ? Effect.succeed(def)
    : Effect.fail(
        dom("UNKNOWN_REFERENCE", path, `no widget '${id}' in the catalogue`, {
          allowed: WIDGET_IDS.slice(0, 20),
          fix_hint: "widgets.catalog lists every widget id.",
        }),
      );
};

/** A free instance slug for a widget on a page: `<page>.<widget-id>`, numbered when taken. */
const freeSlug = (page: string, widget: string, taken: Set<string>): string => {
  const base = `${page}.${widget.replace(".", "-")}`;
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  taken.add(slug);
  return slug;
};

const itemSlugs = (spec: PageSpecLite): string[] =>
  spec.layout.items.filter((i) => i.item.startsWith("widget:")).map((i) => i.item.slice(7));

// ---- clear ---------------------------------------------------------------------------------------------

const clear: ActionHandler<unknown, S.Schema.Type<typeof SuitePages.SiteClearOut>> = {
  preview: (_i, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const pages = yield* loadNodes<PageSpecLite>(ws, "Page");
      const widgets = yield* loadNodes(ws, "Widget");
      const system = pages.filter((p) => p.spec.system).length;
      return {
        effect: `Delete every page (${pages.length}, ${system} of them system pages) and every widget (${widgets.length}): the site becomes empty`,
        facts: { pages: pages.length, system_pages: system, widgets: widgets.length },
      };
    }),
  run: (_i, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const pages = yield* loadNodes<PageSpecLite>(ws, "Page");
      const widgets = yield* loadNodes(ws, "Widget");
      const changes = [
        ...pages.map((p) => remove(ctx, "Page", p.slug, p.revision)),
        ...widgets.map((w) => remove(ctx, "Widget", w.slug, w.revision)),
      ];
      if (changes.length === 0) return { pages_removed: 0, widgets_removed: 0, change_seq: 0 };
      const r = yield* commitAs(ctx, "site.clear", changes, "clear the site");
      return { pages_removed: pages.length, widgets_removed: widgets.length, change_seq: r.seq };
    }),
};

// ---- restore -------------------------------------------------------------------------------------------

const restore: ActionHandler<
  S.Schema.Type<typeof SuitePages.SiteRestoreIn>,
  S.Schema.Type<typeof SuitePages.SiteRestoreOut>
> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const wanted = input.pages;
      if (wanted) {
        const unknown = wanted.filter((s) => !PAGES.some((p) => p.slug === s));
        if (unknown.length > 0)
          return yield* Effect.fail(
            dom("UNKNOWN_REFERENCE", "/pages", `no default page ${unknown.map((s) => `'${s}'`).join(", ")}`, {
              allowed: PAGES.map((p) => p.slug),
            }),
          );
      }
      const livePages = new Set((yield* loadNodes(ws, "Page")).map((p) => p.slug));
      const liveWidgets = new Set((yield* loadNodes(ws, "Widget")).map((w) => w.slug));
      const orders = defaultNavOrders();
      const widgetChanges: NodeChange[] = [];
      const pageChanges: NodeChange[] = [];
      const created: string[] = [];
      const skipped: string[] = [];
      for (const p of PAGES) {
        if (wanted && !wanted.includes(p.slug)) continue;
        if (livePages.has(p.slug)) {
          skipped.push(p.slug);
          continue;
        }
        for (const i of p.items) {
          const body = widgetBody(p, i);
          if (liveWidgets.has(body.metadata.slug)) continue;
          liveWidgets.add(body.metadata.slug);
          widgetChanges.push(create(ctx, "Widget", body.metadata.slug, body));
        }
        pageChanges.push(create(ctx, "Page", p.slug, pageBody(p, orders.get(p.slug) ?? 10)));
        created.push(p.slug);
      }
      if (pageChanges.length === 0)
        return { pages_created: [], pages_skipped: skipped, widgets_created: 0, change_seq: 0 };
      const r = yield* commitAs(
        ctx,
        "site.restore",
        [...widgetChanges, ...pageChanges],
        `restore default pages: ${created.join(", ")}`,
      );
      return {
        pages_created: created,
        pages_skipped: skipped,
        widgets_created: widgetChanges.length,
        change_seq: r.seq,
      };
    }),
};

// ---- page.put ------------------------------------------------------------------------------------------

const put: ActionHandler<
  S.Schema.Type<typeof SuitePages.SitePutIn>,
  S.Schema.Type<typeof SuitePages.SitePutOut>
> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const existing = yield* loadNode<PageSpecLite>(ws, "Page", input.slug);
      if (existing?.spec.kind === "personal")
        return yield* Effect.fail(
          dom("VALIDATION_FAILED", "/slug", "a personal page cannot be replaced here"),
        );
      const liveWidgets = yield* loadNodes(ws, "Widget");
      const taken = new Set(liveWidgets.map((w) => w.slug));
      const revisions = new Map(liveWidgets.map((w) => [w.slug, w.revision] as const));

      // order of the nav entry: kept on update, else the default table's, else after the section's last entry
      let order = existing?.spec.nav?.order;
      if (input.nav && order === undefined) {
        const live = yield* loadNodes<PageSpecLite>(ws, "Page");
        const inSection = live.flatMap((p) =>
          p.spec.nav !== undefined && p.spec.nav.section === input.nav?.section ? [p.spec.nav.order] : [],
        );
        order = defaultNavOrders().get(input.slug) ?? Math.min(1000, Math.max(0, ...inSection) + 10);
      }

      const widgetChanges: NodeChange[] = [];
      const layout: LayoutItem[] = [];
      const slugs: string[] = [];
      for (const [i, it] of (input.items ?? []).entries()) {
        const def = yield* widgetOf(it.widget, `/items/${i}/widget`);
        const size = it.size ?? def.default_size;
        const at =
          it.at ??
          firstFree(
            layout.map((l) => l.at),
            SIZE_GRID[size].w,
            SIZE_GRID[size].h,
          );
        const slug = freeSlug(input.slug, it.widget, taken);
        widgetChanges.push(
          create(ctx, "Widget", slug, {
            apiVersion: "plinth/v1",
            kind: "Widget",
            metadata: { slug, title: `${input.title}: ${def.title}`.slice(0, 120) },
            spec: { widget: it.widget, config: it.config ?? {} },
          }),
        );
        layout.push({ item: `widget:${slug}`, at, size });
        slugs.push(slug);
      }

      const nav = input.nav
        ? {
            section: input.nav.section,
            label: input.nav.label,
            icon: input.nav.icon,
            order: order ?? 10,
            ...(input.nav.count !== undefined ? { count: input.nav.count } : {}),
            ...(input.nav.permission !== undefined ? { permission: input.nav.permission } : {}),
          }
        : undefined;
      const description = input.description ?? input.title;
      const pageChanges: NodeChange[] = [];
      const deletes: NodeChange[] = [];
      if (!existing) {
        pageChanges.push(
          create(ctx, "Page", input.slug, {
            apiVersion: "plinth/v1",
            kind: "Page",
            metadata: { slug: input.slug, title: input.title },
            spec: {
              kind: input.kind ?? "module",
              description,
              route: input.route,
              system: false,
              ...(nav ? { nav } : {}),
              layout: { columns: 12, items: layout },
            },
          }),
        );
      } else {
        const sets: Array<readonly [string, unknown]> = [
          ["/metadata/title", input.title],
          ["/spec/route", input.route],
          ["/spec/description", description],
        ];
        if (input.kind) sets.push(["/spec/kind", input.kind]);
        if (nav) sets.push(["/spec/nav", nav]);
        if (input.items) {
          sets.push(["/spec/layout", { columns: 12, items: layout }]);
          for (const old of itemSlugs(existing.spec)) {
            const rev = revisions.get(old);
            if (old.startsWith(`${input.slug}.`) && rev !== undefined)
              deletes.push(remove(ctx, "Widget", old, rev));
          }
        }
        pageChanges.push(update(ctx, "Page", input.slug, existing.revision, sets));
      }
      const r = yield* commitAs(
        ctx,
        "site.page.put",
        [...widgetChanges, ...pageChanges, ...deletes],
        `${existing ? "update" : "create"} page ${input.slug}`,
      );
      const uri = nodeUriOf(ctx.principal.workspaceSlug, ws, "Page", input.slug);
      return {
        page: { uri, kind: "Page", slug: input.slug, title: input.title, revision: r.revisionOf(uri) },
        created: existing === undefined,
        widgets: slugs,
        change_seq: r.seq,
      };
    }),
};

// ---- widget.add / widget.remove -------------------------------------------------------------------------

const widgetAdd: ActionHandler<
  S.Schema.Type<typeof SuitePages.SiteWidgetAddIn>,
  S.Schema.Type<typeof SuitePages.SiteWidgetAddOut>
> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const page = yield* loadNode<PageSpecLite>(ws, "Page", input.page);
      if (!page) return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/page", `no page '${input.page}'`));
      const def = yield* widgetOf(input.widget, "/widget");
      const size = input.size ?? def.default_size;
      const at =
        input.at ??
        firstFree(
          page.spec.layout.items.map((i) => i.at),
          SIZE_GRID[size].w,
          SIZE_GRID[size].h,
        );
      const taken = new Set((yield* loadNodes(ws, "Widget")).map((w) => w.slug));
      const slug = freeSlug(input.page, input.widget, taken);
      const widget = create(ctx, "Widget", slug, {
        apiVersion: "plinth/v1",
        kind: "Widget",
        metadata: { slug, title: `${page.title}: ${def.title}`.slice(0, 120) },
        spec: { widget: input.widget, config: input.config ?? {} },
      });
      const layout = {
        columns: 12,
        items: [...page.spec.layout.items, { item: `widget:${slug}`, at, size }],
      };
      const r = yield* commitAs(
        ctx,
        "site.widget.add",
        [widget, update(ctx, "Page", page.slug, page.revision, [["/spec/layout", layout]])],
        `add ${input.widget} to ${input.page}`,
      );
      return { widget: slug, page: input.page, at, change_seq: r.seq };
    }),
};

const widgetRemove: ActionHandler<
  S.Schema.Type<typeof SuitePages.SiteWidgetRemoveIn>,
  S.Schema.Type<typeof SuitePages.SiteWidgetRemoveOut>
> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const page = yield* loadNode<PageSpecLite>(ws, "Page", input.page);
      if (!page) return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/page", `no page '${input.page}'`));
      const ref = `widget:${input.widget}`;
      if (!page.spec.layout.items.some((i) => i.item === ref))
        return yield* Effect.fail(
          dom("UNKNOWN_REFERENCE", "/widget", `page '${input.page}' has no widget '${input.widget}'`, {
            allowed: itemSlugs(page.spec),
          }),
        );
      const widget = yield* loadNode(ws, "Widget", input.widget);
      const layout = { columns: 12, items: page.spec.layout.items.filter((i) => i.item !== ref) };
      const changes = [
        update(ctx, "Page", page.slug, page.revision, [["/spec/layout", layout]]),
        ...(widget ? [remove(ctx, "Widget", widget.slug, widget.revision)] : []),
      ];
      const r = yield* commitAs(
        ctx,
        "site.widget.remove",
        changes,
        `remove ${input.widget} from ${input.page}`,
      );
      return { widget: input.widget, page: input.page, change_seq: r.seq };
    }),
};

// ---- appearance ----------------------------------------------------------------------------------------

type Appearance = S.Schema.Type<typeof SuitePages.SiteAppearanceOut>["appearance"];

const appearanceGet: ActionHandler<unknown, S.Schema.Type<typeof SuitePages.SiteAppearanceOut>> = {
  run: (_i, ctx) =>
    Effect.gen(function* () {
      const program = (yield* loadProgram(ctx.principal.workspaceId)) as { appearance?: Appearance };
      return {
        appearance: {
          look: program.appearance?.look ?? "calm",
          density: program.appearance?.density ?? "comfortable",
          experience: program.appearance?.experience ?? "classic",
        },
      };
    }),
};

const appearanceSet: ActionHandler<
  S.Schema.Type<typeof SuitePages.SiteAppearanceSetIn>,
  S.Schema.Type<typeof SuitePages.SiteAppearanceOut>
> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const node = yield* loadNode(ws, "Program", "rewards");
      if (!node) return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/", "the Program node does not exist"));
      const current = ((yield* loadProgram(ws)) as { appearance?: Appearance }).appearance;
      // A new look without a density resets it (the original behaviour); otherwise what is not given is kept.
      const density = input.density ?? (input.look === undefined ? current?.density : "comfortable");
      const experience = input.experience ?? current?.experience;
      const value: Appearance = {
        look: input.look ?? current?.look ?? "calm",
        ...(density === undefined ? {} : { density }),
        ...(experience === undefined ? {} : { experience }),
      };
      yield* commitAs(
        ctx,
        "site.appearance.set",
        [update(ctx, "Program", "rewards", node.revision, [["/spec/appearance", value]])],
        input.look === undefined
          ? `set the site experience to ${input.experience ?? "unchanged"}`
          : `set the site look to ${input.look}`,
      );
      return {
        appearance: {
          ...value,
          density: value.density ?? "comfortable",
          experience: value.experience ?? "classic",
        },
      };
    }),
};

export const siteHandlers = {
  "site.clear": clear,
  "site.restore": restore,
  "site.page.put": put,
  "site.widget.add": widgetAdd,
  "site.widget.remove": widgetRemove,
  "site.appearance.get": appearanceGet,
  "site.appearance.set": appearanceSet,
} satisfies HandlerTable;
