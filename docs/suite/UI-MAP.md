# Plinth Suite: UI map

The information architecture and frontend work split for Plinth Suite. Read with `CONTRACT.md` (behaviour and API,
especially 5A, the widget model, and 6, realtime) and `DESIGN-SYSTEM.md` (visual system and components). The widget
catalogue itself (ids, config schemas, sizes, views, actions, events, bus topics) is generated in CONTRACT 5A.6 and in
`packages/web/src/core/widget-schemas.js`; this document does not repeat it.

## 1. Principles

1. **Domains expose widgets; widgets are apps.** Each widget is a self-contained ES module that owns its state, calls
   its domain's actions, listens to its domain's events, and switches between its own internal views (list, detail,
   form, confirm). A widget never imports another widget.
2. **Every screen is a Page.** Home, profile and every module screen are `Page` nodes laying out configured `Widget`
   nodes on a 12-column grid. Module pages are seeded default layouts; nothing about a page is hard-coded in JavaScript.
   The agent composes and edits pages over MCP, and open browsers re-render through the change stream.
3. **One shell.** The shell (side navigation, top bar, bell, inbox count, balance chip, command palette, toasts) is not
   a widget; it is drawn once around the page host.
4. **Honest realtime.** Widgets update from domain events (CONTRACT 6.2) and node changes; motion marks only what an
   event changed, never page loads.
5. **Same widget, many places.** `points.balance` sits on home, profile and the points page with different configs;
   checking out in `store.cart` updates all of them, the bell and the cart count, live.

## 2. Routes and default pages

The router resolves every path through `pages.resolve` (CONTRACT 5A.4); this table is what the seed must create as
system pages (slug, route, nav entry and default layout). Layout cells give `widget id {config} size @x,y,w,h`. Query
string parameters (for `/search?q=`) are merged into the binding parameters by the page host. Items whose widget the
viewer may not use are omitted from the layout (the page editor shows them as placeholders).

Nav sections, in order: **Personal**, **Rewards**, **Engage**, **Insight**, **Operate**, **Admin**. Counts come from
`NavCounts` (CONTRACT 6.1 counts frame).

