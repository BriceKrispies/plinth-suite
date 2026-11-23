# 06. Architecture, the swap contract and testing

Part of the Township canonical spec (`README.md`). Requirement IDs are `TWN-R-6.<section>.<n>`.

Base: `../proposals/township.md` section R9. Changes: Classic (`packages/web`) is kept and is not retired (Township's
D15 is dropped); the town app is served under `/town/` on the same origin with the Classic/Town swap contract; the
building kit is procedural; there is no BVH dependency; Plain mode is built first and is the widget harness (Atelier);
the golden policy is set from measured data (feasibility spike 6). Mobile-first (`00-mobile-first.md`): layout is by
container queries with the compact design as the base stylesheet; widgets declare their compact presentation and
expansion; the default test profile is the phone; the dev origin is served over HTTPS on the LAN (section 6.11).

---

## 6.1 Packages

```
packages/
  spec/          (extended) + src/suite/experience.ts: pure swap helpers shared by Classic and Town (6.7);
                 SiteAppearance gains experience?: "classic" | "town"
  web/           Classic, kept: the Plain-mode reference, the no-GPU fallback, the task-time baseline;
                 gains the top-bar Town toggle and the swap handling (6.7)
  town-app/      Vite app served at /town/: index.html, boot, router, shell (HUD, Directory, palette, toasts,
                 agent log), plain.css (design-system CSS restyled for Plat class names)
  town-state/    api, rt (incl. onPresent), identity, stores, bus, widget runtime, page host, dispatcher, present,
                 experience store; a TypeScript port of packages/web/src/core (Classic keeps its own copy)
  town-plat/     the Plat runtime: PaintSpec registry, PaneHost, read batch, focus, announce, inert, city Plat,
                 breakpoints (shell and pane container names, 00 section 0.3), history for rooms and sheets,
                 visualViewport keyboard handling, doubleText() check
  town-kit/      interior UI kit: each component builds Plat DOM and registers PaintSpecs (h() discipline);
                 table (list and table presentations, columnar store, search, density strip and fast-scroll rail,
                 Select mode), grid, tabs, chip strip, menu and action sheet, dialog, sheet (detents), room dock, status layer,
                 room, lobby card, combobox, field, board, radiogroup (View control), slider, chart/*, diff,
                 vellum-fan, condition-builder, stepper
  town-text/     segmenter, measurer, breaker, runtime guard, clip chain and ellipsis, raster-run and SDF glyph
                 paths, numerals and rolls, the 2D surface (OffscreenCanvas or detached canvas)
  town-engine/   three.ts (the only three import site), capability, tiers, loop, governor, thermal guard, frame
                 graph, pipelines list, camera rigs (landing and street bake, vista), picking (vista), painters (panes, text,
                 charts, focus halo, rim), post (tilt-shift, grade, spotlight, fog), pane cards
  town-world/    plan (blocks, bands, lots, layouts: landing tiles, borough streets, side by side, vista; streets per
                 layout, derive), band bakes,
                 kit materials, districts, effects (flows, parcels, letters,
                 gates, machines and circuits, frieze, construction, lamp, stamps, look sweep, replay),
                 choreographer, scrubber model
  town-looks/    six looks × light, dark, light-more, dark-more; scene presets; token and contrast checker
  town-widgets/  the 77 widgets: src/<domain>/<name>.ts (+ optional <name>.diorama.ts), manifest.ts
  town-assets/   build scripts: procedural kit and landmark generator, font subsets, product and badge image atlases
  town-test/     harness: launch flags, deterministic clock, golden runner, parity, alignment, no-ghost-text,
                 perf runner, scenario specs (rebuild, demo, swap)
  town-spike/    the G0 spike (branch suite/town-spike); a record, never a dependency
```

**Dependency direction** (enforced by `scripts/check-deps.mjs`):

```
spec ◀── town-state ◀── town-plat ◀── town-kit ◀── town-widgets
              ▲             ▲            ▲
              │             └── town-text ◀── town-engine ◀── town-world
              │                                  ▲               ▲
              └───────────────── town-app ───────┴───────────────┘        town-looks ◀── (engine, kit, world, app)
web (Classic) ──▶ spec (experience.ts only new import)
```

Widgets never import `town-engine` or `town-world`; they depend only on `town-kit`, `town-state` (their context) and
`spec`. That keeps widgets self-contained apps and lets the whole widget layer run in Plain mode without a GPU.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-6.1.1 | The dependency direction above holds; `town-widgets` imports nothing from `town-engine`, `town-world` or `three`. | `check-deps.mjs` in CI. |
| TWN-R-6.1.2 | `packages/web` keeps building and passing its own suites at every step of the plan. | Classic's existing route sweep, a11y sweep and keyboard walk on every stack. |

## 6.2 The widget authoring contract

The module shape is UI-MAP section 4.1, unchanged except for an optional diorama.

