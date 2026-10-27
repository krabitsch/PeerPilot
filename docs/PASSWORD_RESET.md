# Self-service password reset (Phase 2)

Public pages: `/forgot-password` and `/reset-password?token=...`.
The existing Sign In page links to Forgot password. Reset requires no email entry.
The reset page shows an invalid/expired state for missing, unknown, expired or
consumed links, with a link to request another. Weak passwords use the existing
registration strength policy (zxcvbn score >= 3); confirmation must match.

Public API (under `/api/auth`):

- `POST /forgot-password` with `{email}`: always returns the same message for
  syntactically valid addresses, including unknown, pending, OAuth accounts,
  delivery failures, and throttled requests:
  `If an account exists for that email address, a password reset link has been sent.`
- `POST /reset-password/validate` with `{token}`: returns only `{valid:true}`
  for an eligible unexpired token; no identity, hashes or organization data.
- `POST /reset-password` with `{token,password}`: changes the password once and
  returns a success message. Errors follow the application's existing error
  envelope, which the frontend error-normalizer handles.

Only local accounts with an existing password are eligible. Pending accounts
must use invitations; OAuth-only accounts cannot acquire a local password here.
Emails are trimmed/lowercased with case-insensitive lookup; ambiguous legacy
identities fail closed with the same public response.

Reset tokens contain 32 cryptographically random bytes encoded as Base64URL.
Only SHA-256 hashes and expiry are stored in the existing `UserAuth` reset fields.
A new request replaces the previous token. Delivery failure conditionally clears
only the failed request's token. Request/expiry never modifies the password.
Default expiry is 20 minutes; optionally set `PASSWORD_RESET_EXPIRY_MINUTES=20`.
New environment generation includes that variable; existing `.env` files were
not changed. No schema migration or regenerated Prisma client is needed.

Successful redemption bcrypt-hashes the new password, then uses a Prisma
transaction and conditional update to replace the password, clear hash/expiry,
and delete this user's persisted refresh tokens. Failures roll back all changes;
concurrent redemption cannot succeed twice. User/UserAuth identities remain.
Existing access tokens retain their normal short lifetime. Admin replacement
password functionality and invitation state/content/controls are unchanged.

Forgot-password limits: 5 requests per IP and 3 per normalized email per 15 minutes.
Both apply without regard to account existence; over-limit responses stay generic.
The existing development/e2e `AUTH_RATE_LIMIT_SCALE` applies, and is ignored in
production. Email limiter keys are SHA-256 hashes. Limits use the existing
in-process express-rate-limit infrastructure; restarting the API clears them.
Validation allows 30 attempts and redemption 5 per IP per 15 minutes.

Mail uses the existing shared Nodemailer transport and a new password-reset
message. SMTP sends never log reset links or credentials. Explicit development
JSON mode generates/logs the message without delivery. Reset messages are not
logged in production even if JSON transport is selected. Production should use
SMTP. A generic response confirms receipt of the request, not inbox delivery;
server-side failures are logged without account details or secrets.

## Local JSON-mail verification

1. Use a registered **local** test account whose current password you know.
   A pending invitation account is not eligible.
2. In your untracked `src/.env`, set:
   ```dotenv
   EMAIL_TRANSPORT=json
   PUBLIC_APP_URL=http://localhost:4200
   PASSWORD_RESET_EXPIRY_MINUTES=20
   ```
   Use a development `NODE_ENV` so JSON emails appear in logs.
3. With the existing development stack running, reload environment values:
   ```bash
   docker compose -f src/docker-compose.yml -f src/docker-compose.dev.yml up -d --no-deps api
   ```
   Dev mounts API source. For an image-based deployment, build only `api` first.
   Start Angular if needed:
   ```bash
   cd src/frontend
   npm start -- --proxy-config proxy.conf.json
   ```
4. Open `http://localhost:4200/login` logged out. Click Forgot password, enter the
   registered test email, submit, and confirm the generic message.
5. Run `docker logs -f api`. Copy the `/reset-password?token=...` URL from the
   Development email JSON message (exclude escaped newlines).
