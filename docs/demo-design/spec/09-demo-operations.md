# 09 Demo operations: deterministic data, reset, replay driver and contingencies

Status: implementation-ready specification for mission sections 17 and 18, plus the replay driver.
Design only. Nothing in this document is built or run.

**Precedence.** `README.md` (canonical facts), then `../selection-rationale.md` (amendments P1–P20),
then this document, then `../revised/04-emergent-composition.md`. Grafted material is cited from
`../revised/05-operational-resilience.md` and `../revised/06-agent-native-innovation.md` where it is
used. Where a grafted proposal disagrees with the canonical facts, the canonical facts win; the
disagreements are listed in section 3.

**Labels.** Every property is marked **Guarantee** (enforced by code and covered by a named test) or
**Target** (a design goal, measured in rehearsal before it is claimed). Configuration values are
marked **Config** and live in `config/demo.toml`. Test names are the ones the CI and rehearsal suites
carry.

---

## 1. Section 17: deterministic demo data and reset

### 17.1 Virtual time

- **Virtual now** is `clock.virtual_now`, stored as integer epoch milliseconds in UTC. It is shown in
  `demo.timezone`. **Guarantee.**
- **Ticks.** Tick `0` is `14:30:00` on `demo.virtual_date`. Tick `k` is virtual time
  `14:30:00 + k × gen.tick_s` seconds, with `gen.tick_s = 1`. The 30 history days are ticks
  `-2,592,000 ≤ k < 0`. Live ticks are `k ≥ 1`. **Guarantee.**
- **Clock modes.**
  - `paused`: the tick is fixed and the generator writes nothing.
  - `live`: the tick advances at `clock.speed` (Config: `6`) times wall time, and the generator runs.
  - `stepped`: the tick changes only through `advance_to(k)` from the driver or the presenter console.
    Wall time has no effect. **Guarantee.**
- **Start.** Reset leaves the clock `paused` at tick `0`. The console's **Start** control moves it to
  `live` and writes a clock event to the run log. The canonical statement "paused at the start of the
  script" is read this way (section 3, D6). **Guarantee.**
- **Stall.** When the published `orders` watermark trails virtual now by more than
  `clock.stall_threshold_virtual_s` (Config: `10`), the console shows a stall indicator. **Target**,
  measured in rehearsal.
- **Virtual timestamps.** In demo mode, every Change records `changes.virtual_at`, the virtual now at
  commit. Audit windows (for example "0 changes in 14:00–14:20") filter on `virtual_at`, not on
  `created_at`. This column is defined in the `changes` DDL of 05 section 8.2
  (README ruling 7; section 3, D9). **Guarantee.**

### 17.2 Configuration and seed

The generator reads one committed file, `config/demo.toml`. Its values are part of the manifest
(section 17.5).

| Key | Value | Notes |
|---|---|---|
| `demo.virtual_date` | committed once, before the first build | A new date is a new manifest. Section 3, D1. |
| `demo.timezone` | IANA name, committed | Display only; all stored times are UTC. |
| `demo.t0` | `14:30:00` | Tick 0. Canonical. |
| `gen.seed` | `0x504C494E5448` | Section 3, D2. |
| `gen.tick_s` | `1` | Section 3, D8. |
| `gen.history_days` | `30` | Canonical. |
| `gen.orders_target_rows` | `2400000` | **Target**, tolerance ±2 %, reported by the build. |
| `clock.speed` | `6` | README ruling 7. |
| `clock.stall_threshold_virtual_s` | `10` | Section 17.1. |
| `gen.generator_version` | semver | Part of the manifest. Bumped on any change to output. |

**Random streams.** Each tick has its own generator state. The state is derived from the seed, a
stream id and the tick index by a splitmix64 chain, and it seeds one xoshiro256** generator. Stream
ids are fixed: `1` order arrivals, `2` order attributes, `3` stage latencies, `4` carrier scans,
`5` warehouse capacity. Consequences: any tick can be computed alone, and the build can run in
parallel without changing output. **Guarantee**, tested by `tick_independence` (AC-DATA-2).

**Integer-only sampling.** The generator uses no transcendental functions. Distributions are
committed integer tables under `gen/tables/`, with thresholds in 2^-32 fixed point. Arrival counts use
a Poisson CDF table for each arrival-rate bucket, where the rate is quantised to 1/1000 per tick. Cross-
machine identity therefore depends only on the table files, the generator version and the Node major
version pinned in the image. Result digests are computed with `threads=1` (canonical 04, section G.1,
item 4). **Guarantee.**

### 17.3 Northwind generator

The data model is Northwind Fulfilment. Regions: NA, EMEA, APAC, LATAM, ANZ. Carriers: Crane, Swift,
Harbor, Polar, Meridian. All time values are integer milliseconds.

- **`orders`** (one row per order, partitioned per virtual hour): `order_id` (UUIDv5 of
  `(demo.virtual_date, tick, index)`), `placed_at`, `region`, `warehouse`, `carrier`, `sku_count`,
  `status`, `pick_ms`, `pack_ms`, `handoff_ms`, `transit_ms`, `fulfilled_at`. Derived latency is
  `fulfilled_at - placed_at`, which is the sum of the four stages.
- **`carrier_scans`** (one row per handoff): `order_id`, `carrier`, `scanned_at`, `scan_type`.
- **`warehouse_capacity`** (one row per warehouse per 300 virtual seconds): `warehouse`, `at`,
  `capacity_units`, `used_units`.
- **Volume.** The arrival rate is normalised so that the 30-day mean is
  `gen.orders_target_rows / 2,592,000` orders per tick. The diurnal and weekday factors are
  normalised to mean 1 at build, and the normalising constant is recorded in the manifest.
  **Target** for the row count; **Guarantee** for the normalisation.
- **Handoff.** `handoff_ms` is the base handoff for the `(region, carrier)` pair, multiplied by the
  active fault factor for that pair at that tick (section 17.4), then rounded half-up to integer ms.

