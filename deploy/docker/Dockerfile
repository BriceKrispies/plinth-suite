# One repository, one Dockerfile, one target per image (spec 07 section 11.1).
# Targets: plinth-app (api, rt, mcp, web, migrate, reset), plinth-gen, plinth-worker, plinth-ingest, plinth-driver.
# The base is a Node image; a distroless runtime is a later hardening step.
FROM docker.io/library/node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile
COPY deploy/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /app/.tmp && chown -R node:node /app/.tmp

FROM base AS plinth-app
USER node
ENTRYPOINT ["/entrypoint.sh"]

FROM base AS plinth-gen
USER node
ENTRYPOINT ["/entrypoint.sh"]

FROM base AS plinth-worker
USER node
ENTRYPOINT ["/entrypoint.sh", "worker"]

FROM base AS plinth-ingest
USER node
ENTRYPOINT ["/entrypoint.sh", "ingest"]

FROM base AS plinth-driver
USER node
ENTRYPOINT ["/entrypoint.sh", "driver"]
