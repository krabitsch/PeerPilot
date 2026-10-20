# Retry history fixes — 20 October 2026

## Root causes and resulting behavior

1. **Assignment ordering:** the assignment query had no `orderBy`. The overview's
   `forkJoin` already preserves input order; API completion order was not the
   cause. The query now orders by `created_at`, then `id`, ascending. The shared
   frontend assignment service also sorts the response, covering analytics cards
   and selectors consistently without sorting titles.
2. **Repeated retry uploads:** eligibility checked whether a retry was awaiting
   evaluation, but never checked whether that retry had already received a file.
   Eligibility now compares the latest applicable failed attempt's
   `retryRequestedAt` with version `createdAt`. A version at/after that request
   consumes the opportunity. The check runs inside the existing submission-row
   lock and upload transaction, so simultaneous uploads cannot both succeed.
   The returned `canUploadRetryFile` becomes false and the existing student UI
   hides its upload action. A later failed replacement with a new retry request
   opens one new opportunity. Rejected uploads clean up only their new object.
3. **Bulk submissions:** the ZIP planner queried only legacy `file`, omitting
   `fileVersions`. It now includes the original and all chronological revisions,
   with group, submission and version IDs in paths to prevent filename collisions.
4. **Individual downloads:** `latestSubmissionFile` explicitly sorts revisions by
   creation time and ID, choosing the latest; original-file fallback and explicit
   historical-file downloads remain available.
5. **Evaluation CSV:** previously it iterated only responses, omitting pending
   replacements. It now iterates every pairing, including cancelled attempts,
   and adds any legacy unpaired responses/staff reviews. Rows retain existing
   section scores, written feedback, replies and recording names, and add pairing
   ID, chronological attempt number, status, outcome, creation/retry timestamps
   and response ID. Attempt numbers are per group and logical round.
6. **Recordings:** all original/replacement responses remain included when audio
   is requested. Paths contain group, round, pairing and response IDs; repeated
   filenames cannot overwrite one another. Excluding recordings still excludes
   audio streams while retaining evaluation CSV data.
7. **Score colors:** one shared helper uses the assignment threshold. Passing
   scores are green; failed scores >=50% are amber, lower failed scores red.
   The helper is used by score pills, submission confirmation, and the evaluator's
   submitted-evaluation view. Assignment Detail passes its actual threshold.
   Bocal analytics status icons use the backend's actual academic outcome.
8. **Pairing modal:** only actual backend missing/retry slots appear, one checkbox
   per group/round. Initial and retry slots have separate labels; retries show
   previous failed evaluators. The API accepts exact slot selections, validates
   them against the current queue, and retains support for existing group-based
   clients. Generation still fills only missing slots and preserves all history,
   fairness, eligibility, workload and self-evaluation restrictions.
9. **Analytics detail:** staff see Passed/Failed/Pending/Cancelled rather than
   Completed. All attempts remain, ordered by creation time and ID within a round,
   with explicit attempt numbers and direct evaluator names, including staff.
10. **Analytics table:** each existing round cell contains one icon per actual
    task/attempt, with wrapping and identifying title/accessible text. Passed is a
    green check, Failed a red cross, Pending an orange clock and Cancelled grey.
    Active pairing counts include retries and exclude cancellations. Missing-group
    counts use the backend queue, including unresolved retries. Participation
    defaults and evaluator-only participants remain respected. Evaluator progress
    uses actual task counts; evaluee progress counts distinct evaluated rounds.

## Changed files

Backend/API and shared utilities:

- `src/api/src/modules/eval/pairing-management.js`
- `src/api/src/modules/eval/pairing-management.test.js`
- `src/api/src/modules/eval/service.js`
- `src/api/src/modules/export/service.js`
- `src/api/src/modules/export/service.test.js`
- `src/api/src/modules/submission/files.js`
- `src/api/src/modules/submission/service.js`
- `src/api/src/modules/submission/service.test.js`
- `src/packages/utils/src/classUtils.js`

Frontend:

- `src/frontend/src/app/assignment-detail/assignment-detail.component.html`
- `src/frontend/src/app/bocal-panel/analytics/analytics-assignment.component.ts`
- `src/frontend/src/app/bocal-panel/analytics/analytics-assignment.component.html`
- `src/frontend/src/app/bocal-panel/analytics/analytics-assignment.component.css`
- `src/frontend/src/app/bocal-panel/analytics/analytics-student.component.ts`
- `src/frontend/src/app/bocal-panel/analytics/analytics-student.component.html`
- `src/frontend/src/app/bocal-panel/analytics/analytics-student.component.css`
- `src/frontend/src/app/bocal-panel/analytics/assignment-order.spec.ts`
- `src/frontend/src/app/bocal-panel/analytics/retry-history.spec.ts`
- `src/frontend/src/app/core/services/assignment-workflow.service.ts`
- `src/frontend/src/app/core/services/course-service/Assignment.service.ts`
- `src/frontend/src/app/core/services/eval-service/eval-service.ts`
- `src/frontend/src/app/eval-assignment-list/eval-assignment-list.component.ts`
- `src/frontend/src/app/eval-assignment-list/eval-assignment-list.component.html`
- `src/frontend/src/app/evaluation-flow/evaluation-flow.component.ts`
- `src/frontend/src/app/evaluation-flow/evaluation-flow.component.html`
- `src/frontend/src/app/shared/assignment-workflow.spec.ts`
- `src/frontend/src/app/shared/score-pill.component.ts`
- `src/frontend/src/app/shared/score-color.ts`
- `src/frontend/src/app/shared/score-color.spec.ts`

## Validation and deployment

- Targeted backend test files pass: submission service, export service, pairing
  management, evaluation service and CSV utilities.
- Targeted frontend tests pass: 26 tests across assignment ordering, historical
  analytics, participation/pairing management, score colors, Assignment Detail
  and evaluation workflow.
- Angular development build passes with existing unused-import warnings.
- Modified backend JavaScript syntax checks and `git diff --check` pass.
- Tests are non-destructive unit/component tests, not a live browser/MinIO ZIP
  download test. No database reset, reseed or historical-data deletion occurred.
- No schema migration or Prisma regeneration is required.
- Angular development server needs no restart; its watcher loads source changes.
- Docker-served API and frontend require their images rebuilt and services
  recreated. Running containers were not rebuilt/restarted by this source change.

## Existing model limits and policy

Revisions belong to the shared submission rather than a specific retry relation.
When several rounds request retry before the next upload, the newest eligible
request defines the shared revision window; that uploaded revision serves those
outstanding evaluations. A later request opens another window. Existing repeated
uploads are preserved and exported rather than removed.

The existing request endpoint always records `retryRequestedAt`. Legacy rows
without it cannot open a revision window automatically. Evaluation responses have
no independent submission/reply timestamps in the schema, so CSV includes the
available pairing creation and retry-request timestamps without inventing dates.
