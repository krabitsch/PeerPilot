.DEFAULT_GOAL := dev
COMPOSE_FILE     = src/docker-compose.yml
COMPOSE_DEV_FILE = src/docker-compose.dev.yml
# The e2e stack is its own Compose project with its own volumes; see
# src/docker-compose.e2e.yml. It never shares data with the dev stack.
E2E_COMPOSE      = docker compose -p peerpilot-e2e -f src/docker-compose.yml -f src/docker-compose.e2e.yml
ENV_FILE         = src/.env
ENV_DBFILE         = src/packages/database/.env

GREEN  = \033[0;32m
RED    = \033[0;31m
YELLOW = \033[0;33m
BLUE   = \033[0;34m
RESET  = \033[0m

.PHONY: setup build up down clean restart run re dev prod check_env studio populateDB resetDB genPrismaClient seedAdmin seedAdmin_prod migrate migrate_prod generateUsers e2e e2e-up e2e-seed e2e-down e2e-install

setup: check_env
	@echo "$(GREEN)Setup complete.$(RESET)"

check_env:
	@echo "$(BLUE)Checking .env...$(RESET)"
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "$(YELLOW).env not found — generating...$(RESET)"; \
		bash scripts/gen-env.sh --defaults && \
		echo "$(GREEN).env created at $(ENV_FILE)$(RESET)"; \
		if docker volume inspect src_postgres_data >/dev/null 2>&1; then \
			echo "$(RED)Warning: an existing database volume was found. It still uses the$(RESET)"; \
			echo "$(RED)password from the old .env, so the new one will be rejected.$(RESET)"; \
			echo "$(RED)Run 'make fclean' to wipe it, or restore the old .env.$(RESET)"; \
		fi; \
	else \
		echo "$(GREEN).env found.$(RESET)"; \
	fi
	@if [ ! -L src/packages/database/.env ]; then \
		echo "$(BLUE)Linking packages/database/.env to root .env...$(RESET)"; \
		ln -sf `pwd`/$(ENV_FILE) src/packages/database/.env; \
		echo "$(GREEN)Linked!$(RESET)"; \
	fi

# Host-side migration, for dev: the dev overlay publishes the database port and
# DATABASE_URL points at localhost.
migrate:
	@echo "$(BLUE)Applying migrations...$(RESET)"
	@cd src/packages/database && npx prisma migrate deploy
	@echo "$(GREEN)Migrations applied.$(RESET)"

# In-container migration, for production: the database is not reachable from
# the host there, so this runs inside the api container, which ships the
# schema and the migration history.
migrate_prod:
	@echo "$(BLUE)Applying migrations inside the stack...$(RESET)"
	@docker compose -f $(COMPOSE_FILE) exec -T api npx prisma migrate deploy --schema packages/database/prisma/schema.prisma
	@echo "$(GREEN)Migrations applied.$(RESET)"

genPrismaClient:
	@echo "$(BLUE)Generating Prisma client...$(RESET)"
	@cd src/packages/database && npm install && npx prisma@5.22.0 generate
	@echo "$(GREEN)Prisma client generated.$(RESET)"

build: setup genPrismaClient
	@echo "$(GREEN)Building images...$(RESET)"
	@docker compose -f $(COMPOSE_FILE) build

prod: setup genPrismaClient
	@echo "$(GREEN)Starting production...$(RESET)"
	@docker compose -f $(COMPOSE_FILE) up -d
	@$(MAKE) migrate_prod
	@$(MAKE) seedAdmin_prod
	@$(MAKE) print_url

dev: setup genPrismaClient
	@echo "$(YELLOW)Starting dev mode...$(RESET)"
	@docker compose -f $(COMPOSE_FILE) -f $(COMPOSE_DEV_FILE) up -d
	@$(MAKE) migrate
	@$(MAKE) seedAdmin
	@$(MAKE) print_url

studio:
	@echo "$(BLUE)Opening Prisma Studio...$(RESET)"
	@cd src/packages/database && npx prisma studio

run: build prod 
re:  down run
restart: down prod

up:
	@docker compose -f $(COMPOSE_FILE) up -d
	@$(MAKE) print_url

down:
	@echo "$(RED)Stopping containers...$(RESET)"
	@docker compose -f $(COMPOSE_FILE) down

# Removes this project's containers *and* its named volumes (database and MinIO
# data). `docker volume prune` alone is not enough: since Docker 23 it only
# removes anonymous volumes, and a surviving postgres volume keeps the password
# it was initialised with, which no longer matches a freshly generated .env.
clean:
	@echo "$(RED)Removing all Docker resources...$(RESET)"
	@docker compose -f $(COMPOSE_FILE) down -v --remove-orphans
	@docker system prune -af

fclean: clean
	@echo "$(RED)Removing .env...$(RESET)"
	@rm -f $(ENV_FILE)
	@rm -f $(ENV_DBFILE)

print_url:
	@echo "$(GREEN)https://localhost$(RESET)"

status:
	@docker compose -f $(COMPOSE_FILE) ps

logs:
	@docker compose -f $(COMPOSE_FILE) logs -f

populateDB:
	@echo "$(YELLOW)WARNING: This will wipe the current database and populate it with fake/sample data.$(RESET)"
	@printf "Type 'yes' to continue: "; \
	read answer; \
	if [ "$$answer" = "yes" ]; then \
		echo "$(BLUE)Running seed script...$(RESET)"; \
		bash scripts/populate-db.sh && \
		echo "$(GREEN)Database populated.$(RESET)"; \
	else \
		echo "$(RED)Cancelled.$(RESET)"; \
	fi

seedAdmin:
	@echo "$(BLUE)Ensuring admin user exists...$(RESET)"
	@bash scripts/seed-admin.sh
	@echo "$(GREEN)Admin user ready.$(RESET)"

seedAdmin_prod:
	@echo "$(BLUE)Ensuring admin user exists...$(RESET)"
	@docker compose -f $(COMPOSE_FILE) exec -T api node packages/database/prisma/seedAdmin.js
	@echo "$(GREEN)Admin user ready.$(RESET)"

generateUsers:
	@bash scripts/generate-users.sh $(ARGS)

resetDB:
	@echo "$(YELLOW)WARNING: This will wipe the current database (all data will be lost).$(RESET)"
	@printf "Type 'yes' to continue: "; \
	read answer; \
	if [ "$$answer" = "yes" ]; then \
		echo "$(BLUE)Resetting database...$(RESET)"; \
		(cd src/packages/database && npx prisma migrate reset --force --skip-seed) && \
		echo "$(GREEN)Database reset.$(RESET)"; \
		$(MAKE) migrate; \
	else \
		echo "$(RED)Cancelled.$(RESET)"; \
	fi

# ── End-to-end tests ─────────────────────────────────────────
# `make e2e` builds and starts the isolated test stack on https://localhost:8443,
# applies migrations inside it, and runs the Playwright suite. The suite reseeds
# the test database itself at the start of every run. The stack stays up
# afterwards so you can re-run with `cd e2e && npx playwright test`; stop it with
# `make e2e-down`.
e2e: e2e-up e2e-install
	@echo "$(BLUE)Running Playwright...$(RESET)"
	@cd e2e && npx playwright test

e2e-up: setup genPrismaClient
	@echo "$(BLUE)Starting the e2e stack (https://localhost:8443)...$(RESET)"
	@$(E2E_COMPOSE) up -d --build --wait
	@$(E2E_COMPOSE) exec -T api npx prisma migrate deploy --schema packages/database/prisma/schema.prisma
	@echo "$(GREEN)e2e stack ready.$(RESET)"

e2e-install:
	@cd e2e && npm install --no-audit --no-fund >/dev/null && npx playwright install chromium >/dev/null
	@cd src && npm install --workspaces --include-workspace-root --no-audit --no-fund >/dev/null

e2e-seed:
	@cd e2e && node support/seed.js

e2e-down:
	@echo "$(RED)Removing the e2e stack and its data...$(RESET)"
	@$(E2E_COMPOSE) down -v --remove-orphans
