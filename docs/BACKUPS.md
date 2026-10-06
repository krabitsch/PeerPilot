# Backups

How to back up and restore PeerPilot's two pieces of state: the **PostgreSQL
database** and the **MinIO file storage**. Companion to `docs/STORAGE.md` and
`GOING-LIVE.md`. Last updated 2026-10-05.

Run `make backup` (or put it on a schedule, see *Scheduling*). Output goes to
`$BACKUP_DIR` (default `backups/`, git-ignored); **copy it off this host** for it
to count as a real backup — moving it off-host is a manual step by design.

## What there is to back up

| State | Where | Backup target |
| ----- | ----- | ------------- |
| Database (users, classes, submissions, evaluations, …) | Postgres `database` container, volume `src_postgres_data` | `make backup-db` |
| Files (submissions, assignment subjects, avatars, **evaluation recordings**) | MinIO `minio` container, volume `src_minio_data`, buckets `submissions` / `assignment-subjects` / `user-profile` / `eval-recordings` | `make backup-files` |

The `eval-recordings` bucket holds the recordings a teacher uploads as proof
that a peer evaluation actually happened. They can't be re-created once the
evaluation is over, so this is the most important thing to back up and keep.

## Commands

```bash
make backup          # db dump + file mirror + prune old dumps (use this / cron)
make backup-db       # → backups/db/peerpilot-<db>-<timestamp>.sql.gz
make backup-files    # → backups/files/<bucket>/...
make restore-db FILE=backups/db/peerpilot-db-20261004-164437.sql.gz
```

`make backup` is the single entry point (what the cron job below calls): it runs
the DB dump, mirrors the buckets, then prunes DB dumps older than
`BACKUP_KEEP_DAYS` (default 14). `BACKUP_DIR` (default `backups/`) controls where
everything is written — point it at a dedicated disk/dir, then move that
off-host yourself.

All three run against the **running stack** (dev or prod) using the containers'
own tools — no extra images to pull.

### `make backup-db` — `scripts/backup-db.sh`
`pg_dump` inside the `database` container, `--clean --if-exists`, gzipped. The
`--clean` means the dump drops and recreates objects on restore, so it replays
cleanly over an existing database. The `_prisma_migrations` table is included,
so migration history is preserved.

### `make backup-files` — `scripts/backup-files.sh`
Uses the `mc` client already inside the `minio` container to `mc mirror` every
bucket to a staging dir, then `docker cp`s it to `backups/files/`. No external
image needed.

### `make restore-db` — `scripts/restore-db.sh`
**Destructive.** Prompts for confirmation, then pipes the chosen dump into
`psql` (`ON_ERROR_STOP=1`). Verified round-trip: dump → restore leaves the row
counts and migration history unchanged.

To restore **files**, copy objects back with `mc mirror` in the other direction
(host backup → bucket), e.g. from inside the `minio` container:
`mc mirror /path/to/backups/files/eval-recordings pp/eval-recordings`.

## Scheduling (cron example)

Nightly full backup (dump + mirror + prune), from the repo root:

```cron
# m h  dom mon dow   command
0 2 * * *   cd /srv/peerpilot && make backup >> /var/log/pp-backup.log 2>&1
```

`make backup` already prunes old DB dumps (`BACKUP_KEEP_DAYS`). It does **not**
move anything off-host — that is a deliberate manual step: after the run, copy
`$BACKUP_DIR` (default `backups/`) to another machine or medium (e.g. an external
disk, a NAS, or a bucket). A backup that only ever lives on this host is not a
backup.

## Retention & off-host (do before go-live)

- **Keep backups off this host.** A backup on the same disk as the data is not a
  backup. After each `make backup`, copy `$BACKUP_DIR` to a second location
  (external disk / NAS / another machine). This is the one step that isn't
  automated — on purpose: the team moves the data off-host manually.
- **Retention:** `make backup` prunes DB dumps older than `BACKUP_KEEP_DAYS`
  (default 14). The bucket mirrors overwrite in place (always the current state),
  so they don't accumulate — only DB dumps are one-file-per-run.
- **Managed-storage note (not the plan):** the decision is to **stay on
  self-hosted MinIO + these backups** — managed object storage isn't warranted at
  ~60 users (see `docs/STORAGE.md`). If that ever changes, a managed S3-compatible
  store with **versioning** would make `make backup-files` a secondary copy rather
  than the only one, and managed Postgres would make `make backup-db` a portable
  extra.
- **Test restores periodically** — a backup you've never restored is a guess.