```ts
// packages/town-widgets/src/points/ledger.ts
import { schemaOf, type WidgetModule } from "@plinth/town-state/widgets";
import { table, radiogroup } from "@plinth/town-kit";

export default {
  id: "points.ledger",
  domain: "points",
  title: "Statement",
  configSchema: schemaOf("points.ledger"),
  sizes: ["l", "xl", "full"],
  views: ["lines", "transaction"],
  presentations: ["table", "flow"],           // the View control (02 section 2.5); first is the default
  card: "summary",                             // default lobby card kind; a placement's compact.card overrides it
  dock: [                                      // the room dock at compact width, in priority order (00 section 0.4.2)
    { tool: "search" }, { tool: "sort" }, { tool: "filter" }, { tool: "view" }, { tool: "select" },
  ],
  list: {                                      // kit/table list presentation (02 section 2.6.1)
    primary: "memo", trailing: "delta", secondary: ["at", "type", "no"], trailingSub: "balance",
  },
  expand: { regular: { columns: ["at", "memo", "delta", "balance"] }, wide: { columns: "all" } },
  mount(el, { config, size, api, rt, bus, nav, ctx }) {
    // build Plat DOM inside el with town-kit components only; ctx.diorama.set(model) feeds the diorama
    return () => {};
  },
  update(config, size) {},
} satisfies WidgetModule;

// packages/town-widgets/src/points/ledger.diorama.ts
export default {
  id: "points.ledger",
  kind: "flow",
  budget: { drawCalls: 6, triangles: 12_000 },
  build(scene: DioramaScene, model: FlowModel) {},    // a sandboxed subgraph with its own camera and light rig
  update(model: FlowModel) {},
  describe(model: FlowModel): string,                  // the announced one-sentence summary
  walk: { items(model: FlowModel): WalkItem[] },       // keyboard walk order; each item maps to a Plat row
} satisfies DioramaModule<FlowModel>;
```

**Rules.**

1. **Plat only.** Render only inside `el`, with `town-kit` components and `h()`; raw `innerHTML` is forbidden. Every
   visible element comes from a kit component that registers a PaintSpec; an element without one is outlined magenta
   in the dev overlay and fails the no-ghost-text check.
2. **Data and realtime** go through the scoped `api`, `rt` and `bus`, as in Classic. Widgets never touch the world;
   city effects come only from the event map.
3. **Dioramas** receive a `DioramaScene` and a plain data model (`ctx.diorama.set(model)`), never `api`. Their budget
   is asserted in dev.
4. **Arrival and attribution** chrome is drawn by the PaneHost, never by widgets.
5. **A widget never imports another widget.** Bus topics are the catalogue's.
6. **Plain first, phone first.** A widget is accepted in Plain mode (axe, interaction tests, Plat-versus-Classic
   diff) before its GPU paint is reviewed, and at 390 × 844 with touch before its expansions are reviewed. Because the
   painter is generic, a widget needs no GPU code unless it has a diorama.
7. **Containers, not viewports.** A widget chooses its presentation only from its pane's container (CSS
   `@container` rules on the pane root, or the kit's `ctx.size`, which reports compact, regular or wide from the
   pane's `ResizeObserver`); it never reads the viewport.

**Porting from Classic.** Classic widgets already build DOM with `h()` and design-system components. The port swaps
those imports for `town-kit` components with the same names and options, removes widget CSS (layout becomes kit
props, colour lives in tokens), and moves charts to `kit/chart`. The authoring-cost gate (G1, `07` section 7.4)
measures this on three widgets before the widget waves start.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-6.2.1 | No widget module uses `innerHTML`, imports another widget, or creates an element outside `town-kit`/`h()`. | Lint rules over `town-widgets`. |
| TWN-R-6.2.2 | Every widget passes its Plain-mode acceptance before its GPU visual baseline is approved. | Workgraph task dependency per widget wave; CI job order on the stack. |

## 6.3 Scene graph

