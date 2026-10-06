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
- **No email — drop the email dependency instead of fixing it.** The Mailtrap
  sandbox was set up by a teammate and is unavailable, and for a small,
  controlled deployment (~60 vetted people, admin reachable) email verification
  and emailed password resets aren't worth their weight. Decision: remove the
  email dependency rather than wire up a provider. Details under
  *Remove the email dependency* below. (If the platform ever grows beyond a
  controlled cohort, revisit and add a real SMTP provider — the
  `email_verified` column is kept so verification can be re-enabled.)

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

### Remove the email dependency (controlled-environment auth)  ✅ DONE (2026-10-03)

Shipped on branch `peter` (commits de26086 backend, 94733f0 frontend, 5b778a5
tests): registration auto-verifies and sends no mail; login's email_verified
gate is gone; emailed forgot/reset + verify-email routes, the nodemailer
transport and the hardcoded Mailtrap creds are removed; admin password reset is
`POST /api/user/:id/reset-password` (Admin only) → system-generated one-time
password, surfaced on the admin org-detail page. 50/50 e2e green. Original plan
below for reference.

Decided 2026-09-30: for a small, controlled deployment we remove email from the
auth flow rather than run an SMTP provider. How auth works today (for context):
an Admin/Bocal whitelists an email (`POST /auth/invite` → `AuthAllowedEmail`
row); the student self-registers against the whitelist; the backend **emails a
verification link** (mandatory — if the send fails, registration rolls back);
login refuses any account whose email isn't verified; and password reset is via
an **emailed** token. Email is on the critical path in two places, both broken.

Changes (not yet implemented):

1. **Auto-verify on registration.** Keep self-registration (whitelisted email +
   chosen password), but set `email_verified = true` immediately and stop
   sending the verification email. Remove the mandatory email-send that
   currently rolls registration back. Keep the `email_verified` column so real
   verification can be re-enabled later.
2. **Drop forgot/reset-password by email.** Remove `POST /auth/forgot-password`
   and `POST /auth/reset-password`, the reset-token model usage, and the
   frontend forgot/reset-password pages + routes.
3. **Add an admin password reset — system-generated temp password** (decided:
   the system generates it, not the admin typing one). New admin-only endpoint
   (e.g. `POST /api/user/:id/reset-password` or under `/auth`, `Admin` only)
   that sets a new random password and returns it once, plus a "Reset password"
   button on the admin org/members page that shows the generated password for
   the admin to pass on. This is the "if something happens, ask the admin"
   path — without it there is currently **no** way to reset a forgotten
   password (only self-register or the emailed token, which we're removing).
4. **Delete the email-sending code and the committed Mailtrap secret.** Remove
   `sendVerificationEmail` / `sendResetEmail` and the hardcoded
   `sandbox.smtp.mailtrap.io` credentials from `auth/utils.js`; drop
   nodemailer and the `EMAIL_*` / `EMAIL_TRANSPORT` wiring (the e2e stack sets
   `EMAIL_TRANSPORT=json` today only to avoid real sends — unneeded once email
   is gone).
5. **Tests.** Extend the Playwright suite: registration activates an account
   with no email step; admin reset produces a working temp password; the
   removed endpoints/pages are gone.

Accepted trade-offs (fine at ~60 vetted users): no email verification means a
typo'd whitelist entry could register a slightly-wrong address (admin controls
the list, so catchable); password reset depends on the admin being reachable.

### Remove OAuth — frontend hidden ✅ (2026-10-03); backend left dormant
Done in the frontend (commit 94733f0): GitHub/Google buttons, divider,
handlers, the oauth-callback route/component and the dead scaffold copies are
gone. The backend `/google` + `/github` routes remain in place but unreachable
(decided: hide in frontend only). Remaining optional cleanup (backend) below.

### Remove OAuth (follow-up to the no-social-login decision)
- Backend: `/auth/google`, `/auth/google/callback`, `/auth/github`,
  `/auth/github/callback` and `findOrCreateOAuthUser` in the auth module.
- Frontend: the GitHub/Google buttons on the login page, `loginWithGitHub` /
  `loginWithGoogle`, and the `oauth-callback` route/component.
- Env / config: `GOOGLE_*`, `GITHUB_*` in `gen-env.sh` and `.env.example`.
- Keep the invite/whitelist registration path (now without email verification).

---

## 🟠 Should-do for a real deployment

- **Object storage** ✅ decided (2026-10-05): **stay on self-hosted MinIO + the
  backups below** — managed S3 isn't warranted at ~60 users and there's no
  audit/compliance obligation; the bar is just not losing files. Done: pinned the
  **official `quay.io/minio/minio`** image (was the `coollabsio` community mirror).
  The code stays parameterised (`MINIO_*`, `BASE_URL`), so a managed S3-compatible
  store remains a config-level upgrade path if we outgrow this (see
  `docs/STORAGE.md`). Buckets: `submissions`, `assignment-subjects`,
  `user-profile` (public via nginx `/files/`), and `eval-recordings` (private;
  presigned access only — the recordings are the teacher's proof a peer
  evaluation happened, irreplaceable, so they must be backed up).
- **Managed Postgres + backups.** Postgres runs containerised on a local
  volume. Production wants managed Postgres or, at minimum, a backup job for
  the `postgres` volume.
- **Backups** ✅ tooling + automation-ready (2026-10-05): `make backup` is the
  one-shot entry point (DB dump + file mirror + prune) for cron; `make backup-db`
  / `make backup-files` / `make restore-db` still exist; retention is built in
  (`BACKUP_KEEP_DAYS`, default 14) and `BACKUP_DIR` controls the output location.
  See `docs/BACKUPS.md` for the cron snippet. Remaining operational step (by
  design, manual): **move `$BACKUP_DIR` off-host** after each run — nothing
  auto-ships it off the box.
- **Secrets out of source / git.** The hardcoded Mailtrap SMTP creds in
  `auth/utils.js` are a committed secret. They go away with *Remove the email
  dependency* (step 4); they should also be rotated/invalidated since they're
  in git history. Keep any future secrets in `.env` / a secret store.

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
