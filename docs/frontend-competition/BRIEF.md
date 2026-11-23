# Frontend design competition: brief

Plinth is an enterprise operations platform. An external AI agent builds dashboards in it, live,
over MCP, while humans watch the same dashboards update on several screens. The frontend is where
a technical audience decides whether this is a serious product. We are choosing the whole frontend
design: its visual language, information architecture, HTML structure, CSS architecture and
interaction model.

Five designers compete, each with a different artistic direction. All of them must look
professional, clean and enterprise. They should look like something a bank, a hospital network or
a logistics company would run every day. Nothing toy-like, no gimmicks, no stock-template look.

## Technical contract (identical for every competitor)

- **No framework, no build step, no dependencies.** The deliverable is static files: HTML, CSS,
  and ES modules loaded with `<script type="module">`. No npm packages, no CDN libraries, no
  web fonts from third parties (use a system font stack, or fonts already on the machine through
  `local()`).
- **Semantic, structured HTML.** Use landmarks (`header`, `nav`, `main`, `aside`, `footer`),
  correct heading order, `section`/`article` with accessible names, real `button`s and links,
  and `dialog` for the inspector. Use ARIA only where HTML has no native semantics. Required:
  - every panel is a labelled region;
  - live updates are announced politely (`aria-live="polite"` on the trace, and a status region
    for "panel added or changed");
  - the identity switch is a labelled control;
  - focus is managed when the inspector opens and closes;
  - visible focus styles.
- **Accessible charts.** Charts are inline SVG drawn by your own small vanilla module, with
  `role="img"` and a meaningful `aria-label`/`<title>`/`<desc>`. Each chart has a "view as table"
  toggle that reveals a real `<table>` of the same rows. A threshold breach is conveyed by more
  than colour (pattern, icon or text).
- **Layered modern CSS.**
  - Declare `@layer reset, tokens, base, layout, components, utilities, overrides;` once, and put
    every rule in a layer.
  - Use design tokens as custom properties (colour, space, type scale, radius, elevation,
    motion), including `light-dark()` or `prefers-color-scheme`.
  - Use container queries for panels, `:has()` where it simplifies state, logical properties,
    `clamp()` for fluid type, `color-mix()`/OKLCH for colour derivation, and nesting.
  - Honour `prefers-reduced-motion` and `forced-colors`.
  - No utility-class soup, and no `!important` outside `overrides`.
- **Clean, minimal vanilla JS** where behaviour needs it. That covers the data fetch, the live
  socket, rendering panels from the dashboard document, the inspector, the identity switch,
  brushing, the table toggle and the trace. Write small ES modules with clear names. No global
  mutable soup, no innerHTML with unescaped data (escape or use DOM APIs/`textContent`), and no
  layout thrash in render loops.
- **Animation honesty.** An element may animate in only when a realtime change event caused it.
  Show the causing change `seq` on that panel briefly. Initial page load renders without entry
  animation.
- **Responsive.** The same page must work at phone width (390 px), on a laptop (1280 px) and on a
  wall display (1920 px). At phone width, panels stack in reading order.

## What the page must do (real data, no mocks)

Your prototype lives at `packages/web/public/proto/<your-id>/`. It is served by the running Vite
dev server at `http://localhost:5173/proto/<your-id>/`, so it is same-origin with:

- `GET /api/nodes?kind=Dashboard&slug=ops-board` lists dashboards (with no slug it lists all).
  Each node is `{uri, kind, slug, revision, body}`. A Dashboard body has `metadata.title` and
  `spec.layout.items[]` = `{panel: <uri>, at: {x,y,w,h}}` on a 12-column grid, plus optional
  `spec.parameters`.
- `GET /api/nodes/<id>` returns one node; a Panel body has `metadata.title`, `spec.query` and
  `spec.visual`. Read the URI→id mapping in the reference client.
- `POST /api/query` with `{query, params?}` returns the envelope:
  - success: `{ok:true, data:{columns:[{name,type}], rows:[[...]], row_count, as_of, watermarks, plan_summary, policy_hash?, ...}}`;
  - failure: `{ok:false, error:{code,message,...}}`.
