# Backups

How to back up and restore PeerPilot's two pieces of state: the **PostgreSQL
database** and the **MinIO file storage**. Companion to `docs/STORAGE.md` and
`GOING-LIVE.md`. Last updated 2026-10-04.

Nothing backs these up automatically yet — run the targets below (ideally on a
schedule, see *Scheduling*). Output goes to `backups/` (git-ignored); **copy it
off this host** for it to count as a real backup.

## What there is to back up

| State | Where | Backup target |
| ----- | ----- | ------------- |
| Database (users, classes, submissions, evaluations, …) | Postgres `database` container, volume `src_postgres_data` | `make backup-db` |
| Files (submissions, assignment subjects, avatars, **evaluation recordings**) | MinIO `minio` container, volume `src_minio_data`, buckets `submissions` / `assignment-subjects` / `user-profile` / `eval-recordings` | `make backup-files` |

The `eval-recordings` bucket holds audit artifacts (proof evaluations happened),
so it is the most important thing to back up and keep.

## Commands

```bash
make backup-db       # → backups/db/peerpilot-<db>-<timestamp>.sql.gz
make backup-files    # → backups/files/<bucket>/...
make restore-db FILE=backups/db/peerpilot-db-20261004-164437.sql.gz
```

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

Nightly DB dump + weekly file mirror, from the repo root:

```cron
# m h  dom mon dow   command
0 2 * * *   cd /srv/peerpilot && make backup-db      >> /var/log/pp-backup.log 2>&1
0 3 * * 0   cd /srv/peerpilot && make backup-files   >> /var/log/pp-backup.log 2>&1
```

Then sync `backups/` to off-host storage (object storage or another machine),
e.g. `mc mirror backups/ <remote>/peerpilot-backups/` or `rclone`/`rsync`.

## Retention & off-host (do before go-live)

- **Keep backups off this host.** A backup on the same disk as the data is not a
  backup. Mirror `backups/` to a second location on each run.
- **Retention:** keep, say, 14 daily DB dumps + 8 weekly file mirrors; prune
  older ones. (Add a `find backups/db -mtime +14 -delete` step, or use the
  object store's lifecycle rules.)
- **Managed-storage note:** if we move files to a managed S3-compatible store
  (see `docs/STORAGE.md`), enable **versioning** there and `make backup-files`
  becomes a secondary copy rather than the only one. For managed Postgres, use
  the provider's automated backups and keep `make backup-db` as a portable
  extra.
- **Test restores periodically** — a backup you've never restored is a guess.