### 17.4 Fault profiles

A `FaultProfile` is data. The same schema serves the seeded history episode and the live cue (F7).

```json
{
  "profile_key": "history-emea-crane-1400",
  "origin": "history",
  "region": "EMEA",
  "carrier": "Crane",
  "applies_from_tick": -1700,
  "ramp_start": "14:00:00",
  "ramp_end": "14:05:00",
  "hold_end": "14:20:00",
  "recover_end": "14:25:00",
  "peak_permille": 3100
}
```

- **Weight function.** `w(k)` is in permille. It is 0 before `ramp_start`, rises linearly to 1000 at
  `ramp_end`, is 1000 until `hold_end`, falls linearly to 0 at `recover_end`, and is 0 after that.
  The factor is `1000 + (peak_permille - 1000) × w(k) / 1000`, in integer arithmetic. **Guarantee.**
- **History episode.** The seeded profile is `history-emea-crane-1400`, as canonical. Its
  `peak_permille` is set by a calibration step at build. The build searches a fixed grid and commits
  the chosen value into the manifest. The acceptance condition is that the 30-day backtest of the
  rule `p95-regional-breach` (threshold 900 ms, hold 3 min) fires exactly once, starting in
  14:02–14:04 and ending with the hold (AC-DATA-3). **Guarantee** for the condition; the value is a
  calibration output.
- **Live cue.** Applying F7 creates a profile with `origin = live`, `region = EMEA`,
  `carrier = Crane`, `applied_tick` set to the tick where it takes effect, and the ramp, hold and
  recovery offsets set to 5, 20 and 5 virtual minutes from that tick. Ramp times in the profile are
  relative to `applied_tick` for live profiles. **Guarantee.**
- **Cue application.** The cue takes effect at the next generator tick, and that tick is written to
  `fault_profiles.applied_tick`. In `stepped` mode, the driver supplies the tick (section 18.2), and the
  generator refuses a cue whose tick it has already passed with `FAULT_TICK_PASSED`. **Guarantee.**

### 17.5 History build and manifest

The build runs as a job, `plinth-gen build --config config/demo.toml --out <dir>`, from the
`plinth-gen` image. The build steps are, in order:

1. Validate the config and the table files against their committed digests.
2. Run the fault calibration grid (section 17.4) and commit the chosen `peak_permille`.
3. For each source and each virtual hour, generate the rows for those ticks, sort them by
   `(event_time, primary key)`, and write a Parquet file under a temporary key. Then fsync, rename to
   the final key, and record the partition as published. This is the same publication rule as
   `plinth-ingest` (canonical 04, D.2). **Guarantee.**
4. Build the control-store seed (section 17.6).
5. Compute the row digest of every partition and write `manifest.json`.
6. Compute `manifest_hash`.

**Manifest.** `manifest.json` has these fields: `manifest_version`, `generator_version`, `seed`,
`virtual_date`, `config_hash`, `tables_hash`, `normalisation`, `fault_profiles` (the history profiles
with their calibrated values), `partitions` (for each: `source`, `key`, `rows`, `event_min`,
`event_max`, `row_digest`), `control_seed_digest`, and `manifest_hash`.

- `row_digest` is the SHA-256 of the partition's rows, serialised as canonical JSON lines (sorted keys,
  UTF-8, integers only) in primary-key order. Parquet file bytes are not hashed, because the writer is
  not byte-stable across versions.
- `manifest_hash` is the SHA-256 of the canonical JSON of the manifest without that field.
- The manifest is stored immutably at `history/manifests/<manifest_hash>.json`, under the full digest
  (07 section 12.4). **Guarantee.**

**Test `history_reproduces`.** A clean build job regenerates the history from the seed with
`threads=1` and compares `manifest_hash` with the snapshot's manifest. A mismatch fails the build
(AC-DATA-1).

### 17.6 Control-store seed and snapshot

The control store is the PostgreSQL 16 database (or Aurora on AWS, same schema and migrations). Its
seed contains:

- **Principals.** The five principals in the canonical identity table, with `max_scope` set for
  `agent:claude-code` (the ceiling in `../revised/04`, D.5) and `driver:execute` for `service:replay-driver` (section
  18.1).
- **Workspace** `northwind`, with `history_manifest` and `run_id` columns.
- **Nodes.** Dashboard `ops-board` with three seeded panels (presenter script, decision 24): KPI tile
  `orders-delivered-1h` (fed by live orders), table `open-workflows` (over `workflow.instances`) and an
  `audit` panel. The agent creates `p95-by-region`, `carrier-heatmap`, `control-heatmap`,
  `config-changes` and the acknowledge form live (beats 2, 3 and 9); they are not seeded. Dashboard
  `exec-view` and dashboard `finance-board`, owned by `user:finance-analyst`. An existing grant on
  `ops-board`: `user:emea-lead` may read rows with `region = 'EMEA'`.
- **Workflow definition** `incident`, with states `open`, `acknowledged`, `resolved` and `closed`
  (README ruling 17) and one transition.
- **Seeded change history.** A small number of changes on days before the demo date, with
  `virtual_at` values. **No** change has `virtual_at` in `[13:55, 14:25]` on the demo date
  (AC-DATA-4). This is what makes the audit beat show "0 changes in window" honestly.

**Snapshot.** The build job runs `plinth-gen snapshot`. It writes a custom-format dump of the control
store and a `snapshot.json` with: the manifest hash, the migration id, and an ordered-row SHA-256 for
every table. **Guarantee.**

### 17.7 Live prefix and per-run storage

- History partitions live under `partitions/` (07 section 12.4) and are never written again.
- Live partitions written during a run go under `runs/<run_id>/`. Their rows are recorded in
  `source_partitions` with `partition_key` prefixed by the run id.
