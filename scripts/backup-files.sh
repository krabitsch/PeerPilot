#!/usr/bin/env bash
# Mirror the MinIO buckets to backups/files/<bucket>. Uses the mc client already
# inside the running minio container (no extra image to pull), then docker cp's
# the result to the host.
#
#   make backup-files       (or: bash scripts/backup-files.sh)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
set -a; . "$REPO_ROOT/src/.env"; set +a
COMPOSE="docker compose -f $REPO_ROOT/src/docker-compose.yml"

DEST="${BACKUP_DIR:-$REPO_ROOT/backups}/files"
mkdir -p "$DEST"
BUCKETS="submissions assignment-subjects user-profile eval-recordings"
STAGE="/tmp/pp-backup"

echo "Mirroring MinIO buckets to $DEST ..."
$COMPOSE exec -T minio sh -c "
  mc alias set pp http://localhost:9000 '${MINIO_ACCESS_KEY}' '${MINIO_SECRET_KEY}' >/dev/null
  rm -rf $STAGE
  for b in $BUCKETS; do
    echo \"  \$b\"
    mc mirror --overwrite --quiet \"pp/\$b\" \"$STAGE/\$b\" || true
  done"

$COMPOSE cp "minio:$STAGE/." "$DEST/" 2>/dev/null || true
$COMPOSE exec -T minio rm -rf "$STAGE" || true

echo "Done. Copy $DEST off this host for a real backup."
