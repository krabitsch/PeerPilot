# Production runbook — running & changing the PeerPilot server

How to stand up the production server, operate it day to day, and — most
importantly — **ship changes without destroying the data already in prod**.

Companion to `GOING-LIVE.md` (what's left before launch), `docs/BACKUPS.md`
(backup/restore detail) and `docs/STORAGE.md`. Last updated 2026-10-06.

All commands run **from the repo root on the server**, over SSH, unless noted.

---

## 0. The one rule that matters

**All prod data lives in two Docker named volumes:**

| Volume | Holds |
| ------ | ----- |
| `src_postgres_data` | the database — users, classes, assignments, evaluations, everything |
| `src_minio_data` | the files — submissions, subject files, avatars, **evaluation recordings** |

Everyday commands (`build`, `up`, `down`, `restart`, `re`, rebuilds, migrations)
**keep these volumes**. Only a short list of commands destroys them — see
[§6 Never run these in prod](#6-never-run-these-in-prod). If you learn nothing
else from this doc, learn that list.

---

## 1. First-time setup (once, when you get the VPS + domain)

1. **Point DNS at the server.** Create an `A` record for your domain →
   the server's IPv4. (Keep the box dual-stack; an `AAAA` is fine too, but the
   `A` record is what matters — see the IPv4 note in `GOING-LIVE.md`.) Make sure
   ports **80 and 443** are open to the internet.

2. **Install prerequisites on the server:** Docker Engine + the Compose plugin,
   `git`, and `make`. Give the box some **swap** (2–4 GB) — the frontend image
   build is memory-hungry and the VPS has 4 GB RAM (see `docs/STORAGE.md`):
   ```bash
   sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile \
     && sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```

3. **Clone the repo and check out the release branch:**
   ```bash
   git clone <repo-url> peerpilot && cd peerpilot
   git checkout peter      # or main, once merged
   ```

4. **Generate `src/.env`, then set the production values.** Generate it once:
   ```bash
   bash scripts/gen-env.sh      # interactive — or add --defaults then edit
   ```
   Then **edit `src/.env`** and set, at minimum:
   - `NODE_ENV=production` — required. (The app refuses to start with default
     MinIO credentials when this is set; it also hardens behaviour.)
   - `BASE_URL=https://<your-domain>/` — public origin; file/links are built
     from it.
   - `ADMIN_EMAIL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` — **change these from the
     defaults** (`admin@example.com` / `Test1234!`). This is the first admin
     login, seeded on first start.

   > `gen-env.sh` also generates random DB / JWT / MinIO secrets. **Keep
   > `src/.env` safe and never regenerate it on a live server** — the Postgres
   > volume was initialised with the DB password in that file; a new `.env`
   > would no longer match and the database would reject connections.

5. **Build and start:**
   ```bash
   make run        # = build images + start + migrate + seed the admin
   ```
   `make run` builds the images, starts the stack detached, applies DB
   migrations, and ensures the admin account exists. Only nginx is published
   (ports 80/443); api / postgres / minio stay internal.

6. **Get a real TLS certificate** (stack must be running, DNS must resolve):
   ```bash
   make cert DOMAIN=<your-domain> CERTBOT_EMAIL=<you@example.com>
   ```
   This runs certbot's HTTP-01 challenge through nginx, installs the cert, and
   reloads nginx. If you hadn't set `BASE_URL` yet, set it now and restart
   (`make restart`).

7. **Verify:** open `https://<your-domain>`, sign in as the admin, and check
   `make status` shows every container healthy.

8. **Turn on backups and TLS renewal** — see [§4](#4-backups--restore) and
   [§5](#5-tls-renewal). Do this now, not "later".

---

## 2. Everyday operations

```bash
make status          # list containers + health
make logs            # follow all logs (Ctrl-C to stop)
make up              # start the stack (if stopped) — keeps all data
make down            # stop the stack — keeps all data
make restart         # stop, then start again (no rebuild) — keeps all data
```

`down`/`up`/`restart` never touch the data volumes. A server reboot is fine —
the containers restart on their own (`restart: unless-stopped`); `make up`
brings anything up that didn't.

---

## 3. Shipping changes safely (the important part)

The safe deploy is: **back up → pull → rebuild → migrate**. Data volumes are
preserved throughout because nothing here uses `-v`.

```bash
# 1. Back up FIRST — so a bad deploy is recoverable (see §4)
make backup

# 2. Get the new code
git pull            # (git fetch && git checkout <tag/branch> for a pinned release)

# 3. Rebuild images and restart with the new code
make re             # = down (keeps volumes) + build + start + migrate + seed

# 4. Confirm
make status         # all healthy?
make logs           # watch for errors; then Ctrl-C
```

Why this is data-safe:
- **Rebuilding images does not touch named volumes.** New `api`/`frontend`/
  `nginx` images, same `src_postgres_data` and `src_minio_data`.
- **`make re` uses `down` without `-v`** — it recreates containers but keeps
  volumes. (`make run` is also fine; it doesn't stop first, just rebuilds and
  recreates changed containers.)
- **Migrations are applied with `prisma migrate deploy`** (via `make
  migrate_prod`, which `make re`/`make run` call), which only plays **committed,
  pending** migrations forward. It never resets the database.

### Database migrations — the one thing to review
`prisma migrate deploy` is forward-only and non-interactive, but a *migration
itself* can still be destructive if someone wrote it to drop or rename a column.
Before deploying a release that includes new migrations:
1. Read the new files under `src/packages/database/prisma/migrations/`.
2. If any `DROP`/`ALTER ... DROP`/data-moving SQL is there, make sure a
   `make backup` ran immediately before, and ideally rehearse the migration on a
   **copy** of the prod DB first (restore a dump into a scratch stack).

Run migrations alone (without a full redeploy) with:
```bash
make migrate_prod
```

### Rolling back a bad deploy
```bash
git checkout <previous-tag>   # back to the known-good code
make re                       # rebuild/restart on it
```
If a *migration* corrupted data, code rollback isn't enough — restore the
pre-deploy dump (see §4). This is why step 1 is "back up first".

---

## 4. Backups & restore

The tooling exists (`make backup` / `make restore-db`, see `docs/BACKUPS.md`);
**it only protects you once it's scheduled and copied off the box.**

- **What `make backup` does:** dumps Postgres (gzipped, timestamped) and mirrors
  all four MinIO buckets into `$BACKUP_DIR` (default `backups/`), then prunes DB
  dumps older than `BACKUP_KEEP_DAYS` (14). It does **not** move anything
  off-host.
- **Point `BACKUP_DIR` off the 80 GB system disk**, or sync it off immediately —
  the file mirror keeps a *second copy* of every recording, and a backup on the
  same disk as the data is not a backup.
- **Schedule it** (example `crontab -e`, adjust path):
  ```cron
  0 2 * * *  cd /root/peerpilot && BACKUP_DIR=/mnt/backups make backup >> /var/log/pp-backup.log 2>&1
  # then push /mnt/backups off-box (rsync/rclone) — see docs/BACKUPS.md
  ```
- **Restore the database:**
  ```bash
  make restore-db FILE=backups/db/peerpilot-<db>-<timestamp>.sql.gz   # destructive: replaces current DB
  ```
  Restore files by mirroring a saved bucket copy back with `mc` (steps in
  `docs/BACKUPS.md`).
- **Test a restore once** into a scratch environment — an untested backup is a
  guess.

---

## 5. TLS renewal

Let's Encrypt certs last 90 days. Renew on a schedule (safe to run daily; it
only acts within 30 days of expiry):
```cron
0 3 * * *  cd /root/peerpilot && make cert-renew >> /var/log/pp-cert.log 2>&1
```
`make cert-renew` renews and reloads nginx automatically.

---

## 6. Never run these in prod

These **delete data** or break the deployment. There is no undo.

| Command | What it destroys |
| ------- | ---------------- |
| `make clean` | **Drops `src_postgres_data` and `src_minio_data`** (and built images). All data gone. |
| `make fclean` | `clean` **plus deletes `src/.env`** (loses the secrets that match the volumes). |
| `make resetDB` | **Wipes the database.** (Prompts, but still.) |
| `make populateDB` | **Wipes the database** and loads fake sample data. |
| `make dev` | Dev overlay — **publishes Postgres/MinIO/api ports to the host** (security hole) and uses host-side migration. Use `make prod` / `make run`. |
| `docker compose ... down -v` | The `-v` drops the volumes. Never add `-v` in prod. |
| `docker volume rm src_postgres_data` / `src_minio_data` | Deletes the data directly. |
| regenerating / deleting `src/.env` | New secrets won't match the existing volumes; DB connections fail. |

If you ever *intend* to wipe and start fresh, take a `make backup` first and be
certain.

---

## 7. Quick troubleshooting

- **A container is unhealthy:** `make logs` (or `docker compose -f
  src/docker-compose.yml logs <service>`). Then `make restart`.
- **Site down after a deploy:** `make status`; if a new image is bad, roll back
  (§3). Check nginx and api logs first.
- **"MinIO default credentials" error on start:** `NODE_ENV` isn't
  `production`, or MinIO creds are still defaults — fix `src/.env`, `make restart`.
- **DB auth failures after touching `.env`:** the `.env` no longer matches the
  `src_postgres_data` volume. Restore the original `.env`; do **not** `make
  fclean` unless you mean to wipe.
- **Disk filling up:** usually `backups/` (the file mirror) or accumulating
  recordings — see `docs/STORAGE.md`. Move backups off-box; consider a recording
  retention policy.
- **Cert problems:** re-run `make cert …`; ensure 80/443 are open and DNS
  resolves to this host.