- The snapshot holds only history partitions, so restoring it removes every live partition row from
  earlier runs. Reset then deletes the object prefix of the previous run. **Guarantee.**
- Queries read the history partitions for event time before `demo.t0` and the run partitions for
  event time at or after it. **Guarantee.**

### 17.8 Reset

`make demo-reset` runs `plinth-gen reset` and then the readiness gates (section 17.9). Reset never
regenerates history. Steps:

| Step | Action | Failure behaviour |
|---|---|---|
| R1 | Refuse if the driver is `RUNNING` or the clock is `live`. `--force` first sets the clock `paused` and stops the driver (section 18.4). | Exit 2 without `--force`. |
| R2 | Stop the generator. Set the clock to `paused`, tick `0`. | Abort. |
| R3 | Restore the control store from the snapshot in one transaction (`pg_restore --clean --single-transaction`). Verify every table's ordered-row digest against `snapshot.json`. | Roll back. The prior state remains. Reset is atomic. **Guarantee**, test `reset_atomic`. |
| R4 | Re-point the workspace to the manifest and set a new `run_id`. Verify `manifest.json` against its recorded digest. | Abort. |
| R5 | Delete the object prefix of the previous run. | Retry, then warn. History is not touched. |
| R6 | Delete Redis presence and rate-limit keys (`plinth:presence:*`, `plinth:rl:*`). Redis is not authoritative, so this is safe. | Warn. |
| R7 | Run the readiness gates. | Exit 1 on any FAIL. |

**Printed output.** Reset prints one block. The durations shown are measured values:

```
plinth demo-reset  run=r-0007  target=local
  control store   snapshot demo-7c1e04a9  restored, 14 tables digest-verified
  history         manifest sha256:9f2c…e1 re-pointed (30 days, 720 hours x 3 sources)
  run prefix      runs/r-0007/ created; runs/r-0006/ removed (212 objects)
  virtual clock   2026-…T14:30:00Z  paused  tick=0
  rule state      p95-regional-breach: not defined; workflows open=0
  readiness       PASS 10/10 (G11 redis: WARN if down)
  elapsed         14.2 s  (Target: 20 s)
```

**Target.** Reset elapsed time is at most 20 s, measured in rehearsal on the reference laptop
(canonical 04, E.4). **Guarantee** for the postconditions (AC-RESET-2).

### 17.9 Readiness gates

`/readyz` returns one entry per gate. `/healthz` is liveness only.

| Gate | Check | Blocking |
|---|---|---|
| G1 | Control-store migration id matches; table digests match `snapshot.json`. | yes |
| G2 | Workspace manifest hash equals the snapshot's; manifest object digest verifies. | yes |
| G3 | Every manifest partition exists and is `published = true`. | yes |
| G4 | Watermarks equal tick 0 in `paused` mode, and are at or after the virtual now in `live` mode. | yes |
| G5 | DuckDB extensions load from the bundled path; one history partition reads from the object store. On AWS, the private-subnet route check passes (section E.4 of 04). | yes |
| G6 | The engine attaches to the control store. | yes |
| G7 | MCP `tools/list` returns exactly 15 tools, and its hash equals the committed `tool_surface_hash`. No presenter or fault tool appears. | yes |
| G8 | `/rt` subscribe and snapshot round trip succeeds. | yes |
| G9 | `GET /audit/verify` passes. | yes |
| G10 | The presenter control API answers with its own credential. Live fault profiles count is 0. | yes |
| G11 | Redis ping. Commits do not depend on Redis, so a failure is WARN. | no |

**Guarantee**: a FAIL on any blocking gate makes `make up` and `make demo-reset` exit non-zero
(AC-READY-1).

### 17.10 Section 17 acceptance criteria

| ID | Property | Label | Test |
|---|---|---|---|
| AC-DATA-1 | Two independent builds with the same config, generator version and Node major give the same `manifest_hash`. | Guarantee | `history_reproduces` |
| AC-DATA-2 | Generating a tick range alone gives the same row digests as that range inside a full build. | Guarantee | `tick_independence` |
| AC-DATA-3 | The 30-day backtest of `p95-regional-breach` fires once, starting 14:02–14:04, and nowhere else. | Guarantee | `backtest_fires_once`, `episode_in_history` |
| AC-DATA-4 | The seed has no change with `virtual_at` in `[13:55, 14:25]` on the demo date. | Guarantee | `no_config_change_in_window` |
| AC-DATA-5 | `orders` row count is within ±2 % of `gen.orders_target_rows`. | Target | build report |
| AC-DATA-6 | A live cue at a recorded tick produces the same events as the recorded run, in stepped mode. | Guarantee | `replay_reproduces` (section 18) |
| AC-RESET-1 | A failure at any step R1–R6 leaves the prior control state unchanged. | Guarantee | `reset_atomic` |
| AC-RESET-2 | After reset: manifest hash equals the snapshot's, history object digests are unchanged, the previous run prefix is gone, and the clock is at tick 0, paused. | Guarantee | `reset_postconditions` |
| AC-RESET-3 | Reset elapsed time is at most 20 s on the reference laptop. | Target | rehearsal report |
| AC-RESET-4 | Reset output has the manifest hash and every gate; exit is non-zero on any blocking FAIL. | Guarantee | `reset_output_contract` |
| AC-READY-1 | A blocking gate failure fails readiness; a Redis failure is WARN only. | Guarantee | `readiness_gates` |
| AC-READY-2 | The MCP tool list has 15 tools and no fault or presenter tool. | Guarantee | `fault_not_in_tools` |

---

## 2. Section 18: failure recovery and contingency

### 18.1 Replay driver: identity and principals

The driver is `plinth-driver`, a Node.js MCP and HTTP client, with the entrypoints `replay` and `record`
(07 section 11.1). It has four commands: `replay --from n`, `status`, `verify-transcript` and `record`.
`make demo-replay STEP=n` runs `replay --from n`.

