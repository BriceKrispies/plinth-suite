import { Effect, Schema as S } from "effect";
import { nodeId, nodeUri } from "@plinth/core";
import {
  SIZE_GRID,
  SUITE_PERMISSIONS,
  SuitePages,
  WIDGET_CATALOGUE,
  WIDGET_SIZES,
  compactJsonSchema,
  widgetById,
  type NodeChange,
  type WidgetSize,
} from "@plinth/spec";
import { Authorizer } from "../../authz";
import { ChangeLog } from "../../change-log";
import type { ActionCtx, ActionHandler, HandlerError, SuiteEnv } from "../types";
import type { HandlerTable } from "./stub";
import { dom, q } from "./util3";

/**
 * Module `pages` (CONTRACT.md 5A.4, 12.11): the widget catalogue, page listing and resolution, and personal copies of
 * shared pages. Pages and widgets are ordinary nodes edited through the change log; this module only reads them and, for
 * `personalize` and `reset`, writes the viewer's own personal copies.
 */

type PageSpec = {
  kind: "module" | "home" | "profile" | "custom" | "personal";
  description: string;
  route?: string;
  owner?: string;
  based_on?: string;
  system: boolean;
  nav?: unknown;
  layout: {
    columns: 12;
    items: Array<{ item: string; at: { x: number; y: number; w: number; h: number }; size?: WidgetSize }>;
  };
};

interface PageRow {
  slug: string;
  revision: string;
  body: { metadata?: { title?: string }; spec?: PageSpec };
}

const loadPages = (ws: string) =>
  q<PageRow>(
    `SELECT slug, revision::text AS revision, body FROM nodes WHERE workspace_id = $1 AND kind = 'Page' AND deleted_at IS NULL ORDER BY slug`,
    [ws],
  );

const nodeLink = (ctx: ActionCtx, kind: string, slug: string, title: string, revision: string | number) => ({
  uri: nodeUri(
    ctx.principal.workspaceSlug,
    kind as never,
    nodeId(ctx.principal.workspaceId, kind as never, slug),
  ),
  kind,
  slug,
  title,
  revision: Number(revision),
});

const handleOfCtx = (ctx: ActionCtx) =>
  q<{ handle: string }>(`SELECT handle FROM members WHERE member_id = $1`, [ctx.principal.id]).pipe(
    Effect.map((r) => r[0]?.handle ?? null),
  );

/** May the viewer use a widget with this permission? Cached per call. */
const widgetGate = (ctx: ActionCtx) => {
  const cache = new Map<string, boolean>();
  const slug = ctx.principal.workspaceSlug;
  return (perm: string) =>
    Effect.gen(function* () {
      if (perm === "authenticated") return true;
      const hit = cache.get(perm);
      if (hit !== undefined) return hit;
      const authz = yield* Authorizer;
      const resource = (SUITE_PERMISSIONS as ReadonlyArray<string>).includes(perm)
        ? `plinth://${slug}/suite/pages`
        : perm === "query:run"
          ? `plinth://${slug}/Source/`
          : `plinth://${slug}/Page/`;
      const d = yield* authz.authorize(ctx.principal, perm, resource);
      cache.set(perm, d.kind === "allow");
      return d.kind === "allow";
    });
};

// ---- catalogue -----------------------------------------------------------------------------------------

const widgets: ActionHandler<
  S.Schema.Type<typeof SuitePages.WidgetsCatalogIn>,
  S.Schema.Type<typeof SuitePages.WidgetsCatalogOut>
> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const gate = widgetGate(ctx);
      const items = [];
      for (const w of WIDGET_CATALOGUE) {
        if (input.domain && w.domain !== input.domain) continue;
        items.push({
          id: w.id,
          domain: w.domain,
          title: w.title,
          description: w.description,
          pkg: w.pkg,
          sizes: [...w.sizes],
          default_size: w.default_size,
          grid: Object.fromEntries(w.sizes.map((s) => [s, SIZE_GRID[s]])),
          config_schema: input.include_schemas ? compactJsonSchema(w.config, false) : null,
          views: [...w.views],
          actions: [...w.actions],
          events: [...w.events],
          publishes: [...w.publishes],
          subscribes: [...w.subscribes],
          permission: w.permission,
          available: yield* gate(w.permission),
        });
      }
      return { items } as never;
    }),
};

