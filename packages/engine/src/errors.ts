import { Data } from "effect";

/**
 * Infrastructure failures. Domain refusals are `DomainError` (in @plinth/spec) and map onto the closed code set;
 * these map onto HTTP 500/503 and the readiness endpoints.
 */
export class StoreError extends Data.TaggedError("StoreError")<{
  readonly message: string;
  readonly cause?: unknown;
  /** Postgres SQLSTATE when known. `55P03` is a lock timeout. */
  readonly sqlstate?: string;
}> {}

export class BlobError extends Data.TaggedError("BlobError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class EphemeralError extends Data.TaggedError("EphemeralError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class EngineError extends Data.TaggedError("EngineError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type InfraError = StoreError | BlobError | EphemeralError | EngineError;

export const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