**Principal (P9).** Every write the driver makes is performed as `service:replay-driver`, which is
its own workspace principal. For each replayed Change:

- `actor_id = service:replay-driver`;
- `on_behalf_of = user:ops-lead` (the delegating human for both agent and human steps);
- `surface = 'driver'`;
- `replay_of = '<transcript_id>:<step>'` (README ruling 6), and `recorded_actor` in its own column
  (05 section 8.2): `agent:claude-code` for agent steps and `user:ops-lead` for human steps. Both are
  part of the hashed row (section 3, D9).

**Authority (README ruling 16).** The driver holds `driver:execute`. Each replayed step runs with the
recorded principal's effective permissions, evaluated as that principal with `on_behalf_of =
user:ops-lead`. The driver holds no other grant. It never holds `grant:write` or `approval:decide`, and
it never approves.

**Recorded actor.** For agent steps, `recorded_actor` sets the rule owner (`owner = agent:claude-code`,
`on_behalf_of = user:ops-lead`, as in D.5) and the audit display. It does not confer authority.
**Guarantee**, test `replay_rows` (AC-DRV-2).

**No presenter session.** The driver never uses a presenter token or session. Its credential is a
service credential read by name from `Secrets` (canonical 04, E.2). **Guarantee.**

**Approvals are never replayed.** Approving a held Grant is a human act in the finance window, by
`user:finance-analyst`. The driver cannot approve, and it cannot approve on behalf of anyone (AC-DRV-3).
This keeps P7 intact in replay: the requester and the delegator cannot approve. The acknowledge in S14
is likewise never replayed: the presenter performs it live (20 beat 10), so its audit row stays a human row.

**Live-agent write lock.** While the driver is in `REPLAY` mode, the MCP server refuses writes from
`agent:claude-code` with `FORBIDDEN` and `reason: "replay_in_control"`. Reads still succeed. This
prevents a live agent and the driver from writing in parallel. The lock lifts when the mode returns to
`LIVE`. **Guarantee**, test `f9_boundary` (AC-DRV-10).

### 18.2 Transcript format

A transcript is `demo/transcripts/main.jsonl`. Its first line is a header with `transcript_id`,
`seed`, `manifest_hash`, `generator_version`, `tool_surface_hash`, and the transcript's own digest
recorded in the release. Each following line is one step:

```json
{"step":"S06","index":6,"beat":"5","window_s":[125,160],"kind":"agent",
 "recorded_actor":"agent:claude-code","prompt":"Who can see the finance board? Let the EMEA lead see only EMEA rows on it.",
 "tick":412,"as_of":"2026-…T14:32:10.000Z",
 "calls":[{"n":1,"tool":"grant.check","args":{"resource":"$finance-board","action":"read","with_counts":true},
           "expect":"ok","result_hash":"sha256:…"}],
 "change":{"kind":"Grant","target":"$finance-board","change_hash":"sha256:…","expect":"held"},
 "predicate":"held_change(Grant,finance-board,in[pending_approval,approved])",
 "budget_s":20,"expects_error":false}
```

- **Stable names.** Arguments use slugs prefixed with `$`, never ids. The driver resolves names to
  the ids it finds (canonical 04's UUIDv5 rule and 05's stable-name rule).
- **Step kinds.** `clock`, `presenter`, `agent`, `human`, `approval` (never replayed), and `platform`
  (wait only).
- **Result hashes.** As canonical 04, C.3: over columns and rows, numeric values rounded to six
  significant digits, excluding watermarks and timings, computed at the recorded `as_of`.
- **Fault cues.** A `clock` or `presenter` step records `tick`. A cue carries `applied_tick`, which
  is required for replay (section 18.6).
- **Integrity.** `verify-transcript` checks the header's `manifest_hash` against the workspace, and
  the transcript digest against the release. **Guarantee**, test `transcript_integrity` (AC-DRV-1).

### 18.3 Satisfaction predicates (P10)

Each step has a predicate over current state. Predicates are the only thing that decides whether a
step is done. They never mention revisions, generated ids or keys chosen by the live agent. This is
the rule from `../revised/06`, C.4, applied to the canonical beats.

**Closed grammar.**

```
pred   := 'true' | atom | pred 'and' pred | pred 'or' pred | 'not' pred
atom   := 'exists(' kind ',' natural_key ')'
        | 'panel(' dashboard ',' shape ')'          shape: {visual, group[], agg{}, bound{}}
        | 'field(' ref ',' path ')' cmp literal
        | 'row_count(' panel ',' filter ')' cmp int
        | 'held_change(' kind ',' target ',in[' status[,status]* '])'
        | 'grant_active(' resource ',' principal ',' predicate_text ')'
        | 'grant_absent(' resource ',' principal ')'
        | 'rule_state(' slug ')' '==' rule_state
        | 'workflow_state(' natural_key ')' '==' wf_state
        | 'parameter(' dashboard ',' name ')' '==' literal
        | 'fault_applied(' profile_key ')'
        | 'audit_contains(' action ',' target ',' actor ')'
