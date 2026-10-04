# Object / file storage — options and recommendation

Research for taking PeerPilot to production. Companion to `GOING-LIVE.md`.
Last updated 2026-10-04.

## TL;DR

- Our file access is **S3-compatible already** — `packages/fileManager` talks to
  an S3 API via the MinIO client, pointed at any endpoint through `MINIO_*` env
  vars. **Switching providers is configuration, not code.**
- **Recommendation: use a managed, S3-compatible object store in production**
  (Cloudflare R2 or Backblaze B2 for cost; AWS S3 if already on AWS). Keep
  self-hosted MinIO only if we must keep all data on our own/one box.
- Whatever we choose, the **`eval-recordings`** bucket holds audit artifacts
  (proof evaluations happened) and **must be durable and backed up** (see
  `docs/BACKUPS.md`).

## What we store today

One MinIO container (`src/minio/docker-compose.yml`) on a **local Docker volume**
`minio_data`, reached by the browser only through nginx's `/files/` location.

| Bucket | Contents | Access | Created by |
| ------ | -------- | ------ | ---------- |
| `submissions` | student submission files | public read via `/files/`; downloads also presigned | `submission` + `eval` services |
| `assignment-subjects` | assignment subject files | public read via `/files/` | `class` service |
| `user-profile` | avatars | public read via `/files/` | `user` service |
| `eval-recordings` | **audio recordings of evaluations (audit)** | **private — presigned URLs only**, gated to staff/evaluator/group | `eval` service |

How access works (`packages/fileManager/index.js`):
- **Public** buckets get an anonymous-read policy (`makePublic()`), served at
  `${BASE_URL}/files/<bucket>/<key>` through nginx.
- **Private** access (`eval-recordings`, and submission downloads) uses
  **presigned GET URLs** (`getUrl`), time-limited, with the internal MinIO origin
  rewritten to `${BASE_URL}/files`.

Config knobs (all env): `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_USE_SSL`,
`MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, and `BASE_URL` (public origin).

### Current weaknesses for production
- **Local volume = single point of failure**, no redundancy, no backups.
- Image is a **community mirror** (`coollabsio/minio`), not official `minio/minio`.
- Presigned URLs are rewritten to go back through **our nginx** — fine for MinIO
  on the same host, but a managed store serves presigned URLs from its own
  domain (see "Switching", below).

## Requirements

- Durability for `eval-recordings` (audit) and submissions (student work).
- Backups / point-in-time recovery (see `docs/BACKUPS.md`).
- Private access that stays private (presigned, short-lived).
- Modest scale: a cohort of ~60 students; recordings up to ~200 MB each — tens of
  GB per term, not TB. Egress is light (staff/graders replaying recordings).

## Options

### A. Self-hosted MinIO (what we run now)
- **Pros:** no external dependency; all data on our own infrastructure; zero
  marginal cost beyond the box; already wired up.
- **Cons:** we own durability, backups, upgrades, and uptime. A single volume has
  no redundancy. Real resilience means multi-node MinIO or disk-level
  replication + snapshots — operational work we'd rather not carry.
- **If we keep it:** pin the **official `minio/minio`** image, put it on a
  dedicated/managed volume with **snapshots**, run **`docs/BACKUPS.md`** mirroring
  off-box, and set strong `MINIO_*` creds (already env-driven).

### B. Managed S3-compatible (recommended)
Same code; point `MINIO_*` at the provider.

| Provider | Why | Watch-outs |
| -------- | --- | ---------- |
| **Cloudflare R2** | S3 API, **no egress fees**, cheap storage, simple | newer ecosystem |
| **Backblaze B2** | S3 API, cheapest storage, generous free egress via CDN | region choice limited |
| **AWS S3** | gold standard, lifecycle/versioning/replication built in | egress costs; priciest |
| **Hetzner Object Storage** | S3 API, EU, cheap | region limited |

- **Pros:** durability/replication/backup are the provider's job; versioning and
  lifecycle rules available; no MinIO to operate.
- **Cons:** external dependency + credentials to manage; egress cost on some
  providers (R2/B2 mitigate this).

## Recommendation

1. **Production: Cloudflare R2** (or Backblaze B2) — S3-compatible, no/low egress,
   cheap at our scale, and it removes the durability/backup burden for the audit
   recordings. Use **AWS S3** instead only if we're already committed to AWS.
2. **Keep MinIO for local dev** (the current stack) — fast, offline, free.
3. Either way, enable **versioning** (or run the backup job) on `eval-recordings`
   and `submissions`, since those are the data we can't recreate.

## Switching (config, not code)

Because `fileManager` is S3-compatible:
1. Create the four buckets at the provider; set a public-read policy on the three
   public ones (or front them with the provider's public/CDN URL).
2. Set in `src/.env`: `MINIO_ENDPOINT=<provider endpoint>`, `MINIO_PORT=443`,
   `MINIO_USE_SSL=true`, `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` = provider keys.
3. Stop deploying the `minio` container in production (drop it from the prod
   compose; keep it in dev).
4. **Public-URL wiring:** today public files are served at `${BASE_URL}/files/…`
   via nginx, and presigned URLs are rewritten to that path. With a managed store
   the objects live on the provider's domain, so `fileManager`'s `getPublicUrl`
   and the `getUrl` origin-rewrite (currently `${BASE_URL}/files`) need to point
   at the provider (or keep nginx as a proxy to it). This is the one code touch —
   a small change in `packages/fileManager/index.js` to build URLs from a
   configurable public base rather than always `${BASE_URL}/files`.
5. Migrate existing objects with `mc mirror` (MinIO client) from the old bucket to
   the new one.

## Open decisions for the team
- Provider choice (R2 vs B2 vs S3) — driven by where we host and budget.
- Whether recordings have a **retention policy** (e.g. delete after the term) or
  are kept indefinitely as audit records.
