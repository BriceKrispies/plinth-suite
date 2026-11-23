COMPOSE = podman compose -f deploy/compose/compose.yaml

.PHONY: up up-app down demo-reset typecheck dev install test

install:
	pnpm install

# Start Postgres and MinIO, create the bucket, migrate. Host mode runs the Node processes with make dev.
up:
	$(COMPOSE) up -d postgres objectstore
	pnpm migrate

# Same, plus the app services in containers.
up-app:
	$(COMPOSE) --profile app up -d --build

down:
	$(COMPOSE) --profile app --profile seed down

# Reset the control store to the seed, then land the seeded history.
demo-reset:
	pnpm reset
	pnpm gen:history

typecheck:
	pnpm -r typecheck

# api, rt, mcp and the web dev server on the host.
dev:
	pnpm dev

# Run on the stack once it is up and seeded.
test:
	pnpm test
