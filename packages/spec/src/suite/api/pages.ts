import { Schema as S } from "effect";
import { PageNav, PageSpec, SiteAppearance } from "../nodes";
import { WidgetCatalogEntry, WidgetSize } from "../widgets";
import { Empty, NodeLink } from "../primitives";
import { LayoutAt } from "../../nodes";

/** Pages and the widget catalogue (CONTRACT.md section 5A). Pages and widgets are edited through POST /changes. */

export const WidgetsCatalogIn = S.Struct({
  domain: S.optional(S.String),
  include_schemas: S.optional(S.Boolean),
});
export const WidgetsCatalogOut = S.Struct({ items: S.Array(WidgetCatalogEntry) }).annotations({
  identifier: "WidgetsCatalogOut",
});

/** One placed widget, resolved: the instance node body (or a synthesised reporting.panel instance for a panel item). */
export const ResolvedItem = S.Struct({
  item: S.String,
  at: LayoutAt,
  size: WidgetSize,
  node: S.NullOr(NodeLink),
  widget: S.String,
  config: S.Record({ key: S.String, value: S.Unknown }),
  title: S.String,
  /** False when the viewer lacks the widget's permission or the referenced node is unreadable: render the unavailable state. */
  available: S.Boolean,
  unavailable_reason: S.NullOr(S.Literal("forbidden", "missing", "unknown_widget")),
}).annotations({ identifier: "ResolvedItem" });

export const ResolveIn = S.Struct({
  /** An app path such as `/store/p/fleece-quarter-zip`; or give `page`. */
  path: S.optional(S.String.pipe(S.maxLength(200))),
  page: S.optional(S.String),
}).annotations({ identifier: "PagesResolveIn", description: "Exactly one of path or page." });

export const ResolveOut = S.Struct({
  page: NodeLink,
  spec: PageSpec,
  /** Route parameters extracted from `path`, used to resolve `{ param }` bindings client-side. */
  params: S.Record({ key: S.String, value: S.String }),
  items: S.Array(ResolvedItem),
  /** Set when the viewer has a personal copy of this page that was served instead. */
  personal_of: S.NullOr(NodeLink),
  editable: S.Boolean,
}).annotations({ identifier: "PagesResolveOut" });

export const PagesListOut = S.Struct({
  items: S.Array(
    S.Struct({
      page: NodeLink,
      kind: PageSpec.fields.kind,
      route: S.NullOr(S.String),
      nav: S.NullOr(PageNav),
      system: S.Boolean,
      widget_count: S.Int,
    }),
  ),
}).annotations({ identifier: "PagesListOut" });

/** Copy a shared page (and its widget instances) into a personal page owned by the viewer. */
export const PersonalizeIn = S.Struct({ page: S.String });
export const PersonalizeOut = S.Struct({
  page: NodeLink,
  widgets: S.Array(NodeLink),
  change_seq: S.Int,
}).annotations({ identifier: "PersonalizeOut" });

export const ResetPersonalIn = S.Struct({ page: S.String });
export const ResetPersonalOut = S.Struct({ deleted: S.Array(NodeLink), change_seq: S.Int });

// ---- site build actions: clear, restore, put page, add and remove widgets, appearance -----------------

const SiteSlug = S.String.pipe(S.pattern(/^[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*$/), S.maxLength(80));

export const SiteClearIn = Empty;
export const SiteClearOut = S.Struct({
  pages_removed: S.Int,
  widgets_removed: S.Int,
  change_seq: S.Int,
}).annotations({ identifier: "SiteClearOut" });

export const SiteRestoreIn = S.Struct({
  /** Default page slugs to restore; omit for every default page. */
  pages: S.optional(S.Array(SiteSlug).pipe(S.maxItems(100))),
}).annotations({ identifier: "SiteRestoreIn" });
export const SiteRestoreOut = S.Struct({
  pages_created: S.Array(S.String),
  pages_skipped: S.Array(S.String),
  widgets_created: S.Int,
  change_seq: S.Int,
}).annotations({ identifier: "SiteRestoreOut" });

export const SitePageItemIn = S.Struct({
  widget: S.String,
  config: S.optional(S.Record({ key: S.String, value: S.Unknown })),
  size: S.optional(WidgetSize),
  at: S.optional(LayoutAt),
}).annotations({ identifier: "SitePageItemIn" });

export const SitePutIn = S.Struct({
  slug: SiteSlug,
  title: S.String.pipe(S.minLength(1), S.maxLength(120)),
  route: S.String.pipe(S.pattern(/^\/[a-z0-9/:_-]*$/)),
  description: S.optional(S.String.pipe(S.maxLength(280))),
  kind: S.optional(S.Literal("module", "home")),
  nav: S.optional(
    S.Struct({
      section: PageNav.fields.section,
      label: PageNav.fields.label,
      icon: PageNav.fields.icon,
      count: PageNav.fields.count,
      permission: PageNav.fields.permission,
    }),
  ),
  /** When given on an existing page, replaces its widgets. */
  items: S.optional(S.Array(SitePageItemIn).pipe(S.maxItems(40))),
}).annotations({ identifier: "SitePutIn" });
export const SitePutOut = S.Struct({
  page: NodeLink,
  created: S.Boolean,
  widgets: S.Array(S.String),
  change_seq: S.Int,
}).annotations({ identifier: "SitePutOut" });

export const SiteWidgetAddIn = S.Struct({
  page: SiteSlug,
  widget: S.String,
  config: S.optional(S.Record({ key: S.String, value: S.Unknown })),
  size: S.optional(WidgetSize),
  at: S.optional(LayoutAt),
}).annotations({ identifier: "SiteWidgetAddIn" });
export const SiteWidgetAddOut = S.Struct({
  widget: S.String,
  page: S.String,
  at: LayoutAt,
  change_seq: S.Int,
}).annotations({ identifier: "SiteWidgetAddOut" });

export const SiteWidgetRemoveIn = S.Struct({ page: SiteSlug, widget: SiteSlug }).annotations({
  identifier: "SiteWidgetRemoveIn",
});
export const SiteWidgetRemoveOut = S.Struct({
  widget: S.String,
  page: S.String,
  change_seq: S.Int,
}).annotations({ identifier: "SiteWidgetRemoveOut" });

export const SiteAppearanceOut = S.Struct({ appearance: SiteAppearance }).annotations({
  identifier: "SiteAppearanceOut",
});
/** Every field is optional so an agent can flip just the experience; at least one must be given. */
export const SiteAppearanceSetIn = S.Struct({
  look: S.optional(SiteAppearance.fields.look),
  density: SiteAppearance.fields.density,
  experience: SiteAppearance.fields.experience,
})
  .pipe(
    S.filter((v) => v.look !== undefined || v.density !== undefined || v.experience !== undefined, {
      message: () => "give at least one of look, density or experience",
    }),
  )
  .annotations({ identifier: "SiteAppearanceSetIn" });
