# Teacher downloads — submissions, evaluation sheets, recordings

Spec for letting staff download, per assignment, every group's submission file,
the evaluation data as a CSV sheet, and the evaluators' audio recordings —
individually or as one organized ZIP. Companion to `docs/STORAGE.md`.
Last updated 2026-10-08.

## Goal

From the bocal panel, staff (`Bocal`/`Admin`) can download, for one assignment:

- each group's **submission file**,
- the **evaluation data as a CSV sheet**,
- the evaluators' **audio recordings**,

either one at a time or bundled into a single ZIP.

## What exists today (and the gaps)

| Artifact | Storage | Current access | Gap |
| --- | --- | --- | --- |
| Submission file | `submissions` bucket (public-read), 1/group | `GET /submission/:groupId/file/download` → presigned `{url}`, gated to **group members only** | staff not exempted — add staff bypass |
| Recording | `eval-recordings` bucket (private), 1/`EvalResponse` | `GET /eval/responses/:id/recording` → presigned `{url}`, **already staff-gated** | individual done; needs bulk + UI |
| Eval sheet | `EvalResponse` rows (scores, comment, reply, givenMarks, evaluator) — **not a file** | `GET /eval/submission/:subId/responses` returns JSON | no downloadable document — add CSV |

### Auth constraint that shapes everything

The frontend sends a Bearer token from the in-memory `AuthService`
(`auth-interceptor.ts`). A plain `<a download>` link cannot carry it, so:

- **Single files** → server returns a short-lived presigned MinIO URL as JSON;
  the browser opens it. (Already the pattern for submissions/recordings.)
- **Server-generated content (CSV, ZIP)** → the frontend fetches with
  `responseType: 'blob'` (the interceptor adds the token), then saves the blob
  via an object URL. These are **never** exposed as unauthenticated links.

### Error-handler caveat

`middleware/errorHandler.js` always replies `200` + JSON. For the streaming ZIP
route, all validation/DB lookups must happen **before** the first byte is
written; once streaming starts, an error can only destroy the socket, not emit
JSON.

## API specification

All new routes are `requireStaff`. New bulk routes live in a small **`export`
module** mounted at `/api/export` (keeps the teacher-facing bulk features
together; cross-domain Prisma access is already the house style after the
service consolidation).

### Individual submission (staff) — modify existing

`GET /api/submission/:groupId/file/download`

Pass `isStaff(req)` into `getDownloadUrl`; when staff, skip
`validateGroupMember` and return the presigned `{url}` for the group's last
submission file. Students keep today's membership check.

### Individual recording — no change

`GET /api/eval/responses/:id/recording` already works for staff.

### Evaluations CSV (per assignment)

`GET /api/export/assignment/:id/evaluations.csv` → `text/csv`,
`Content-Disposition: attachment`

One row per `EvalResponse` for the assignment. Columns:
`evalueeGroup, round, evaluatorUsername, evaluatorEmail, isStaffReview,
<one column per eval-section score>, totalGivenMarks, maxScore, comment, reply,
replied, recordingFileName`.

Round comes from the linked `EvalAssignment`
(`evalAssignment.evalResponseId`). No new dependency: a tiny CSV escaper (wrap
fields containing `"`, `,` or newline in quotes, double inner quotes).

### Bulk ZIP (per assignment)

`GET /api/export/assignment/:id/archive[?recordings=0]` → `application/zip`,
streamed.

Entry layout:

```
<class>-<assignment>/
  evaluations.csv
  submissions/<groupName>/<originalFileName>
  recordings/<groupName>/round<n>-<evaluatorUsername>-<originalName>
  MANIFEST.txt      # groups with no submission, evals with no recording
```

- Use `archiver` (store / level 0 — audio and zips do not recompress), piping
  MinIO `getObject` **streams** (never buffer a whole file). Memory stays
  bounded regardless of cohort size.
- `?recordings=0` omits the heavy audio (up to 200 MB each) for a quick
  submissions + CSV grab.
- **Sanitize** every entry name (group name, original filename) to block
  zip-slip / path traversal.

## Frontend specification

Home: `bocal-panel/analytics/analytics-assignment.component` (the teacher's
per-assignment page).

- **New `ExportService`** (`core/services/export-service/`):
  `downloadEvaluationsCsv(assId)` and
  `downloadAssignmentArchive(assId, { recordings })`, both `GET` with
  `responseType: 'blob'`; plus a `saveBlob(blob, filename)` helper (object URL →
  anchor click → revoke; filename from `Content-Disposition`).
- **Header buttons:** "Download all (ZIP)" with an "include recordings" toggle,
  and "Download evaluations (CSV)".
- **Per-row controls:** in the student/group table, a submission-download icon
  (→ `SubmissionService.getDownloadUrl` staff path → `window.open(url)`) and,
  where a response has a recording, a recording-download icon (→ existing
  `getRecordingUrl` → `window.open`).

## Access-control posture

New routes use `requireStaff`, matching the current analytics pages where **any
staff member sees any assignment** (`getSubmissionsForAssignment` staff scope is
`{}`). Per-teacher / per-org scoping is a separate, deferred decision.

## Edge cases & ops

- Groups with no closed submission / no file → skipped, listed in
  `MANIFEST.txt`.
- Legacy responses with `recordingFileId = null` → absent from `recordings/`,
  still present in the CSV.
- **nginx:** downloads are unaffected by `client_max_body_size` (upload-side).
  For the large streamed ZIP the `/api/` location now sets `proxy_buffering off`
  and `proxy_read_timeout 600s` (see `src/nginx/conf.d/default.conf`) so big
  archives stream straight through instead of disk-buffering or timing out.
- MinIO reads are streamed; no full-file buffering anywhere.

## Phased implementation plan

1. **Backend — individual + CSV:** staff bypass in
   `submission/service.getDownloadUrl`; `evaluations.csv` endpoint + CSV helper.
2. **Backend — bulk ZIP:** add `archiver` to `src/api`, new `export` module +
   streaming route, pre-stream validation, nginx check.
3. **Frontend:** `ExportService` + `saveBlob`, header buttons + toggle, per-row
   download icons.
4. **Tests + docs:** Playwright e2e on :8443 (staff → CSV header, ZIP starts
   with `PK` and holds the CSV + manifest, `recordings=0` excludes audio, student
   refused, staff bypass on the per-submission download) in
   `e2e/tests/api/exports.spec.js`; `node:test` unit tests for the CSV escaper
   and the zip-slip `sanitize` in `src/api/test/export-csv.test.js` (run with
   `npm test -w @transcendence/api`).

## Status

Phases 1–4 implemented on branch `peter` and verified: 7/7 unit tests,
6/6 new e2e specs, full e2e suite 67/67 green. Not yet committed.

## Decisions (defaults chosen)

- **Scoping:** keep "any staff sees any assignment" (matches current analytics).
- **Recordings in ZIP:** default **on**, with an opt-out toggle.
- **CSV granularity:** one CSV per assignment.
</content>
</invoke>
