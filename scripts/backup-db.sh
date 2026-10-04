#!/usr/bin/env bash
# Logical backup of the PeerPilot Postgres database to a gzip'd pg_dump file.
# Works against the running stack (dev or prod). Output: backups/db/<ts>.sql.gz
#
#   make backup-db          (or: bash scripts/backup-db.sh)
#
# The dump is created with --clean --if-exists, so restore-db.sh can replay it
# over an existing database.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
set -a; . "$REPO_ROOT/src/.env"; set +a
COMPOSE="docker compose -f $REPO_ROOT/src/docker-compose.yml"

OUT_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}/db"
mkdir -p "$OUT_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$OUT_DIR/peerpilot-${POSTGRES_DB}-${TS}.sql.gz"

echo "Dumping database '${POSTGRES_DB}' ..."
$COMPOSE exec -T -e PGPASSWORD="$DB_PASSWORD" database \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  | gzip > "$OUT"

echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"
echo "Keep backups off this host (copy to object storage / another machine)."