| Route                                  | Page slug                   | Nav (section · label · icon · count · permission)                | Default layout                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------- | --------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                    | `home` (kind home)          | Personal · Home · home                                           | `promotions.active {limit:3}` full @0,0,12,3 · `points.balance {member:"$me", show_tier:true, show_expiring:true}` m @0,3,4,5 · `badges.progress {member:"$me", limit:3}` m @4,3,4,5 · `messaging.unread {}` s @8,3,4,5 · `content.feed {layout:"cards", limit:6}` xl @0,8,8,8 · `notifications.feed {filter:"unread", page_size:8}` m @8,8,4,8 · `approvals.inbox {scope:"to_decide", page_size:5}` m @0,16,6,5 · `tasks.list {scope:"mine", status:["open","in_progress","blocked"], page_size:5}` m @6,16,6,5 · `reporting.suite-kpis {metrics:["points_issued_today","points_redeemed_today","orders_today","active_members_7d"]}` xl @0,21,12,4 |
| `/messages`                            | `messages`                  | Personal · Inbox · inbox · `messages_unread` · messages:use      | `messaging.inbox {folder:"inbox", open_in:"bus"}` l @0,0,5,12 · `messaging.thread {}` xl @5,0,7,12                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/messages/t/:thread`                  | `messages-thread`           |                                                                  | `messaging.inbox {open_in:"bus"}` l @0,0,4,12 · `messaging.thread {thread:{param:"thread"}}` xl @4,0,8,12                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/messages/new`                        | `messages-new`              |                                                                  | `messaging.compose {}` xl @2,0,8,10                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/notifications`                       | `notifications`             | Personal · Notifications · bell · `notifications_unread`         | `notifications.feed {filter:"all"}` full @0,0,12,12                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/tasks`                               | `tasks`                     | Personal · Tasks · task · `tasks_open` · tasks:use               | `tasks.quick-add {}` m @0,0,4,4 · `tasks.board {scope:"mine"}` full @0,4,12,12                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/tasks/all`                           | `tasks-all`                 |                                                                  | `tasks.list {scope:"all"}` full @0,0,12,12                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/approvals`                           | `approvals`                 | Personal · Approvals · check-circle · `approvals_pending`        | `approvals.inbox {scope:"to_decide"}` full @0,0,12,12 · `approvals.inbox {scope:"requested", link_group:"mine"}` xl @0,12,8,8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/points`                              | `points`                    | Rewards · Points · coins · · points:use                          | `points.balance {member:"$me", show_tier:true, show_expiring:true}` l @0,0,6,6 · `points.transfer {}` m @6,0,6,6 · `points.ledger {member:"$me"}` full @0,6,12,10 · `points.expiry {member:"$me"}` m @0,16,6,5 · `points.tiers {}` l @6,16,6,5                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/points/award`                        | `points-award`              | Rewards · Award points · award · · points:award                  | `points.award {}` l @0,0,6,8 · `people.directory {view:"table"}` l @6,0,6,8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/store`                               | `store`                     | Rewards · Store · store · `cart_items`                           | `promotions.active {limit:2}` full @0,0,12,3 · `store.featured {limit:6}` full @0,3,12,5 · `store.catalog {show_filters:true, open_in:"page"}` full @0,8,12,14                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/store/c/:category`                   | `store-category`            |                                                                  | `promotions.active {limit:1}` full @0,0,12,3 · `store.catalog {category:{param:"category"}, show_filters:true, open_in:"page"}` full @0,3,12,14                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/store/p/:product`                    | `store-product`             |                                                                  | `store.product {product:{param:"product"}}` xl @0,0,8,12 · `store.cart {compact:true}` m @8,0,4,6 · `store.featured {limit:4}` m @8,6,4,6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/store/cart`                          | `store-cart`                |                                                                  | `store.cart {}` xl @0,0,8,12 · `points.balance {member:"$me"}` m @8,0,4,5 · `store.wishlist {}` m @8,5,4,7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/store/orders`                        | `store-orders`              |                                                                  | `store.orders {scope:"mine", open_in:"widget"}` full @0,0,12,12                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/store/orders/:order`                 | `store-order`               |                                                                  | `store.order {order:{param:"order"}}` full @0,0,12,12                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/store/wishlist`                      | `store-wishlist`            |                                                                  | `store.wishlist {}` full @0,0,12,10                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/badges`                              | `badges`                    | Rewards · Badges · trophy                                        | `badges.showcase {member:"$me"}` m @0,0,4,5 · `badges.progress {member:"$me", limit:4}` m @4,0,4,5 · `badges.recent {limit:8}` m @8,0,4,5 · `badges.catalog {member:"$me", filter:"all"}` full @0,5,12,12                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/people`                              | `people`                    | Engage · People · users                                          | `people.directory {view:"grid"}` full @0,0,12,12 · `people.groups {}` m @0,12,4,6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/people/:handle`                      | `profile` (kind profile)    |                                                                  | `people.profile-card {member:{param:"handle"}}` l @0,0,6,6 · `points.balance {member:{param:"handle"}, show_tier:true}` m @6,0,3,6 · `badges.showcase {member:{param:"handle"}}` m @9,0,3,6 · `people.activity {member:{param:"handle"}}` xl @0,6,8,10 · `badges.progress {member:{param:"handle"}}` m @8,6,4,10                                                                                                                                                                                                                                                                                                                                     |
| `/profile`                             | `my-profile` (kind profile) | (avatar menu)                                                    | `people.profile-card {member:"$me"}` l @0,0,6,6 · `points.balance {member:"$me", show_tier:true, show_expiring:true}` m @6,0,3,6 · `badges.showcase {member:"$me"}` m @9,0,3,6 · `people.activity {member:"$me"}` xl @0,6,8,10 · `people.sessions {}` m @8,6,4,10                                                                                                                                                                                                                                                                                                                                                                                    |
| `/groups/:group`                       | `group`                     |                                                                  | `people.group {group:{param:"group"}}` xl @0,0,8,12 · `messaging.compose {collapsed:true}` m @8,0,4,8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/search`                              | `search`                    | (palette, Enter)                                                 | `search.results {q:{param:"q"}}` full @0,0,12,14                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `/news`                                | `news`                      | Engage · News · article                                          | `content.feed {layout:"list"}` full @0,0,12,14                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/read/:content`                       | `read`                      |                                                                  | `content.reader {content:{param:"content"}}` xl @2,0,8,14                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/content`                             | `content`                   | Engage · Content · document · `content_reviews` · content:author | `content.review-queue {}` l @0,0,6,7 · `calendar.agenda {days:14, types:["content"]}` l @6,0,6,7 · `content.list {}` full @0,7,12,12                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `/content/new`                         | `content-new`               |                                                                  | `content.editor {content:null}` full @0,0,12,16                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/content/:content`                    | `content-edit`              |                                                                  | `content.editor {content:{param:"content"}}` full @0,0,12,16 · `audit.node-history {node:{param:"content"}}` l @0,16,6,8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/promotions`                          | `promotions`                | Engage · Promotions · percent · · promotions:simulate            | `promotions.performance {promotion:null}` l @0,0,6,6 · `calendar.agenda {days:30, types:["promotion"]}` l @6,0,6,6 · `promotions.list {}` full @0,6,12,12                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/promotions/new`                      | `promotion-new`             |                                                                  | `promotions.builder {promotion:null}` full @0,0,12,16                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/promotions/:promotion`               | `promotion`                 |                                                                  | `promotions.builder {promotion:{param:"promotion"}}` full @0,0,12,16 · `promotions.simulator {promotion:{param:"promotion"}}` l @0,16,6,9 · `promotions.performance {promotion:{param:"promotion"}}` l @6,16,6,9                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `/automations`                         | `automations`               | Engage · Automations · workflow · · automation:manage            | `automation.list {}` full @0,0,12,10 · `automation.runs {}` full @0,10,12,10                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `/automations/new`                     | `automation-new`            |                                                                  | `automation.builder {automation:null}` full @0,0,12,16                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `/automations/:automation`             | `automation`                |                                                                  | `automation.builder {automation:{param:"automation"}}` full @0,0,12,16 · `automation.runs {automation:{param:"automation"}}` full @0,16,12,10                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/segments`                            | `segments`                  | Engage · Segments · segment · · segments:preview                 | `segments.list {}` l @0,0,5,12 · `segments.members {}` xl @5,0,7,12                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/segments/new`                        | `segment-new`               |                                                                  | `segments.builder {segment:null}` full @0,0,12,14                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/segments/:segment`                   | `segment`                   |                                                                  | `segments.builder {segment:{param:"segment"}}` full @0,0,12,14 · `segments.members {segment:{param:"segment"}}` l @0,14,6,8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/calendar`                            | `calendar`                  | Engage · Calendar · calendar                                     | `calendar.month {}` full @0,0,12,14 · `calendar.agenda {days:7}` m @0,14,4,8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `/reports`                             | `reports`                   | Insight · Reports · chart · · query:run                          | `reporting.suite-kpis {metrics:["points_issued_today","points_redeemed_today","orders_today","active_members_7d","badges_awarded_7d","members_total"]}` full @0,0,12,4 · `reporting.board {dashboard:"programme-overview"}` full @0,4,12,16                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/reports/:dashboard`, `/d/:dashboard` | `report`                    |                                                                  | `reporting.board {dashboard:{param:"dashboard"}}` full @0,0,12,18                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/audit`                               | `audit`                     | Insight · Audit · audit · · audit:view                           | `audit.verify {}` s @0,0,3,3 · `audit.timeline {}` full @0,3,12,16                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/store/manage`                        | `store-manage`              | Operate · Orders · box · `orders_attention` · store:orders       | `store.orders {scope:"all", requires_approval:true}` xl @0,0,8,8 · `approvals.inbox {types:["order"]}` m @8,0,4,8 · `store.orders {scope:"all", link_group:"all"}` full @0,8,12,12                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/store/inventory`                     | `store-inventory`           | Operate · Inventory · tag · · store:inventory                    | `store.inventory {}` full @0,0,12,12                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `/ledger`                              | `ledger`                    | Operate · Ledger · wallet · · points:ledger                      | `points.trial-balance {}` l @0,0,6,6 · `reporting.panel {panel:"panel:suite-points-flow"}` l @6,0,6,6 · `points.accounts {}` full @0,6,12,14                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `/admin`                               | `admin-members`             | Admin · Members · user · · admin:members                         | `admin.members {}` full @0,0,12,14                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/admin/roles`                         | `admin-roles`               | Admin · Roles · shield · · admin:roles                           | `admin.roles {}` full @0,0,12,10 · `admin.matrix {}` full @0,10,12,12                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/admin/grants`                        | `admin-grants`              | Admin · Grants · key · · admin:roles                             | `admin.grants {}` full @0,0,12,14                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/admin/program`                       | `admin-program`             | Admin · Programme · sliders                                      | `admin.program {}` full @0,0,12,16                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/settings`                            | `settings`                  | Admin · Settings · settings                                      | `notifications.preferences {}` xl @0,0,8,12 · `settings.appearance {}` m @8,0,4,6 · `people.sessions {}` m @8,6,4,6 · `notifications.deliveries {}` xl @0,12,8,8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `/p/:page`                             | (custom pages)              |                                                                  | the page's own layout                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/pages/:page/edit`                    | `page-edit`                 | (page menu "Edit page")                                          | `pages.editor {page:{param:"page"}}` full                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

