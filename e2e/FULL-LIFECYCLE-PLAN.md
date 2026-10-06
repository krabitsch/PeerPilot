# Full-lifecycle e2e test — implementation plan (for review)

A single Playwright journey that builds a cohort **from the bottom up** and
drives every feature end-to-end: admin whitelists → accounts register → teacher
runs a class → students submit → two rounds of peer evaluation, each with a
recording upload. Draft for review — nothing is implemented yet.

Last updated 2026-10-05. Companion to the existing suite in `e2e/tests/`.

> **Status: implemented.** `e2e/tests/journeys/full-lifecycle.spec.js` (11 ordered
> steps) is green; the full suite is 61/61. Enrolment goes through a **new** Bocal
> "Add student to class" control (the UI had no staff enrol path before — see §5);
> groups are made with "Generate all groups" (one solo group per student).

---

## 1. Goal & scenario

One test proves the whole chain works together (today's specs each exercise one
slice against pre-seeded data; this one creates its own data through the app):

1. **Admin** signs in, creates an org, whitelists emails for a teacher + students.
2. Those people **register** against the whitelist and can sign in immediately
   (no email step).
3. Admin **promotes** the teacher account to **Bocal**.
4. **Teacher** creates a class, **enrols** the students, creates an **assignment**
   with an **uploaded subject file** and an **eval sheet**.
5. Teacher creates **one group per student** (group size 1).
6. **Students** each start a submission, upload a file, and close it (→ passkey).
7. Teacher **generates pairings** → **2 rounds** of evaluations.
8. Each assigned **evaluator** scores their evaluee, **uploads a recording**, and
   submits — for every pairing across both rounds.

Uploaded files are throwaway (a tiny PDF buffer, a tiny audio buffer) — we only
need the features to fire, not real content.

### Actors & data

| Thing | Value | Why |
| ----- | ----- | --- |
| Org | `Lifecycle Academy` (new) | built fresh, not the seeded org |
| Teacher | 1, registered then promoted to Bocal | register always makes a Student |
| Students | **3** (single-member groups) | 2 rounds needs ≥ 3 groups (see §2) |
| Class | 1, created by the teacher | all 3 students enrolled |
| Assignment | `groupSize = 1`, `req_eval = 2`, subject file + 2-section eval sheet | `req_eval` drives the number of rounds |
| Groups | 1 per student (3 total) | each student is their own "group" |
| Evaluations | `groups × rounds = 3 × 2 = 6` pairings | each student evaluates 2 others and is evaluated by 2 others |

Distinct emails/names (e.g. `lifecycle-*@e2e.test`) so this test's data never
collides with the seeded dataset or the other specs.

---

## 2. Key mechanics discovered (these shape the test)

Confirmed by reading the backend — flagging them because they constrain the data:

- **`req_eval` = number of evaluation rounds**, not evaluations per group.
  `generateSimpleEvalAssignmentPairings` loops `round = 1..req_eval`
  (`src/api/src/modules/eval/service.js:364`).
- **2 rounds ⇒ at least 3 groups.** The generator rejects
  `req_eval > groups − 1` (service.js:351). With `groupSize = 1`, that means
  **3 students minimum**. We use exactly 3.
- **Registration always creates a `Student`** (`auth/controller.js` →
  `createUser`). The teacher must be **promoted to Bocal** afterwards. There is
  an admin org-detail role control (`PATCH /api/org/:id/members {email, role}`).
- **Registration inherits the org from the invite** (`createUser(email, pw,
  allowedEmail.orgId)`), so whitelisting must happen **on the new org's page** so
  the invite carries that `orgId`. Teacher + students then all land in that org.
- **Pairing eligibility only needs a group with ≥1 member** (`evalUtils.js:52`)
  — a closed submission is *not* required to generate pairings. **But** the
  evaluation UI asks the evaluator for the **evaluee's leader email + passkey**,
  and the passkey only exists once that group **closes a submission**. So
  students must submit+close before evaluations can run through the UI.
- **Pairing is staff-triggered**: `POST /api/eval/assignment/:id/generate-simple-pairings`
  (teacher clicks "Generate all pairings" in the eval-assignment list).
- The eval **submit** requires a recording — the Submit button stays disabled
  until an audio file is attached (already covered by `evaluation.spec.js`).

### What the 6 pairings look like (3 groups A,B,C; shift = round)

| Round | Evaluee → Evaluator (by the circular offset) |
| ----- | -------------------------------------------- |
| 1 (shift 1) | A←B, B←C, C←A |
| 2 (shift 2) | A←C, B←A, C←B |

Each student evaluates 2 others and is evaluated by 2 others. The test reads the
actual generated `evalAssignment` rows from the DB (evaluator, evaluee group,
round) and the per-group passkeys, then drives the UI from that — rather than
hard-coding who evaluates whom (the generator seeds a shuffle by assignment id).

---

## 3. Step-by-step flow (UI unless noted)

