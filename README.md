# Plinth Suite

Plinth Suite is a self-hosted enterprise CMS, loyalty and automation suite for an organisation's own people:
pages and content, a points programme with a ledger, a rewards store, badges, promotions, messaging,
notifications, tasks and approvals, people and segments, reporting, and automations that tie them together.

People and AI agents use it through the same surfaces. Every feature is an entry in one action registry, and the
web UI, the HTTP API and the MCP server all dispatch those same entries, with the same permission checks and
the same domain events. An agent connected over MCP can read the site, preview a change, commit it, and every
open browser updates live.

**Live demo:** `https://<user>.github.io/<repo>/` (recorded data, see [About the demo](#about-the-demo)).

## What is in the repository

| Package               | What it is                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `packages/spec`       | The contract: schemas, the action registry, domain events, errors                                |
| `packages/core`       | Pure building blocks: canonical JSON, ids, hashing, change operations                            |
| `packages/engine`     | The store: nodes, the change log (hash-chained in Postgres), authorisation, blobs, the clock     |
| `packages/ingest`     | Lands source data as Parquet in object storage                                                   |
| `packages/api`        | The HTTP API, written with [Effect](https://effect.website)                                      |
| `packages/query`      | A typed query compiler over Parquet in object storage, run by DuckDB                             |
| `packages/rt`         | The realtime gateway: node changes and domain events over one WebSocket                          |
| `packages/mcp`        | The MCP server (`action.list`, `action.invoke`, `node.preview`, `node.commit`, `query.run`, ...) |
| `packages/worker`     | Domain-event consumers (automations, badges, notifications) and the virtual-time scheduler       |
| `packages/gen`        | The seed: the Northwind organisation, its people, history and a live event generator             |
| `packages/web`        | **Classic**, the main frontend: plain ES modules and web components, built with Vite             |
| `packages/town-spike` | **Township**, a 3D frontend (three.js on WebGPU or WebGL2) where the suite is a small town       |
| `packages/demo-data`  | Recordings and the browser mock runtime for the static demo                                      |

Classic and Township are two frontends over one backend, served from one origin (Township under `/town/`). A
site-wide setting chooses the default experience and each viewer can override it.

## Run it locally

Requirements: Node 24, pnpm 10, and podman with `podman compose` (for Postgres and MinIO).

```sh
pnpm install
make up            # Postgres (55432) and MinIO (59000, console 59001); creates the bucket; migrates
make demo-reset    # seeds the Northwind workspace, its people and history
make dev           # api :8782, rt :8781, worker, mcp :8790, web :5173
pnpm --filter @plinth/town-spike dev   # Township on :5180, served by the web dev server under /town/
```

Open http://localhost:5173/. Switch person with `?as=<handle>` (for example `?as=tomas-alvarez`) or from the
account menu. Open the 3D town at http://localhost:5173/town/. Every configuration key is in `.env.example`.

Compose mode runs the Node processes in containers too: `make up-app`, then seed once with
`podman compose -f deploy/compose/compose.yaml --profile seed run --rm seed`. `make down` stops everything.

### Connect an MCP client

Streamable HTTP, once `make dev` is running:

```sh
claude mcp add --transport http plinth http://localhost:8790/mcp --header "Authorization: Bearer dev-agent-claude-code"
```

Or stdio, run from the repository root:

```sh
claude mcp add plinth -- pnpm exec tsx packages/mcp/src/main.ts --stdio --principal agent:claude-code
```

### Checks and tests

`pnpm typecheck` needs nothing running. `pnpm test` needs the stack up and seeded (`make up`, `make demo-reset`);
the pure packages (core, query, spec, gen) need no services.

## About the demo

The GitHub Pages demo has no backend. Both frontends are built in a demo mode (`vite build --mode demo`) that
answers every API request from responses recorded against the seeded stack, for seven people with different
roles: Maya Ortiz (operations lead and admin), Tomás Alvarez (marketing), Ana Silva (member), Priya Nair
(finance), Samir Haddad (IT admin), Jonas Becker (regional manager) and Leah Okafor (content editor). Switch
between them with `?as=<handle>` or the account menu.

What to expect:

- **Reads are recorded.** What you see is the seeded data as it was when the recordings were made. A view or a
  filter that was not recorded shows an empty result.
- **Writes are simulated.** Transfers, messages and replies, marking notifications read, tasks, the cart, the
  wishlist and the site appearance (look and experience) take effect in the tab you made them in, and are
  forgotten when it closes. Other writes report success and change nothing.
- **Realtime is simulated.** A gentle loop of events (a points award, a new message, a notification) keeps
  toasts and badges moving; the connection indicator reads "Demo".
- **No agents.** The MCP server is not part of the demo, so agent-driven changes cannot be shown there. Run it
  locally for that.

### Rebuild the demo

```sh
pnpm demo:record    # with the local stack and both dev servers running; writes packages/demo-data/recordings
pnpm demo:build     # DEMO_BASE (default /plinth-suite/) is the Pages path; writes dist-pages/
pnpm demo:preview   # serves dist-pages/ at http://localhost:4173/plinth-suite/
```

`.github/workflows/pages.yml` runs `pnpm demo:build` on every push to `main` and deploys `dist-pages/` to
GitHub Pages, with `DEMO_BASE` set to the repository name. Enable Pages for the repository with "GitHub Actions"
as the source.
