#!/usr/bin/env bash
# Restore a pg_dump backup made by backup-db.sh into the running database.
# DESTRUCTIVE: replays --clean, dropping and recreating objects.
#
#   make restore-db FILE=backups/db/peerpilot-db-20261004-120000.sql.gz
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
set -a; . "$REPO_ROOT/src/.env"; set +a
COMPOSE="docker compose -f $REPO_ROOT/src/docker-compose.yml"

FILE="${1:-${FILE:-}}"
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "Usage: FILE=<path-to.sql.gz> $0"; exit 1; }

echo "WARNING: this will overwrite database '${POSTGRES_DB}' from $FILE"
printf "Type 'yes' to continue: "; read -r answer
[ "$answer" = "yes" ] || { echo "Cancelled."; exit 1; }

gunzip -c "$FILE" | $COMPOSE exec -T -e PGPASSWORD="$DB_PASSWORD" database \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1
echo "Restore complete."
