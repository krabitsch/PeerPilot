# Going to production

Tracking what's left before PeerPilot can go live. Kept in the repo so it
survives any single working session. Work happens on branch `peter`.

Legend: ✅ done · 🚧 in progress · 🔴 blocker · 🟠 should-do · 🟡 hardening

---

## Decisions made (2026-09-30)

- **No Google / GitHub OAuth.** The platform will *not* use social login.
  Students are given access by whitelisting their organisational email, then
  log in with email + password. The GitHub/Google buttons on the login page
  and the OAuth backend routes are now dead and should be removed — see
  *Remove OAuth* below.
- **Email provider access is currently lost.** The Mailtrap sandbox was set up
  by a teammate; we don't have the credentials right now. Real email is still
  needed (see the dependency note under *Real email*).

---

## Already done (Phase 4 baseline)

- ✅ Only nginx is published to the host; api / postgres / minio are internal.
- ✅ Secrets are generated randomly into `src/.env` (DB password, JWT secrets,
  MinIO keys) instead of shipping known defaults.
- ✅ `fileManager` refuses to start with default MinIO creds when
  `NODE_ENV=production`, and derives public file URLs from `BASE_URL`.
- ✅ `restart: unless-stopped` on the long-running services.
- ✅ Migrations and the admin seed run inside the stack for prod
  (`make migrate_prod`, `make seedAdmin_prod`).
- ✅ `make clean` is scoped to this project (does not touch other Docker images).

---

## 🔴 Blockers — the app is not correct in prod without these

### Real TLS  ✅ mechanism done — one manual step remains (needs a domain)
- Done: nginx no longer bakes a cert into the image. It reads
  `/etc/nginx/ssl/{fullchain,privkey}.pem` from a mounted volume; the
  entrypoint generates a self-signed pair there only if none is mounted (dev
  keeps working). nginx serves the ACME HTTP-01 challenge over HTTP and
  redirects everything else to HTTPS. `make cert` / `make cert-renew` issue and
  renew Let's Encrypt certs via an on-demand certbot service and reload nginx.
- Verified locally: self-signed fallback, HTTPS, ACME challenge path, a
  dropped-in real cert being served and surviving a restart, and the full e2e
  suite green on the rebuilt stack.
- **Remaining manual step (needs a public domain + host):** point DNS at the
  server with ports 80/443 open, run
  `make cert DOMAIN=<domain> CERTBOT_EMAIL=<email>`, then set
  `BASE_URL=https://<domain>/` in `src/.env`. `make cert` itself is untested
  against the live Let's Encrypt service (no domain yet).

### Real email
- `src/api/src/modules/auth/utils.js` **hardcodes Mailtrap sandbox credentials
  in source** and ignores the `EMAIL_*` variables that already exist in `.env`.
  So verification and password-reset emails go to a test inbox, not the user.
- Fix: use the `EMAIL_*` env vars (host/port/user/pass) for the SMTP transport;
  delete the hardcoded creds. The env-driven version is already in the file,
  commented out (note the typo `EMIAL_HOST`).
- **Dependency for our auth model:** login refuses an account whose email is
  not verified (`auth.controller.js` login → `ForbiddenError('Please verify
  your email…')`), and verification happens by emailed link. So the
  whitelist-email login flow **cannot work end to end until real email works**,
  unless we decide to pre-verify whitelisted accounts / skip verification for
  them. Open question to resolve when email access is restored.
- Blocked for now: we don't have the mail provider credentials.

### Remove OAuth (follow-up to the no-social-login decision)
- Backend: `/auth/google`, `/auth/google/callback`, `/auth/github`,
  `/auth/github/callback` and `findOrCreateOAuthUser` in the auth module.
- Frontend: the GitHub/Google buttons on the login page, `loginWithGitHub` /
  `loginWithGoogle`, and the `oauth-callback` route/component.
- Env / config: `GOOGLE_*`, `GITHUB_*` in `gen-env.sh` and `.env.example`.
- Keep the invite/whitelist + email-verification registration path.

---

## 🟠 Should-do for a real deployment

- **Managed object storage.** MinIO runs as a container on a local volume. Move
  to managed S3 (or MinIO with backups + lifecycle). The code is already
  parameterised (`MINIO_*`, `BASE_URL`).
- **Managed Postgres + backups.** Postgres runs containerised on a local
  volume. Production wants managed Postgres or, at minimum, a backup job for
  the `postgres` volume.
- **Backups** for both the `postgres` and `minio` volumes — nothing backs them
  up today.
- **Secrets out of source / git.** The hardcoded SMTP creds (above) are a
  committed secret; rotate them and keep secrets in `.env` / a secret store.

---

## 🟡 Hardening / polish

- **HSTS + security headers at the nginx TLS edge** (helmet covers the app;
  nginx could add `Strict-Transport-Security` etc.).
- **Container healthcheck on `api`** — db and minio have healthchecks; api only
  exposes `/health` with nothing checking it.
- **Real HTTP status codes** — every error currently returns HTTP 200 with the
  real code in the JSON body. The last Phase 2 item; needs a matching change to
  the Angular 401-refresh interceptor (keys off `err.status`). The Playwright
  suite's `expectError` accepts either 200 or the real code, so it stays green
  through the change — tighten it afterwards.

---

## Known product issues (not go-live blockers)

- Students still see an **Enroll** button that always fails (enrolment is
  staff-only); it should be hidden for students.
- A translation placeholder leaks on *Browse classes*: `{{threshold}}%`
  instead of the value.

---

## Notes

- `GET /api/user/:id` returning an email is **accepted** — email is not treated
  as sensitive here. Not a todo.