// ---- list ----------------------------------------------------------------------------------------------

const list: ActionHandler<unknown, S.Schema.Type<typeof SuitePages.PagesListOut>> = {
  run: (_i, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const pages = yield* loadPages(ws);
      const gate = widgetGate(ctx);
      const visible = pages.filter(
        (p) => p.body.spec?.kind !== "personal" || p.body.spec.owner === ctx.principal.subject,
      );
      // widget slug -> catalogue permission, for the widgets of pages that have a nav entry
      const navSlugs = new Set<string>();
      for (const p of visible)
        if (p.body.spec?.nav)
          for (const i of p.body.spec.layout.items)
            if (i.item.startsWith("widget:")) navSlugs.add(i.item.slice(7));
      const wRows = navSlugs.size
        ? yield* q<{ slug: string; body: { spec?: { widget: string } } }>(
            `SELECT slug, body FROM nodes WHERE workspace_id = $1 AND kind = 'Widget' AND deleted_at IS NULL AND slug = ANY($2::text[])`,
            [ws, `{${[...navSlugs].map((s) => `"${s}"`).join(",")}}`],
          )
        : [];
      const widgetPerm = new Map<string, string | undefined>();
      for (const w of wRows)
        widgetPerm.set(w.slug, w.body.spec ? widgetById(w.body.spec.widget)?.permission : undefined);
      const usable: PageRow[] = [];
      for (const p of visible) {
        const s = p.body.spec;
        const nav = s?.nav as { permission?: string } | undefined;
        if (s && nav) {
          if (nav.permission && !(yield* gate(nav.permission))) continue;
          if (s.layout.items.length > 0) {
            let any = false;
            for (const i of s.layout.items) {
              if (i.item.startsWith("panel:")) any = yield* gate("query:run");
              else {
                const perm = widgetPerm.get(i.item.slice(7));
                any = perm !== undefined && (yield* gate(perm));
              }
              if (any) break;
            }
            if (!any) continue;
          }
        }
        usable.push(p);
      }
      const items = usable.map((p) => {
        const s = p.body.spec as PageSpec;
        return {
          page: nodeLink(ctx, "Page", p.slug, p.body.metadata?.title ?? p.slug, p.revision),
          kind: s.kind,
          route: s.route ?? (s.kind === "custom" ? `/p/${p.slug}` : null),
          nav: s.nav ?? null,
          system: s.system,
          widget_count: s.layout.items.length,
        };
      });
      return { items } as never;
    }),
};

// ---- resolve -------------------------------------------------------------------------------------------

const matchRoute = (route: string, path: string): Record<string, string> | undefined => {
  const a = route.split("/").filter(Boolean);
  const b = path.split("/").filter(Boolean);
  if (a.length !== b.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const seg = a[i] as string;
    if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(b[i] as string);
    else if (seg !== b[i]) return undefined;
  }
  return params;
};

const literalCount = (route: string): number =>
  route.split("/").filter((x) => x && !x.startsWith(":")).length;

/** The largest size variant whose footprint fits the cell. */
const sizeFor = (at: { w: number; h: number }): WidgetSize => {
  let best: WidgetSize = "s";
  for (const s of WIDGET_SIZES) if (SIZE_GRID[s].w <= at.w && SIZE_GRID[s].h <= at.h) best = s;
  return best;
};

const resolve: ActionHandler<
  S.Schema.Type<typeof SuitePages.ResolveIn>,
  S.Schema.Type<typeof SuitePages.ResolveOut>
> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      if ((input.path === undefined) === (input.page === undefined))
        return yield* Effect.fail(dom("VALIDATION_FAILED", "/path", "give exactly one of path or page"));
      const pages = yield* loadPages(ws);
      const shared = pages.filter((p) => p.body.spec && p.body.spec.kind !== "personal");
      let found: PageRow | undefined;
      let params: Record<string, string> = {};
      if (input.page !== undefined) {
        const slug = input.page.replace(/^page:/, "");
        found = shared.find((p) => p.slug === slug);
      } else {
        const [rawPath, query = ""] = (input.path as string).split("?");
        let path = (rawPath ?? "/").replace(/\/+$/, "") || "/";
        if (path.startsWith("/d/")) path = `/reports/${path.slice(3)}`;
        const custom = /^\/p\/([a-z][a-z0-9.-]*)$/.exec(path);
        if (custom) found = shared.find((p) => p.slug === custom[1]);
        else {
          let best = -1;
          for (const p of shared) {
            const r = p.body.spec?.route;
            if (!r) continue;
            const m = matchRoute(r, path);
            if (m && literalCount(r) > best) {
              best = literalCount(r);
              found = p;
              params = m;
            }
          }
        }
        for (const [k, v] of new URLSearchParams(query)) if (!(k in params)) params[k] = v;
      }
      if (!found || !found.body.spec)
        return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/path", "no page serves this path"));
      // a personal copy of the shared page wins
      const handle = yield* handleOfCtx(ctx);
      const personal = handle
        ? pages.find((p) => p.slug === `${found?.slug}.${handle}` && p.body.spec?.kind === "personal")
        : undefined;
      const served = personal ?? found;
      const spec = served.body.spec as PageSpec;
      const gate = widgetGate(ctx);
      // resolve the layout items
      const widgetSlugs = spec.layout.items
        .filter((i) => i.item.startsWith("widget:"))
        .map((i) => i.item.slice(7));
      const panelSlugs = spec.layout.items
        .filter((i) => i.item.startsWith("panel:"))
        .map((i) => i.item.slice(6));
      const wRows = widgetSlugs.length
        ? yield* q<{
            slug: string;
            revision: string;
            body: {
              metadata?: { title?: string };
              spec?: { widget: string; config: Record<string, unknown>; title?: string };
            };
          }>(
            `SELECT slug, revision::text AS revision, body FROM nodes WHERE workspace_id = $1 AND kind = 'Widget' AND deleted_at IS NULL AND slug = ANY($2::text[])`,
            [ws, `{${widgetSlugs.map((s) => `"${s}"`).join(",")}}`],
          )
        : [];
      const pRows = panelSlugs.length
        ? yield* q<{ slug: string; body: { metadata?: { title?: string } } }>(
            `SELECT slug, body FROM nodes WHERE workspace_id = $1 AND kind = 'Panel' AND deleted_at IS NULL AND slug = ANY($2::text[])`,
            [ws, `{${panelSlugs.map((s) => `"${s}"`).join(",")}}`],
          )
        : [];
      const items = [];
      for (const it of spec.layout.items) {
        const size = it.size ?? sizeFor(it.at);
        if (it.item.startsWith("panel:")) {
          const slug = it.item.slice(6);
          const p = pRows.find((x) => x.slug === slug);
          const ok = p !== undefined && (yield* gate("query:run"));
          items.push({
            item: it.item,
            at: it.at,
            size,
            node: null,
            widget: "reporting.panel",
            config: { panel: `panel:${slug}` },
            title: p?.body.metadata?.title ?? slug,
            available: ok,
            unavailable_reason: p === undefined ? "missing" : ok ? null : "forbidden",
          });
          continue;
        }
        const slug = it.item.slice(7);
        const w = wRows.find((x) => x.slug === slug);
        const def = w?.body.spec ? widgetById(w.body.spec.widget) : undefined;
        const ok = w !== undefined && def !== undefined && (yield* gate(def.permission));
        items.push({
          item: it.item,
          at: it.at,
          size,
          node: w ? nodeLink(ctx, "Widget", slug, w.body.metadata?.title ?? slug, w.revision) : null,
          widget: w?.body.spec?.widget ?? "",
          config: w?.body.spec?.config ?? {},
          title: w?.body.spec?.title ?? def?.title ?? w?.body.metadata?.title ?? slug,
          available: ok,
          unavailable_reason:
            w === undefined ? "missing" : def === undefined ? "unknown_widget" : ok ? null : "forbidden",
        });
      }
      const authz = yield* Authorizer;
      const edit = yield* authz.authorize(
        ctx.principal,
        "node:write",
        `plinth://${ctx.principal.workspaceSlug}/Page/${served.slug}`,
        {
          owner: spec.owner,
        },
      );
      return {
        page: nodeLink(ctx, "Page", served.slug, served.body.metadata?.title ?? served.slug, served.revision),
        spec,
        params,
        items,
        personal_of: personal
          ? nodeLink(ctx, "Page", found.slug, found.body.metadata?.title ?? found.slug, found.revision)
          : null,
        editable: edit.kind === "allow",
      } as never;
    }),
};