```ts
// packages/town-world/src/types.ts
export interface World {
  readonly plinth: Plinth;                                   // static mesh, engraving, seq strip
  readonly districts: ReadonlyMap<DistrictId, District>;
  readonly streets: StreetGraph;
  readonly homes: ReadonlyMap<Handle, Home>;
  readonly actors: { viewer: Figure; lamp: Lamp | null };
  readonly effects: EffectPools;                              // flows, parcels, letters, carts, medallions, pulses
  readonly stamps: StampTrail;
  look: LookState;
  replay: ReplayState | null;                                 // scrubber
}
export type DistrictId =
  | "points" | "store" | "promotions" | "badges" | "messaging" | "notifications" | "tasks" | "approvals"
  | "content" | "people" | "segments" | "automation" | "calendar" | "reporting" | "audit" | "admin"
  | "pages" | "search" | "settings" | "newtown" | "square";
export interface District {
  readonly id: DistrictId; readonly borough: Borough; readonly bounds: Box2;
  readonly lots: ReadonlyArray<Lot>; readonly annex: ReadonlyArray<Lot>;
  readonly landmark: LandmarkInstance;
  available: boolean; plaque: PlaqueState; elsewhere: ReadonlyArray<{ widgetId: string; href: string }>;
}
export interface Lot { readonly id: string; readonly origin: Vec3; readonly frontage: number; readonly depth: number;
  readonly door: StreetNodeId; building: Building | null }
export interface Building {
  readonly pageUri: string; readonly slug: string; readonly route: string; readonly createdSeq: number;
  readonly storeys: number;                                   // ceil(max(y+h)/6)
  readonly style: KitStyleId; readonly homeDistrict: DistrictId;   // differs from the lot's district on overflow
  floors: ReadonlyArray<{ pageUri: string; route: string; title: string }>;
  windows: ReadonlyArray<Window>;
  construction: { phase: "none" | "survey" | "foundation" | "frame" | "courses" | "dressing" | "demolish";
                  progress: number; actor: ActorTag };
  attribution: ActorTag | null;
}
export interface Window {
  readonly instanceUri: string; readonly widgetId: string;
  readonly cell: { x: number; y: number; w: number; h: number }; readonly facadeRect: Rect;
  lit: "dark" | "lit" | "arriving" | "removed"; emblem: DistrictId | null; count: number | null;
}
export interface Lamp { position: Vec3; target: LotRef | NodeRef | null; activity: "idle" | "working";
  session: string; actor: ActorTag; lastSeq: number }
export interface Stamp { readonly at: Vec3; readonly outcome: "commit" | "held" | "dry-run" | "refused";
  readonly label: string; readonly seq: number | null; readonly approval: string | null; readonly t: number }
export interface StampTrail { readonly stamps: ReadonlyArray<Stamp>; readonly path: ReadonlyArray<Vec3> }
export interface ActorTag { kind: "person" | "agent" | "system"; id: string; label: string; hue?: number; seq: number }
```

**Three mapping.** One `InstancedMesh` per procedural kit module (about 40); construction progress, tone, hatch and
window state are instance attributes. The whole city is about 45 draws plus landmarks, 6 effect pools, the lamp and
plaques: about 90 draw calls at its busiest. The world model is pure data updated by the Dispatcher and the derive
step; three objects are a projection of it, rebuilt per frame only where dirty bits say.

## 6.4 Layout

- **Shell:** `#plat` is a size container (`container-type: inline-size`, name `shell`); the base stylesheet is the
  compact design, and `@container shell (min-width: 37.5rem)`, `64rem` and `100rem` blocks add the medium, expanded
  and wide expansions, plus `@media (max-height: 30rem)` for the short rail. No layout rule uses a viewport media
  query for width.
- **Interior:** the Plat lays out with CSS. At compact width the page host renders the lobby (a single flex column in
  `(y, x)` order); at medium two columns; at expanded the 12-column grid (`grid-template-columns: repeat(12, 1fr)`,
  rows 4.5 rem, `--x --y --w --h`). Each pane root is a size container (name `pane`); kit components use flex and
  grid. The painter reads it as in `03` section 3.6.
- **City:** the lot plan (`plan/lots.ts`, surveyed once per band in code), the block layout (`plan/layout.ts`: one
  column, two columns, the vista) and the derive step (`01` sections 1.4 and 1.6). At compact and medium width plaques
  are Plat text at fixed offsets in the street's content (no per-frame layout). In the vista they are laid out in
  screen space each frame from projected anchors with a greedy collision pass (≤ 0.2 ms for 80 plaques);
  lower-priority plaques fade when they overlap.

## 6.5 State

