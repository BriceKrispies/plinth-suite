import { Layer } from "effect";
import { AppConfigLive } from "./config";
import { PlinthClockLive } from "./clock";
import { ControlStoreLive } from "./control-store";
import { BlobStoreLive } from "./blob-store";
import { EphemeralMemory } from "./ephemeral";
import { IdentityDev } from "./identity";
import { ChangeLogLive } from "./change-log";
import { QueryEngineLive } from "./query-engine";
import { AuthorizerLive } from "./authz";

const Infra = Layer.mergeAll(ControlStoreLive, BlobStoreLive, EphemeralMemory).pipe(
  Layer.provideMerge(AppConfigLive),
);

/** Infrastructure services: config, clock, Postgres, MinIO, in-memory ephemeral store. */
export const BaseLive = PlinthClockLive.pipe(Layer.provideMerge(Infra));

/** Everything a process needs except DuckDB: authorizer, change log and identity. Used by rt and migrate. */
export const StoreLive = Layer.mergeAll(ChangeLogLive, IdentityDev).pipe(
  Layer.provideMerge(AuthorizerLive.pipe(Layer.provideMerge(BaseLive))),
);

/** The full engine: StoreLive plus the DuckDB query engine. Used by api and mcp. */
export const EngineLive = QueryEngineLive.pipe(Layer.provideMerge(StoreLive));
