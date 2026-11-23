# 07 Deployment: containers, AWS, local, configuration and secrets

This document specifies mission sections 11 (containers), 12 (AWS deployment architecture), 13 (local deployment architecture) and 14 (configuration and secrets management) for Plinth. It agrees with `README.md` (canonical facts, binding), with the amendments in `../selection-rationale.md`, and with the base design in `../revised/04-emergent-composition.md` (sections E, D.2, D.5, D.9 and H.4). Grafted ideas used here come from `../revised/01-systems-complexity.md` (section E: digest check, cosign, SBOM, auth parity, agent client-credentials), `../revised/02-visual-spectacle.md` (section E: one-substrate principle, `secret://` references, route parity) and `../revised/03-enterprise-platform.md` (section E: `doctor` checks, database role split, migration task, Secrets adapter, Caddy edge). Each graft is marked where it appears.

**Labels.** Each property is marked **Guarantee** (enforced by code or infrastructure and covered by a named test) or **Target** (a design goal, reported only after measurement on the stated substrate).

**Identifiers.** Acceptance criteria are `AC-DEP-<n>`. Test names are the names the CI and rehearsal suites carry.

---

## 11. Containers

### 11.1 Images

The README fixes five images. All five are built from one repository, from one Dockerfile with one target per image, on one pinned base. Every image is immutable, tagged with the git commit, and deployed only by digest.

| Image | Entrypoint subcommands | Process role | Runs on |
|---|---|---|---|
| `plinth-app` | `api`, `rt`, `mcp`, `presenter-control`, `migrate`, `reset`, `doctor`, `healthcheck`, `cli` | Web assets and HTTP API (`api`, port 8782), WebSocket gateway (`rt`, 8781), MCP server (`mcp`, 8790), presenter control API (`presenter-control`, 8791) | ECS services, compose services, one-shot tasks |
| `plinth-worker` | `serve` | Rule evaluator, workflow runner, backtests, scheduled exports, JWKS refresh | ECS service in the egress tier; compose service |
| `plinth-ingest` | `serve` | Kafka consumers writing immutable Parquet partitions; watermark publication | ECS service; compose service |
| `plinth-gen` | `serve`, `build-history`, `snapshot` | Seeded Northwind generator and virtual clock (`serve`); history build and control-store snapshot (one-shot) | ECS service and one-shot task; compose service and one-shot |
| `plinth-driver` | `replay`, `record` | Replay driver (MCP and HTTP client) and transcript recorder, principal `service:replay-driver` | One-shot task; compose profile `demo` |

**Guarantee (AC-DEP-01).** `plinth-app` contains every process that serves a browser, an HTTP client or an MCP client. No other image serves those surfaces. `plinth-driver` is the only image that contains transcript code.

The revised proposal listed four images and omitted the driver. The README lists five, and the README is binding. The driver is a fifth image.

### 11.2 Build

Multi-stage Dockerfile, one pinned Node 22 base for build stages and one distroless Node 22 base for runtime stages. Digests are read from `deploy/base-images.lock`. The build stages are:

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim@sha256:<pinned in deploy/base-images.lock> AS deps
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/ packages/
RUN npm ci --ignore-scripts && npm rebuild @duckdb/node-api