- **Stores** (ported with the same API as Classic's): `meStore`, `countsStore`, `prefsStore`, `clockStore`,
  `navStore`; new: `connectionStore` (connecting, live, offline; retry time; head seqs), `altitudeStore` (city,
  district, interior, pane focus; district and route), `presentStore` (pending present requests), `renderStore`
  (tier, pinned tier, backend, motion, travel, text scale, hand, single-key shortcuts, follow agent, init-failure
  reason), `layoutStore` (shell breakpoint, short, city layout, keyboard open), `experienceStore` (site default,
  override, effective; 6.7), `agentStore` (active sessions, lamp state, stamps).
- **World model** is a store-fed projection.
- **Widget state stays inside widgets.**
- **Persisted per viewer** in the Preference node `ui` block: pinned tier, motion, travel, text size, hand,
  single-key shortcuts, follow agent, Directory collapsed, View choice per widget instance, column widths, matrix view.
  `localStorage` holds the last governed tier per device (`plinth.town.tier`, a device fact rather than a viewer
  preference), a motion hint for the first paint, and the swap override `plinth.experience`.

## 6.6 Routing and deep links

- The town app is served with Vite `base: "/town/"`. **Every Classic route works under `/town` with the same path and
  is shareable** (6.7).
- Town-only routes: `/town/city` (the landing or the vista), `/town/city/b/:borough` (a borough street, or the vista
  framed on the borough), `/town/city/:district`.
- Town-only query parameters: `?focus=<instance>` (the room at compact width, pane focus at expanded), `?cam=`
  (a framed vista view, or the band at compact width),
  `?render=plain|webgl2|webgpu` and its alias `?plain=1`, `?backend=webgl2`, `?motion=full|reduced|off`, `?test=1`.
  `?as=<handle>` is kept by `href()` exactly as in Classic.
- **History:** altitude changes, floor changes, opening a room, pushing a detail inside a room and opening a modal
  sheet push entries; sibling-pane moves, camera orbiting and city scrolling do not (the city's scroll position is
  kept in the history state and restored). Back from an interior entered from the city returns to the band or the
  district framing it was entered from.
- A deep link renders the interior directly; the backdrop builds in idle time. No establishing shot is forced.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-6.6.1 | Every route in UI-MAP section 2 (and `/d/:dashboard`, `/p/:page`) loads cold under `/town` with the same page and bound parameters as in Classic. | Route sweep of both apps; compare `pages.resolve` calls and rendered instances. |
| TWN-R-6.6.2 | `?as=` survives every in-app navigation, Enter, Exit, travel, room, sheet, present acceptance and swap. | Interaction sweep in both profiles asserting the URL. |
| TWN-R-6.6.3 | History back from any room, detail push or modal sheet returns to exactly the previous state (route, open sheet or room, city scroll position) and never leaves the app while an in-app state remains. | Phone interaction test driving `history.back()` through a deep stack. |

## 6.7 The Classic/Town swap contract

Classic and Town are two experiences of one site. The contract is implemented on both sides; Classic's half is on the
`suite/swap` branch. The town app must honour all of it.

### 6.7.1 One origin, mirrored routes

- Both apps are served from **one origin**. Classic owns `/`; the town app owns `/town/` and everything under it. In
  development, Classic's Vite server proxies `/town/` (including the town app's HMR socket) to the town app's dev
  server, so the browser sees one origin; in production both static builds are served from the same origin with SPA
  fallbacks for each prefix. One origin is what lets both apps share `localStorage`.
- **Under HTTPS on the LAN** (section 6.11) the one origin is `https://<host>:5443`: Classic's HTTPS dev server
  terminates TLS and proxies `/town` (with `ws: true`), `/api` and `/rt` to their local HTTP processes, so the contract
  is unchanged. `http://localhost:5173` and `https://<host>:5443` are different origins with separate `localStorage`;
  the override and identity tabs set on one are not seen on the other.
- **Route mirroring is 1:1** and lives in `packages/spec/src/suite/experience.ts` as pure functions:

```ts
export type Experience = "classic" | "town";
export type ExperienceOverride = Experience | "site";
export const EXPERIENCE_KEY = "plinth.experience";
export const TOWN_ONLY_PARAMS = ["focus", "cam", "render", "plain", "backend", "motion", "test"] as const;

/** "/store?as=ana" → "/town/store?as=ana"; "/" → "/town/". */
export function toTown(url: URL): string;
/** "/town/store?as=ana&render=plain" → "/store?as=ana"; "/town/city", "/town/city/b/:b" and "/town/city/:d" → "/". */
export function toClassic(url: URL): string;
/** The effective experience: the override unless it is "site" (or absent or unreadable), else the site default. */
export function effectiveExperience(override: ExperienceOverride | null, siteDefault: Experience | undefined): Experience;
```

- Query parameters are preserved except the town-only set, which is dropped going to Classic. `?as=` is always
  preserved. The hash is preserved.

### 6.7.2 The site default

- `SiteAppearance` gains `experience?: "classic" | "town"` on the Program node; absent means `"classic"`.
- It is set by `site.appearance.set` (`admin:settings`, agent `direct`, so MCP-settable) and read by
  `site.appearance.get`, alongside `look` and `density`. Like every `site.*` action it is an ordinary change-log commit.

### 6.7.3 The per-viewer override

- `localStorage["plinth.experience"]` ∈ `"classic" | "town" | "site"`; absent means `"site"`. Every read and write is in
  `try/catch`; a failure means `"site"`.
- The top-bar toggles write the override:
  - Classic's top bar: a **Town** toggle; the town HUD: **Switch to Classic**. Each is a real `<a href>` to the mirrored
    URL with the one-shot parameter `?experience=<target>`, so middle-click and copy-link work.
  - On load, either app that sees `?experience=<x>` writes the override `x` and removes the parameter with
    `history.replaceState`.
  - Both apps' settings offer **Follow site default**, which writes `"site"`.

### 6.7.4 Boot and live swap

- **On boot**, before rendering anything, each app computes the effective experience from the override and the site
  default (from `site.appearance.get`, with the last-known value cached in `localStorage` for the first paint and
  corrected once fetched). If it is the other app, it calls `location.replace` with the mirrored URL.
