#!/usr/bin/env bash
# Run a local copy of production data in its own, isolated stack.
#
#   make snapshot-up                         build + start (https://localhost:8444)
#   make snapshot-restore DB=backups/db/<dump>.sql.gz [FILES=backups/files]
#   make snapshot-down                       stop and DELETE the copy's volumes
#
# Everything here is pinned to the Compose project `peerpilot-snapshot`
# (src/docker-compose.snapshot.yml): its own containers and volumes. It never
# touches the dev stack (`make dev`) or the e2e stack. Emails are forced to
# EMAIL_TRANSPORT=json, because the copy contains real student addresses.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
set -a; . "$REPO_ROOT/src/.env"; set +a

PROJECT=peerpilot-snapshot
FILES_DIR="$(realpath -m "${FILES:-$REPO_ROOT/backups/files}")"
export SNAPSHOT_FILES_DIR="$FILES_DIR"
COMPOSE=(docker compose -p "$PROJECT" -f "$REPO_ROOT/src/docker-compose.yml" -f "$REPO_ROOT/src/docker-compose.snapshot.yml")
BUCKETS="submissions assignment-subjects user-profile eval-recordings"

up() {
    # The bind mount must exist (and belong to you, not to root via Docker).
    mkdir -p "$FILES_DIR"
    echo "Starting the snapshot stack (https://localhost:8444) ..."
    "${COMPOSE[@]}" up -d --build --wait
    migrate
    echo "Snapshot stack up. Load data with: make snapshot-restore DB=backups/db/<dump>.sql.gz"
}

migrate() {
    "${COMPOSE[@]}" exec -T api npx prisma migrate deploy --schema packages/database/prisma/schema.prisma
}

restore() {
    local dump="${DB:-}"
    [ -n "$dump" ] && [ -f "$dump" ] || { echo "Usage: make snapshot-restore DB=<path-to.sql.gz> [FILES=<bucket folder>]"; exit 1; }
    gunzip -t "$dump"

    "${COMPOSE[@]}" ps --status running --services | grep -qx database \
        || { echo "The snapshot stack is not running. Run 'make snapshot-up' first."; exit 1; }

    echo "Restoring $dump into the SNAPSHOT database ($PROJECT, localhost:5435) ..."
    # The dump was made with --clean --if-exists, so it replaces whatever the
    # snapshot DB held. Ownership statements name the prod DB role, which does
    # not exist here; dropping them leaves everything owned by the local role.
    gunzip -c "$dump" \
        | sed -E '/^ALTER [A-Z ]+ .* OWNER TO /d' \
        | "${COMPOSE[@]}" exec -T -e PGPASSWORD="$DB_PASSWORD" database \
            psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 >/dev/null
    echo "Database restored."

    # Prod may run an older schema than this branch; bring it up to date.
    migrate

    if [ -n "$(ls -A "$FILES_DIR" 2>/dev/null)" ]; then
        # The folder is bind-mounted when the container is created; if FILES
        # points elsewhere than at `up`, Compose recreates just MinIO (its data
        # volume is kept). A no-op when nothing changed.
        "${COMPOSE[@]}" up -d --no-deps --wait minio >/dev/null 2>&1
        echo "Mirroring files from $FILES_DIR into the snapshot MinIO ..."
        "${COMPOSE[@]}" exec -T minio sh -c "
          mc alias set snap http://localhost:9000 '${MINIO_ACCESS_KEY}' '${MINIO_SECRET_KEY}' >/dev/null
          for b in $BUCKETS; do
            [ -d /restore/\$b ] || { echo \"  \$b: not in backup, skipped\"; continue; }
            mc mb --ignore-existing snap/\$b >/dev/null
            mc mirror --overwrite --quiet /restore/\$b snap/\$b && echo \"  \$b: done\"
          done"
    else
        echo "No files in $FILES_DIR: pages work, but file/recording downloads will fail."
    fi

    # The API caches nothing from the DB, but restart it so it starts clean.
    "${COMPOSE[@]}" restart api >/dev/null
    echo "Done. Open https://localhost:8444 and sign in with your own prod account."
}

down() {
    echo "Removing the snapshot stack and its data (the copy of prod) ..."
    "${COMPOSE[@]}" down -v --remove-orphans
}

case "${1:-}" in
    up) up ;;
    restore) restore ;;
    down) down ;;
    *) echo "Usage: $0 up|restore|down"; exit 1 ;;
esac