6. Before using it, sign in with the old password: it must still work. Then sign
   out or use a separate incognito browser for the reset page.
7. Open the reset link, enter a strong new password twice, and submit. Confirm the
   success state. Old-password login must fail; new-password login must work.
8. Reopen the link: it must show the invalid/expired message. Request two more
   links: the first must fail after the second request. Respect the email limit
   of 3 requests per 15 minutes when performing these checks.
9. Enter a nonexistent address and a pending student's address. Both must show
   the same generic message without generating reset mail. Use test addresses
   you control and observe the IP limit while checking.
10. To test expiry, temporarily set `PASSWORD_RESET_EXPIRY_MINUTES=1`, recreate the
    API, request a link and wait over one minute. It must fail without affecting
    the old password. Restore the normal setting afterwards.

## SMTP / Brevo verification

1. Keep your working SMTP/Brevo host, port, TLS flag, username, password, and
   approved `EMAIL_FROM` in the untracked environment. Do not copy credentials
   into source files. Set `EMAIL_TRANSPORT=smtp` and `PUBLIC_APP_URL` to the URL
   you will open in the browser (locally `http://localhost:4200`, production your
   public HTTPS origin). The reset code contains no provider-specific settings.
2. Recreate only the API as above to load changed environment values.
3. From Sign In choose Forgot password, enter a registered local account email
   you control, and submit. Confirm the generic response.
4. Receive the real Brevo email titled “Reset your Peerofessor password”. For
   localhost links, open it on the development computer.
5. Confirm the old password still works before redemption. Open the link logged
   out/incognito, choose and confirm a strong new password, submit, then sign in
   with the new password. The old password and used link must fail afterwards.
6. SMTP API logs must not contain the reset URL. Existing refresh tokens are
   deleted on success; short-lived access tokens expire normally.

## Automated verification

```bash
docker exec -w /app/api api npm test
docker exec -e PASSWORD_RESET_DB_TEST=1 api node api/src/modules/auth/passwordResetService.integration.test.js
cd src/frontend
npm test -- --watch=false --include='src/app/password-recovery/password-recovery.spec.ts' --include='src/app/register/register.component.spec.ts'
npm run build -- --configuration development
```

The opt-in reset test uses PostgreSQL and real bcrypt with temporary account and
refresh-token rows inside a transaction that intentionally rolls back. It stubs
mail delivery and does not affect existing accounts (sequences may advance).
The existing opt-in invitation integration test additionally requires a pending
roster account; it is separate from the reset tests.

## Results for this implementation

- Full API suite: 171 passed, 2 opt-in database tests skipped, no failures.
- PostgreSQL reset integration: passed separately, all writes rolled back.
- Existing invitation/auth tests: passed, covering registration, pending-user
  claiming, resend and invitation-only generic registration.
- Optional live invitation integration: could not run because this database has
  no pending roster account. No fixture was added or existing roster changed.
- Frontend: 14 recovery/registration tests passed. Angular development build
  passed without warnings or errors. Shell/JavaScript syntax and diff checks passed.
- Actual SMTP/Brevo inbox delivery remains a manual check. No real email was sent.

## Files changed or added

- `docs/PASSWORD_RESET.md`
- `scripts/gen-env.sh`
- `src/api/src/modules/auth/passwordResetController.js`
- `src/api/src/modules/auth/passwordResetRoutes.test.js`
- `src/api/src/modules/auth/passwordResetService.integration.test.js`
- `src/api/src/modules/auth/passwordResetService.js`
- `src/api/src/modules/auth/passwordResetService.test.js`
- `src/api/src/modules/auth/routes.js`
- `src/api/src/services/mailService.js`
- `src/api/src/services/mailService.test.js`
- `src/frontend/src/app/app.routes.ts`
- `src/frontend/src/app/login/login.component.ts`
- `src/frontend/src/app/password-recovery/forgot-password.component.ts`
- `src/frontend/src/app/password-recovery/password-recovery.css`
- `src/frontend/src/app/password-recovery/password-recovery.spec.ts`
- `src/frontend/src/app/password-recovery/reset-password.component.ts`
- `src/frontend/src/app/services/auth.service.ts`