- **Live:** when a Program change arrives on the change stream and the site default's `experience` changed, every
  browser whose override is `"site"` (or absent) and whose effective experience changed swaps to the mirrored route.
  - If an editable field has unsaved input, a dialog is open or a composition is active, the swap waits: a banner says
    "The site switched to Classic. Switch now · Stay here" and is announced politely. "Stay here" keeps this tab until
    its next full load; nothing is persisted.
  - Otherwise the swap is a `location.assign` to the mirrored route.
- Browsers with an explicit `"classic"` or `"town"` override never swap on a site-default change.

### 6.7.5 Town without a GPU path

- If the capability ladder finds neither WebGPU nor WebGL2 (`03` section 3.3), the town app sets
  `sessionStorage["plinth.town.unsupported"] = "1"` and calls `location.replace` with the Classic mirror plus
  `?notice=town-unsupported`.
- Classic shows the notice "Town needs WebGPU or WebGL2, which this browser does not offer, so you are in Classic."
  (a polite announcement and a dismissible banner) and removes the parameter.
- While the session flag is set, Classic does not redirect to Town even if the effective experience is Town, which
  prevents a loop. The flag dies with the tab.
- Forced colours, Save-Data and the Plain choice are **not** reasons to redirect: the town app serves them in Plain
  mode (`04` section 4.2).
- **A renderer that fails after the probe passed** (init, warm-up, text surface, first frame; `03` section 3.3) is
  also not a reason to redirect: the town app stays on the same route in Plain mode with its notice. This refines
  UI-MAP section 8.5 rule 1, which had the town app write the override `"classic"` and redirect; staying in Plain mode
  keeps the viewer's route and their own override, and no loop can arise because nothing redirects. The redirect to
  Classic remains only for a browser with neither WebGPU nor WebGL2 at the probe.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-6.7.1 | `toTown` and `toClassic` are inverse on every Classic route (with parameters and query), map `/town/city*` to `/`, preserve `?as=` and the hash, and drop exactly the town-only parameters. | Unit tests in `packages/spec` over the UI-MAP route list and edge cases. |
| TWN-R-6.7.2 | The town app is served under `/town/` from the same origin as Classic in development and production builds, and `localStorage` written by one app is read by the other. | Playwright: write the override in Classic, load `/town/`, read it. |
| TWN-R-6.7.3 | On boot, a viewer whose effective experience is the other app is redirected to the mirrored route before any app content renders. | Playwright with each override and site-default combination (3 × 2) on 5 routes; assert the final URL and no content paint before redirect. |
| TWN-R-6.7.4 | `site.appearance.set { experience }` swaps every open browser following the site default to the mirrored route, live, and leaves browsers with an explicit override alone. | Swap scenario test: four browser contexts (follow in Classic, follow in Town, override classic, override town); MCP call; assert each context's URL. |
| TWN-R-6.7.5 | A live swap waits behind the banner while an editable field has unsaved input, a dialog is open or a composition is active. | Swap scenario with typed but unsaved input in the transfer memo. |
| TWN-R-6.7.6 | The toggles are links to the mirrored URL carrying `?experience=`; following one writes the override and strips the parameter. | Interaction test in both apps, including middle-click into a new context. |
| TWN-R-6.7.7 | Without WebGPU and WebGL2, a `/town/...` load ends on the Classic mirror with the notice and never loops, even with the override set to `"town"`. | Playwright with GPU disabled and the override `"town"`; assert one redirect and the notice. |
| TWN-R-6.7.8 | Forced colours, Save-Data, the Plain choice and a renderer failure after the probe keep the viewer in the town app, on the same route, in Plain mode, with the override unchanged. | Media and header emulation tests; the fault-injection tests of TWN-R-3.3.4 asserting the URL and `localStorage`. |

## 6.8 Agent and backend surface

The town app needs these backend pieces:

- `ui.present` forwarding (CONTRACT 6.3, merged).
- `SiteAppearance.experience` for the swap contract (on `suite/swap`).
- **The compact placement on page layout items** (below), new with the mobile review. It is what gives the phone a
  vote in each page's information architecture (`02` section 2.1).

Optional, not required by this spec, open question for the owner: an `agent.activity` notice forwarded to the
session's owners so browsers can stamp dry runs and refusals (`05` section 5.6).

### 6.8.1 Schema change: `PageItem.compact`

In `packages/spec/src/suite/nodes.ts`:

