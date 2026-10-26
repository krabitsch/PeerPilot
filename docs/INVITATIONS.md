# Invitation-only registration (Phase 1)

Apply the additive migration and regenerate the Prisma client before starting
this version. For the Docker production stack, `make re` rebuilds the client
and API, then runs the existing migration deployment target. Existing records
are preserved. No reset or seed is needed.

Configure these keys in `src/.env` (the generator supplies them for new setups):

```dotenv
EMAIL_TRANSPORT=json
EMAIL_FROM="Peerofessor <no-reply@example.invalid>"
PUBLIC_APP_URL=http://localhost:4200
INVITATION_EXPIRY_HOURS=168
EMAIL_SECURE=false
```

Use the URL where your browser actually opens the application. `BASE_URL` is
accepted as a fallback for existing installations. No domain is hardcoded in
application logic. JSON transport sends nothing over the network and prints the
complete email/link in API logs; use it only when exposing links in logs is
appropriate. The e2e stack retains JSON transport.

For real local or production delivery, set `EMAIL_TRANSPORT=smtp`, a real
`EMAIL_FROM`, `EMAIL_HOST`, `EMAIL_PORT`, and, when required, `EMAIL_USER` and
`EMAIL_PASS`. `EMAIL_SECURE=true` selects implicit TLS (usually port 465);
port 587 normally uses `false` with STARTTLS. SMTP failures are reported without
logging message content or credentials. Keep credentials out of Git.

Whitelisting and roster entry do not automatically send mail. Use Send invitation
or the scoped bulk action in Admin organization whitelists or the Bocal course
roster. Each send replaces the prior link; bulk sends run sequentially and
report independent success/failure counts. JSON-mode success means generated
locally, not delivered to an inbox. An SMTP success means accepted by the mail
server, not a guarantee of inbox delivery.

Public API:
- POST `/api/auth/invitation/validate`: `{token}` -> `{email}`.
- POST `/api/auth/register`: `{token,password}`; an email alone never authorizes registration.

Staff API:
- POST `/api/auth/invite/:id/send`: optional `{orgId}` scope.
- POST `/api/auth/invitations/send`: `{orgId}` for Admin organization bulk;
  `{classId,orgId}` for a course bulk action (required course for Bocal).
- Existing whitelist create/list/revoke endpoints remain, with organization checks.

Pending Bocal accounts are claimed in place, keeping usernames, IDs, enrollments,
groups, and pairings. Admin-whitelisted emails without accounts receive the
existing generated username. Existing OAuth sign-in remains; new OAuth account
creation cannot bypass invitation redemption. `AllowedEnrollment` and the
Admin password-reset flow are unchanged. Emailed password recovery is Phase 2.

Local startup and verification:

1. In `src/.env`, select one of the configurations below. Existing installations
   must add the new variables explicitly; the generator does not overwrite them.
2. From the repository root run:
   ```bash
   cd src/packages/database
   npx prisma generate
   npx prisma migrate deploy
   cd ../../..
   docker compose -f src/docker-compose.yml -f src/docker-compose.dev.yml build api
   docker compose -f src/docker-compose.yml -f src/docker-compose.dev.yml up -d --no-deps api
   cd src/frontend
   npm start -- --proxy-config proxy.conf.json
   ```
   These commands assume the existing development database/MinIO stack is running.
   To start existing services first, use
   `docker compose -f src/docker-compose.yml -f src/docker-compose.dev.yml up -d database minio`.
   No seed/reset/populate command is needed.
3. Open `http://localhost:4200` and sign in as Admin. In the organization page,
   whitelist an unused email address you control. Its status should be Not invited.
4. Click Send invitation. Its status becomes Invitation sent.
5. With JSON mode, run `docker logs -f api`, find the Development email entry,
   and copy the complete `http://localhost:4200/register?token=...` URL from its
   text body. JSON escaping shows newlines as `\n`; do not include them in the URL.
   With SMTP mode, open the delivered email and click its link on this computer.
6. Open the link in an incognito/logged-out browser. Confirm that the invited
   email is read-only and there is no username field. Enter matching strong
   passwords, create the account, and sign in. Refresh the Admin list: Registered
   should replace the invitation action.
7. For resend verification, send an invitation to another unused controlled
   address and save link A; click Resend and save link B. A must show the
   invalid/expired message; B must permit registration. Reusing B after successful
   registration must also fail.
8. Open `/register` without a token: only the invitation information and Sign in
   link should appear. Invalid or expired links must show the safe error state.

Safe local configuration (no real email):

```dotenv
EMAIL_TRANSPORT=json
EMAIL_FROM="Peerofessor <no-reply@example.invalid>"
PUBLIC_APP_URL=http://localhost:4200
INVITATION_EXPIRY_HOURS=168
```

Real local email configuration (use an SMTP-approved sender and your own secrets):

```dotenv
EMAIL_TRANSPORT=smtp
EMAIL_HOST=smtp.your-provider.example
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-smtp-user
EMAIL_PASS=your-smtp-password
EMAIL_FROM="Peerofessor <your-approved-sender@example.com>"
PUBLIC_APP_URL=http://localhost:4200
INVITATION_EXPIRY_HOURS=168
```

After changing environment variables, recreate the API with the `up -d --no-deps api`
command above; a restart alone does not load changed Compose environment values.
The local SMTP email will contain a localhost link. Open it on the development
computer; it is not a remotely accessible registration URL.

Production uses the same SMTP keys, with a real approved `EMAIL_FROM` and:

