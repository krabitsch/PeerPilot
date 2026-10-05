# Object / file storage — options and recommendation

Research for taking PeerPilot to production. Companion to `GOING-LIVE.md`.
Last updated 2026-10-05.

## TL;DR

- **Decision: stay on self-hosted MinIO** (now on the official, pinned
  `quay.io/minio/minio` image) **plus the backups in `docs/BACKUPS.md`.** At our
  scale (~60 users) managed object storage isn't warranted — capacity and load
  were never the problem, and we have no audit/compliance obligation that demands
  provider-grade durability. The one real requirement is *don't lose files*,
  which disciplined backups cover.
- Our file access is **S3-compatible already** — `packages/fileManager` talks to
  an S3 API via the MinIO client, pointed at any endpoint through `MINIO_*` env
  vars. **So moving to a managed store later is configuration, not code** — it
  stays available as a zero-ops option if we ever outgrow this.
- The **`eval-recordings`** bucket holds the recordings a teacher uploads as
  **proof a peer evaluation happened**. They can't be re-created once the eval is
  over, so this bucket **must be backed up and kept** (see `docs/BACKUPS.md`).

## What we store today

One MinIO container (`src/minio/docker-compose.yml`) on a **local Docker volume**
`minio_data`, reached by the browser only through nginx's `/files/` location.

| Bucket | Contents | Access | Created by |
| ------ | -------- | ------ | ---------- |
| `submissions` | student submission files | public read via `/files/`; downloads also presigned | `submission` + `eval` services |
| `assignment-subjects` | assignment subject files | public read via `/files/` | `class` service |
| `user-profile` | avatars | public read via `/files/` | `user` service |
| `eval-recordings` | **audio recordings of evaluations (teacher's proof the eval happened)** | **private — presigned URLs only**, gated to staff/evaluator/group | `eval` service |

How access works (`packages/fileManager/index.js`):
- **Public** buckets get an anonymous-read policy (`makePublic()`), served at
  `${BASE_URL}/files/<bucket>/<key>` through nginx.
- **Private** access (`eval-recordings`, and submission downloads) uses
  **presigned GET URLs** (`getUrl`), time-limited, with the internal MinIO origin
  rewritten to `${BASE_URL}/files`.

Config knobs (all env): `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_USE_SSL`,
`MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, and `BASE_URL` (public origin).

### Current weaknesses for production
- **Local volume = single point of failure**, no redundancy. Mitigated (not
  removed) by the scheduled backups in `docs/BACKUPS.md` — which must be moved
  off-host to actually protect against losing the box.
- ~~Image is a community mirror~~ — **fixed**: pinned to the official
  `quay.io/minio/minio` image (published on quay.io, not Docker Hub; bundles
  `mc` + `curl`, so the healthcheck and backup scripts work unchanged).
- Presigned URLs are rewritten to go back through **our nginx** — fine for MinIO
  on the same host, but a managed store serves presigned URLs from its own
  domain (see "Switching", below).

## Requirements

- Don't lose `eval-recordings` (the teacher's proof an eval happened) or
  submissions (student work) — both are irreplaceable. No audit/compliance
  retention obligation applies; the bar is data-loss protection, not a formal
  audit trail.
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
- **What we do (chosen):** pinned the **official `quay.io/minio/minio`** image,
  run the scheduled `docs/BACKUPS.md` backups (DB + buckets) and move them
  off-host, and set strong `MINIO_*` creds (already env-driven). Optionally put
  the volume on a disk with snapshots for faster recovery.

### B. Managed S3-compatible (optional alternative)
Same code; point `MINIO_*` at the provider. Not chosen at our scale, but a clean
upgrade path if we outgrow self-hosting.

| Provider | Why | Watch-outs |
| -------- | --- | ---------- |
| **Cloudflare R2** | S3 API, **no egress fees**, cheap storage, simple | newer ecosystem |
| **Backblaze B2** | S3 API, cheapest storage, generous free egress via CDN | region choice limited |
| **AWS S3** | gold standard, lifecycle/versioning/replication built in | egress costs; priciest |
| **Hetzner Object Storage** | S3 API, EU, cheap | region limited |

- **Pros:** durability/replication/backup are the provider's job; versioning and
  lifecycle rules available; no MinIO to operate.
- **Cons:** external dependency + credentials to manage; egress cost on some
  providers (R2/B2 mitigate this); a monthly bill for something we can host.

## Recommendation

1. **Chosen: self-hosted MinIO (option A)** on the official pinned image, with the
   `docs/BACKUPS.md` backups scheduled and moved off-host. At ~60 users this is
   sufficient and avoids an external dependency and a bill; the data we can't
   recreate (`eval-recordings`, `submissions`) is protected by the backups.
2. **If we ever outgrow this** (much larger cohort, or we want durability to stop
   being our job): switch to a managed S3-compatible store — **Cloudflare R2** or
   **Backblaze B2** for low/no egress, **AWS S3** if we're already on AWS. Because
   `fileManager` is S3-compatible it's mostly config (see *Switching*), plus the
   one public-URL code touch noted there.
3. **MinIO stays the local-dev store** regardless — fast, offline, free.

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
- Whether recordings have a **retention policy** (e.g. delete after the term) or
  are kept indefinitely as the teacher's proof.
- (Only if we ever switch to managed storage) provider choice — R2 vs B2 vs S3,
  driven by where we host and budget.
