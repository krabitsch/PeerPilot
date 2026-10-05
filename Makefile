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

.PHONY: setup build up down clean restart run re dev prod check_env studio populateDB resetDB genPrismaClient seedAdmin seedAdmin_prod migrate migrate_prod generateUsers e2e e2e-up e2e-seed e2e-down e2e-install e2e-summary e2e-report cert cert-renew backup backup-db restore-db backup-files

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

# Removes THIS project's containers, networks, named volumes (database and
# MinIO data) and the images it built — nothing else on the machine.
#   -v          drops the named volumes. `docker volume prune` alone is not
#               enough: since Docker 23 it only removes anonymous volumes, and a
#               surviving postgres volume keeps the password it was initialised
#               with, which no longer matches a freshly generated .env.
#   --rmi local removes only the images this compose built (api, frontend,
#               nginx); the tagged base images (postgres, minio) are kept.
# The e2e stack is a separate Compose project, so it is torn down explicitly.
clean:
	@echo "$(RED)Removing this project's containers, volumes and built images...$(RESET)"
	@docker compose -f $(COMPOSE_FILE) down -v --remove-orphans --rmi local
	@$(E2E_COMPOSE) down -v --remove-orphans --rmi local 2>/dev/null || true

fclean: clean
	@echo "$(RED)Removing .env...$(RESET)"
	@rm -f $(ENV_FILE)
	@rm -f $(ENV_DBFILE)

print_url:
	@echo "$(GREEN)https://localhost$(RESET)"

# ── Real TLS (Let's Encrypt) ─────────────────────────────────
# Obtain a production certificate and install it for nginx. Requires a public
# domain pointed at this host with ports 80 and 443 reachable from the
# internet, and the stack already running (`make prod`).
#
#   make cert DOMAIN=peerpilot.example.com CERTBOT_EMAIL=admin@example.com
#
# certbot answers the HTTP-01 challenge through nginx's /.well-known/ path,
# then the deploy hook copies the issued cert into the volume nginx serves and
# nginx is reloaded. Afterwards set BASE_URL=https://$(DOMAIN)/ in src/.env.
cert:
	@if [ -z "$(DOMAIN)" ] || [ -z "$(CERTBOT_EMAIL)" ]; then \
		echo "$(RED)Usage: make cert DOMAIN=your.domain CERTBOT_EMAIL=you@example.com$(RESET)"; exit 1; fi
	@echo "$(BLUE)Requesting a certificate for $(DOMAIN)...$(RESET)"
	@docker compose -f $(COMPOSE_FILE) run --rm certbot certonly \
		--webroot -w /var/www/certbot \
		-d $(DOMAIN) \
		--email $(CERTBOT_EMAIL) --agree-tos --no-eff-email --non-interactive \
		--deploy-hook 'cp "$$RENEWED_LINEAGE/fullchain.pem" /nginx-certs/fullchain.pem && cp "$$RENEWED_LINEAGE/privkey.pem" /nginx-certs/privkey.pem'
	@docker compose -f $(COMPOSE_FILE) exec nginx nginx -s reload
	@echo "$(GREEN)Certificate installed for $(DOMAIN). Set BASE_URL=https://$(DOMAIN)/ in src/.env.$(RESET)"

# Renew any certificate near expiry and reload nginx. Safe to run on a schedule
# (e.g. a daily cron); Let's Encrypt renews only within 30 days of expiry.
cert-renew:
	@docker compose -f $(COMPOSE_FILE) run --rm certbot renew \
		--deploy-hook 'cp "$$RENEWED_LINEAGE/fullchain.pem" /nginx-certs/fullchain.pem && cp "$$RENEWED_LINEAGE/privkey.pem" /nginx-certs/privkey.pem'
	@docker compose -f $(COMPOSE_FILE) exec nginx nginx -s reload

status:
	@docker compose -f $(COMPOSE_FILE) ps

logs:
	@docker compose -f $(COMPOSE_FILE) logs -f

# ── Backups ──────────────────────────────────────────────────
# `make backup` is the one-shot entry point for cron: DB dump + file mirror +
# prune. Individual targets below still work. Output goes to $BACKUP_DIR
# (default backups/); copy it off this host for a real backup. See docs/BACKUPS.md.
backup:
	@bash scripts/backup.sh

backup-db:
	@bash scripts/backup-db.sh

restore-db:
	@bash scripts/restore-db.sh $(FILE)

backup-files:
	@bash scripts/backup-files.sh

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

# Compact terminal summary of the last run (pass/fail counts + any failures).
e2e-summary:
	@cd e2e && node support/summary.js

# Open the detailed HTML report of the last run (serves it on localhost:9323).
e2e-report:
	@cd e2e && npx playwright show-report

e2e-down:
	@echo "$(RED)Removing the e2e stack and its data...$(RESET)"
	@$(E2E_COMPOSE) down -v --remove-orphans