`reporting.panel {panel:"panel:suite-points-flow"}` refers to a Panel the seed creates in the `programme-overview`
board. Personal copies: any member may personalise `home` and `my-profile` (top-right "Customise" in the page header).

### 2.1 Empty site and live nav

The site can be cleared (`site.clear`) and rebuilt while people watch. `app/main.js` re-reads `pages.list` into
`navStore` (debounced about 150 ms) on every realtime change of a Page node, so nav entries appear and disappear live;
entries that are new since the last read fade in (`live-build.css`). When `pages.resolve` finds no page for the current
path, `core/page-host.js` shows a calm centred state, "This workspace is empty" with "Pages appear here as they are
built.", if `pages.list` is empty, and the normal not-found otherwise. While that state is shown the host watches Page
changes: when a page serving the path is created it renders at once, and widgets added to a live page enter with a short
animation (disabled by `prefers-reduced-motion` and the reduced-motion preference). The site look is
`site.appearance.get`, applied to `<html data-look>` at boot and again on every Program node change; the site density
applies unless the viewer has chosen a compact density of their own, and the viewer's light/dark theme is untouched.

## 3. Shared boundary (owned by the design-system and runtime builder)

### 3.1 File ownership

```
packages/web/
  index.html  vite.config.ts  scripts/check.mjs  public/ds-gallery.html      DS/runtime
  src/styles.css                                    DS/runtime (@layer order + every import below)
  src/ds/css/**  src/ds/js/**                       DS/runtime (DESIGN-SYSTEM.md)
  src/core/api.js rt.js router.js stores.js identity.js bus.js
           widgets.js page-host.js widget-manifest.js DS/runtime
  src/core/widget-schemas.js action-routes.js       generated by `pnpm schema:gen` (never hand-edited)
  src/app/main.js                                   DS/runtime (boot)
  src/shell/**                                      Package A
  src/widgets/<domain>/<name>.js, <domain>.css      the package owning <domain> (section 6)
  src/js/**, src/css/** (legacy Meridian board)     Package D (migrates into src/widgets/reporting, then deletes)
  public/proto/**                                   untouched
```

