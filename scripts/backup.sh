#!/usr/bin/env bash
# One-shot backup: dump the database, mirror the MinIO buckets, then prune old
# DB dumps. This is the single entry point cron should call (see docs/BACKUPS.md).
#
#   make backup            (or: bash scripts/backup.sh)
#
# Output goes to $BACKUP_DIR (default: repo/backups). That directory is the
# thing you move OFF this host — a backup sitting on the same disk as the data
# is not a backup. See docs/BACKUPS.md.
#
# Env:
#   BACKUP_DIR        where backups are written (default: <repo>/backups)
#   BACKUP_KEEP_DAYS  how many days of timestamped DB dumps to keep (default: 14)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
export BACKUP_DIR   # the db/files scripts read this too

echo "== PeerPilot backup =="
echo "Destination: $BACKUP_DIR"

bash "$SCRIPT_DIR/backup-db.sh"
bash "$SCRIPT_DIR/backup-files.sh"

# Retention: keep the last $KEEP_DAYS days of timestamped DB dumps. The bucket
# mirrors overwrite in place (always the current state), so they don't pile up —
# only the DB dumps accumulate one file per run.
if [ -d "$BACKUP_DIR/db" ]; then
  echo "Pruning DB dumps older than ${KEEP_DAYS} days ..."
  find "$BACKUP_DIR/db" -name 'peerpilot-*.sql.gz' -type f -mtime "+${KEEP_DAYS}" -print -delete || true
fi

echo "Backup complete. Now copy '$BACKUP_DIR' off this host (manual step)."