```ts
/** How a layout item appears on a phone (compact width). Absent: after the items that have it, in grid (y, x) order,
 *  with the widget's default card kind. */
export const CompactCard = S.Literal("whole", "summary", "entry", "hidden").annotations({ identifier: "CompactCard" });
export const PageItemCompact = S.Struct({
  /** Position in the phone lobby, ascending; unique within the page. */
  order: S.Int.pipe(S.between(0, 999)),
  /** Overrides the widget's default card kind; "hidden" lists it under "More on this page" instead. */
  card: S.optional(CompactCard),
  /** Pinned cards lead the lobby; at most three per page. */
  pin: S.optional(S.Boolean),
}).annotations({ identifier: "PageItemCompact" });

export const PageItem = S.Struct({
  item: S.String.pipe(S.pattern(/^(widget|panel):[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*$/)),
  at: LayoutAt,
  size: S.optional(WidgetSize),
  compact: S.optional(PageItemCompact),                       // new
}).annotations({ identifier: "PageItem" });
```

`PageSpec.layout` gains a check (an `S.filter` on the struct): `compact.order` values are unique among the items that
have one, and at most three items have `pin: true`. A failing page is refused like any invalid node commit
(`ApiError` with `error.path` at the offending item).

**Actions and API** (`packages/spec/src/suite/api/pages.ts`):

- `SitePageItemIn` gains `compact: S.optional(PageItemCompact)`; `site.page.put` writes it through. When `items` is
  given without any `compact`, the server assigns none (the derived order applies).
- `SiteWidgetAddIn` gains `compact: S.optional(PageItemCompact)`; without it, an added item on a page whose items
  have compact data gets `order` = the page's largest order + 1 and no card override, so an agent's addition lands at
  the end of the phone lobby rather than nowhere.