FROM deps AS build
COPY . .
RUN npm run build && npm run build:web && npm prune --omit=dev && \
    mkdir -p /out/app && cp -r dist packages/*/dist node_modules /out/app/

FROM node:22-bookworm-slim@sha256:<pinned> AS extensions
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && \
    /src/deploy/scripts/fetch-duckdb-extensions.sh /opt/plinth/duckdb/ext
# fetch-duckdb-extensions.sh verifies each file against deploy/duckdb-extensions.lock (SHA-256)

FROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:<pinned> AS runtime-base
COPY --from=build /out/app /app
COPY --from=extensions /opt/plinth/duckdb/ext /opt/plinth/duckdb/ext
ENV TZ=UTC \
    PLINTH_DUCKDB_EXTENSION_DIR=/opt/plinth/duckdb/ext \
    PLINTH_DUCKDB_AUTOINSTALL=false
USER 65532:65532
ENTRYPOINT ["/nodejs/bin/node", "/app/bin/plinth.js"]

FROM runtime-base AS plinth-app
CMD ["api"]
# plinth-worker, plinth-ingest, plinth-gen and plinth-driver are further runtime targets
# with the same base and their own CMD. Each copies only the packages it runs.
```

Rules the build enforces:

- **Guarantee (AC-DEP-02).** Every `FROM` line carries a `@sha256:` digest. A `FROM` without a digest fails `dockerfile_pinned` in CI.
- **Guarantee (AC-DEP-10).** No build step downloads at runtime. The DuckDB extensions are copied in at build and verified against `deploy/duckdb-extensions.lock`. Package installation at runtime is impossible because the runtime base has no package manager.
- **Guarantee.** Test devDependencies and source maps are not present in runtime targets. `npm prune --omit=dev` runs before the copy.
- **Guarantee.** Native code is limited to `@duckdb/node-api`, rebuilt once in the `deps` stage with the lockfile's exact version.
- The `extensions` stage uses the DuckDB CLI at the version in `deploy/duckdb-extensions.lock`. Extensions not in that lockfile are not copied.

### 11.3 Supply chain

- **Guarantee (AC-DEP-04).** `deploy/images.lock.json` records, per image, the commit, the digest, the SBOM digest and the cosign signature reference. It is the only place a digest is written by hand or by a script.
- **Guarantee (AC-DEP-05).** Every image has an SBOM in CycloneDX form attached as an OCI attestation, and a cosign signature. `verify-images` fails on a missing signature or a missing SBOM. The AWS deploy script calls `verify-images` before `cdk deploy`, and the compose renderer calls it before writing `docker-compose.yml`.
- **Guarantee (AC-DEP-06, graft from 01 E.1).** `check-digests` fails if the compose file, any CDK stack, or any task definition references an image digest that is not in `deploy/images.lock.json`. Compose and CDK both read the lockfile; neither contains a digest literal.
- **Limit.** ECS does not verify signatures at task launch. Signature verification is a gate in the deploy path and in CI, not a runtime admission control. This is stated, not hidden.
- Image scanning: **Target.** Each image is scanned for known vulnerabilities at build. A fixed-version finding at high severity or above blocks the lockfile update. The threshold is recorded in `deploy/scan-policy.json`.

### 11.4 Runtime user, filesystem and process model

- **Guarantee (AC-DEP-07).** All processes run as UID 65532, GID 65532. The root filesystem is read-only in both compose (`read_only: true`) and ECS (`readonlyRootFilesystem: true`). The only writable paths are `/tmp` (a tmpfs in compose, an ephemeral volume on ECS) and the DuckDB temporary directory, which is `/tmp/duckdb` through `PLINTH_DUCKDB_TEMP_DIR`.
- **Guarantee.** The runtime image has no shell. Health checks therefore call the application: `["CMD", "/nodejs/bin/node", "/app/bin/plinth.js", "healthcheck", "--ready"]`. A health check that needs a shell fails `image_runtime_shape`.
- **Guarantee (AC-DEP-08).** An unknown subcommand exits with status 64 and the error code `CONFIG_INVALID`. An entrypoint never starts a process it did not name.
- **Guarantee.** `TZ=UTC` is set in the runtime base. Virtual time, history partitioning and the seeded generator never read local time.
- Process supervision is the orchestrator's job (ECS or compose). A process exits on an unrecoverable startup error, with a machine-readable error code on stderr, and does not retry startup internally beyond the configured readiness budget.

### 11.5 Health and readiness

Every process exposes two endpoints on its HTTP port (or, for processes without HTTP, the `healthcheck` subcommand):

- `GET /healthz` is **liveness**. It returns 200 when the process is running and its event loop lag is below `PLINTH_HEALTH_LOOP_LAG_MAX_MS`. It checks no dependency.
- `GET /readyz` is **readiness**. It runs the checks for the process role, each with a timeout of `PLINTH_HEALTH_CHECK_TIMEOUT_MS`, and returns 200 with a JSON map of check names to results. If any check fails it returns 503 and names each failing check.

| Process | Readiness checks |
|---|---|
| `api` | `controlstore` (`SELECT 1`, schema version equals the migration set's version); `engine` (bundled extensions load with autoinstall off, `ATTACH` of the control store succeeds); `blobstore` (HEAD of the history manifest); `secrets` (every required `secret://` reference resolved); `jwks` (identity keys table non-empty and refreshed within `PLINTH_OIDC_JWKS_REFRESH_S` times 2) |
| `rt` | `ephemeral` (Redis `PING`, reported as degraded only, see the rule below); `outbox` (relay lag below the configured maximum); `controlstore` |
| `mcp` | `api` (the `api` process's `/readyz` answers 200); `jwks`; `schema` (the 15 tool schemas compile) |
| `worker` | `controlstore`; `jwks`; `outbox`; `clock` (virtual clock has advanced in the last 5 s) |
| `ingest` | `eventbus` (consumer group has all assigned partitions); `blobstore`; `controlstore` (partition publication path reachable) |
| `gen` | `clock` (tick counter advanced within the last 5 s); `controlstore`; `manifest` (manifest hash equals `PLINTH_HISTORY_MANIFEST_SHA256`) |
| `presenter-control` | `controlstore`; `token` (presenter control token resolved) |

- **Rule (Redis readiness).** Redis is non-blocking for readiness of every process. A failing `ephemeral` check is reported as degraded in the `/readyz` map and does not change the 200 or 503 result. `rt` reports `ephemeral` as degraded and stays ready, because fan-out recovers by resume. Redis loss changes latency only (08 section 16.7, 09 G11).
- **Guarantee (AC-DEP-09).** `health_contract` runs each process against its dependencies and asserts: liveness is 200 while Postgres is stopped; readiness is 503 with the failing check named (`controlstore`) while Postgres is stopped; readiness returns to 200 within two check intervals after Postgres restarts.
- **Guarantee.** The `api` readiness gate includes the engine check. A process whose DuckDB extensions fail to load never reports ready, so no query can reach a process that cannot run one.
- **Target.** A cold start of the full compose stack reaches all-ready within `PLINTH_READY_GATE_TIMEOUT_S`. The value is reported after measurement in the rehearsal report.

### 11.6 Acceptance criteria for containers

- **AC-DEP-01** Five images, one per README name; no other image serves a browser, HTTP or MCP client.
- **AC-DEP-02** `dockerfile_pinned`: every `FROM` has a digest.
- **AC-DEP-03** `image_runtime_shape`: final images have no shell and no package manager; run as 65532; start with a read-only root filesystem.
- **AC-DEP-04** `images_lock_complete`: every image in `images.lock.json` has commit, digest, SBOM and signature fields filled.
- **AC-DEP-05** `verify_images`: an unsigned or unattested digest makes the deploy script exit non-zero before any stack is touched.
- **AC-DEP-06** `check_digests`: no image literal in compose, CDK or task definitions; all digests come from the lockfile.
- **AC-DEP-07** `readonly_rootfs_writes`: a write to any path other than `/tmp` fails with `EROFS`.
- **AC-DEP-08** `unknown_subcommand`: exit status 64, `CONFIG_INVALID`.
- **AC-DEP-09** `health_contract`, as in 11.5.
- **AC-DEP-10** `extension_hashes`: every bundled extension matches its SHA-256 in `deploy/duckdb-extensions.lock`; a mismatch at startup fails with `EXTENSION_HASH_MISMATCH`.

---

## 12. AWS deployment architecture

### 12.1 Adapter interfaces and contract suites

Every cloud integration sits behind a named interface. Application code imports only the interface. The adapter is chosen by configuration (`PLINTH_*_BACKEND` or the endpoint keys in section 14), never by checking the deployment label.

```ts
interface ControlStore {                       // AWS: Aurora PostgreSQL 16 writer; local: postgres:16
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;   // read committed, always
  health(): Promise<{ schemaVersion: string }>;
}
interface EventBus {                           // AWS: MSK with IAM SASL; local: Redpanda
  produce(topic: string, key: Buffer, value: Buffer): Promise<void>;
  consume(group: string, topic: string, handler: (m: Msg) => Promise<void>): Stop;
}
interface BlobStore {                          // AWS: S3; local: MinIO
  put(key: string, body: Readable): Promise<void>;      // multipart above the SDK threshold
  get(key: string): Readable;  list(prefix: string): AsyncIterable<string>;
  renameInto(tmpKey: string, finalKey: string): Promise<void>;  // publication by rename
}
interface Ephemeral {                          // AWS: ElastiCache for Redis; local: redis:7
  set(key: string, v: string, ttlS: number): Promise<void>;
  publish(channel: string, payload: string): Promise<void>;
}
interface Identity {                           // AWS: Cognito user pool; local: Keycloak realm
  issuer(): string;  keys(): Promise<JwkSet>;  claims(token: string): Promise<PlinthClaims>;
}
interface Secrets {                            // AWS: Secrets Manager; local: files in /run/secrets
  resolve(ref: string): Promise<string>;       // ref is "secret://<name>"
}
interface Telemetry { export(): OtlpExporter; }   // AWS: ADOT to X-Ray and CloudWatch; local: OTel collector
```

| Interface | AWS implementation | Local implementation | Preserved behaviour | Contract suite |
|---|---|---|---|---|
| `ControlStore` | Aurora PostgreSQL 16, single writer endpoint | `postgres:16` container | Same SQL, same migrations, read committed, row locks on `workspace_chain` and `nodes` | `contract.controlstore` |
| `EventBus` | MSK, IAM SASL, TLS | Redpanda, plaintext, single node | Topic names, key `(workspace_id, order_id)`, ordering per key, consumer groups and offsets, redelivery after a consumer crash | `contract.eventbus` |
| `BlobStore` | S3 | MinIO | Bucket layout, SDK calls, multipart upload, listing order, rename publication | `contract.blobstore` |
| `Ephemeral` | ElastiCache for Redis, TLS, AUTH | `redis:7`, no TLS | Key names, TTLs, pub/sub channel names; non-authoritative on both | `contract.ephemeral` |
| `Identity` | Cognito user pool, OIDC | Keycloak with an exported realm | Authorisation-code with PKCE for humans, client credentials for agents, claim mapping, expiry handling | `contract.identity`, `identity_manifest_parity` |
| `Secrets` | Secrets Manager (task role) | Read-only files under `/run/secrets` | `secret://` resolution, missing-name error | `contract.secrets` |
| `Telemetry` | ADOT sidecar to X-Ray and CloudWatch | OTel collector to the local LGTM stack | Same OTLP export, same attributes | `contract.telemetry` |
| Compute | ECS on Fargate, one service per process | Compose services, same images and entrypoints | Same readiness contract, same environment keys | `health_contract` on both |

- **Guarantee (AC-DEP-11).** Each `contract.*` suite runs against both adapters in CI. A deploy to the staging stack is accepted only if the AWS run of every suite passes on the deployed digests. Local runs use the same suite files, so a suite cannot be satisfied by one adapter alone.
- **Guarantee.** `contract.eventbus` asserts per-key ordering across 10,000 messages with a consumer killed and restarted at random offsets; no message is lost and the redelivered messages are idempotently landed by `plinth-ingest` (dedupe on topic, partition and offset in the landing record).
- **Guarantee.** `contract.identity` asserts claim presence for `sub`, the workspace claim and the roles claim after the configured mapping, expiry rejection, unknown-key rejection (`401 UNKNOWN_KEY`), and key rotation without restart.
- **Target.** Adapter-specific behaviour (failover, broker operations) is not claimed to be identical. It is listed in the parity table in section 13.4.

### 12.2 Network topology

One VPC per stage, two availability zones.

| Tier | Subnets | Routes | Hosts |
|---|---|---|---|
| Public | `public-a`, `public-b` | Internet gateway | The ALB only |
| Egress | `egress-a` | NAT gateway in `public-a` (one, for the demo) | `plinth-worker` only |
| Data | `data-a`, `data-b` | No route to a NAT or an internet gateway; local routes and endpoints only | `api`, `rt`, `mcp`, `ingest`, `gen`, `presenter-control`, the migrate task, the driver task, the startup probe; Aurora, MSK, ElastiCache |

**Why the worker is the only task with egress.** The identity keys are fetched from the Cognito JWKS URL, which is on the public internet. The worker fetches it every `PLINTH_OIDC_JWKS_REFRESH_S` and writes the key set to the `identity_keys` table in the control store. The `api`, `rt` and `mcp` processes read that table, so they never need the public internet to validate a token. An unknown `kid` returns `401 UNKNOWN_KEY` and causes one immediate refresh request through the outbox. This is a Guarantee for the data tier: no request-serving task has egress.

**Interface VPC endpoints** (all in the data subnets, private DNS enabled): `ecr.api`, `ecr.dkr`, `secretsmanager`, `logs`, `monitoring`, `xray`, `ssmmessages` (ECS Exec, used for the presenter control path only). **Gateway endpoint:** `s3`, with an endpoint policy that allows only the `plinth-data-<stage>` bucket and the ECR layer buckets for the region.

- **Guarantee (AC-DEP-12).** `route_table_audit` asserts that no data-tier route table has a `0.0.0.0/0` route to a NAT or internet gateway. It fails the stack synthesis if one is added.
- **Guarantee (AC-DEP-13).** `endpoint_policy` asserts that the S3 gateway endpoint policy names no bucket outside the set above.

**Security groups.**

| Group | Inbound | Outbound |
|---|---|---|
| `alb` | 443 from the internet (and 80, redirected to 443) | To `api` 8782, `rt` 8781, `mcp` 8790 only |
| `api`, `rt`, `mcp` | From `alb` on their ports only | To Aurora 5432, Redis 6379, MSK 9098, S3 (endpoint), endpoints |
| `ingest`, `gen`, `worker` | None | To Aurora, Redis, MSK, S3, endpoints; `worker` also to the Cognito JWKS URL through NAT |
| `presenter-control` | None (no ALB rule, no ingress) | To Aurora and endpoints |
| `aurora`, `redis`, `msk` | From the application groups only | None |

- **Guarantee (AC-DEP-14).** `no_public_ingress` asserts that the only resource with an internet-facing listener is the ALB, that its listeners forward only to the three target groups above, and that no target group exists for port 8791.

### 12.3 Services and CDK stacks

CDK in TypeScript. Stacks depend on each other only through explicit outputs, never through runtime lookups; `cdk synth --no-lookups` is run in CI, so the synthesised templates depend only on committed inputs.

| Stack | Contents | Depends on |
|---|---|---|
| `PlinthNetwork` | VPC, subnets, route tables, NAT, endpoints, endpoint policies, security groups | none |
| `PlinthData` | Aurora PostgreSQL 16 (one writer, no reader instance), MSK (IAM, two brokers), ElastiCache for Redis (TLS, AUTH), the data bucket `plinth-data-<stage>`, Secrets Manager entries | `PlinthNetwork` |
| `PlinthIdentity` | Cognito user pool, hosted domain, resource server `plinth-api` with scopes `plinth.read`, `plinth.write`, `plinth.propose`, human app client (authorisation code with PKCE), agent app client `agent-claude-code` (client credentials), custom attributes `plinth_workspace` and `plinth_roles` | none |
| `PlinthCompute` | ECS cluster, Cloud Map namespace `plinth.internal`, task definitions and services for `api`, `rt`, `mcp`, `worker`, `ingest`, `gen`, `presenter-control`; one-shot task definitions for `migrate`, `history-build`, `reset`, `driver`, `startup-probe` | `PlinthNetwork`, `PlinthData`, `PlinthIdentity` |
| `PlinthEdge` | ALB, ACM certificate, listener rules generated from `deploy/routes.yaml`, WAF web ACL with a rate-based rule on `/mcp` | `PlinthNetwork`, `PlinthCompute` |
| `PlinthObservability` | Log groups with retention, X-Ray sampling rule, alarms on readiness failures and on the audit-chain verify failure | `PlinthCompute` |

Each service runs `desiredCount: 1`, one task. The demo does not claim multi-task behaviour. The control store serialises commits per workspace, so `api` and `mcp` can run more tasks without a semantic change, and that is a Target, not a demonstrated property.

**Routes.** `deploy/routes.yaml` is the single route table. The ALB rules and the local edge configuration are both rendered from it.

| Host | Path | Target |
|---|---|---|
| `app.<domain>` | `/rt/*` | `rt` 8781 |
| `app.<domain>` | `/*` | `api` 8782 (web assets, HTTP API, `/receivers/ops-channel`) |
| `mcp.<domain>` | `/mcp`, `/.well-known/oauth-protected-resource` | `mcp` 8790 |
| `auth.<domain>` | Cognito hosted domain | Not routed through the ALB |

`<domain>` is a CDK context value (`plinth.domain`). The stack refuses to synthesise without it.

### 12.4 Data tier

- **Aurora PostgreSQL 16.** One writer, no reader endpoint. Reads go to the writer. This is a deliberate simplification of the 03 proposal's reader-lag path: the control store serves every read through the same serialised chain, so a replica would add a second read-your-writes problem the demo does not need. **Guarantee** (AC-DEP-15): no component connects to a reader endpoint; the configuration has no key for one.
- **Roles.** Migrations create three roles. `plinth_owner` (NOLOGIN, owns every table, used only by the `migrate` task through its own login secret). `plinth_app` (the services' login; not the owner; no `BYPASSRLS`; not a superuser; DML grants only). `plinth_readonly` (for `query.explain` diagnostics only; reserved, not used by the demo path). The Aurora master user is used once by the `migrate` task's bootstrap step to create the three roles, and is then unused.
- **Guarantee (AC-DEP-16).** `db_roles`, run by `plinth doctor` in the `migrate` task and at every `api` start: `plinth_app` is not the owner of any table, is not a superuser, lacks `BYPASSRLS`, and has `statement_timeout` set to `PLINTH_DB_STATEMENT_TIMEOUT_MS` on the role. `doctor` fails closed (`DB_ROLE_INVALID`).
- **MSK.** IAM access control only. The plaintext and unauthenticated listeners are disabled. Topics are created by `plinth-app topics ensure` from the topic list in section 14, not by auto-creation. **Guarantee** (AC-DEP-17, `msk_iam_only`).
- **ElastiCache.** Redis engine major 7, TLS in transit, AUTH token from Secrets Manager. Keys and TTLs follow section 14. **Guarantee:** no invariant depends on Redis; the outbox relays fan-out after a Redis loss (revised D.6).
- **S3.** One bucket `plinth-data-<stage>`: immutable Parquet partitions under `partitions/`, history manifests under `history/manifests/`, control-store snapshots under `snapshots/`, runs under `runs/<run-id>/`, transcripts under `transcripts/`, exports under `exports/`. Versioning is off; immutability is by key convention plus the publication-by-rename rule (revised D.2). A bucket policy denies requests that are not TLS. Default encryption is SSE-S3 for the demo. **Target:** SSE-KMS is the production choice and is not required for the demo.

### 12.5 Identity

- **Humans.** Authorisation-code flow with PKCE against the Cognito hosted domain. Three human principals are created from `deploy/identity/demo-principals.yaml`: `user:ops-lead`, `user:emea-lead`, `user:finance-analyst`. The `migrate` task runs `plinth-app identity seed`, which uses the Cognito admin API with the task role to create them with the workspace and role attributes. It does not use a CDK custom resource, so no Lambda is part of the deployment.
- **Agent.** The `agent-claude-code` app client uses client credentials, with the resource server scopes. The token's scope can narrow the agent's permissions but cannot widen them. The agent's ceiling is `principals.max_scope` in the control store, set by the seed and not changeable through MCP (revised D.5).
- **Claim layout.** The platform reads three claims: `sub`, the workspace claim and the roles claim. The names are configuration (section 14). On AWS, Cognito custom attributes are `custom:plinth_workspace` (a string) and `custom:plinth_roles` (space-separated). On local Keycloak the names are `plinth/workspace` and `plinth/roles` (lists). The `Identity` adapter normalises both to the same `PlinthClaims` type. This is the one place the claim names differ; it is confined to the adapter and listed in 13.4.
- **Audience.** Cognito access tokens carry `client_id`, not `aud`. The adapter checks `aud` for ID tokens and `client_id` for access tokens against `PLINTH_OIDC_AUDIENCE` and the registered client IDs. **Guarantee** (AC-DEP-18, `contract.identity`).
- **Token lifetime.** Access tokens 900 s on both substrates. Refresh tokens 8 h on both.

### 12.6 Ingress and MCP exposure on AWS

- **Web and API.** `https://app.<domain>`. The ALB terminates TLS with the ACM certificate.
- **MCP.** Streamable HTTP at `https://mcp.<domain>/mcp`. The `mcp` service validates Cognito-issued bearer tokens against the JWKS held in the control store (section 12.2). It publishes protected-resource metadata at `/.well-known/oauth-protected-resource`, naming the issuer and the resource.
- **Stdio is not offered on AWS.** This is intended. The tool list, schemas, errors and audit rows are the same on both transports (section 13.3 and AC-DEP-30).
- **Rate limits.** A WAF rate-based rule on `/mcp` per source address, and the application's own token buckets (revised D.9, section 14). **Guarantee** (AC-DEP-19, `waf_mcp_rule`).
- **Presenter control.** No ALB rule, no target group. Reached only through an ECS Exec session (`ssmmessages` endpoint) that port-forwards `8791` to the presenter's machine. Its token is `secret://presenter-control-token`. **Guarantee** (AC-DEP-14 and AC-DEP-20, `presenter_control_isolation`).

### 12.7 Observability

- Every process exports OTLP to `PLINTH_OTLP_ENDPOINT`. On ECS that is the ADOT sidecar at `localhost:4317`, which exports traces to X-Ray and metrics and logs to CloudWatch.
- Span and metric attributes include `plinth.process`, `plinth.principal`, `plinth.surface`, `plinth.change_seq` and `plinth.deployment` (the label from section 14). The attribute names are the same on both substrates.
- The audit-chain verifier runs at `api` start and every `PLINTH_AUDIT_VERIFY_INTERVAL_S`. A failure raises a CloudWatch alarm on AWS and a visible status-page failure on both substrates (revised D.11).
- **Guarantee (AC-DEP-21).** `telemetry_attributes` asserts identical attribute names from both the ADOT and the OTel collector paths, using the same instrumentation.

### 12.8 Private-subnet startup test

The data tier has no route to the internet. Two things that a database-backed analytics service usually needs from the internet are removed by design: DuckDB extensions are bundled in the image (section 11.2), and the control store is reached only inside the VPC. The test proves that a task in the data tier can start and answer its first query under those conditions.

**Test `private_subnet_startup`.** Runs the `startup-probe` task definition (image `plinth-app`, the same digest as the services) in `data-a` with the network described in 12.2 and no NAT route. The probe runs `plinth-app doctor --probe` and must complete all steps:

1. Load the bundled `postgres` and `httpfs` extensions from `PLINTH_DUCKDB_EXTENSION_DIR` with autoinstall and autoload from the network disabled (`PLINTH_DUCKDB_AUTOINSTALL=false`). Verify their hashes.
2. Fetch `secret://db-app` through the Secrets Manager endpoint.
3. `ATTACH` the Aurora writer read-only and run `SELECT 1` and a schema-version read.
4. Run the first query over S3: `read_parquet` on one partition under `partitions/` through the gateway endpoint, returning one row.
5. Attempt a TCP connection to `1.1.1.1:443` with a 3 s timeout, and require it to fail. This proves the probe is genuinely without egress; a probe that could reach the internet would pass steps 1 to 4 for the wrong reason.

The probe writes a JSON report with each step's result and exits 0 only if every step passed. A failing step exits non-zero with its error code: `EXTENSION_MISSING`, `EXTENSION_HASH_MISMATCH`, `SECRET_NOT_FOUND`, `DB_UNREACHABLE` or `S3_UNREACHABLE`.

- **Guarantee (AC-DEP-22).** `private_subnet_startup` passes on every deployment of `PlinthCompute` before the services are updated, and in the staging stack before each rehearsal. A failure blocks the service update.
- **Guarantee (AC-DEP-23).** The probe runs with `PLINTH_DUCKDB_AUTOINSTALL=false` and `PLINTH_DUCKDB_AUTOLOAD=false`, and the first query uses only the bundled extensions.

### 12.9 Acceptance criteria for AWS

- **AC-DEP-11** `contract_both_substrates`: every `contract.*` suite passes on local and AWS for the deployed digests.
- **AC-DEP-12** `route_table_audit`: no data-tier route to NAT or internet gateway.
- **AC-DEP-13** `endpoint_policy`: S3 endpoint policy limited to the stated buckets.
- **AC-DEP-14** `no_public_ingress`: only the ALB is internet-facing; no target group for 8791.
- **AC-DEP-15** `no_reader_endpoint`: no connection to a reader endpoint in any component or configuration.
- **AC-DEP-16** `db_roles`.
- **AC-DEP-17** `msk_iam_only`.
- **AC-DEP-18** `identity_claims_audience`.
- **AC-DEP-19** `waf_mcp_rule`.
- **AC-DEP-20** `presenter_control_isolation`: no route from `mcp`, `api` or `rt` to `presenter-control`; separate token.
- **AC-DEP-21** `telemetry_attributes`.
- **AC-DEP-22** `private_subnet_startup`.
- **AC-DEP-23** `no_runtime_extension_fetch`.
- **Target** Cold deploy of `PlinthCompute` to a fresh stage. Measured and reported; no value is claimed here.

---

## 13. Local deployment architecture

### 13.1 Compose topology

`docker compose up` runs the same five images. The compose file is rendered by `deploy/scripts/render-compose.ts` from `deploy/services.yaml`, the same service list the CDK stacks read. Digests come from `deploy/images.lock.json`.

| Service | Image | Published port (host) | Network aliases | Networks | Depends on (health) |
|---|---|---|---|---|---|
| `postgres` | `postgres:16` (digest pinned) | 5432 | `postgres.plinth.internal` | `data` | none |
| `redis` | `redis:7` | 6379 | `redis.plinth.internal` | `data` | none |
| `redpanda` | Redpanda (digest pinned) | 19092 | `redpanda.plinth.internal` | `data` | none |
| `minio` | MinIO (digest pinned) | 9000, 9001 (console) | `minio.plinth.internal` | `data` | none |
| `keycloak` | Keycloak (digest pinned) | 8180 | `auth.plinth.localhost` | `edge`, `data` | `postgres` |
| `otel` | `grafana/otel-lgtm` (digest pinned) | 3000, 4317, 4318 | `otel-collector.plinth.internal` | `data` | none |
| `migrate` (one-shot) | `plinth-app` `migrate` | none | none | `data` | `postgres`, `minio`, `keycloak` |
| `history-build` (one-shot) | `plinth-gen` `build-history` | none | none | `data` | `minio`, `migrate` |
| `ingest` | `plinth-ingest` | none | `ingest.plinth.internal` | `data` | `redpanda`, `migrate` |
| `gen` | `plinth-gen` `serve` | none | `gen.plinth.internal` | `data` | `history-build`, `redpanda` |
| `worker` | `plinth-worker` | none | `worker.plinth.internal` | `data`, `edge` | `migrate`, `keycloak` |
| `api` | `plinth-app` `api` | none (via `edge`) | `api.plinth.internal` | `data`, `app` | `migrate`, `minio` |
| `rt` | `plinth-app` `rt` | none (via `edge`) | `rt.plinth.internal` | `data`, `app` | `migrate`, `redis` |
| `mcp` | `plinth-app` `mcp` | 8790 | `mcp.plinth.internal` | `data`, `app`, `edge` | `api` |
| `presenter-control` | `plinth-app` `presenter-control` | 127.0.0.1:8791 | none | `data` only | `migrate` |
| `edge` | `caddy` (digest pinned), config rendered from `deploy/routes.yaml` | 8780 | `edge.plinth.internal` | `edge`, `app` | `api`, `rt` |
| `driver` (profile `demo`) | `plinth-driver` | none | none | `data`, `app` | `mcp`, `api` |

Networks are `data` (state and infrastructure), `app` (HTTP and WebSocket between processes), `edge` (things a browser or a client reaches). `presenter-control` is on `data` only. It is therefore not reachable from `edge` or `app`, and the MCP path cannot reach it even by address.

**Browser origin.** The browser uses `http://localhost:8780` for web, API and realtime. `edge` routes `/rt` to `rt` and every other path to `api`. The routes come from `deploy/routes.yaml`, the same file as the ALB rules.

**Identity hostname.** The Keycloak issuer is `http://auth.plinth.localhost:8180/realms/plinth`. Browsers resolve `*.localhost` to loopback. Containers reach Keycloak through the network alias `auth.plinth.localhost` on the `data` and `edge` networks, so the issuer string is identical for browser and server. **Decision** (see the list at the end).

- **Guarantee (AC-DEP-24).** `routes_parity` renders the ALB route list and the `edge` configuration from `deploy/routes.yaml` and asserts identical host, path and target triples.
- **Guarantee (AC-DEP-25).** `single_origin_local` asserts that the browser-visible origin for web, API and realtime is one origin, `http://localhost:8780`, as on AWS.
- **Guarantee (AC-DEP-26).** `presenter_control_loopback`: the published port for `presenter-control` is bound to `127.0.0.1`.

### 13.2 Startup order, gates and commands

`make up` (or `docker compose up`) starts services in dependency order. Each service declares its dependencies with `condition: service_healthy` or `service_completed_successfully`. The one-shot tasks run in this order:

1. `migrate`: bootstrap roles (using the master secret, local value the compose superuser), apply migrations as `plinth_owner`, seed identities from `deploy/identity/demo-principals.yaml`, run `bootstrap-storage` (create the data bucket), run `topics ensure`, run `doctor`. Exits 0 only when every step and every `doctor` check passes.
2. `history-build`: if `history/manifests/<PLINTH_HISTORY_MANIFEST_SHA256>.json` exists in the bucket, verify its partition hashes and exit. Otherwise generate the 30-day history from the seed and write partitions, manifest and control-store snapshot. The generation is deterministic (xoshiro256**, seed committed), so a second build with the same seed produces the same manifest hash.

Long-running services then start. `make up` waits for `/readyz` on every service and fails with the first failing check name after `PLINTH_READY_GATE_TIMEOUT_S`.

| Command | Behaviour | Guarantee |
|---|---|---|
| `make up` | Renders compose from the lockfile, runs the gates above, prints the four window URLs and the MCP URL | AC-DEP-27 |
| `make demo-reset` | Control-store restore from the snapshot named by the manifest, repoint the workspace at the manifest, create `runs/<new-run-id>/`, delete the previous run's live partitions. The history is not regenerated and not reloaded. | AC-DEP-28 |
| `make rehearse` | Playwright across the four windows, then the replay driver from the transcript | AC-DEP-29 |
| `make demo-replay STEP=n` | Starts `driver` from step `n` | Revised C.3 and D.6 |
| `plinth apply`, `plinth diff` | Applies or diffs YAML documents through the same commit path as the UI | Revised D.7 |

`plinth apply` and `plinth diff` run from the `plinth-app` image (`cli` subcommand) or from a host install built from the same lockfile. Both use the same commit path (preview then commit). A host install never writes to the database directly.

- **Guarantee (AC-DEP-27).** `compose_up_gates`: `make up` from an empty volume reaches all-ready in dependency order, and no service starts before its dependencies are healthy (checked from the compose event log).
- **Guarantee (AC-DEP-28).** `reset_idempotent`: two consecutive `make demo-reset` runs produce identical body hashes for the Ops board, the finance board, the rule and the workflow instance, and `history_reproduces` (revised C.2) passes: the history rebuilt from the seed matches the manifest hash that the snapshot names.
- **Target.** Reset completes within 20 s on the rehearsal host (revised E.4). Measured and reported.
- **Guarantee (AC-DEP-29).** `rehearse_waits_on_sequence`: the Playwright harness waits on the page-exposed realtime sequence number, never on a fixed sleep. A test scans the rehearsal scripts for `waitForTimeout` and fails if one is present.

### 13.3 Local MCP exposure

- **stdio** for Claude Code and Claude Desktop: the client launches `docker run --rm -i --network plinth_app ... plinth-app mcp --stdio --principal agent:claude-code`, with the workspace and the agent token in the environment. The demo uses this path. The image is the same digest as the `mcp` service.
- **Streamable HTTP** at `http://localhost:8790/mcp`, with a bearer token from Keycloak (client credentials for `agent-claude-code`).
- The stdio path and the HTTP path use one tool registry, one schema set and one error model. **Guarantee** (AC-DEP-30, `transport_parity`): the `tools/list` result, every tool's input schema, and the error codes for a fixed set of 20 requests are byte-identical across stdio and HTTP. The audit rows differ only in `surface`, which is `mcp` on both, and in the recorded transport identifier.

### 13.4 Parity table

Every difference between the two deployments is listed here, with the reason behaviour is unchanged and the test that covers it. A difference not in this table is a defect.

| # | Concern | Local | AWS | What differs | Why behaviour is unchanged | Test |
|---|---|---|---|---|---|---|
| 1 | Compute scheduler | Compose | ECS on Fargate | Placement, restart, scaling | Stateless processes; state only in the control store, the bucket and Redis | `health_contract` on both |
| 2 | TLS and edge | `edge` (Caddy) over HTTP | ALB with ACM over HTTPS | Certificate and termination | Same route table (`deploy/routes.yaml`) | `routes_parity` |
| 3 | Browser origin | `localhost:8780` | `app.<domain>` | Host name | One origin in both; same paths | `single_origin_local` |
| 4 | Control-store failover | None | Aurora writer, no reader; managed failover is not exercised | Failover behaviour exists only on AWS | Same SQL, migrations, roles and isolation; failover is not part of the demo path | `contract.controlstore` |
| 5 | Reader endpoint | None | None | Not used on either | No component reads a replica on either; no read-your-writes path exists to diverge | `no_reader_endpoint` |
| 6 | Event-stream auth and TLS | Plaintext | MSK IAM SASL, TLS | Authentication and transport security | Same Kafka protocol, topic names, partition key, consumer groups and offsets | `contract.eventbus` |
| 7 | Kafka replication factor | 1 | 2 | Durability on broker loss | Ordering and offsets are per partition and do not depend on replication | `contract.eventbus` |
| 8 | Object store addressing | MinIO, path style | S3, virtual-hosted style | `PLINTH_S3_FORCE_PATH_STYLE` | Same SDK calls and paths | `contract.blobstore` |
| 9 | Object store credentials | Static, from `secret://minio-*` | Task role | Credential source | Same permissions needed by the same calls | `contract.blobstore` |
| 10 | Redis transport | No TLS, no AUTH | TLS, AUTH | Transport security | Same keys, TTLs, channels; non-authoritative on both | `contract.ephemeral` |
| 11 | Identity provider | Keycloak realm | Cognito user pool | Issuer, client registration | Same OIDC flows; same `PlinthClaims` after mapping | `contract.identity`, `identity_manifest_parity` |
| 12 | Claim names | `plinth/workspace`, `plinth/roles` (lists) | `custom:plinth_workspace`, `custom:plinth_roles` (strings) | Claim format and name | Adapter normalises to one type; the platform reads only the normalised claims | `contract.identity` |
| 13 | Token audience | `aud` for ID tokens, `aud` for access tokens | `aud` for ID tokens, `client_id` for access tokens | Claim location | Adapter checks the right claim per token type | `identity_claims_audience` |
| 14 | Agent auth | Keycloak client credentials | Cognito client credentials with resource scopes | Scope registration | Token scope narrows only; ceiling is in the control store on both | `agent_auth_parity` |
| 15 | Principal seeding | Realm import from `deploy/keycloak/realm-plinth.json` generated from the manifest | Cognito admin API from the `migrate` task | Mechanism | Same manifest; same principal IDs and attributes | `identity_manifest_parity` |
| 16 | Secrets backing | Files under `/run/secrets` | Secrets Manager | Storage | Same `secret://` references and error code `SECRET_NOT_FOUND` | `contract.secrets` |
| 17 | Telemetry backend | OTel collector to LGTM stack | ADOT to X-Ray and CloudWatch | Backend and dashboards | Same OTLP export and attribute names | `contract.telemetry`, `telemetry_attributes` |
| 18 | MCP transport | stdio and Streamable HTTP | Streamable HTTP only | stdio not offered on AWS | Same tool list, schemas, errors and audit rows | `transport_parity` |
| 19 | Data-tier egress | Not restricted | No NAT route | Network reachability | No runtime path fetches from the internet on either; the startup probe proves it on AWS | `private_subnet_startup` |
| 20 | Worker egress | Not restricted | NAT for JWKS only | Network path | The JWKS table is the same on both; only the worker writes it | `contract.identity`, `health_contract` |
| 21 | Presenter control access | Loopback port | No ALB route; SSM port forward | Access path | Same cue table and same tick semantics | `presenter_control_isolation` |
| 22 | Replica count | 1 per service | 1 per service | Not a difference in the demo | Commit serialisation is in Postgres, so more tasks are a Target and not a claim | Revised G.5 |
| 23 | Virtual clock time zone | UTC | UTC | None | Fixed by image | `image_runtime_shape` |
| 24 | DuckDB extensions | Bundled, autoinstall off | Bundled, autoinstall off | None | Same files, same hashes | `extension_hashes` |
| 25 | Reset mechanism | `make demo-reset` on host | Same command runs the `reset` task | Who runs it | Same snapshot, same manifest, same steps | `reset_idempotent` |
| 26 | Driver location | `driver` container | One-shot ECS task | Placement | Same image digest, same transcript format | `replay_reproduces` (revised C.3) |
| 27 | Ops-channel receiver | `api` on `api.plinth.internal:8782` | Same on Cloud Map name | None observable | Same internal endpoint; no external chat service in either | `ops_channel_local_only` |
| 28 | Deployment label | `local` | `aws-<stage>` | Telemetry label only | Code does not branch on it (AC-DEP-32) | `no_env_branch` |

- **Guarantee (AC-DEP-31).** `parity_table_complete`: the set of configuration keys whose local and AWS values differ (section 14.2) is a subset of the rows above, and every row names a test that exists in the suite.

### 13.5 Acceptance criteria for local

- **AC-DEP-24** `routes_parity`.
- **AC-DEP-25** `single_origin_local`.
- **AC-DEP-26** `presenter_control_loopback`.
- **AC-DEP-27** `compose_up_gates`.
- **AC-DEP-28** `reset_idempotent` and `history_reproduces`.
- **AC-DEP-29** `rehearse_waits_on_sequence`.
- **AC-DEP-30** `transport_parity`.
- **AC-DEP-31** `parity_table_complete`.
- **Target** Commit-to-screen latency on one host: 300 ms at p95 from commit to the second window (revised D.6). Measured in `make rehearse` and reported.

---

## 14. Configuration and secrets management

### 14.1 Rules

1. **One substrate, configured.** Application code does not branch on environment. Substrate is chosen by a configuration key that names an adapter, and every adapter passes the same contract suite (section 12.1). **Guarantee** (AC-DEP-32, `no_env_branch`): a static check fails the build if any source file reads `PLINTH_DEPLOYMENT_LABEL` in a conditional, or compares it to a string.
2. **Environment variables only.** Configuration arrives as environment variables. Files are used for secrets only (section 14.3) and for the route table, service list and seed, which are committed and identical on both substrates.
3. **Prefix.** Every key starts with `PLINTH_`. An unknown `PLINTH_*` variable makes startup fail with `CONFIG_INVALID`, so a misspelt key cannot silently fall back to a default. **Guarantee** (AC-DEP-33, `config_unknown_key_refused`).
4. **Precedence.** Environment value, then the default in the schema. A required key with no value fails with `CONFIG_MISSING`. A value that fails its type or range fails with `CONFIG_INVALID`, naming the key and the expected type.
5. **References, not values, for secrets.** A key whose name ends in `_REF` holds a `secret://<name>` reference. The value is resolved through the `Secrets` adapter at startup and held in memory only.
6. **Values that are not secret are committed.** The default column of section 14.2 is committed in `deploy/config/defaults.yaml`. The local column is in `deploy/config/local.env`, committed. The AWS column is produced by CDK from stack outputs and from `deploy/config/aws-<stage>.yaml`, committed.

### 14.2 Configuration keys

Column meanings: **Default** is the schema default (`-` means required, no default). **Local** is the value in `deploy/config/local.env`. **AWS source** is where the value comes from on AWS. Where the Local and AWS values are equal the table says `same`. Where they differ, the parity table (13.4) lists the row.

**Identity and mode**

| Key | Default | Local | AWS source | Notes |
|---|---|---|---|---|
| `PLINTH_DEPLOYMENT_LABEL` | `local` | `local` | `aws-<stage>` from CDK context `stage` | Telemetry label only (rule 1) |
| `PLINTH_WORKSPACE_SLUG` | `northwind` | same | `deploy/config/aws-<stage>.yaml` | Workspace UUID is UUIDv5 of this slug |
| `PLINTH_PROFILE` | `demo` | same | `deploy/config/aws-<stage>.yaml` | Selects the seeded demo profile, not an environment |
| `PLINTH_EXTERNAL_BASE_URL` | `http://localhost:8780` | `http://localhost:8780` | `https://app.<domain>` | Used for OIDC redirects and links |
| `PLINTH_INTERNAL_BASE_URL` | `http://api.plinth.internal:8782` | same | Cloud Map name | Used by the worker for the ops-channel post |
| `PLINTH_HTTP_PORT` | per process: `api` 8782, `rt` 8781, `mcp` 8790, `presenter-control` 8791 | same | same | Container port |
| `PLINTH_LOG_LEVEL` | `info` | `info` | `info` | |
| `PLINTH_HEALTH_LOOP_LAG_MAX_MS` | `500` | same | same | Liveness |
| `PLINTH_HEALTH_CHECK_TIMEOUT_MS` | `2000` | same | same | Per readiness check |
| `PLINTH_READY_GATE_TIMEOUT_S` | `180` | same | same | Compose gate and ECS health grace |

**Database**

| Key | Default | Local | AWS source | Notes |
|---|---|---|---|---|
| `PLINTH_DB_HOST` | `postgres.plinth.internal` | same | `PlinthData` output `WriterEndpoint` | Writer only |
| `PLINTH_DB_PORT` | `5432` | same | same | |
| `PLINTH_DB_NAME` | `plinth` | same | same | |
| `PLINTH_DB_USER` | `plinth_app` | same | same | Not the owner (AC-DEP-16) |
| `PLINTH_DB_PASSWORD_REF` | `secret://db-app` | same | same ref; Secrets Manager `plinth/<stage>/db-app` | |
| `PLINTH_DB_OWNER_USER` | `plinth_owner` | same | same | `migrate` task only |
| `PLINTH_DB_OWNER_PASSWORD_REF` | `secret://db-owner` | same | same ref | `migrate` task only |
| `PLINTH_DB_MASTER_SECRET_REF` | `secret://db-master` | `secret://db-master` (compose superuser) | Aurora managed master secret ARN | `migrate` bootstrap only; unused after |
| `PLINTH_DB_SSLMODE` | `verify-full` | `disable` | `verify-full` | Local network only |
| `PLINTH_DB_POOL_MAX` | `20` | same | same | |
| `PLINTH_DB_STATEMENT_TIMEOUT_MS` | `15000` | same | same | Set on `plinth_app` by migration; checked by `doctor` |

**Query engine**

| Key | Default | Local | AWS source | Notes |
|---|---|---|---|---|
| `PLINTH_DUCKDB_THREADS` | `1` | same | same | Replay determinism (revised G.1, item 4) |
| `PLINTH_DUCKDB_EXTENSION_DIR` | `/opt/plinth/duckdb/ext` | same | image | Set in image |
| `PLINTH_DUCKDB_AUTOINSTALL` | `false` | same | same | Set in image; refused if `true` (`CONFIG_INVALID`) |
| `PLINTH_DUCKDB_AUTOLOAD` | `false` | same | same | As above |
| `PLINTH_DUCKDB_TEMP_DIR` | `/tmp/duckdb` | same | same | Writable tmpfs |
| `PLINTH_DUCKDB_MEMORY_LIMIT` | `2GB` | same | same | Fits the Fargate task size in CDK (4 GiB) |
| `PLINTH_QUERY_MAX_PARTITIONS` | `2000` | same | same | Refusal with `QUERY_TIMEOUT` and a window hint above this (revised D.9) |
| `PLINTH_QUERY_DEFAULT_TIMEOUT_MS` | `5000` | same | same | Default for `query.run` |
| `PLINTH_QUERY_MAX_TIMEOUT_MS` | `30000` | same | same | Ceiling for `query.run` |
| `PLINTH_QUERY_WATERMARK_WAIT_MS` | `10000` | same | same | Wait for `as_of` before `SOURCE_STALE` (revised D.4) |
| `PLINTH_RESULT_CACHE_MAX_MB` | `256` | same | same | Policy-keyed cache (revised D.4) |

**Object store**

| Key | Default | Local | AWS source | Notes |
|---|---|---|---|---|
| `PLINTH_S3_ENDPOINT` | empty (regional default) | `http://minio.plinth.internal:9000` | empty | Parity row 8 |
| `PLINTH_S3_REGION` | `us-east-1` | same | same | |
| `PLINTH_S3_BUCKET` | `plinth-data` | `plinth-data` | `PlinthData` output `DataBucketName` | |
| `PLINTH_S3_FORCE_PATH_STYLE` | `false` | `true` | `false` | Parity row 8 |
| `PLINTH_S3_CREDENTIAL_MODE` | `task-role` | `static-ref` | `task-role` | Static mode reads `secret://minio-access-key` and `secret://minio-secret-key`; parity row 9 |

**Event stream**

| Key | Default | Local | AWS source | Notes |
|---|---|---|---|---|
| `PLINTH_KAFKA_BROKERS` | `redpanda.plinth.internal:9092` | same | `PlinthData` output `MskBootstrapIam` | |
| `PLINTH_KAFKA_SASL_MECHANISM` | `none` | `none` | `AWS_MSK_IAM` | Parity row 6 |
| `PLINTH_KAFKA_TLS` | `false` | `false` | `true` | Parity row 6 |
| `PLINTH_KAFKA_REPLICATION` | `1` | `1` | `2` | Parity row 7 |
| `PLINTH_KAFKA_PARTITIONS` | `6` | same | same | Topic creation |
| `PLINTH_KAFKA_TOPIC_ORDERS` | `northwind.orders.v1` | same | same | Named in revised A |
| `PLINTH_KAFKA_TOPIC_CARRIER_SCANS` | `northwind.carrier_scans.v1` | same | same | **Decision** (name not fixed by canonical facts) |
| `PLINTH_KAFKA_TOPIC_WAREHOUSE` | `northwind.warehouse_capacity.v1` | same | same | **Decision** |
| `PLINTH_KAFKA_CONSUMER_GROUP` | `plinth-ingest` | same | same | Offsets preserved across backends |

**Redis**

| Key | Default | Local | AWS source | Notes |
|---|---|---|---|---|
| `PLINTH_REDIS_HOST` | `redis.plinth.internal` | same | `PlinthData` output `RedisEndpoint` | |
| `PLINTH_REDIS_PORT` | `6379` | same | same | |
| `PLINTH_REDIS_TLS` | `false` | `false` | `true` | Parity row 10 |
| `PLINTH_REDIS_AUTH_REF` | empty | empty | `secret://redis-auth` | Empty means no AUTH |
| `PLINTH_REDIS_KEY_PREFIX` | `plinth:` | same | same | |
| `PLINTH_PRESENCE_TTL_S` | `5` | same | same | Presence key TTL; 5 s is the binding UI requirement (04 section 6.11, README ruling 14) |
| `PLINTH_PRESENCE_MAX_HZ` | `5` | same | same | Per node (revised D.6) |

**Identity**

| Key | Default | Local | AWS source | Notes |
|---|---|---|---|---|
| `PLINTH_OIDC_ISSUER` | `-` | `http://auth.plinth.localhost:8180/realms/plinth` | `PlinthIdentity` output `Issuer` | Parity rows 11 to 13 |
| `PLINTH_OIDC_AUDIENCE` | `plinth-api` | same | same | Resource server identifier |
| `PLINTH_OIDC_CLAIM_WORKSPACE` | `plinth/workspace` | `plinth/workspace` | `custom:plinth_workspace` | Parity row 12 |
| `PLINTH_OIDC_CLAIM_ROLES` | `plinth/roles` | `plinth/roles` | `custom:plinth_roles` | Parity row 12; string split on spaces on AWS |
| `PLINTH_OIDC_JWKS_REFRESH_S` | `300` | same | same | Worker writes `identity_keys` |
| `PLINTH_OIDC_CLOCK_SKEW_S` | `30` | same | same | |
| `PLINTH_AGENT_CLIENT_ID` | `agent-claude-code` | same | `PlinthIdentity` output `AgentClientId` | |
| `PLINTH_AGENT_CLIENT_SECRET_REF` | `secret://agent-claude-code-client-secret` | same ref | same ref | Used by the token helper only |
| `PLINTH_AGENT_TOKEN_FILE` | `~/.config/plinth/agent-claude-code.token` | same | same | Client-side; never mounted into a container; mode 0600 (AC-DEP-37) |
| `PLINTH_MCP_PUBLIC_URL` | `-` | `http://localhost:8790/mcp` | `https://mcp.<domain>/mcp` | Protected-resource metadata |
| `PLINTH_AUTH_TOKEN_TTL_S` | `900` | `900` | `900` | Access tokens on both (section 12.5) |

**Secrets**

| Key | Default | Local | AWS source | Notes |
|---|---|---|---|---|
| `PLINTH_SECRETS_BACKEND` | `file` | `file` | `aws-secrets-manager` | Parity row 16 |
| `PLINTH_SECRETS_PATH` | `/run/secrets` | `/run/secrets` | `plinth/<stage>/` (name prefix) | |

**Telemetry**

| Key | Default | Local | AWS source | Notes |
|---|---|---|---|---|
| `PLINTH_OTLP_ENDPOINT` | `http://otel-collector.plinth.internal:4317` | same | `http://localhost:4317` (ADOT sidecar) | Parity row 17 |
| `PLINTH_OTEL_TRACE_SAMPLING` | `1.0` | same | same | Demo volume is sampled in full |
| `PLINTH_AUDIT_VERIFY_INTERVAL_S` | `300` | same | same | Audit-chain verify |

**Clock, seed and history**

| Key | Default | Local | AWS source | Notes |
|---|---|---|---|---|
| `PLINTH_DEMO_SEED` | `2026` | same | same (`deploy/config`) | **Decision** (committed in `deploy/seed.json`) |
| `PLINTH_DEMO_VIRTUAL_DATE` | `2026-11-20` | same | same | **Decision** (virtual demo date, UTC) |
| `PLINTH_DEMO_VIRTUAL_START` | `14:30:00` | same | same | Virtual time at script start (revised C.1) |
| `PLINTH_DEMO_CLOCK_RATE` | `6` | same | same | Virtual seconds per wall second (revised C.2) |
| `PLINTH_GEN_TICK_VIRTUAL_MS` | `1000` | same | same | Fault cue applies at the next tick (revised C.3) |
| `PLINTH_RULE_EVAL_INTERVAL_VIRTUAL_MS` | `60000` | same | same | One-minute windows (revised B-3 and C.2) **Decision** on the evaluation cadence |
| `PLINTH_HISTORY_DAYS` | `30` | same | same | |
| `PLINTH_HISTORY_MANIFEST` | `-` | `s3://plinth-data/history/manifests/<sha>.json` | same with the stage bucket | Path resolved through `BlobStore` |
| `PLINTH_HISTORY_MANIFEST_SHA256` | `-` | from `deploy/history.lock` | same | Checked at startup (`MANIFEST_MISMATCH`) |
| `PLINTH_RUN_ID` | `-` | written by `reset` | written by `reset` | Keys runs under `runs/<run-id>/` |

**Rules, receivers and rate limits**

| Key | Default | Local | AWS source | Notes |
|---|---|---|---|---|
| `PLINTH_RECEIVER_OPS_CHANNEL_URL` | `http://api.plinth.internal:8782/receivers/ops-channel` | same | same | Internal endpoint; no external service (section 13.1) |
| `PLINTH_PREVIEW_TTL_S` | `300` | same | same | Preview token lifetime; single-use, stored in Postgres as a hash (README ruling 13) |
| `PLINTH_RATE_AGENT_BURST_UNITS` | `60` | same | same | Revised D.9 |
| `PLINTH_RATE_AGENT_WINDOW_S` | `10` | same | same | Burst window |
| `PLINTH_RATE_AGENT_PER_MIN_UNITS` | `300` | same | same | Sustained |

**Demo driver and presenter control**

| Key | Default | Local | AWS source | Notes |
|---|---|---|---|---|
| `PLINTH_PRESENTER_PORT` | `8791` | same | same | Presenter control API container port (11.1). Published on `127.0.0.1` only locally (13.1); no ALB route on AWS (12.6) |
| `PLINTH_PRESENTER_CONTROL_TOKEN_REF` | `secret://presenter-control-token` | same | same ref | Separate from every agent credential (P15) |
| `PLINTH_DRIVER_TRANSCRIPT_URI` | `file:///transcripts/live-s1.json` | same | `s3://plinth-data/transcripts/live-s1.json` | Read through `BlobStore` |
| `PLINTH_DRIVER_BUDGET_QUERY_MS` | `12000` | same | same | Revised C.3 |
| `PLINTH_DRIVER_BUDGET_MULTI_MS` | `20000` | same | same | Revised C.3 |
| `PLINTH_DRIVER_CUE_WAIT_MS` | `5000` | same | same | Scripted cue after silence (revised C.3) |
| `PLINTH_DRIVER_MAX_SCRIPT_S` | `300` | same | same | Hard maximum (P19) |
| `PLINTH_DRIVER_SLACK_POOL_S` | `30` | same | same | **Decision**, shown on the presenter console (P19) |

Keys not in this table do not exist. Adding a key requires adding a row here, and `config_keys_documented` fails the build otherwise.

- **Guarantee (AC-DEP-34).** `config_keys_documented`: the key set in the code's schema equals the key set in section 14.2, and each row's default equals the schema default.

### 14.3 Secrets handling

**Secret inventory.**

| Reference | Used by | Local backing | AWS backing | Rotation |
|---|---|---|---|---|
| `secret://db-app` | api, rt, mcp, worker, ingest, gen, presenter-control | File | Secrets Manager `plinth/<stage>/db-app` | **Target**: rotation not in the demo |
| `secret://db-owner` | migrate | File | Secrets Manager | Not rotated during the demo |
| `secret://db-master` | migrate (bootstrap) | Compose superuser password file | Aurora managed master secret | Managed by Aurora |
| `secret://redis-auth` | rt, api, worker | Empty locally | Secrets Manager | Not rotated during the demo |
| `secret://minio-access-key`, `secret://minio-secret-key` | Static credential mode only | Generated file, gitignored | Not used | n/a |
| `secret://agent-claude-code-client-secret` | Token helper (client side) and `identity seed` | Generated file | Secrets Manager | Not rotated during the demo |
| `secret://presenter-control-token` | presenter-control, presenter console | Generated file | Secrets Manager | Not rotated during the demo |
| `secret://demo-password-<persona>` | Human sign-in for the three windows | Generated file | Secrets Manager | Not rotated during the demo |
| Keycloak admin, Grafana admin | Local operators | Generated file | Not used | n/a |

**Rules.**

- **Guarantee (AC-DEP-35, `secret_scan`).** No secret value appears in an image layer, in `deploy/config/*`, in a task definition, in a compose file, in a log line, or in a test snapshot. The check scans every image's filesystem and every rendered artifact. A committed secret-looking string fails the build.
- **Guarantee.** ECS task definitions reference Secrets Manager by ARN in the `secrets` block, and that is the only way a secret reaches a container on AWS. Environment blocks hold only non-secret values and `_REF` keys.
- **Guarantee.** Compose secrets are file mounts under `/run/secrets`, generated by `make up` if absent, with random values, into `deploy/local-secrets/`, which is gitignored. The compose file names the files, never their contents.
- **Guarantee (AC-DEP-36, `secret_resolution_contract`).** `contract.secrets` runs against both backends. A missing name fails with `SECRET_NOT_FOUND` and the reference name, never the value. A backend that is unreachable fails with `SECRET_BACKEND_UNAVAILABLE`. A resolved value is never returned in an error message.
- **Guarantee.** The log redactor replaces any field whose key matches `password|secret|token|authorization|cookie` with `[redacted]`, and any `Bearer` header value. The redactor runs before the OTLP exporter, so traces are covered too.
- **Guarantee.** Preview tokens and idempotency keys are stored in Postgres as hashes (`preview_tokens.token_hash`, revised D.2). A database dump does not contain a usable token.
- **Guarantee (AC-DEP-37, `agent_token_file_mode`).** The token helper refuses to read `PLINTH_AGENT_TOKEN_FILE` unless the file is readable only by the current user (mode 0600 on POSIX; on Windows, an ACL granting only the current user). The helper never prints the token.
- **Limit.** Agent authority is not a secret property. A stolen agent token is bounded by the agent's ceiling and by the preview and approval rules (revised D.10). Rotation of the agent client secret is a **Target**.

### 14.4 Configuration validation: `plinth doctor`

`plinth-app doctor` runs in the `migrate` task, at every `api` start, and as the startup probe's first step. It fails closed. Each check has a stable code.

| Check | Failure code |
|---|---|
| Every required key present; every value parses and is in range | `CONFIG_MISSING`, `CONFIG_INVALID` |
| `PLINTH_DUCKDB_AUTOINSTALL` and `AUTOLOAD` are `false`; `PLINTH_DUCKDB_THREADS` is `1` when the profile is `demo` | `CONFIG_INVALID` |
| Bundled extension hashes match the lockfile | `EXTENSION_HASH_MISMATCH` |
| Database roles (AC-DEP-16) | `DB_ROLE_INVALID` |
| Schema version equals the migration set | `SCHEMA_VERSION_MISMATCH` |
| The workspace chain head row exists for `PLINTH_WORKSPACE_SLUG` | `CHAIN_HEAD_MISSING` |
| `PLINTH_HISTORY_MANIFEST_SHA256` equals the manifest's own hash, and each partition's hash matches the manifest | `MANIFEST_MISMATCH` |
| Presenter-control token is not equal to any agent credential (compared as hashes) | `CREDENTIAL_REUSE` |
| No `PLINTH_*` variable is unknown | `CONFIG_INVALID` |

- **Guarantee (AC-DEP-38, `doctor_fails_closed`).** Each row above has one negative test that breaks exactly that condition and asserts the stated code and a non-zero exit.

### 14.5 Acceptance criteria for configuration and secrets

- **AC-DEP-32** `no_env_branch`.
- **AC-DEP-33** `config_unknown_key_refused`.
- **AC-DEP-34** `config_keys_documented`.
- **AC-DEP-35** `secret_scan`.
- **AC-DEP-36** `secret_resolution_contract`.
- **AC-DEP-37** `agent_token_file_mode`.
- **AC-DEP-38** `doctor_fails_closed`.

---

## Decisions and open items

Each item below is a point the canonical facts leave open. The decision is recorded here so the rest of the specification can rely on it.

1. Five images, not four (README lists the driver; revised E.1 omitted it).
2. Virtual demo date `2026-11-20` UTC, start `14:30:00`, seed `2026`.
3. Presenter control is a separate container on the `data` network only, on port 8791, with no ALB route, reached through ECS Exec on AWS.
4. The ops-channel receiver is an internal endpoint of `api`. No external chat service is used.
5. The Keycloak issuer host is `auth.plinth.localhost` with a network alias, so browser and server share one issuer string.
6. Cognito claim names are mapped through configuration (`custom:plinth_workspace`, `custom:plinth_roles`).
7. JWKS is fetched by the worker and stored in the control store, so the request-serving tasks have no internet egress.
8. One NAT gateway for the egress tier, for the demo only.
9. Aurora has no reader instance; no component reads a replica.
10. Region `us-east-1` for both substrates.
11. DuckDB threads fixed at 1 in every profile, for replay determinism.
12. Partition refusal limit 2,000 per query.
13. Carrier-scan and warehouse-capacity topic names.
14. Evaluation cadence of one virtual minute (`PLINTH_RULE_EVAL_INTERVAL_VIRTUAL_MS`), matching the one-minute windows in the script.
15. Slack pool of 30 s shown on the presenter console.
16. Local observability uses one all-in-one LGTM image rather than separate Tempo, Prometheus and Grafana containers.
17. The revised proposal's MCP tool count is 14 in several places; the README's 15 (with `change.status`) is used here, so the transport parity test covers 15 tools.
18. Snapshots are COPY-format table dumps, restored by the application, so no database client binary is needed in the runtime image.
19. The Cognito access-token audience is checked through `client_id`, because Cognito does not set `aud` on access tokens.
20. Lockfile-based digest enforcement is a deploy-path gate; ECS does not verify signatures at launch, and that is stated as a limit.

**Word count (measured with `wc -w`):** 9,060, including markdown table punctuation. This is above the 3,000 to 6,000 target, because the configuration table and the parity table are complete by requirement.