| # | Step | How | Notes |
| - | ---- | --- | ----- |
| 1 | Admin signs in | reuse the seeded `admin` session | the bottom-up part is the *data*, not re-creating the admin |
| 2 | Create org | admin/orgs → **+ New org** | `admin.spec.js` already shows this form |
| 3 | Whitelist teacher + 3 students | org-detail whitelist form (single + bulk) | invites carry this org's id |
| 4 | Register all 4 | `/register` per email, then verify login works | auto-verify; `auth.spec.js` pattern |
| 5 | Promote teacher → Bocal | org-detail role control **(confirm UI; else `PATCH /api/org/:id/members`)** | **open decision — see §5** |
| 6 | Teacher signs in | UI login (no pre-saved session for new accounts) | needs a "fresh login" helper (§4) |
| 7 | Create class | bocal `+ New course` | `bocal.spec.js` pattern |
| 8 | Enrol the 3 students | bocal Students tab (EnrollService) **(confirm control; else `POST /api/enroll {classId, studentId}`)** | **open decision — see §5** |
| 9 | Create assignment + subject file + eval sheet | assignment-create form; file input is `input[type=file][accept*=".pdf"]`; `groupSize=1`, `req_eval=2` | subject-file input confirmed present |
| 10 | One group per student | bocal "Manage groups → Add single group" ×3 | `bocal.spec.js` pattern |
| 11 | Each student submits + closes | per-student fresh login → assignment-detail → start/upload/close → capture passkey | `student.spec.js` pattern |
| 12 | Generate pairings | teacher → eval-assignment list → "Generate all pairings" | assert 6 rows, rounds {1,2} |
| 13 | Complete every evaluation (both rounds) | for each pairing: evaluator fresh login → `/evaluation` → evaluee leader email + passkey → score → **upload recording** → submit | assert `evalAssignment.status='Submitted'` and `recordingFileId` set for all 6 |
| 14 | (optional) Verify recording access gate | fetch `/api/eval/responses/:id/recording` as evaluator/staff (ok) vs an outsider (refused) | reuse `evaluation.spec.js` helper |

---

## 4. Harness / support changes needed

- **New spec:** `e2e/tests/journeys/full-lifecycle.spec.js` (one `test`, or a
  `describe` with ordered steps sharing state). Runs under the existing
  `journeys` project; `workers: 1` already guarantees order.
- **Fresh-login helper** (`support/ui.js`): accounts created mid-test have no
  pre-saved session, so add `freshContext(browser, email, password)` that logs
  in via the API, injects the `access_token` into `localStorage` (mirroring
  `global-setup.js`), and returns a ready context/page. Used for the teacher and
  each student taking their turn.
- **Reuse existing fixtures:** `samplePdf` (subject file + submissions),
  `sampleAudioUpload` (recordings), `db()` (read generated pairings/passkeys and
  assert), `seeded()` only for the admin session.
- **No new seed data.** The test builds its own org/users/class; it does **not**
  modify `support/data.js` or `support/seed.js`. It coexists with the seeded
  dataset by using unique identifiers.
- **Data readback:** after step 12, query `evalAssignment` (+ each group's
  `submission.passkey`) to build the evaluator→(evaluee email, passkey, round)
  map that drives step 13 deterministically.

---

## 5. Decisions (settled 2026-10-05)

1. Promote-to-Bocal: **admin org-detail UI** (API only as fallback).
2. Enrolment: **Bocal Students-tab UI**.
3. Evaluations: **submit all 6** pairings across both rounds, each with a recording.
4. Structure: **ordered `describe` steps** sharing state.
5. No special tag — run standalone by filename (`npx playwright test full-lifecycle`).

### Original options (for reference)

1. **Promote-to-Bocal path** — drive the admin org-detail **role control in the
   UI**, or take the **API shortcut** (`PATCH /api/org/:id/members`)? (UI is more
   faithful; API is simpler/robust. I lean UI, with API fallback if the control
   is fiddly.)
2. **Enrolment path** — same question for adding students to the class: **Bocal
   Students-tab UI** vs `POST /api/enroll`. (Lean UI.)
3. **How many evaluations to actually submit** — all **6** pairings across both
   rounds (fully faithful, ~6 recording uploads, slower), or a **representative
   subset** (e.g. one per round) while asserting all 6 pairings were *generated*?
   (I lean: complete all 6 — it's what "they have to upload the recordings"
   asks, and keeps the proof honest.)
4. **One big test vs a few ordered steps** — a single long `test`, or a
   `describe` split into labelled steps (setup / teaching / submissions /
   evaluations) that share state for a clearer report? (I lean: ordered steps.)
5. **Runtime budget** — this is the heaviest journey (many logins + uploads).
   Acceptable, or should it be tagged (e.g. `@slow`) so it can be run on its own?

---

## 6. Non-goals

- Not testing real file contents, media playback, or audio validity — only that
  uploads are accepted and stored.
- Not replacing the existing focused specs — this adds breadth on top of them.
- Not changing app behaviour; if a step turns out to need an app change
  (e.g. no usable enrol/promote control), that's a finding to raise, not fix here.
