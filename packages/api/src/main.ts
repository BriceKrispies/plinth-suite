import { createServer } from "node:http";
import { Effect, Layer } from "effect";
import { HttpMiddleware, HttpServer } from "@effect/platform";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { AppConfig, EngineLive, migrate } from "@plinth/engine";
import { router } from "./app";

const Serve = Layer.unwrapEffect(
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    yield* migrate;
    yield* Effect.logInfo(`plinth api listening on :${cfg.ports.api}`);
    return HttpServer.serve(HttpMiddleware.logger)(router).pipe(
      Layer.provide(NodeHttpServer.layer(() => createServer(), { port: cfg.ports.api, host: "0.0.0.0" })),
    );
  }),
);

NodeRuntime.runMain(Layer.launch(Serve.pipe(Layer.provide(EngineLive))));