`styles.css` declares `@layer reset, tokens, base, layout, components, modules, utilities, overrides;` and imports
`src/shell/shell.css` and every `src/widgets/<domain>/<domain>.css` into `layer(modules)`; each package creates its
CSS files (empty is fine). Widget files are named after the part of the id after the domain: `store.catalog` is
`src/widgets/store/catalog.js`, `people.profile-card` is `src/widgets/people/profile-card.js`,
`reporting.suite-kpis` is `src/widgets/reporting/suite-kpis.js`. `widget-manifest.js` (DS/runtime) maps all 77 ids to
`() => import("../widgets/<domain>/<name>.js")`.

### 3.2 Core APIs (exact signatures)

`src/core/api.js`

- `request(method, path, { query, body } = {}) -> Promise<data>`: adds `Authorization`, `X-Plinth-Session`,
  `content-type`; unwraps `{ ok, data }`; throws `ApiError` with `{ status, code, message, path, details, fix_hint }`.
- `call(actionName, input = {}) -> Promise<data>`: looks the action up in `ACTION_ROUTES`, fills `:params` from
  `input`, sends the rest as query (GET/DELETE, arrays comma-joined) or JSON body (POST/PUT).
- `idempotencyKey(prefix) -> string`: `<prefix>:<16 random url-safe chars>`; one per user intent.
- `nodes`: `get(ref)`, `list(kind)`, `commit(changes, { reason, idempotency_key })` (kernel `POST /changes`),
  `create(kind, slug, body)`, `patch(uri, baseRevision, ops)` (JSON-patch ops turned into a `ChangeSet`),
  `remove(uri, baseRevision)`, `history({ uri, limit })`, `diff(a, b)`.
- `query(ast, { params, dashboard })` (kernel `POST /query`).

`src/core/rt.js` (one socket, two subscriptions, CONTRACT 6.1)

- `connect()`: hello with token and `client_id` = session id; subscribes `s1` (changes) and `s2` (domain); reconnects
  with backoff 1, 2, 4, 8 s; resumes each stream from its last seq kept in `sessionStorage`.
- `on(type | "*", handler) -> off`: domain events by type.
- `onChange(predicate, handler) -> off`: change-stream items (`{ seq, node, rev, actor, surface, ... }`).
- `onCounts(handler) -> off`, `onState(handler) -> off` (`"connecting" | "live" | "offline"`, info),
  `onSessionRevoked(handler)` (socket closed 4401).
- Widgets do not use `rt` directly: they get a scoped view (4.2) that unsubscribes on unmount.

`src/core/router.js`

- `start()`: listens to `popstate` and same-origin `<a>` clicks (not `target`, not modified clicks, not `download`).
- `navigate(path, { replace } = {})`, `href(path, query)` (keeps `?as=`), `current() -> { path, query }`,
  `onRoute(handler) -> off`. Every navigation calls `pageHost.render(path, query)`; focus moves to `#main` and the
  page title is announced in `#announcer`.

`src/core/stores.js`

- `createStore(initial) -> { get(), set(v), update(fn), subscribe(fn) -> off }`.
- App stores: `meStore` (`MeOut`), `countsStore` (`NavCounts`, fed by `rt.onCounts` and `me.counts`), `prefsStore`
  (`PreferenceSpec.ui`, applied to `data-theme`, `data-density`, `data-reduced-motion` on `<html>`), `clockStore`
  (`{ virtual_now, speed, paused }`, ticking locally from `me.get`), `navStore` (`pages.list` items with `nav`).

`src/core/identity.js`

- `principal` (from `?as=<handle>`, default `maya-ortiz`), `token()`, `sessionId()`, `switchTo(handle)` (navigates).
  The switcher lists `dev.principals`.

`src/core/bus.js`

- `createBus() -> { scope(linkGroup) -> { publish(topic, payload), subscribe(topic, handler) -> off } }`. One bus per
  rendered page; payloads are `{ id }` (or `{ from, to }` for `date.selected`, `{ key, value }` for `filter.changed`).

`src/core/widgets.js` (runtime and registry)

- `loadWidget(id) -> Promise<WidgetModule>` (through the manifest; unknown id rejects).
- `catalogEntry(id)` (from `widget-schemas.js`), `schemaOf(id)`, `defaultsOf(id)`.
- `validateConfig(id, config) -> { ok, errors }` (JSON Schema check against `config_schema`; the server re-validates).
- `resolveBindings(config, params, me) -> config` (substitutes `{ param }` and leaves `"$me"` for the widget).
- `mountWidget(el, { id, config, size, instance, page }) -> handle { update(config, size), unmount() }`: wraps the
  module in the `widgetFrame` component, builds the scoped context (4.2, `widgetContext()`), catches errors into the
  frame's error state. `<plinth-widget>` (4.5) is its element form; the page host uses the element.

`src/core/page-host.js`

- `render(path, query)`: `pages.resolve`, lays out items on the 12-column grid (`--x --y --w --h` as Meridian does),
  mounts each available item, unmounts the previous page's widgets, creates the page bus, and subscribes to change
  events on the page node and its widget nodes: a layout change re-lays out, a widget config change calls
  `handle.update`. Below 48rem the grid collapses to one column in `(y, x)` order with each widget at its `m` (or
  smallest) size. Page header: title, description, "Customise" (`pages.personalize`) or "Reset to default"
  (`pages.reset`) and "Edit page" (navigates to `/pages/:page/edit`) when allowed.

