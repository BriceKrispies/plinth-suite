# GPU frontend: proposal brief

The owner's direction (2026-11-23): the current DOM frontend "still just kinda looks like a decent basic site".
They want an **entire website experience rendered with the GPU**, preferably WebGPU (WebGL2 acceptable as a
fallback). It should use real 3D, with the same domains and features the Suite has now. The present frontend can mostly be
thrown away. This round is **proposals only**: each proposer writes a complete, implementation-ready spec for
the whole frontend in their own artistic and interaction direction.

## What stays (do not redesign it, build on it)

- **Backend**: TypeScript, purely functional Effect. Postgres change log of typed Nodes, DuckDB over Parquet for
  reporting, a double-entry points ledger, and a worker for automations, badges, promotions, expiry and digests.
- **One action registry**: 122 actions in `packages/spec/src/suite/actions.ts`, served by one dispatcher over HTTP
  (`POST /suite/actions/:name`, `GET /suite/actions`) and over MCP (`action.list`, `action.invoke`, plus
  `node.*`, `query.*`, `ui.present`, `change.*` and so on, 17 tools in all). Each action has a schema and a permission. The
  agent discipline is direct, dry-run then commit, held for approval, or refused.
- **Realtime**: the `/rt` WebSocket. It carries change-stream frames (`seq, node, rev, actor, surface`),
  per-user `domain` events, and `counts` frames (unread, approvals pending, cart and so on).
- **Pages and widgets as data**: Page nodes (route, nav entry, a 12-column layout of Widget instance nodes) and
  Widget nodes (`widget` catalogue id plus `config`, validated by `configSchema`). The `site.*` actions (clear,
  restore, page.put, widget.add/remove, appearance.get/set) let an agent **clear the whole site and rebuild it live
  over MCP** while people watch. This is the signature demo moment and must be even more spectacular in the new
  frontend.
- **Looks**: the site-wide appearance (`look`, `density`) is stored in the Program node and switched live. The current
  looks are calm, meridian, nocturne, folio, lattice and strata. You may redefine what a "look" means on the GPU,
  for example a scene, lighting, material and palette preset.
- **Identity**: dev tokens and `?as=<handle>`. Roles: member, manager, ops lead, finance, marketing, content
  editor, admin. Row-level grants and column masks are enforced server-side.
- **Seeded world**: Northwind Rewards, 40 members, about 150 orders, about 890 ledger transactions, about 8,500 domain
  events, message threads, tasks, content, promotions, automations, badges and pending approvals.

## Domains and the current widget catalogue (feature parity target)

| Domain | Widgets today |
|---|---|
| points | balance, ledger, transfer, award, expiry, tiers, trial-balance, accounts |
| store | catalog, product, featured, cart, orders, order, wishlist, inventory |
| promotions | list, builder, simulator, performance, active |
| badges | showcase, progress, catalog, recent |
| messaging | inbox, thread, compose, unread |
| notifications | feed, preferences, deliveries, send |
| tasks | list, board, quick-add |
| approvals | inbox (with separation-of-duties decisions) |
| content | feed, reader, editor, review-queue, list |
| people | directory, profile-card, activity, group, groups, sessions |
| segments | list, builder, members |
| automation | list, builder, runs |
| calendar | month, agenda |
| reporting | panel (kpi/bar/line/table/heatmap), board, suite-kpis |
| audit | timeline, verify (hash chain), node-history |
| admin | members, roles, matrix (permission grid), grants, program |
| pages | editor (layout editing) |
| search | results (global, grouped) |
| settings | appearance |

The shell also has nav, a top bar (points chip, inbox, notification bell, live indicator, identity switcher), a command
palette (search or run a command, Ctrl+K), toasts, an approvals banner and an offline banner.
Specs and contracts: `docs/suite/CONTRACT.md`, `docs/suite/UI-MAP.md`, `docs/suite/DESIGN-SYSTEM.md`,
`packages/spec/src/suite/widgets.ts` (widget catalogue and config schemas), `packages/spec/src/suite/actions.ts`.

## Hard requirements every proposal must meet

1. **Feature parity.** Every domain and widget above has a home in the new experience. Say where and how each one
   is presented and operated. "Widgets are apps in their own right, each an expression of part of a domain"
   remains the owner's model.
2. **WebGPU first, WebGL2 fallback.** Name the rendering stack precisely: raw WebGPU, three.js `WebGPURenderer`
   with TSL, Babylon.js, or another. Justify it, cover the fallback path and the unsupported-browser path, and pin exact
   library versions if any are used.
3. **Text and data density.** Enterprise data means a lot of text, tables and numbers. Specify text rendering
   (MSDF or SDF atlases, glyph caching, i18n and fallback fonts, numerals), how a 900-row ledger or a permission
   matrix stays legible and fast, and where 3D helps comprehension rather than hurting it.
4. **Input and forms.** Text entry, IME, selection, copy and paste, autofill, validation and keyboard shortcuts. If the
   proposal uses DOM overlays for editing, specify exactly how they are positioned, styled and synchronised with the scene.
5. **Accessibility.** It must be operable by keyboard and by screen reader at WCAG 2.2 AA. Specify the parallel semantic
   layer (an accessibility DOM mirror, focus model, announcements), reduced motion, contrast in every look, and
   zoom/text scaling. A canvas-only experience without this is rejected.
6. **Realtime and the agent.** Show how live changes, counts, toasts and especially the **clear-and-rebuild over
   MCP** play out in 3D. Show how an agent's actions are visibly distinguished from a person's, and how `ui.present`
   (an agent showing something on screen) works.
7. **Performance budgets.** Frame time targets for desktop, integrated GPU and phone. Memory, the shader
   compilation strategy (pipeline caching, warm-up), asset sizes, first meaningful paint, battery or low-power mode,
   and a 2D or low-power mode. Measured targets, not guesses about effort.
8. **Phone.** The experience on a 390px-wide phone, touch gestures and thermal limits.
9. **Architecture.**
   - The module layout under `packages/` (new packages allowed).
   - How widgets stay self-contained apps.
   - The scene graph and layout engine.
   - Hit testing and picking.
   - State (stores fed by rt).
   - Routing and deep links (URLs still work and are shareable).
   - Testing: headless WebGPU or WebGL rendering, visual regression, interaction tests and an a11y-mirror test.
10. **Looks and theming** in GPU terms, switchable live.
11. **Demo choreography.** A beat-by-beat five-minute live demo script using the new frontend, including the MCP
    rebuild and at least one moment that would be impossible in the DOM.
12. **A plan ordered by dependency.** What must exist before what. Never give durations, estimates, sprints or
    t-shirt sizes; convey scope by what each step touches.
13. **Risks and kill criteria.** The specific things that could make this fail, and the measurable signal that would
    make you fall back. Include an honest comparison with "keep the DOM app and add a GPU layer".

## Deliverable

One Markdown spec at `docs/gpu-frontend/proposals/<codename>.md`. Use complete, specific and concrete prose with
diagrams in ASCII or Mermaid where useful. Include exact shader and pass structure for the signature effects, data
structures for the scene and a11y mirror, and per-domain screen descriptions. Length is whatever completeness takes;
expect thousands of lines for a whole-frontend spec. No time estimates anywhere.