- `ResolvedItem` (the `pages.resolve` output) gains `compact: PageItemCompact` **resolved**: the stored value, or the
  derived one (`order` from the derived position, `card` from the widget's manifest default), so every client gets a
  complete order.
- The page editor commits Page changes as before (a `node.commit` of the Page); the Phone layout tab changes only
  `compact`, the Desktop layout only `at` and `size` (`02` TWN-R-2.9.5).

**Rules and migration:**

- R-PAGE-SYSTEM is unchanged: an agent's edit of a system page's `compact` data is held like any other edit.
- Nothing is migrated: existing Page nodes without `compact` keep working on the derived order.
- `packages/spec/src/suite/default-pages.ts` gains `compact` on every seeded item (`02` section 2.1.3), so
  `site.restore` brings back the authored phone order.
- `pnpm schema:gen` regenerates `generated/*.json` and `packages/web/src/core/widget-schemas.js`. **Classic** may use
  the resolved order for its own single column below 48 rem (a recommendation, not part of the swap contract), which
  would make both experiences' phone order the same.
- CONTRACT.md section 5A gains the field's description in the same change.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-6.8.1 | `PageItem.compact` exists with the schema above; a Page whose `compact.order` values repeat, or with more than three pinned items, is refused with `error.path` at the item. | Schema unit tests in `packages/spec`; an API test committing each invalid case. |
| TWN-R-6.8.2 | `site.page.put` and `site.widget.add` accept and persist `compact`; `site.widget.add` without it on a page with compact data appends at the end of the order; `pages.resolve` returns a resolved `compact` for every item. | Engine tests for `site.ts` handlers and the resolve handler. |
| TWN-R-6.8.3 | `site.restore` recreates the seeded pages with their authored `compact` data. | Rebuild scenario: compare `compact` before clear and after restore. |

## 6.9 Testing strategy

Per the repository's rule, each change runs only cheap checks (typecheck, format, lint on touched files). Test suites
run once per stack on the integration line, through Workgraph stacks; a failing stack is bisected on the stack, not
re-tested per change.

**Phone first.** The default Playwright project in `town-test` is the phone profile of `00` section 0.8: 390 × 844 CSS
px, DPR 3, `isMobile`, `hasTouch`, CPU slowed 4× through CDP, the design network for load tests. Every interaction,
a11y, parity, scenario and perf suite runs there first. The **expansion pass** runs the same suites at 800 × 1280
(touch), 1440 × 900 (mouse, DPR 1) and 1920 × 1080. A WebKit project at 390 × 844 (Playwright's WebKit, iPhone 13
descriptor) runs the interaction, a11y and text-integrity suites as a proxy for iOS Safari's layout and missing APIs
(it has no `OffscreenCanvas` in the configurations that matter). A Chromium project at 412 × 915 and DPR 2.625 (Pixel 7)
runs the parity and alignment sweeps.

**What runs on real devices.** Emulation does not measure a phone GPU, thermals, battery, memory pressure or real
WebGPU availability. The two G0 phones (an Adreno 6xx class Android phone in Chrome and an A15 class iPhone in Safari)
run, over HTTPS on the LAN: G0 C11 to C13, the device perf scenes at G-PERF, the screen-reader scripts with VoiceOver
and TalkBack, and the phone-led demo rehearsal. Results are posted from the device to the dev server by the harness's
device reporter (`/town/?test=device` opens a results panel and POSTs JSON to `/__town/results`), so no cable or
remote inspector is needed.

| Layer | Tool | What it proves |
|---|---|---|
| Unit (pure) | Vitest | derive, lots and overflow, layouts and street paths, swap helpers, Choreographer ordering and pressure, text breaker, guard, clip and ellipsis, numerals, event map, resolver, scrubber model, look tokens and contrast, tiers and governor |
| Harness boot | Playwright Chromium on the reference machine with `--enable-unsafe-webgpu --use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`; SwiftShader (`--use-angle=swiftshader`, WebGPU on SwiftShader where it boots) on GPU-less runners | both backends boot and render; structure only on SwiftShader |
| Determinism | `?test=1`: frozen clock with `advance(ms)`, seeded RNG, fixed DPR per project, grain off | pixel-stable frames |
| Visual regression | golden runner (6.9.1) | looks and layouts do not drift |
| Text integrity | line-start parity, 1 CSS px alignment, clip chain, `doubleText()` after every step, fault injection for init failures and `OffscreenCanvas` absence (`03` sections 3.3, 3.5) | one copy of every text, in its box, inside its clip, at every DPR |
| No ghost text | `04` TWN-R-4.1.1 | nothing painted that AT cannot read, nothing readable unpainted |
| Interaction | Playwright against the Plat (`getByRole`), touch emulation first (`tap`, scripted touch swipes with CDP `Input.dispatchTouchEvent`), then keyboard and mouse; the vista through `__town.project(worldPos)` under `?test=1` | lobby, rooms, sheets, forms with keyboard emulation, lists, matrix views, board, command sheet, landing and borough streets, Enter, Exit, gestures and their alternatives |
| Gesture parity | `00` TWN-R-0.5.1 | every gesture has a working visible alternative |
| A11y mirror | axe, landmark and heading outline snapshots, Plat-versus-Classic diff, announcement log with a stalled painter, forced-colours and prefers-contrast projects, reflow, text spacing | `04` section 4.15 |
| Keyboard walk | `scripts/keyboard-walk.ts` (`check:keys`) extended to `/town` in both profiles and the magnifier proxy | every stop named, outlined, still, unobscured, escapable |
| Realtime | scripted rt replay of recorded `gen:live` frames; gap and reconnect cases; present frames through the test gateway | stores, Plat, world and announcements are right and isolated |
| Rebuild | `rebuild-live.ts --clear` against the test stack, phone profile then vista | the signature sequence end to end, seed lots restored |
| Swap | four-context swap scenario (6.7) | the swap contract |
| Demo | `demo.spec.ts` (`05` section 5.12) | every beat and rehearsal fact, phone-led then big screen |
| Perf | perf runner: phone profile (main-thread CPU per frame, load over the design network), then the reference profile (`timestamp-query` and rAF deltas); device runs at G0 and G-PERF | `03` section 3.11 |
| Screen readers | VoiceOver (iOS) and TalkBack scripts first, then NVDA and VoiceOver (macOS) (`04` TWN-R-4.15.3) | real AT behaviour |
| Task-time study | `04` section 4.16 at G-STUDY | daily users are not slower, on phones first |

### 6.9.1 Golden policy, set from data

1. **Measure first.** Before any golden is committed, `town-test` renders each golden scene 20 times on the reference
   machine per backend and per profile, and 20 times on SwiftShader, and records per-scene noise: the share of pixels
   that differ between runs and the largest channel delta.
2. **Thresholds come from the measurement:** the pixel-difference threshold per backend and profile is the measured
   worst-case noise plus 50 %, recorded in `town-test/goldens/policy.json` with the measurement date and adapter
   string. If SwiftShader noise exceeds 0.5 % of pixels, SwiftShader gets no pixel goldens (boot and structure tests
   only).
3. **Goldens are per adapter class and profile** (`gtx1080ti-d3d12`, `gtx1080ti-angle-d3d11`, each at phone and
   desktop profiles, and later device classes), never shared across adapters.
4. **The set is bounded, phone first:** every route's lobby and one room per route in calm light at 390 × 844 DPR 3
   (Base tier) on both backends; then every route in calm light at 1440 × 900 (Full); every look and theme on three
   representative routes (Home, `/points`, `/admin/roles`) at 390 first and 1440 second; the landing, the Rewards
   street at two scroll positions, the vista and district framing, and five keyframes of each Enter (compact and vista)
   per look. Diorama scenes at their default and flat views in portrait and landscape framings.
5. **Updating a golden** needs a reviewed diff image attached to the change; the stack refuses a golden change without
   one.
6. **Re-measure** on every three upgrade, driver change on the reference machine or new adapter class.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-6.9.1 | `policy.json` exists with measured noise per scene, backend, profile and adapter before any golden is committed, and every threshold equals measured noise plus 50 %. | Golden runner refuses to compare without a policy entry; unit test over the policy file. |
| TWN-R-6.9.2 | No golden is compared across adapter classes or profiles. | Golden runner keys files by adapter string and profile. |
| TWN-R-6.9.3 | The default `town-test` project is the phone profile, and the WebKit 390 × 844 and Chromium 412 × 915 DPR 2.625 projects run the interaction, a11y and text-integrity suites on every stack. | Review of `town-test/playwright.config.ts` and the stack job list (the form of TWN-R-0.8.1 for this file). |

## 6.10 CI

- **Per change** (the agent working on it): `pnpm typecheck` for touched packages, `prettier --check`, lint, and the
  dependency and pin checks. No test suites, no renders, no perf runs.
- **Per stack** (the coordinator, on the integration line):
  - on any runner: unit tests, swap helper tests, look token checks, dependency and pin checks, build-size check
    against the phone download limits;
  - on the **reference machine runner** (the GTX 1080 Ti desktop, headless Chromium with the reference flags, at most
    two Playwright workers so GPU timings are not contended): phone profile first (harness boot on both backends,
    goldens, text integrity, a11y mirror, keyboard walk, interaction and gesture parity, rt replay, rebuild, swap,
    demo, perf), then the WebKit and Pixel projects, then the expansion profiles;
  - Classic's own route sweep, a11y sweep and keyboard walk (TWN-R-6.1.2).
- **At gates** (`07` section 7.4): device runs on the named phones and laptops, screen-reader scripts, the art sheet,
  the task-time study.
- A stack that breaks a budget, a golden, parity, `doubleText()` or an a11y check is not accepted; the breaking change
  is found by bisecting the stack.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-6.10.1 | The stack verification for town packages runs the per-stack job list above in that order, and per-change checks run no test suite. | Workgraph stack configuration review; CI job definitions checked into the repository. |

## 6.11 HTTPS on the LAN (dev)

WebGPU is exposed only in a secure context. `http://localhost` is secure, so development on the desktop needs nothing
new. A phone on the LAN loading `http://192.168.x.y:5173` is not in a secure context and gets WebGL2 at best, which is
why phones over plain HTTP never showed WebGPU.

**What exists** (integration line, commit `a65851f`, WG-5536):

- `packages/web/package.json`: the script `dev:https` = `vite --host 0.0.0.0 --port 5443 --mode https`, and the dev
  dependency `@vitejs/plugin-basic-ssl` pinned at exactly `2.3.0`.
- `packages/web/vite.config.ts`: with `mode === "https"` the plugin `basicSsl({ name: "plinth-lan" })` is added. It is
  the same config as the 5173 server, so the 5443 server proxies `/api` and `/rt` (with `ws: true`) and `/town` to the
  town dev server exactly as 5173 does (UI-MAP section 8.1). TLS ends at 5443; everything behind it stays local HTTP.
- Run with `pnpm --filter @plinth/web dev:https` alongside the usual processes. The phone opens
  `https://<host>:5443/town/` and accepts the self-signed certificate once.

**What the town app must do for it:**

- Build every realtime and API URL from `location` (`${location.protocol === "https:" ? "wss" : "ws"}://
  ${location.host}/rt`), never from a hard-coded scheme or port.
- When served through 5443, set the town dev server's `server.hmr` to `{ protocol: "wss", clientPort: 5443 }` (by an
  environment variable the `dev:https` run sets), so HMR goes through the proxy.