`src/app/main.js`: read identity, `me.get` into the stores, `rt.connect()`, `pages.list` into `navStore`,
`mountShell({ nav: #app-nav, topbar: #app-topbar, toasts: #toasts, palette: #palette })` from
`src/shell/shell.js` (package A), then `router.start()`.

## 4. The widget runtime contract

### 4.1 Module shape

```js
// src/widgets/store/catalog.js
import { schemaOf } from "../../core/widgets.js";
export default {
  id: "store.catalog",
  domain: "store",
  title: "Catalogue",
  configSchema: schemaOf("store.catalog"), // never hand-written: from widget-schemas.js
  sizes: ["l", "xl", "full"], // must equal the catalogue entry
  mount(el, { config, size, api, rt, bus, nav, ctx }) {
    // build DOM inside el only; return the unmount function
    return () => {};
  },
  update(config, size) {}, // optional; without it the runtime unmounts and remounts
};
```

### 4.2 The context a widget receives

| Field    | Contents                                                                                                                                                                                                                                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config` | Validated config with route bindings resolved; `"$me"` left as is (use `ctx.memberHandle(target)`).                                                                                                                                                                                                                                                                   |
| `size`   | `s`, `m`, `l`, `xl` or `full`; widgets render a compact view at `s`/`m` and their full set of internal views at larger sizes.                                                                                                                                                                                                                                         |
| `api`    | `{ call(actionName, input), nodes, query, idempotencyKey }` from `core/api.js`.                                                                                                                                                                                                                                                                                       |
| `rt`     | Scoped: `on(type, fn)`, `onChange(predicate, fn)`, `onNode(uriOrKind, fn)`; all removed on unmount.                                                                                                                                                                                                                                                                   |
| `bus`    | Scoped to the instance's `link_group`: `publish`, `subscribe`; removed on unmount.                                                                                                                                                                                                                                                                                    |
| `nav`    | `{ go(path), href(path, query) }`.                                                                                                                                                                                                                                                                                                                                    |
| `ctx`    | `me` (current `MeOut`), `can(permission)`, `memberHandle(target)`, `params`, `page` (`{ slug, kind, editable }`), `instance` (`{ uri, slug, title }`), `setTitle(text)`, `setCount(n)` (frame header count), `setState("loading" \| "ready" \| "empty" \| "error", info?)`, `announce(text)`, `toast(opts)`, `openDrawer(opts)`, `openDialog(opts)`, `confirm(opts)`. |

### 4.3 Rules every widget follows

1. Render only inside `el`; never touch the shell, `document.body` or another widget's DOM. Overlays go through
   `ctx.openDrawer`/`openDialog` (they mount in `#app-drawers`).
2. Data only through `api.call` with registry action names listed for the widget in the catalogue (plus the kernel
   node API where the catalogue says so). Mutations send an idempotency key per user intent and show
   `formErrors(error)` mapping `error.path` to fields.
3. Realtime: subscribe to the catalogue's events; on an event that names something shown, update in place from the
   payload when it carries everything (counts, balances, statuses) or re-read through the widget's own action. Animate
   only on events (`u-arrive`), never on first load.
4. States: `loading` (skeleton for the first load only), `empty` (`emptyState` with the widget's own copy and a primary
   action where one exists), `error` (`errorState` with retry), `unavailable` (rendered by the frame when the runtime
   says so). Use `ctx.setState`.
5. Internal views are the widget's own business (a `tabs` or a view stack inside `el`); state survives `update`
   (config change) when the same entity is shown.
6. Interactions with other widgets only through the bus topics declared in the catalogue and through domain events.
7. Respect `prefers-reduced-motion` and the `data-density` attribute; all text through `h()`/`inlineText()`.
8. `unmount` removes listeners, timers and observers; the runtime asserts the scoped `rt`/`bus` handles are released.

### 4.4 The widget frame

The runtime wraps each widget in `widgetFrame` (DESIGN-SYSTEM.md section on widget frame): header with title (config
`title` or catalogue title), optional count, menu (Refresh, Open as page when the widget has a route, Configure in
the page editor, Remove from personal page), and the body slot. Frames sit on elevation tier 1 inside the page grid;
`full` widgets on module pages drop the frame chrome to a heading rule (Meridian panel style).

### 4.5 The `<plinth-widget>` element

Widgets run as a vanilla custom element, defined once at boot (`core/plinth-widget.js`, `defineWidgetElement()` in
`app/main.js`). It is light DOM, never shadow DOM, so the layered tokens, `@scope` rules and looks apply unchanged.
The module contract of 4.1 to 4.3 is the same: the element calls `mount` with the context of 4.2, built by one shared
`widgetContext()` (`core/widgets.js`) that `mountWidget` also uses. The page host renders every grid cell as a
`<plinth-widget>` and nothing in the element assumes the page host is its parent.