// ---- personalize / reset -------------------------------------------------------------------------------

const personalize: ActionHandler<
  S.Schema.Type<typeof SuitePages.PersonalizeIn>,
  S.Schema.Type<typeof SuitePages.PersonalizeOut>
> = {
  preview: (input) =>
    Effect.succeed({
      effect: `Copy page ${input.page.replace(/^page:/, "")} and its widgets into your own personal page`,
      facts: { page: input.page.replace(/^page:/, "") },
    }),
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const log = yield* ChangeLog;
      const handle = yield* handleOfCtx(ctx);
      if (!handle)
        return yield* Effect.fail(
          dom("FORBIDDEN", "", "only members have personal pages", { details: { reason: "no_member" } }),
        );
      const baseSlug = input.page.replace(/^page:/, "");
      const pages = yield* loadPages(ws);
      const base = pages.find((p) => p.slug === baseSlug && p.body.spec && p.body.spec.kind !== "personal");
      if (!base || !base.body.spec)
        return yield* Effect.fail(dom("UNKNOWN_REFERENCE", "/page", `no shared page '${baseSlug}'`));
      const personalSlug = `${baseSlug}.${handle}`;
      const existing = pages.find((p) => p.slug === personalSlug);
      const spec = base.body.spec;
      const widgetSlugs = spec.layout.items
        .filter((i) => i.item.startsWith("widget:"))
        .map((i) => i.item.slice(7));
      if (existing) {
        const links = widgetSlugs.map((s) => nodeLink(ctx, "Widget", `${s}.${handle}`, s, 1));
        return {
          page: nodeLink(
            ctx,
            "Page",
            personalSlug,
            existing.body.metadata?.title ?? personalSlug,
            existing.revision,
          ),
          widgets: links,
          change_seq: yield* log.headSeq(ws),
        } as never;
      }
      const wRows = widgetSlugs.length
        ? yield* q<{ slug: string; body: { metadata?: { title?: string }; spec?: Record<string, unknown> } }>(
            `SELECT slug, body FROM nodes WHERE workspace_id = $1 AND kind = 'Widget' AND deleted_at IS NULL AND slug = ANY($2::text[])`,
            [ws, `{${widgetSlugs.map((s) => `"${s}"`).join(",")}}`],
          )
        : [];
      const widgetChanges: NodeChange[] = wRows.map((w) => ({
        target: nodeUri(ctx.principal.workspaceSlug, "Widget", nodeId(ws, "Widget", `${w.slug}.${handle}`)),
        base_revision: null,
        ops: [
          {
            op: "create" as const,
            kind: "Widget" as const,
            slug: `${w.slug}.${handle}`,
            body: {
              apiVersion: "plinth/v1",
              kind: "Widget",
              metadata: { slug: `${w.slug}.${handle}`, title: w.body.metadata?.title ?? w.slug },
              spec: { ...(w.body.spec ?? {}), owner: ctx.principal.subject },
            },
          },
        ],
      }));
      const pageChange: NodeChange = {
        target: nodeUri(ctx.principal.workspaceSlug, "Page", nodeId(ws, "Page", personalSlug)),
        base_revision: null,
        ops: [
          {
            op: "create" as const,
            kind: "Page" as const,
            slug: personalSlug,
            body: {
              apiVersion: "plinth/v1",
              kind: "Page",
              metadata: { slug: personalSlug, title: `${base.body.metadata?.title ?? baseSlug} (mine)` },
              spec: {
                kind: "personal",
                description: spec.description,
                owner: ctx.principal.subject,
                based_on: `page:${baseSlug}`,
                system: false,
                layout: {
                  columns: 12,
                  items: spec.layout.items.map((i) =>
                    i.item.startsWith("widget:") ? { ...i, item: `widget:${i.item.slice(7)}.${handle}` } : i,
                  ),
                },
              },
            },
          },
        ],
      };
      const res = yield* log.commit({
        actor: { principal: ctx.principal, surface: ctx.surface, sessionId: ctx.sessionId },
        changes: [...widgetChanges, pageChange],
        reason: `personalise ${baseSlug}`,
      });
      const last = res.nodes?.[res.nodes.length - 1];
      return {
        page: nodeLink(
          ctx,
          "Page",
          personalSlug,
          `${base.body.metadata?.title ?? baseSlug} (mine)`,
          last?.result_revision ?? 1,
        ),
        widgets: wRows.map((w) =>
          nodeLink(ctx, "Widget", `${w.slug}.${handle}`, w.body.metadata?.title ?? w.slug, 1),
        ),
        change_seq: res.change_seq ?? last?.change_seq ?? 0,
      } as never;
    }),
};