- `https://<host>:5443` is its **own origin**: its `localStorage` (the experience override, identity tabs) is separate
  from `http://localhost:5173`'s. The swap contract holds within each origin.

**Certificate policy.** The click-through certificate stays the default **if** G0 C11 shows that WebGPU is exposed on
a page reached through it on both phones. If it is not (browsers restrict some features on pages whose certificate
error was bypassed), the fallback is **mkcert** (version 1.4.4, checked against its published checksum): a local CA
installed and trusted once on each phone (iOS: install the profile, then enable full trust in Certificate Trust
Settings; Android: install as a user CA, which Chrome honours), a leaf certificate in `.certs/` (gitignored) for the
machine's LAN addresses and `<hostname>.local`, and the 5443 server reading it instead of the plugin's. The choice is
recorded on the G0 task.

| ID | Requirement | Test |
|---|---|---|
| TWN-R-6.11.1 | With `dev:https` running, `https://<lan-address>:5443/town/` and `https://<lan-address>:5443/` are served from one origin, `/api` and `wss://…/rt` work through the proxy, and the town app's HMR connects over `wss` on 5443. | Playwright on the reference machine against the LAN address with `ignoreHTTPSErrors`; assert `isSecureContext`, a successful `site.appearance.get`, an rt frame and the HMR socket's URL. |
| TWN-R-6.11.2 | No source in `packages/web` or `packages/town-*` hard-codes `http:`, `ws:` or a port for the API, realtime or HMR. | Static check over both apps' sources. |
| TWN-R-6.11.3 | `@vitejs/plugin-basic-ssl` is pinned at exactly `2.3.0` and is loaded only in `--mode https`; if G0 C11 selects mkcert, the 5443 server reads the `.certs/` files instead and the plugin is not loaded. | Pin check over `packages/web/package.json` and the lockfile; config review. |