cmp    := '==' | '>=' | '<='
```

Natural keys are slugs and labels. A workflow instance's natural key is `incident:<region>/<carrier>/<profile_key>`.
Predicates run under the driver principal and read state, not history, except `row_count`, which runs
`query.run` with the step's recorded `as_of`. **Guarantee**, test `predicate_grammar` (rejects any
predicate outside the grammar).

**Per-step predicates** (satisfied when the predicate is true; `W` is the window from `../presentation-script.md`):

| Step | W (s) | Kind | Predicate |
|---|---|---|---|
| S00 | start | clock | `clock.mode == live` (console Start) |
| S01 | 0–25 | presenter | `exists(Panel, orders-delivered-1h)` and `field(orders-delivered-1h, feed_watermark_tick) >= 1`; the driver also records the KPI value at S00 and requires it to differ at the end of S01 (beat 1: the KPI changes after T0). No write. |
| S02 | 25–55 | agent | `exists(Panel, p95-by-region)` and `panel(ops-board, {visual: line, group:[region], agg:{p95_latency_ms: percentile 0.95}})` |
| S03 | 55–95 | agent | `exists(Panel, carrier-heatmap)` and `panel(ops-board, {visual: heatmap, group:[carrier,region]})` and `parameter(ops-board, incident_window) == "14:00–14:20"`; `exists(Panel, control-heatmap)` on the D-1 window (negative control, P12); `field(config-changes, value) == 0` (`audit.changes` count for the window) |
| S04 | 95–125 | presenter | `true` (brushing and cell click are session state; not replayed) |
| S05 | 95–125 | agent | `exists(Rule, p95-regional-breach)` and `rule_state(p95-regional-breach) == ok` |
| S06 | 125–160 | agent | `held_change(Grant, finance-board, in[pending_approval, approved])` |
| S06H | 125–160 | approval | `grant_active(finance-board, user:emea-lead, "region = 'EMEA'")` (human; never replayed) |
| S07 | 160–190 | agent | `exists(Panel, p95-by-region)` (agent reads and holds; no write) |
| S08 | 160–190 | human | `field(ops-board, title) == <edited title>` (replayed as ops-lead, surface `driver`) |
| S09 | 160–190 | agent | `field(ops-board, title) == <edited title>` and `field(p95-by-region, width) == <committed width>` |
| S10 | 190–205 | human | `grant_absent(finance-board, user:emea-lead)` and `audit_contains(grant.widened, finance-board, user:ops-lead)` (R-GRANT-UNDO, README ruling 4) |
| S11 | 205–235 | presenter | `fault_applied(live-emea-crane)` (F7) |
| S12 | 205–235 | platform | `rule_state(p95-regional-breach) == firing` and `workflow_state(incident:EMEA/Crane/live-emea-crane) == open` |
| S13 | 235–258 | agent | `exists(Form, ack-incident)` and `panel(incident-timeline, {visual: table, bound: {instance}})` |
| S14 | 258–268 | human (live only) | `workflow_state(incident:EMEA/Crane/live-emea-crane) == acknowledged`; performed by the presenter's Phone tap as `user:ops-lead`, surface `ui` (20 beat 10). Never replayed (section 18.1). |
| S15 | 268–300 | agent | `exists(Panel, incident-blast-radius)` and `row_count(incident-blast-radius, dependents) >= 1` |

**Unsatisfiable predicates.** A predicate is unsatisfiable when no action the driver is permitted to
take can make it true (for example a required Change is refused by a rule the driver cannot satisfy,
or a required node was deleted by a later change). The driver then halts with
`HALTED(predicate_unsatisfiable)` and reports the reset requirement (section 18.4). **Guarantee**,
test `takeover_halt_unsatisfiable`.

### 18.4 Modes, states and the F9 switch

**Driver states.** `IDLE` → `READY` (readiness gates passed, transcript verified) → `RUNNING` (executing
step `n`, with sub-state `WAIT_LIVE`, `REPLAY_STEP` or `CATCH_UP`) → `DONE`. Any state can enter
`HALTED(reason)`. Reasons are a closed set: `predicate_unsatisfiable`, `unexpected_error`,
`ambiguous_commit`, `token_consumed_without_record`, `deadline`, `reset_required`, and
`fault_tick_drift`.

**Modes.** `LIVE` or `REPLAY`. Every trace row carries the mode of the call that produced it, as `live` or `replay`
(README ruling 12). Catch-up calls are tagged `replay`.

- **LIVE → REPLAY.** By an automatic trigger (section 18.5), or by F9. A trigger acts on the step in
  flight immediately. The driver sends `notifications/cancelled` for the live call, effective only if
  its commit transaction has not started (canonical 04, D.6). Then the takeover procedure runs (18.6).
- **REPLAY → LIVE.** Only by F9, and only at a step boundary. The driver stops issuing calls and does
  not cancel the live agent. The write lock lifts.
- **F9 is a toggle.** It is one keystroke, shown as `driver: live / replay` in the console status bar.
  The room display changes only in the trace tag (section 3, D10). **Guarantee**, test `f9_boundary`.

**Presenter control API.** Separate port (Config: `PLINTH_PRESENTER_PORT`, default `8791`, 07 section 14.2) and a
separate credential. It is absent from the MCP tool list (P15). Endpoints (the 03 section 11 list):
`POST /control/clock` (body `start` or `pause`), `POST /control/fault/cue` (F7; returns
`applied_tick`), `POST /control/driver/mode` (`live` or `replay`), `POST /control/driver/step` (`{n}`),
`GET /control/driver/status` and `GET /control/status`.

### 18.5 Takeover triggers

The driver arms a takeover when any of these holds during an expected call:

| ID | Trigger | Config |
|---|---|---|
| T1 | No MCP call from `agent:claude-code` for `driver.silence_s` after the previous call, or for `driver.first_call_s` after step start. | `silence_s = 8` (20 decision 20), `first_call_s = 20` |
| T2 | Two consecutive error responses on a call where `expects_error` is false, or any `LOOP_SUSPECTED`. | `abort_errors = 2` |
| T3 | The step budget is exceeded without the predicate becoming true. | query-only step `12` s; multi-call step `20` s |
| T4 | F9 pressed. | — |

Silence is read from the realtime call stream (`call_log`, one row at call start and one at finish,
written by the server). Silence is detected from the absence of call rows, not from the audit log,
which records writes and refusals only. **Guarantee**, test `takeover_silence`.

**Not triggers.** Errors the recording expects (`expects_error: true`), including the `CONFLICT` in
S09 (P13); `PREVIEW_REQUIRED` followed by the recorded re-preview; approval pending; and
`RATE_LIMITED` where the recording expects it.

### 18.6 Takeover procedure

1. Mark the step `TAKEOVER`. Send `notifications/cancelled` for in-flight live calls.
2. Resolve any in-flight commit (section 18.8).
3. Evaluate predicates from the current step in order. Log `SKIP(satisfied)` for each satisfied step.
   The first unsatisfied step is replayed.
4. Replay that step's recorded calls in order:
   - Reads run with the recorded arguments, with names resolved by the driver.
   - `node.preview` followed by `node.commit`. Before previewing, the driver checks the change log for
     the transcript's `change_hash` under its own principal and the key `replay:<transcript>:<step>`.
     If found, the step's commit is marked done and its stored result is used (canonical 04, C-W2).
   - A `create` whose node exists by slug is not duplicated. If its predicate is true, it is skipped.
     Otherwise the driver previews a patch from the current node to the recorded body and commits it.
     **Guarantee**, test `slug_collision` (AC-DRV-6).
   - `PREVIEW_STALE` is re-previewed once. An expected `CONFLICT` is accepted. Any other error is
     handled by T2.
5. Continue until the step's predicate is true.
6. The trace marks these calls `replay`. The mode is `REPLAY` until F9 returns it to `LIVE`.

**No inversion.** Takeover never issues `node.undo`, never reverts, and never modifies a change row
(`../revised/05`, D.7, without the revert). If the live agent's partial work makes a predicate
unsatisfiable, the driver halts with `predicate_unsatisfiable` rather than undoing anything. **Guarantee**,
test `takeover_no_inversion` (AC-DRV-4).

**No duplicate commits.** A commit is issued only when the predicate is false and the change hash is
absent from the log. **Guarantee**, test `takeover_no_duplicate` (AC-DRV-5).

### 18.7 Budgets and the slack pool (P19)

- Each step has `window_s` (from section 18.3) and a `budget_s` (12 or 20 s, as in 18.5).
- **Slack pool.** `driver.slack_pool_s = 30` (Config; README ruling 8). Shown on the presenter console. Any overrun of a
  step's window is charged to the pool, and the pool never goes below zero. Reset refills it.
- **Exhaustion.** When the pool is empty and the live path is still running, the driver takes over at
  the next step boundary (`REPLAY` for that step) and records `slack_exhausted`. Only these steps may
  be skipped under exhaustion: S01, S04 and S07. Every other step is replayed, so the finale is never
  delayed by a skip it depends on.
- **Hard maximum.** `driver.hard_max_s = 300`, counted from S00. The driver never extends the run. If
  S15 is not complete at 300 s, the driver halts with `deadline` and the console says so. **Guarantee**,
  test `deadline_enforced` (AC-DRV-11). The rehearsed path is required to finish within it.

### 18.8 Ambiguous commit resolution

Cancellation is honoured only before the commit transaction begins (canonical 04, D.6). Once it begins,
the commit runs to completion. A caller that has cancelled, or whose connection dropped, resolves the
outcome as follows:

1. Query `change.history(idempotency_key = K, principal = P)` using the key `K` the call used.
2. **Present:** the commit happened. Use the stored result, marked `replayed: true`.
3. **Absent:** the commit did not happen. If the preview token is unconsumed (`consumed_at IS NULL`),
   the token is reused. If it is consumed with no idempotency record, halt with
   `token_consumed_without_record`. By construction this cannot happen, so it indicates a platform
   defect.
4. **Unknown while the transaction is in flight:** wait `driver.ambiguous_wait_s = 3`, then query once
   more. If still unknown, halt with `ambiguous_commit`.

**Guarantee**, test `cancel_random` (canonical 04, G.1 item 8): commits cancelled at random points
resolve to the chain's state in every run (AC-DRV-7).

### 18.9 Catch-up and resume

**Catch-up.** Whenever the driver starts at step `n > 0` (resume, or a switch to another target), it
first runs steps `0..n-1` in `CATCH_UP`:

- the clock is `stepped`, advanced to each recorded tick;
- there are no budgets and no pacing;
- each step checks its predicate first and performs only unsatisfied work;
- the room display shows a "catching up" caption, so the audience sees a labelled state.

Catch-up uses the takeover procedure of 18.6 with the same keys and the same recorded `as_of` values,
so the result is the same state the original run reached. **Guarantee**, test `catchup_cross_target`
(AC-CONT-3).

**Resume precondition.** Resume at step `n` is allowed only if every fault cue recorded before step `n`
has `applied_tick` equal to its recorded tick. Otherwise the driver halts with `reset_required`. The
reason is that a cue applied at a different tick changes every later row that depends on it, and the
clock cannot go back. Rows at or before a recorded `as_of` do not change after the fact, so later
steps reproduce. **Guarantee**, test `resume_refused_drift` (AC-RECOV-2).

**Stepped clock during replay.** The clock moves only by `advance_to`, so a replay cannot run ahead of
its recorded ticks. This is the mechanism that makes cue ticks, `as_of` pinning and replayed result
hashes agree with the recording, whatever the wall-clock timing. **Guarantee.**

### 18.10 Pre-show checklist

Items are ordered by dependency. Each item is a check, and the checklist is complete only when every
item passes on the target that the show will use.

| # | Check | Command or evidence |
|---|---|---|
| C1 | The five image digests equal the release manifest. | `plinth images verify` |
| C2 | Readiness: G1–G10 PASS, G11 PASS or WARN. | `make up` exit 0 |
| C3 | The manifest on the target verifies, and its hash equals the committed value. | `plinth-gen verify --manifest` |
| C4 | Reset for this show ran; its output matches section 17.8. | `make demo-reset` |
| C5 | The transcript digest and `manifest_hash` in the header match C3. | `plinth-driver verify-transcript` |
| C6 | `make rehearse` passed on this digest set. Its report hash is recorded, with the takeover rate per step and `replay_reproduces` on the target. | rehearsal report |
| C7 | Four windows are signed in: Ops board and Phone as `user:ops-lead`, Exec view as `user:emea-lead`, Finance as `user:finance-analyst`. Presence shows three humans. | window check |
| C8 | Claude Code shows the MCP server connected over stdio, with 15 tools. The agent cannot see presenter tools. | G7 result |
| C9 | Console: driver `READY`, mode `LIVE`, slack pool full, F7 and F9 armed, no stall, clock at tick 0, paused. | console status |
| C10 | The trace explanation for `live` and `replay` tags is rehearsed in one sentence (section 3, D10). | presenter |
| C11 | The rehearsal-only adversarial annotation (P14) is absent from the show workspace. | `node.search` |
| C12 | On AWS: the private-subnet startup check (G5) passed on the current digests. On local: all containers are healthy. | G5 result |

### 18.11 Contingency table

Each row names a detection, the driver's automatic response, the presenter's action and the recovery.
Each row has a rehearsal scenario (AC-CONT-1).

| Failure | Detection | What the audience sees | Automatic response | Presenter action | Recovery |
|---|---|---|---|---|---|
| **Model slow** | T1 or T3 | A pause on the terminal | Driver replays the in-flight step; trace shows `replay` | Speak over the gap; do not wait for a tool | Next step proceeds live if F9 returns it to `LIVE` at a boundary |
| **Model wrong: wrong call** | Typed error (`UNKNOWN_FIELD`, `UNKNOWN_REFERENCE`) | Error, then a retry | One agent retry (`fix_hint` and `available`); a second error is T2 | None | Replay of the step on T2 |
| **Model wrong: wrong result** | Predicate false after the agent's turn | The panel is wrong | The driver replays the step until its predicate is true | Point to the query, watermark and row count on screen | Step complete on replay |
| **Model wrong: prose** | None (not a driver concern) | A confident sentence | None; prose may quote only on-screen numbers (canonical 04, B-2) | Point to the evidence | None |
| **Model unreachable** | T1 with connection error in the agent pane | Terminal error | Driver takes over the step and continues | "The client dropped; the platform carries on." | Trace shows `replay` until F9 |
| **Model loops** | `LOOP_SUSPECTED` (P5) or repeated `VALIDATION_FAILED` | Repeated refusals | T2 takeover | None | Replay |
| **WebSocket drop on a screen** | Socket close | Screen shows "reconnecting" | Client resumes from its last revision; refetches on a sequence gap | Reload that window if reconnect exceeds 10 s | Snapshot on reconnect (`/rt`) |
| **Query slow** | Loading past 2 s; `QUERY_TIMEOUT` at `timeout_ms` (default 5000) | Spinner, progress | Coalescing; progress notifications; step budget applies | Speak over it | Replay of the step on T3 |
| **Rule not firing in time** | No `rule.firings` row within 10 virtual s of the expected firing tick | Rule stays `pending` | The driver never writes a firing. Worker restart is idempotent by `firing_id`. | Say the rule is catching up; console shows evaluator lag | If still not firing at the S12 budget: proceed to S13, and S14 when the instance exists. The finale still runs; its workflow count shows what exists. |
| **Approval window issue** | `change.status` stays `pending_approval`; finance window disconnected or session expired | The Grant is held | S06H waits. A head change makes approval fail with `PREVIEW_STALE`, and the agent re-proposes. | Re-authenticate the finance window. The presenter must not approve. | If not approved by `approval.hold_ttl_s` (Config: `600`): S06H is `not_done`, S10 is skipped with narration, and the run continues. Rehearsed as `approval_timeout_path`. |
| **AWS unreachable** | Readiness fails, or a stuck screen | Screens disconnect | Pre-show: use local (C1–C12 on local). Mid-show: the target switch (console) reloads windows to local. | Say "switching to the local stack." | Reset local, then catch-up to step `n-1` (18.9), then resume at `n` |
| **Local stack down** | Readiness fails, or containers exit | Screens disconnect | Symmetric to AWS unreachable | As above | As above, with AWS |
| **Fault cue lost** | No `fault_applied` within `driver.cue_fallback_s = 5` | Rule stays `ok` | Driver issues the cue at the next tick. In `REPLAY` it uses the recorded tick; if that tick has passed, `fault_tick_drift` halts. | Say "the feed is catching up" | Resume rule (18.9) |
| **Virtual clock stalls** | Stall indicator (17.1) | Charts stop moving | None to the clock. Step budgets apply. | Say the feed is catching up and wait | T3, then replay on the stepped clock |
| **Interrupted demo** | Browser crash, sleep, power loss | Blank or frozen screens | None | Section 18.12 | Section 18.12 |
| **Redis down** | G11 WARN; presence badges disappear | No presence badges | Commits do not depend on Redis. Fan-out is recovered from the outbox on resume. | Speak to it or ignore it | Restart Redis |
| **Undo leaves a screen stale** | Revision gap on the screen | One screen behind | Undo is a Change, so the stream carries it | Reload the window | Snapshot on reconnect |
| **Driver halted** | `HALTED(reason)` on console | Console only | Stops; no further writes | Read the reason. `predicate_unsatisfiable` or `reset_required` means reset and run from `STEP=0`. `deadline` means proceed to the finale and narrate. | Section 18.12 |

### 18.12 Recovery after an interrupted demo

1. **Pause the clock** from the console, or with `POST /control/clock` (`pause`). The driver goes to `IDLE`.
2. **Read the checkpoint.** `plinth-driver status` prints the last completed step `n_last` from
   `driver_checkpoints` (a new table: `run_id`, `step`, `tick`, `predicate_results`, `written_at`;
   written after each step's predicate is true, in the same transaction as that step's last Change).
3. **Resume** with `make demo-replay STEP=n` where `n = n_last + 1` by default. The precondition in
   18.9 is checked first. Catch-up covers any unsatisfied earlier steps.
4. **If the precondition fails,** run `make demo-reset` and then `make demo-replay STEP=0`.
5. **Re-open** the windows and show the console. The presenter says "we're picking up where we left
   off," which is the truth and is what the audience sees.

**Guarantee**, test `resume_equivalence` (AC-RECOV-1): for every step boundary in a recorded run, resume
from there produces the same final body hashes for the Ops board, the finance board, the rule and the
workflow instance as the uninterrupted run.

### 18.13 Section 18 acceptance criteria

| ID | Property | Label | Test |
|---|---|---|---|
| AC-DRV-1 | Transcript and manifest digests are verified before `READY`. | Guarantee | `transcript_integrity` |
| AC-DRV-2 | Every replayed Change has `surface = 'driver'`, `actor = service:replay-driver`, `on_behalf_of` and `replay_of` set. | Guarantee | `replay_rows` |
| AC-DRV-3 | The driver cannot approve or force-apply a Grant. Such an attempt is `FORBIDDEN` naming `grant:write` (README ruling 2). | Guarantee | `driver_no_approval` |
| AC-DRV-4 | Takeover never undoes, reverts or modifies a change row. | Guarantee | `takeover_no_inversion` |
| AC-DRV-5 | Satisfied steps are skipped. No commit is issued twice. | Guarantee | `takeover_no_duplicate` |
| AC-DRV-6 | A `create` on an existing slug patches, and does not duplicate. | Guarantee | `slug_collision` |
| AC-DRV-7 | Commits cancelled at random points resolve to the chain's state. | Guarantee | `cancel_random` |
| AC-DRV-8 | Ten local and ten AWS replays give equal result hashes and equal body hashes for the Ops board, finance board, rule and workflow. Watermarks are not compared. | Guarantee (under `threads=1`) | `replay_reproduces` |
| AC-DRV-9 | The takeover rate per step is measured in at least 10 model-in-the-loop runs. Steps above the pre-registered threshold are replay by default and the trace says so. | Guarantee for the report obligation (at least 10 recorded runs); Target for the measured rate | rehearsal report (P18) |
| AC-DRV-10 | F9 changes mode only at a step boundary, and the live agent's writes are refused with `replay_in_control` while in `REPLAY`. | Guarantee | `f9_boundary` |
| AC-DRV-11 | The run never exceeds 300 s. | Guarantee | `deadline_enforced` |
| AC-DRV-12 | Overruns are charged to the pool. Exhaustion replays the next step, and only S01, S04 and S07 are skippable. | Guarantee | `slack_exhaustion` |
| AC-DRV-13 | A predicate outside the grammar is rejected. An unsatisfiable predicate halts with `predicate_unsatisfiable`. | Guarantee | `predicate_grammar`, `takeover_halt_unsatisfiable` |
| AC-CONT-1 | Every row of the table in 18.11 has a rehearsal scenario that passes. | Guarantee | `contingency_suite` |
| AC-CONT-2 | The approval timeout path skips S10 with narration, and the presenter never approves. | Guarantee | `approval_timeout_path` |
| AC-CONT-3 | Catch-up on AWS and on local reaches the same state. | Guarantee | `catchup_cross_target` |
| AC-RECOV-1 | Resume at any step boundary equals the uninterrupted run. | Guarantee | `resume_equivalence` |
| AC-RECOV-2 | Resume is refused with `reset_required` when a cue's applied tick differs from its record. | Guarantee | `resume_refused_drift` |

---

## 3. Decisions taken in this document

Canonical facts that were open or ambiguous, and how this document settles them.

- **D1.** The virtual demo date has no value in the canonical facts. It is a committed config value, set before the first build.
- **D2.** Seed `0x504C494E5448`. Any committed 64-bit value would serve.
- **D3.** Agent steps in replay write as `service:replay-driver` (P9), with `replay_of.recorded_actor` set. The driver holds no agent credential.
- **D4.** Human steps are replayed by the driver as `on_behalf_of ops-lead`. P9 ("never the presenter's session") overrides 04, C.3.
- **D5.** The finance analyst approves the Grant (canonical facts, P7). 04, C.2 says the presenter does; the canonical facts win. The driver never approves.
- **D6.** "Paused at the start of the script" means paused at tick 0 at reset, started by the console's Start at S00.
- **D7.** Replay uses a `stepped` clock, so cue ticks and `as_of` values reproduce. This adds a mode to 04.
- **D8.** Tick size is 1 virtual second.
- **D9.** Schema additions, all additive, owned by 05 section 8.2 unless noted: `changes.virtual_at`,
  `changes.replay_of`, `changes.recorded_actor`, `driver_checkpoints`, and `fault_profiles` (with `origin`
  and `applied_tick`), a profile table separate from `fault_cues`. The trace table is `call_log` (08 section 16.5).
- **D10.** The live/replay trace tag stays on screen (04, C-W7). The switch remains one keystroke.
- **D11.** The fault peak is a calibrated build output. The recovery ramp after 14:20 is 5 virtual minutes, since the canonical facts do not say what follows the hold.
- **D12.** Takeover never undoes. 05 (C.4, D.7) undoes the live agent's own changes; P10 forbids inverting other principals' changes, and this extends the rule to all inversion. The driver halts instead.
- **D13.** Reset refuses during an active run unless `--force` (05, D.7).
- **D14.** Rejected from 06: the seeded commit at audit sequence 1187 and T0 = 14:20. Both contradict the canonical facts. Kept from 06: the predicate grammar and the `replay:` key scheme.
- **D15.** Resume and target switches use catch-up (18.9). This is the only way `make demo-replay STEP=n` works on fresh state.
- **D16.** Writes during replay are refused with `FORBIDDEN`, reason `replay_in_control`. The closed code set (04, D.8) is unchanged.
- **D17.** Slack and timing values are Config defaults. They are set against the rehearsal report before the first scored run (P18).