const reset: ActionHandler<
  S.Schema.Type<typeof SuitePages.ResetPersonalIn>,
  S.Schema.Type<typeof SuitePages.ResetPersonalOut>
> = {
  preview: (input) =>
    Effect.succeed({
      effect: `Delete your personal copy of ${input.page.replace(/^page:/, "")} and return to the shared page`,
      facts: { page: input.page.replace(/^page:/, "") },
    }),
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const log = yield* ChangeLog;
      const handle = yield* handleOfCtx(ctx);
      if (!handle)
        return yield* Effect.fail(
          dom("FORBIDDEN", "", "only members have personal pages", { details: { reason: "no_member" } }),
        );
      const baseSlug = input.page.replace(/^page:/, "").replace(new RegExp(`\\.${handle}$`), "");
      const slug = `${baseSlug}.${handle}`;
      const rows = yield* q<PageRow>(
        `SELECT slug, revision::text AS revision, body FROM nodes WHERE workspace_id = $1 AND kind = 'Page' AND slug = $2 AND deleted_at IS NULL`,
        [ws, slug],
      );
      const page = rows[0];
      if (!page || page.body.spec?.owner !== ctx.principal.subject)
        return yield* Effect.fail(
          dom("UNKNOWN_REFERENCE", "/page", "you have no personal copy of this page"),
        );
      const widgetSlugs = (page.body.spec?.layout.items ?? [])
        .filter((i) => i.item.startsWith("widget:"))
        .map((i) => i.item.slice(7));
      const wRows = widgetSlugs.length
        ? yield* q<{
            slug: string;
            revision: string;
            body: { metadata?: { title?: string }; spec?: { owner?: string } };
          }>(
            `SELECT slug, revision::text AS revision, body FROM nodes WHERE workspace_id = $1 AND kind = 'Widget' AND deleted_at IS NULL
               AND slug = ANY($2::text[]) AND body -> 'spec' ->> 'owner' = $3`,
            [ws, `{${widgetSlugs.map((s) => `"${s}"`).join(",")}}`, ctx.principal.subject],
          )
        : [];
      const del = (kind: "Page" | "Widget", s: string, rev: string): NodeChange => ({
        target: nodeUri(ctx.principal.workspaceSlug, kind, nodeId(ws, kind, s)),
        base_revision: Number(rev),
        ops: [{ op: "delete" as const }],
      });
      const res = yield* log.commit({
        actor: { principal: ctx.principal, surface: ctx.surface, sessionId: ctx.sessionId },
        changes: [del("Page", slug, page.revision), ...wRows.map((w) => del("Widget", w.slug, w.revision))],
        reason: `reset ${baseSlug} to the shared page`,
      });
      return {
        deleted: [
          nodeLink(ctx, "Page", slug, page.body.metadata?.title ?? slug, page.revision),
          ...wRows.map((w) => nodeLink(ctx, "Widget", w.slug, w.body.metadata?.title ?? w.slug, w.revision)),
        ],
        change_seq: res.change_seq ?? res.nodes?.[0]?.change_seq ?? 0,
      } as never;
    }),
};

export const pagesHandlers = {
  "widgets.catalog": widgets,
  "pages.list": list,
  "pages.resolve": resolve,
  "pages.personalize": personalize,
  "pages.reset": reset,
} satisfies HandlerTable;

export type { HandlerError, SuiteEnv };