- `GET /api/audit/verify` checks the change log's hash chain.
- WebSocket `/rt`, which works like this:
  1. Send `{t:"hello", protocol:1, token}`.
  2. The server replies `{t:"welcome", head_seq}`.
  3. Send `{t:"subscribe", sub:"s1", nodes:[]}`.
  4. The server replies `subscribed {from_seq, through_seq}`.
  5. Pushes then arrive as `events {prev_through, through, items:[{seq, kind, node, rev, surface, actor, on_behalf_of, rule_id[], ops_summary}]}` and `progress {through}`.
- Auth: `Authorization: Bearer <token>` on HTTP, and the token goes in `hello` on the socket.
  Dev tokens: `dev-ops-lead` (Maya Ortiz, Operations lead), `dev-emea-lead` (Jonas Becker,
  Regional lead EMEA), `dev-finance-analyst` (Priya Nair, Finance analyst). `?as=ops-lead|emea-lead|finance-analyst`
  selects one, and the default is ops-lead.

The reference implementation of this contract is the current React client: `packages/web/src/api.ts`,
`rt.ts`, `board.ts`, `identity.ts`, `animation.ts`, `visuals/*`. Read it to learn the protocol, then
write your own vanilla version. Do not copy its design. Visual schemas (types and channels) are in
`packages/spec/src/nodes.ts`: `line`, `bar`, `heatmap`, `kpi`, `table`, `area`, `scatter`.

### Screens and components

1. **Dashboard view** (`index.html?d=ops-board`, which must also be the default):
   - a header with the product, the dashboard title, the live/offline state, the current principal
     with an identity switch, and presence (your own avatar for now);
   - the panel grid honouring `at`;
   - each panel renders its visual type (implement **all seven**) with loading, empty ("No rows for
     this query", plus a query summary) and error (code + message) states;
   - a per-panel menu with "Inspect" and "View as table".
2. **Trace ribbon**: a persistent strip of recent change events, newest first. Each event shows
   `seq`, a `live` tag (actor is an agent and surface `mcp`), `replay` (surface `driver`) or `ui`,
   then the actor, the rule ids, the node kind and title, and the ops summary. It must read like an
   instrument, not a log dump. It must be legible from the back of a room on the wall display and
   unobtrusive on a phone.
3. **Inspector** (`dialog`) shows the panel's query (formatted), the visual spec, the result
   metadata (`as_of`, rows, `policy_hash` when present, `plan_summary`), and the URI and revision.
4. **Dashboard index** (`index.html` with no `d`): a list of dashboards.
5. **States**: offline/reconnecting (the socket must auto-reconnect and resume with
   `since_seq`), an empty dashboard ("This board has no panels yet"), and an unknown dashboard.

The live ops board currently has KPI tiles, a bar chart, a carrier×region heatmap with a threshold
breach (Crane/EMEA), and a table. The agent will add more panels while the page is open, and that
is the moment the audience sees. Design for that moment: a new panel arriving on screen, caused by
an agent, legibly attributed.

## Deliverables

- `packages/web/public/proto/<id>/index.html`, `styles.css` (or a few CSS files imported in layer
  order), and `js/*.js` modules.
- `packages/web/public/proto/<id>/DESIGN.md`, about one page:
  - your artistic intent;
  - the token system (palette in OKLCH, type scale, spacing, elevation, motion);
  - your layout and IA decisions;
  - how accessibility is achieved;
  - what you would do next.

## Rules

- Write only inside `packages/web/public/proto/<id>/`. Do not edit anything else, and do not run
  git. The coordinator commits.
- Do not run servers, browsers, builds or tests. The coordinator serves the page and takes
  screenshots. You may run `node --check <file>` on your JS files.
- Do not copy the look of a specific existing product or brand. The direction words describe a
  mood, not a product to imitate.
- Never mention AI tools or models in code or docs.