| Attribute     | Meaning                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| `type`        | Catalogue id, e.g. `store.catalog`. An id not in the catalogue renders the frame's `unavailable` state.       |
| `config`      | JSON object, validated against the catalogue schema. Invalid JSON or an invalid config shows the error state. |
| `size`        | `s`, `m`, `l`, `xl` or `full`; defaults to the catalogue's `default_size`.                                    |
| `instance`    | Optional slug of the Widget node, surfaced as `ctx.instance.slug`.                                            |
| `page`        | Optional slug of the Page, surfaced as `ctx.page.slug` (`kind` is `custom`, not editable, when standalone).   |
| `unavailable` | Optional reason (`forbidden`, ...): the frame renders the unavailable state and the module is not mounted.    |

- Lifecycle: connecting mounts; removal unmounts (a move within the document does not). Changing `type` or
  `unavailable` unmounts and mounts again. Changing `config` and/or `size` (applied together once per task) calls the
  module's optional `update(config, size)`, or remounts without one.
- State is reflected as `state="loading|ready|error|unavailable"` (a widget's own `empty` shows as `ready`), so CSS
  can style `plinth-widget[state=error]`.
- Events (bubbling): `plinth-widget:ready`, `plinth-widget:error` (`detail.error`), and `plinth-widget:mount` when the
  frame exists (`event.target.frame`). Each has `detail.type`.
- The page host passes what attributes cannot carry through the `host` property (`bus`, `params`, `page`, `instance`,
  `title`, `arrived`, `onRemove`). Standalone elements share one loose bus, so `link_group` still connects them.
- The element sets `display: contents` when it has no display of its own, so the frame is laid out as if it were the
  parent's child.

Live-change marker (set by the page host on the grid cell `.c-page-grid__item`, not on the element): when a realtime
change touches a widget's node, or the page node moves or adds its cell, the cell gets
`data-live-change="human"` or `data-live-change="agent"` for 2.5 s, then the attribute is removed. The value is
`agent` when the change frame's `actor` starts with `agent:` or its `surface` is `mcp`, otherwise `human`. A newer
change restarts the 2.5 s. Styling is CSS only: `[data-live-change=agent] { ... }`.

Embedding. Agent-authored markup (a content article, the styleguide) may place the element directly:

```html
<plinth-widget type="points.balance" size="s"></plinth-widget>
<plinth-widget type="store.catalog" size="l" config='{"category":"mugs"}'></plinth-widget>
```

## 5. Global shell (package A)

| Element           | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Data                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Side nav          | Sections and items from `navStore` (pages with `nav`, filtered by `nav.permission` against `me.permissions`), `aria-current="page"`, count badges from `countsStore[nav.count]`; collapses to a drawer below 64rem                                                                                                                                                                                                                                                                                          | `pages.list`, counts frame                                |
| Top bar           | Product mark, page title, palette trigger (`Ctrl+K` / `⌘K`), balance chip, inbox button with count, bell with count, live connection mark, avatar menu (Profile, Settings, theme, switch identity, sign out of this tab)                                                                                                                                                                                                                                                                                    | `me.get`, stores                                          |
| Balance chip      | Balance and tier pill; on `points.posted` for the viewer animates from old to new balance and flashes a signed delta; on `tier.changed` updates the pill                                                                                                                                                                                                                                                                                                                                                    | `points.posted`, `tier.changed`                           |
| Inbox count       | `messages_unread`; click goes to `/messages`                                                                                                                                                                                                                                                                                                                                                                                                                                                                | counts frame                                              |
| Bell              | `notifications_unread`; click opens a popover with the latest 8 notifications (`notifications.list`), "Mark all read", "Open all"                                                                                                                                                                                                                                                                                                                                                                           | counts frame, `notification.created`, `notification.read` |
| Command palette   | Dialog with a search box: commands (navigate to every nav page, "New message", "New task", "Transfer points", "New promotion", "New automation", "New content", "Toggle theme", "Switch identity to ...") ranked with `search.global` results (people, products, content, promotions, automations, segments, orders, tasks, threads, dashboards); Enter opens, `Ctrl+Enter` opens `/search?q=`                                                                                                              | `search.global`                                           |
| Toasts            | One toast per arriving event of these types for the viewer (CONTRACT 6.2): `message.received` (unless that thread is open or muted), `notification.created` for types with `in_app`, `points.posted` credits, `badge.awarded` (own, with artwork), `tier.changed`, `order.status_changed` (own), `approval.requested` (approvers), `approval.decided` (requester), `task.assigned`, `promotion.budget_alert`, `automation.run_updated` failures (owner), `content.published` (pinned); max 4, newest on top | rt                                                        |
| Identity switcher | Avatar menu item listing `dev.principals` (featured first); switching navigates with `?as=`                                                                                                                                                                                                                                                                                                                                                                                                                 | `dev.principals`                                          |
| Session revoked   | Full-page notice "This tab was signed out" with a reload button; stops the socket                                                                                                                                                                                                                                                                                                                                                                                                                           | `rt.onSessionRevoked`                                     |
| Offline banner    | Meridian banner while `rt` is offline, with retry countdown                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `rt.onState`                                              |

## 6. Work packages (cut by domain)

No two packages write the same file. Each package owns whole domains: every widget of the domain, its CSS file, and
its acceptance. All packages consume the DS/runtime APIs of sections 3 and 4 and DESIGN-SYSTEM.md components; none
edits `src/core`, `src/ds`, `src/app`, `index.html` or `styles.css` (file a request to the DS/runtime builder).

| Package    | Owns                                                                                                                                                                                                                                                                | Widgets (count)                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DS/runtime | Section 3.1 DS files, the widget runtime and page host, the generated files' consumers, `public/ds-gallery.html`                                                                                                                                                    | none (it renders a "Widget not built yet" placeholder for any id whose module is missing, so packages land independently)                                                                                                                                                                                                                                                                               |
| **A**      | `src/shell/**` (shell.js exporting `mountShell`, nav, topbar, balance chip, bell popover, palette, toasts, identity switcher, shell.css); domains **messaging**, **notifications**, **people**, **search**                                                          | messaging.inbox, messaging.thread, messaging.compose, messaging.unread, notifications.feed, notifications.preferences, notifications.deliveries, notifications.send, people.directory, people.profile-card, people.activity, people.group, people.groups, people.sessions, search.results (15)                                                                                                          |
| **B**      | domains **points**, **store**, **badges**                                                                                                                                                                                                                           | points.balance, points.ledger, points.transfer, points.award, points.expiry, points.tiers, points.trial-balance, points.accounts, store.catalog, store.product, store.featured, store.cart, store.orders, store.order, store.wishlist, store.inventory, badges.showcase, badges.progress, badges.catalog, badges.recent (20)                                                                            |
| **C**      | domains **promotions**, **automation**, **content**, **segments**, **calendar**                                                                                                                                                                                     | promotions.list, promotions.builder, promotions.simulator, promotions.performance, promotions.active, automation.list, automation.builder, automation.runs, content.feed, content.reader, content.editor, content.review-queue, content.list, segments.list, segments.builder, segments.members, calendar.month, calendar.agenda (18)                                                                   |
| **D**      | domains **reporting**, **approvals**, **tasks**, **audit**, **admin**, **settings**, **pages**; migrates the Meridian board code (`src/js/**`, `src/css/**`) into `src/widgets/reporting/` (chart kit, board, inspector, trace ribbon) and deletes the legacy files | reporting.table, reporting.bar, reporting.line, reporting.area, reporting.heatmap, reporting.scatter, reporting.kpi, reporting.panel, reporting.board, reporting.suite-kpis, approvals.inbox, tasks.list, tasks.board, tasks.quick-add, audit.timeline, audit.verify, audit.node-history, admin.members, admin.roles, admin.matrix, admin.grants, admin.program, settings.appearance, pages.editor (24) |

Shared helpers inside a package stay inside its domain folders (for example `src/widgets/store/_cart-model.js`);
helpers used across packages go to the DS/runtime builder. Package acceptance:

- Every owned widget module exists at its manifest path, exports the 4.1 shape with `sizes` equal to the catalogue,
  uses only its catalogue actions and events, and passes `node scripts/check.mjs`.
- Every owned widget works at each of its sizes, light and dark, at 360 px wide inside a single-column page, keyboard
  only, and shows the loading, empty, error and unavailable states.
- On the seeded data, each default page of section 2 whose widgets the package owns renders for Maya, Jonas, Priya,
  Tomás, Leah and a plain member (`dev-user-ana-silva`), with permission-dependent widgets omitted correctly.
- Cross-widget behaviour from section 7 works between the package's widgets and others on the same page.

## 7. Cross-widget behaviour (checked on the seeded data)

| Action                                     | What updates, without reload                                                                                                                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Checkout in `store.cart`                   | `points.balance` everywhere, balance chip, `store.catalog` and `store.product` stock, cart count, `store.orders`, `notifications.feed` and the bell (order notification), `promotions.performance` (redemption), `reporting.suite-kpis` (orders today) |
| Manager awards in `points.award`           | recipient's balance chip, `points.ledger`, toast; `badges.progress` if a threshold moves; `promotions.performance` when a multiplier applied                                                                                                           |
| Selecting a thread in `messaging.inbox`    | `messaging.thread` on the same page (bus `thread.selected`)                                                                                                                                                                                            |
| A message arrives                          | inbox count, `messaging.inbox` list, `messaging.unread`, toast                                                                                                                                                                                         |
| Approving a promotion in `approvals.inbox` | `promotions.list` status, `calendar.month`, `promotions.active` banners for eligible members, requester toast                                                                                                                                          |
| Publishing in `content.editor`             | `content.feed` on home for the audience, `content.list`, `calendar.agenda`                                                                                                                                                                             |
| Brushing `reporting.line`                  | other reporting widgets with the same link group filter to the range (bus `date.selected`)                                                                                                                                                             |
| The agent places a widget on `page:home`   | every open home re-lays out and mounts it (change stream on the page node)                                                                                                                                                                             |
| Revoking a session in `people.sessions`    | that tab shows the signed-out notice                                                                                                                                                                                                                   |

## 8. Experience swap

The Suite has two frontends over one backend: the classic site (`packages/web`, vanilla ES modules, Vite on 5173) and
the Township GPU site (`packages/town-spike`, Vite on 5180). A viewer gets one or the other, and either app can send
them to its twin. The backend is the same; nothing else is shared except the contract below.

### 8.1 One origin

- The classic dev server proxies `/town` to `process.env.PLINTH_TOWN_URL ?? "http://127.0.0.1:5180"` with `ws: true`
  (so the town app's HMR socket works), and its SPA fallback (`appRoutes()` in `packages/web/vite.config.ts`) skips
  `/town` and `/town/...`. So `http://localhost:5173/town/` is the town app.
- The town app sets `base: "/town/"` in its Vite config. It must emit every asset, route and HMR path under
  `/town/`, and call `/api` and `/rt` on the same origin (they are proxied by the classic server).
- Both apps share one origin, so they share `localStorage` and `sessionStorage` (identity tabs, `?as=`).

### 8.2 The three settings

| What                    | Where                                                          | Values                                                     |
| ----------------------- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| Site default            | Program node `appearance.experience`; `site.appearance.get`    | `"classic"` (default when never set) or `"town"`           |
| Viewer override         | `localStorage` key `plinth.experience`                         | `"classic"`, `"town"` or `"site"`; missing or invalid is `"site"` |
| Demo link               | URL query `?experience=classic\|town`                          | sets the override, then is removed with `history.replaceState` |

`effective = override === "site" ? appearance.experience : override`. Every `localStorage` read and write is wrapped in
`try/catch` (storage can be blocked); a failed read means `"site"`. `"site"` is stored by removing the key.

Agents change the site default with `site.appearance.set`. Every field is optional but at least one is required, and
fields not given are kept (a new `look` without a `density` still resets the density to comfortable, as before):

```
action.invoke site.appearance.set {"experience": "town"}      // flip only the experience; look and density are kept
action.invoke site.appearance.set {"look": "nocturne"}         // change only the look; experience is kept
action.invoke site.appearance.get {}                           // { appearance: { look, density, experience } }
```

A value other than `classic` or `town` is refused by schema validation. The action needs `admin:settings`.

### 8.3 Route mapping

Routes mirror one to one. `?as=` and every other query parameter are preserved, and so is the hash.

| Classic                   | Town                           |
| ------------------------- | ------------------------------ |
| `/`                       | `/town/`                       |
| `/store?as=x#cart`        | `/town/store?as=x#cart`        |
| `/people/maya-ortiz`      | `/town/people/maya-ortiz`      |

The classic helpers live in `packages/web/src/core/experience.js`; the town app needs the same two functions:

```js
toTown(url = location.href)    // "/town" + pathname + search + hash   ("/town" itself becomes "/town/")
toClassic(url = location.href) // pathname with the leading "/town" removed (empty becomes "/") + search + hash
```

A town route with no classic page (a town-only view) maps to the nearest classic route the town app chooses, and
must still keep `search` and `hash`.

### 8.4 Classic app behaviour (implemented)

- **Boot** (`src/app/main.js`, right after `site.appearance.get`): `?experience=` is consumed first. If `effective` is
  `"town"` and `navigator.gpu` or a WebGL2 context exists, `location.replace(toTown())`. If neither exists the viewer
  stays on classic and gets a toast, once per tab session: "3D view needs WebGPU or WebGL2. Showing the classic site."
- **Live**: the app already listens for the realtime Program change (`rt.onChange` on `/Program/`), debounced, and
  re-reads the appearance. A viewer whose override is `"site"` and whose site default just changed to `"town"` swaps:
  a short view-transition fade, then `location.replace(toTown())`. Viewers with their own override never swap live.
- **Toggle**: the top bar has a menu button ("Choose view: classic or 3D") with three radio items, "Classic view",
  "3D view" and "Follow site default"; the same three items sit in the avatar menu after the theme items. Choosing
  one writes the override and, when the result is town (and a GPU exists), navigates to `toTown()`.

### 8.5 Town app behaviour (to implement in `packages/town-spike`)

1. **Boot rule** (mirror of 8.4), after reading `site.appearance.get` (call `/api/suite/site/appearance` the way the
   town app already calls actions) and the override: consume `?experience=classic|town` first (set the override,
   `history.replaceState` to drop the param). If the override is `classic`, or the browser has neither
   `navigator.gpu` nor WebGL2, `location.replace(toClassic())`. Otherwise stay and render: a viewer who follows the
   site default and opens a town URL directly has chosen the town by the address, so a Classic site default does not
   bounce them at boot (a live change of the site default while they are in the town still swaps them).
   A browser with no GPU that lands on `/town/` therefore always ends on classic.
   - Avoid a redirect loop: classic redirects to town only when a GPU exists, and town redirects to classic when no
     GPU exists, so the two never disagree. If the town app fails to start its renderer after passing the GPU check,
     it must set the override to `"classic"` (guarded `localStorage` write) before `location.replace(toClassic())`;
     otherwise classic would send the viewer straight back.
2. **Toggle**: a control in the town HUD, accessible by keyboard and labelled, with the same three choices ("Classic",
   "3D", "Follow site default"). It writes `plinth.experience` and, when the result is classic, goes to `toClassic()`.
3. **Live swap**: subscribe to the same realtime Program change as the classic app (`/rt`, the change frame whose node
   URI contains `/Program/`), re-read `site.appearance.get`, and when the override is `"site"` and the site default
   changed to `"classic"`, fade (a short view transition or canvas fade, honouring reduced motion) then
   `location.replace(toClassic())`.
4. **Storage**: the key is `plinth.experience`, values `classic | town | site`, default `site`, every access in
   `try/catch`.
5. **Links**: every in-app link and `history` URL stays under `/town/`; links out to the classic site use
   `toClassic()`.
