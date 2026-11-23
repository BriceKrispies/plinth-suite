import { Effect } from "effect";
import { nodeId, nodeUri, workspaceId } from "@plinth/core";
import type { CommitResult, Kind, NodeChange, Surface } from "@plinth/spec";
import {
  AppConfig,
  ChangeLog,
  Identity,
  callAction,
  parseVirtualStart,
  useDeterministicIds,
  type EmitCtx,
  type HandlerError,
  type Principal,
  type SuiteEnv,
} from "@plinth/engine";
import { Xoshiro, splitmix64 } from "../rng";
import { ALL_STEPS } from "./steps";

/**
 * The Suite seed framework (CONTRACT.md section 11, K12). A deterministic script of steps run after the kernel reset.
 * Configuration (Program, Roles, Grants, Categories, Products, Badges, ...) is committed first on the system surface as
 * `service:ingest`; activity is then replayed THROUGH THE ACTION HANDLERS (`ctx.act`) with the clock overridden to each
 * command's virtual timestamp, and after each command the engines drain inline (`ctx.drain`), so badge awards,
 * automation runs, notifications and ledger history are consistent by construction.
 *
 * Wave-2 builders fill the step files under `./steps/` (one per domain) and nothing else. Steps run in the order of
 * `ALL_STEPS`; a step may rely on every step before it.
 */

export type SeedError = HandlerError;

/** What a step receives. Everything a step may do is here; steps never reach for globals. */
export interface SeedCtx {
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  /** The demo time: 2026-11-20 14:30 UTC. History runs over the 90 virtual days before it. */
  readonly demoNow: Date;
  readonly seed: number;
  /** A generator private to this step name: the same seed and step name always give the same sequence. */
  readonly rng: (stepName: string) => Xoshiro;
  /** `service:ingest`: the principal that commits configuration on the system surface. */
  readonly system: Principal;
  /** A principal by subject (`user:ops-lead`, `agent:claude-code`, `service:badges`). */
  readonly principal: (subject: string) => Effect.Effect<Principal, SeedError, SuiteEnv>;
  /** `create` builds the NodeChange of a new node. */
  readonly create: (kind: Kind, slug: string, body: unknown) => NodeChange;
  /** Commit node changes on the system surface (no approval, no preview token). */
  readonly commitNodes: (
    changes: ReadonlyArray<NodeChange>,
    reason: string,
    managed?: { readonly by: string },
  ) => Effect.Effect<CommitResult, SeedError, SuiteEnv>;
  /** Run an action through its registered handler at virtual time `at` (default: demoNow). Fails if it is held. */
  readonly act: (
    as: Principal,
    action: string,
    input: Readonly<Record<string, unknown>>,
    opts?: { readonly at?: Date; readonly surface?: Surface; readonly key?: string },
  ) => Effect.Effect<unknown, SeedError, SuiteEnv>;
  /** The emit context of a system write at virtual time `at` (for the ledger helpers and `emitFrom`). */
  readonly emitCtx: (at: Date) => EmitCtx;
  /** Drain the badge and automation engines until they are caught up (a no-op until the worker hooks land). */
  readonly drain: (at?: Date) => Effect.Effect<void, SeedError, SuiteEnv>;
}

export interface SeedStep {
  readonly name: string;
  /** Contract section the step implements, for the report. */
  readonly spec: string;
  readonly run: (ctx: SeedCtx) => Effect.Effect<void, SeedError, SuiteEnv>;
}

/** The engines' drain, injected by the entrypoint so gen does not depend on how the worker is wired. */
export type Drain = (at: Date) => Effect.Effect<void, SeedError, SuiteEnv>;

export const DEMO_NOW = (date: string, time: string): Date => parseVirtualStart(date, time);

/** Run every step in order. Returns the step names that ran. */
export const runSuiteSeed = (opts?: {
  readonly drain?: Drain;
  readonly steps?: ReadonlyArray<SeedStep>;
}): Effect.Effect<ReadonlyArray<string>, SeedError, SuiteEnv> =>
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const log = yield* ChangeLog;
    const identity = yield* Identity;
    const ws = workspaceId(cfg.workspaceSlug);
    const system = yield* identity.bySubject("service:ingest");
    const demoNow = DEMO_NOW(cfg.demo.virtualDate, cfg.demo.virtualStart);
    const seed = cfg.demo.seed;
    const steps = opts?.steps ?? ALL_STEPS;

    const ctx: SeedCtx = {
      workspaceId: ws,
      workspaceSlug: cfg.workspaceSlug,
      demoNow,
      seed,
      rng: (name) => {
        let h = BigInt(seed);
        for (const c of name) h = splitmix64(h ^ BigInt(c.charCodeAt(0))).next;
        return new Xoshiro(h);
      },
      system,
      principal: (subject) => identity.bySubject(subject),
      create: (kind, slug, body) => ({
        target: nodeUri(cfg.workspaceSlug, kind, nodeId(ws, kind, slug)),
        base_revision: null,
        ops: [{ op: "create", kind, slug, body: body as never }],
      }),
      commitNodes: (changes, reason, managed) =>
        log.commit({
          actor: { principal: system, surface: "system" },
          changes,
          reason,
          ...(managed ? { managed } : {}),
        }),
      act: (as, action, input, o) =>
        callAction(as, action, input, {
          surface: o?.surface ?? "system",
          at: o?.at ?? demoNow,
          ...(o?.key !== undefined ? { idempotencyKey: o.key } : {}),
        }),
      emitCtx: (at) => ({ principal: system, surface: "system", now: at }),
      drain: (at) => (opts?.drain ? opts.drain(at ?? demoNow) : Effect.void),
    };

    // two resets give identical ids, so identical domain payloads and ledger
    const release = useDeterministicIds(seed);
    const ran: string[] = [];
    yield* Effect.gen(function* () {
      for (const step of steps) {
        yield* Effect.logInfo(`suite seed: ${step.name}`);
        yield* step.run(ctx);
        ran.push(step.name);
      }
    }).pipe(Effect.ensuring(Effect.sync(release)));
    return ran;
  });