```dotenv
EMAIL_TRANSPORT=smtp
PUBLIC_APP_URL=https://peerofessor.com
INVITATION_EXPIRY_HOURS=168
```

Set `EMAIL_SECURE` according to the provider's port/TLS instructions. Keep the
SMTP password in deployment secrets or the untracked environment file. Production
must explicitly use SMTP. SMTP never logs the invitation link or message content.

Bocal manual verification:

1. Choose the course in Students. Add an unused controlled email and its official
   course number using Add student to class (or Add several).
2. Confirm the student is immediately enrolled and appears in Pending Registration.
   Record its User ID and, where present, enrollment/group/pairing rows before
   registration using Prisma Studio or your existing database inspection tools.
3. Send its invitation and register through the received/generated link.
4. Refresh Students. The account should move to Registered Students. Confirm the
   same User ID, username, course number, enrollment, groups and pairings remain.
5. Bulk-send within the selected class. Registered accounts must be excluded.
   Admin bulk sending instead covers the selected organization's whitelist.
6. As Bocal, manually supplying another organization's orgId or invitation ID
   to whitelist list/create/revoke/send must fail. Bulk sending for another
   organization's class must also fail.

Implementation and checks:

- Migration `20261026120000_add_invitation_tokens` adds nullable
  `invite_token_hash`, `invite_token_expiry`, `invite_sent_at`, and a unique index
  on the hash. It changes no existing rows or unrelated models.
- Tokens contain 32 random bytes encoded as Base64URL; only SHA-256 hashes are
  stored. Default expiry is 168 hours (7 days), configurable above.
- Redemption hashes the password before a Prisma transaction. A conditional
  update consumes the matching, unexpired, unused token and locks its row; a
  pending local auth row is then conditionally claimed, or a new User and auth
  row are created. A failure rolls back consumption. Concurrent redemption
  cannot consume the same invitation twice.
- Pending account identity and relationships are not recreated or edited.
  New usernames use the existing generator. Identity comes from the token,
  ignoring any caller-supplied email.
- Registration state comes from credentials/provider state, rather than `used`.
  Staff lists expose status and timestamps, never token hashes or raw tokens.
- Bocal whitelist operations are restricted to their organization; class bulk
  sending also checks the class organization and selects active enrollments.
  Admin-specified organizations must exist. Public users only validate/redeem.
- The reusable Nodemailer service supports explicit JSON and SMTP transports.
  Resending replaces the old hash. Delivery failure clears the new token and
  returns a safe error; sequential bulk sending isolates recipient failures.
- Existing OAuth sign-in is retained; new OAuth account creation cannot bypass
  invitation redemption. No self-service password reset was added.

Run backend checks in the API container (it has the workspace dependencies):

```bash
docker exec -w /app/api api npm test
docker exec -e INVITATION_DB_TEST=1 api node api/src/modules/auth/invitationService.integration.test.js
```

The opt-in PostgreSQL test exercises new-account redemption and claiming an
existing pending account, checks password hashing and token consumption, compares
actual enrollment/group/pairing rows, and intentionally rolls back all writes.
It requires at least one existing pending account. It does not send email.
PostgreSQL sequences may advance even when transactions roll back.

Frontend checks:

```bash
cd src/frontend
npm test -- --watch=false --include='src/app/register/register.component.spec.ts' --include='src/app/bocal-panel/students/bocal-students.component.spec.ts'
npm run build -- --configuration development
```

Final verification from the resumed implementation:

- Existing invitation migration applied successfully; no other migration created.
- Prisma client regenerated and only the API image rebuilt/recreated.
- Before/after database data snapshots confirmed existing User and Enrollment rows unchanged.
- Full API suite: 159 passed, 1 opt-in database test skipped; that database test passed separately.
- Focused frontend suite: 11 passed. Angular development build passed with existing unused-import warnings.
- JavaScript/shell syntax checks and `git diff --check` passed.
- Real SMTP inbox delivery and interactive browser flows remain manual checks; no real email was sent during automated verification.

Files changed or added (including work recovered from the interrupted run):

- `docs/INVITATIONS.md`
- `scripts/gen-env.sh`
- `src/api/src/modules/auth/controller.js`
- `src/api/src/modules/auth/controller.test.js`
- `src/api/src/modules/auth/invitationService.integration.test.js`
- `src/api/src/modules/auth/invitationService.js`
- `src/api/src/modules/auth/invitationService.test.js`
- `src/api/src/modules/auth/routes.js`
- `src/api/src/modules/auth/userModel.js`
- `src/api/src/modules/org/routes.js`
- `src/api/src/modules/org/service.js`
- `src/api/src/services/invitationState.js`
- `src/api/src/services/mailService.js`
- `src/api/src/services/mailService.test.js`
- `src/frontend/src/app/admin/org-detail/org-detail.component.html`
- `src/frontend/src/app/admin/org-detail/org-detail.component.ts`
- `src/frontend/src/app/bocal-panel/students/bocal-students.component.html`
- `src/frontend/src/app/bocal-panel/students/bocal-students.component.spec.ts`
- `src/frontend/src/app/bocal-panel/students/bocal-students.component.ts`
- `src/frontend/src/app/register/register.component.spec.ts`
- `src/frontend/src/app/register/register.component.ts`
- `src/frontend/src/app/services/auth.service.ts`
- `src/packages/database/prisma/migrations/20261026120000_add_invitation_tokens/migration.sql`
- `src/packages/database/prisma/schema.prisma`
