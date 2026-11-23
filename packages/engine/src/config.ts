import { Config, Context, Effect, Layer, Option, Redacted } from "effect";

/** Configuration keys, all `PLINTH_*` (spec 07 section 14.2). L1 subset with local-development defaults. */
export interface AppConfigShape {
  readonly workspaceSlug: string;
  readonly db: {
    readonly host: string;
    readonly port: number;
    readonly name: string;
    readonly user: string;
    readonly password: Redacted.Redacted;
    readonly poolMax: number;
  };
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly forcePathStyle: boolean;
    readonly accessKey: string;
    readonly secretKey: Redacted.Redacted;
  };
  readonly ports: { readonly api: number; readonly rt: number; readonly mcp: number };
  readonly duckdb: {
    readonly threads: number;
    readonly memoryLimit: string;
    readonly autoinstall: boolean;
    readonly extensionDir: Option.Option<string>;
    readonly tempDir: string;
  };
  readonly query: {
    readonly defaultTimeoutMs: number;
    readonly maxTimeoutMs: number;
    readonly watermarkWaitMs: number;
  };
  /** Object-store prefix root for run prefixes (`runs`; tests use `test-runs`). */
  readonly runPrefixRoot: string;
  /** The presenter control API (separate port and token; never exposed through MCP). */
  readonly presenter: { readonly port: number; readonly token: string };
  readonly previewTtlS: number;
  readonly commitLockTimeoutMs: number;
  readonly demo: {
    readonly seed: number;
    readonly virtualDate: string;
    readonly virtualStart: string;
    readonly clockRate: number;
    readonly historyDays: number;
    readonly ordersPerDay: number;
  };
  /** `subject=token,subject=token`. The L1 dev Identity layer maps these static bearer tokens to principals. */
  readonly devTokens: string;
  /** K8: accept `dev-user-<handle>` as the bearer token of every seeded human member (dev default true). */
  readonly devOpenTokens: boolean;
  readonly mcp: { readonly stdioToken: Option.Option<string> };
}

export class AppConfig extends Context.Tag("plinth/AppConfig")<AppConfig, AppConfigShape>() {}

export const DEFAULT_DEV_TOKENS = [
  "user:ops-lead=dev-ops-lead",
  "user:emea-lead=dev-emea-lead",
  "user:finance-analyst=dev-finance-analyst",
  "agent:claude-code=dev-agent-claude-code",
  "service:replay-driver=dev-replay-driver",
  "service:ingest=dev-ingest",
].join(",");

const str = (key: string, def: string) => Config.string(key).pipe(Config.withDefault(def));
const int = (key: string, def: number) => Config.integer(key).pipe(Config.withDefault(def));
const bool = (key: string, def: boolean) => Config.boolean(key).pipe(Config.withDefault(def));

export const loadConfig = Effect.gen(function* () {
  const cfg: AppConfigShape = {
    workspaceSlug: yield* str("PLINTH_WORKSPACE_SLUG", "northwind"),
    db: {
      host: yield* str("PLINTH_DB_HOST", "127.0.0.1"),
      port: yield* int("PLINTH_DB_PORT", 55432),
      name: yield* str("PLINTH_DB_NAME", "plinth"),
      user: yield* str("PLINTH_DB_USER", "plinth"),
      password: yield* Config.redacted("PLINTH_DB_PASSWORD").pipe(
        Config.withDefault(Redacted.make("plinth")),
      ),
      poolMax: yield* int("PLINTH_DB_POOL_MAX", 10),
    },
    s3: {
      endpoint: yield* str("PLINTH_S3_ENDPOINT", "http://127.0.0.1:59000"),
      region: yield* str("PLINTH_S3_REGION", "us-east-1"),
      bucket: yield* str("PLINTH_S3_BUCKET", "plinth-data"),
      forcePathStyle: yield* bool("PLINTH_S3_FORCE_PATH_STYLE", true),
      accessKey: yield* str("PLINTH_S3_ACCESS_KEY", "plinth"),
      secretKey: yield* Config.redacted("PLINTH_S3_SECRET_KEY").pipe(
        Config.withDefault(Redacted.make("plinth-secret")),
      ),
    },
    ports: {
      api: yield* int("PLINTH_API_PORT", 8782),
      rt: yield* int("PLINTH_RT_PORT", 8781),
      mcp: yield* int("PLINTH_MCP_PORT", 8790),
    },
    duckdb: {
      threads: yield* int("PLINTH_DUCKDB_THREADS", 1),
      memoryLimit: yield* str("PLINTH_DUCKDB_MEMORY_LIMIT", "2GB"),
      autoinstall: yield* bool("PLINTH_DUCKDB_AUTOINSTALL", true),
      extensionDir: yield* Config.option(Config.string("PLINTH_DUCKDB_EXTENSION_DIR")),
      tempDir: yield* str("PLINTH_DUCKDB_TEMP_DIR", ".tmp/duckdb"),
    },
    query: {
      defaultTimeoutMs: yield* int("PLINTH_QUERY_DEFAULT_TIMEOUT_MS", 5000),
      maxTimeoutMs: yield* int("PLINTH_QUERY_MAX_TIMEOUT_MS", 30000),
      watermarkWaitMs: yield* int("PLINTH_QUERY_WATERMARK_WAIT_MS", 10000),
    },
    runPrefixRoot: yield* str("PLINTH_RUN_PREFIX_ROOT", "runs"),
    presenter: {
      port: yield* int("PLINTH_PRESENTER_PORT", 8795),
      token: yield* str("PLINTH_PRESENTER_TOKEN", "dev-presenter-token"),
    },
    previewTtlS: yield* int("PLINTH_PREVIEW_TTL_S", 300),
    commitLockTimeoutMs: yield* int("PLINTH_COMMIT_LOCK_TIMEOUT_MS", 2000),
    demo: {
      seed: yield* int("PLINTH_DEMO_SEED", 2026),
      virtualDate: yield* str("PLINTH_DEMO_VIRTUAL_DATE", "2026-11-20"),
      virtualStart: yield* str("PLINTH_DEMO_VIRTUAL_START", "14:30:00"),
      clockRate: yield* int("PLINTH_DEMO_CLOCK_RATE", 6),
      historyDays: yield* int("PLINTH_HISTORY_DAYS", 1),
      ordersPerDay: yield* int("PLINTH_GEN_ORDERS_PER_DAY", 80000),
    },
    devTokens: yield* str("PLINTH_DEV_TOKENS", DEFAULT_DEV_TOKENS),
    devOpenTokens: yield* bool("PLINTH_DEV_OPEN_TOKENS", true),
    mcp: { stdioToken: yield* Config.option(Config.string("PLINTH_MCP_TOKEN")) },
  };
  return cfg;
});

export const AppConfigLive = Layer.effect(AppConfig, loadConfig);

/** Direct (non-Layer) accessor for tests and entrypoints. */
export const withConfig = <A, E, R>(f: (c: AppConfigShape) => Effect.Effect<A, E, R>) =>
  Effect.flatMap(AppConfig, f);
