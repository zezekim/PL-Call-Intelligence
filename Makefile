.DEFAULT_GOAL := help
COMPOSE := docker compose
SHELL := /bin/bash

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

.PHONY: env
env: ## Create .env from .env.example with generated secrets
	@test -f .env && { echo ".env already exists - not overwriting"; exit 0; } || true
	@cp .env.example .env
	@python3 -c "import secrets,base64,pathlib;p=pathlib.Path('.env');t=p.read_text();\
t=t.replace('ENCRYPTION_KEY=','ENCRYPTION_KEY='+base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),1);\
t=t.replace('JWT_SECRET=','JWT_SECRET='+secrets.token_urlsafe(48),1);\
t=t.replace('INTERNAL_API_TOKEN=','INTERNAL_API_TOKEN='+secrets.token_urlsafe(32),1);\
t=t.replace('POSTGRES_PASSWORD=','POSTGRES_PASSWORD='+secrets.token_urlsafe(24),1);\
p.write_text(t)"
	@echo "Wrote .env - add CLAUDE_API_KEY and DEEPGRAM_API_KEY"

.PHONY: up
up: ## Build and start everything
	$(COMPOSE) up -d --build

.PHONY: down
down: ## Stop everything
	$(COMPOSE) down

.PHONY: seed
seed: ## Create the business and first admin user
	set -a; . ./.env; set +a; $(COMPOSE) exec -e SEED_BUSINESS_NAME -e SEED_ADMIN_EMAIL -e SEED_ADMIN_PASSWORD app python -m callsentry.scripts.seed

.PHONY: import
import: ## Queue a folder of recordings: make import dir=/path/to/recordings
	@test -n "$(dir)" || { echo "usage: make import dir=/path/to/recordings"; exit 1; }
	$(COMPOSE) cp "$(dir)" app:/tmp/import
	$(COMPOSE) exec app python -m callsentry.scripts.import_calls /tmp/import --email "$$(grep -E '^SEED_ADMIN_EMAIL=' .env | cut -d= -f2-)"
	$(COMPOSE) exec app rm -rf /tmp/import

.PHONY: logs
logs: ## Tail logs (make logs s=app)
	$(COMPOSE) logs -f $(s)

.PHONY: psql
psql: ## Database shell
	$(COMPOSE) exec postgres psql -U callsentry -d callsentry

.PHONY: test
test: ## Backend tests
	$(COMPOSE) run --rm --no-deps app pytest -q

.PHONY: dev
dev: ## Start the database and worker for running the API natively
	$(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis worker
