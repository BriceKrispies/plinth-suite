import { Context, Effect, Layer, Redacted } from "effect";
import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { AppConfig } from "./config";
import { BlobError, messageOf } from "./errors";

/** Object store (S3 API; MinIO locally). Keys are relative to the configured bucket. */
export class BlobStore extends Context.Tag("plinth/BlobStore")<
  BlobStore,
  {
    readonly bucket: string;
    readonly put: (key: string, body: Uint8Array, contentType?: string) => Effect.Effect<void, BlobError>;
    readonly get: (key: string) => Effect.Effect<Uint8Array, BlobError>;
    readonly copy: (from: string, to: string) => Effect.Effect<void, BlobError>;
    readonly remove: (key: string) => Effect.Effect<void, BlobError>;
    readonly exists: (key: string) => Effect.Effect<boolean, BlobError>;
    readonly list: (prefix: string) => Effect.Effect<ReadonlyArray<string>, BlobError>;
    readonly ensureBucket: Effect.Effect<void, BlobError>;
    /** Readiness: HEAD of the bucket. */
    readonly ping: Effect.Effect<void, BlobError>;
  }
>() {}

const wrap = <A>(label: string, f: () => Promise<A>) =>
  Effect.tryPromise({
    try: f,
    catch: (e) => new BlobError({ message: `${label}: ${messageOf(e)}`, cause: e }),
  });

export const BlobStoreLive = Layer.scoped(
  BlobStore,
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const client = yield* Effect.acquireRelease(
      Effect.sync(
        () =>
          new S3Client({
            endpoint: cfg.s3.endpoint,
            region: cfg.s3.region,
            forcePathStyle: cfg.s3.forcePathStyle,
            credentials: { accessKeyId: cfg.s3.accessKey, secretAccessKey: Redacted.value(cfg.s3.secretKey) },
          }),
      ),
      (c) => Effect.sync(() => c.destroy()),
    );
    const Bucket = cfg.s3.bucket;
    const notFound = (e: unknown) => {
      const x = e as { name?: string; $metadata?: { httpStatusCode?: number } };
      return x.name === "NotFound" || x.name === "NoSuchKey" || x.$metadata?.httpStatusCode === 404;
    };
    return BlobStore.of({
      bucket: Bucket,
      put: (Key, body, contentType) =>
        wrap(`put ${Key}`, () =>
          client.send(
            new PutObjectCommand({
              Bucket,
              Key,
              Body: body,
              ContentType: contentType ?? "application/octet-stream",
            }),
          ),
        ).pipe(Effect.asVoid),
      get: (Key) =>
        wrap(`get ${Key}`, async () => {
          const out = await client.send(new GetObjectCommand({ Bucket, Key }));
          return (await out.Body?.transformToByteArray()) ?? new Uint8Array();
        }),
      copy: (from, to) =>
        wrap(`copy ${from} -> ${to}`, () =>
          client.send(new CopyObjectCommand({ Bucket, Key: to, CopySource: `${Bucket}/${from}` })),
        ).pipe(Effect.asVoid),
      remove: (Key) =>
        wrap(`delete ${Key}`, () => client.send(new DeleteObjectCommand({ Bucket, Key }))).pipe(
          Effect.asVoid,
        ),
      exists: (Key) =>
        wrap(`head ${Key}`, async () => {
          try {
            await client.send(new HeadObjectCommand({ Bucket, Key }));
            return true;
          } catch (e) {
            if (notFound(e)) return false;
            throw e;
          }
        }),
      list: (Prefix) =>
        wrap(`list ${Prefix}`, async () => {
          const keys: string[] = [];
          let token: string | undefined;
          do {
            const out = await client.send(
              new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken: token }),
            );
            for (const o of out.Contents ?? []) if (o.Key) keys.push(o.Key);
            token = out.IsTruncated ? out.NextContinuationToken : undefined;
          } while (token);
          return keys as ReadonlyArray<string>;
        }),
      ensureBucket: wrap("ensure bucket", async () => {
        try {
          await client.send(new HeadBucketCommand({ Bucket }));
        } catch {
          await client.send(new CreateBucketCommand({ Bucket }));
        }
      }),
      ping: wrap("head bucket", () => client.send(new HeadBucketCommand({ Bucket }))).pipe(Effect.asVoid),
    });
  }),
);
