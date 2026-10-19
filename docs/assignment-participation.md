# Assignment participation and pairing management

`AssignmentParticipation` stores sparse assignment/user overrides. No rows are
backfilled. Active enrolled Students default to evaluee=true, evaluator=true;
Bocal/Admin participants default to false/false. Overrides persist both flags.
A course roster comprises active enrollees plus Bocal/Admin users in the course's
organisation who have not dropped this course. Course visibility alone never
makes staff eligible. WU external course numbers remain enrollment metadata.

Bocal manages the two flags in **Manage groups → Participation**. Unchecking an
evaluee who already belongs to an assignment group is rejected. Existing groups,
submissions and pairings are never changed by a participation update. Changing
evaluator eligibility affects new allocations; existing pending tasks remain
assigned and accessible. Existing groups containing currently ineligible members
are preserved and flagged; they are excluded from new pairing generation until
staff explicitly resolve their participation/allocation.

Group generation runs server-side in one transaction, allocating only ungrouped
eligible evaluees in user-ID order, using the assignment's group size. A final
short group is allowed, as before. Manual creation/member addition enforces the
same eligibility. Groups with submission/evaluee evaluation history cannot be deleted. Staff evaluators do not need a group or student enrollment;
`evaluatorGroupId` is derived when a membership exists and otherwise null.

## Pairing slots and workload

The staff management summary batches roster/overrides, groups, attempt history,
and course-wide evaluator workload. It returns missing required rounds and
requested retry slots using the existing outcome/feedback-gating resolver.
Failures without a completed feedback workflow and retry request do not enter
the retry queue. A pending replacement removes its slot from that queue.

A slot's candidates exclude noneligible participants, members of its evaluee
group, and every evaluator already attempted in that same round. In particular,
failed evaluators are never reused for their failed round. The existing unique
pairing identity also prevents reusing a cancelled evaluator/group/round tuple;
cancellation therefore requires choosing a different evaluator for that slot.
Reusing an evaluator in a *different* round is permitted when necessary.

Allocation preference is lexicographic: lowest course workload, lowest assignment
workload, not previously assigned to this group, then user ID. Workload includes
Pending and Submitted attempts, including retries, and excludes Cancelled work.
Counts are incremented after each allocation within a generation run. Participation,
group creation/addition and pairing generation lock the course row to serialize
these operations and balance against current course counts.

**Generate missing pairings** opens a preview/configuration modal. Group exclusions
apply to that run only. Evaluator-pool changes persist to the same participation
overrides in the generation transaction. Slots without candidates remain queued
and the result reports their number; valid slots can still be filled. **Create
single pairing** uses the same slot/candidate validation and workload counts.

Every replacement is a new `EvalAssignment` in the same required round with a new
unique six-digit passkey. Previous attempts, keys, feedback and submission files
are unchanged. A uniqueness collision aborts safely; the operation can be retried.
Repeated generation preserves valid Pending/Submitted pairings. Submitted attempts
cannot be edited/deleted through management. Pending pairings may be cancelled,
retaining their history. Bulk deletion and in-place identity edits are rejected.

## API and permissions

All management routes require authenticated Bocal/Admin. Summary, eligibility,
generation, manual allocation and cancellation also validate course scope (Bocal's
organisation; Admin may manage across organisations):

- `GET /api/eval/assignment/:id/management`
- `GET /api/eval/assignment/:id/participation`
- `PUT /api/eval/assignment/:id/participation`, `{participants:[{userId,...flags}]}`
- `POST /api/group/assignment/:assId/generate`
- existing `POST /api/eval/assignment/:id/generate-simple-pairings`, now non-destructive,
  optional `{groupIds,participants:[{userId,evaluatorEligible}]}`
- existing `POST /api/eval/eval-assignments`, selecting a missing/retry slot and user
- existing `DELETE /api/eval/eval-assignments/:id`, now pending-only cancellation

The Bocal sidebar links to the existing **Evaluator tasks** page. Staff task
queries include courses with their own assigned tasks even without enrollment;
students retain their existing active-enrollment restriction. Start/submit still
verify the authenticated evaluator and submission-close/passkey rules. Staff
privileges are preserved. No changes to grading or Feedback Required semantics.

## Deployment

Migration `20261019120000_assignment_participation` creates only the override table,
indexes and foreign keys. Regenerate Prisma before building the API image, apply
normal migrations, then recreate the API container. No database reset or reseed.
Angular's development server picks up source changes; a Docker-served frontend
requires its usual rebuild.

## Files changed

- `docs/assignment-participation.md`
- `src/api/src/modules/eval/pairing-management.js`
- `src/api/src/modules/eval/pairing-management.test.js`
- `src/api/src/modules/eval/routes.js`
- `src/api/src/modules/eval/service.js`
- `src/api/src/modules/eval/service.test.js`
- `src/api/src/modules/group/routes.js`
- `src/api/src/modules/group/service.js`
- `src/api/src/modules/participation/service.js`
- `src/api/src/modules/user/staff-dashboard.js`
- `src/api/src/modules/user/staff-dashboard.test.js`
- `src/frontend/src/app/app.routes.ts`
- `src/frontend/src/app/bocal-panel/classes/bocal-classes.component.html`
- `src/frontend/src/app/bocal-panel/classes/bocal-classes.component.ts`
- `src/frontend/src/app/core/services/assignment-workflow.service.ts`
- `src/frontend/src/app/core/services/group-service/group-service.ts`
- `src/frontend/src/app/eval-assignment-list/eval-assignment-list.component.html`
- `src/frontend/src/app/eval-assignment-list/eval-assignment-list.component.ts`
- `src/frontend/src/app/shared/assignment-participation.component.ts`
- `src/frontend/src/app/shared/assignment-workflow.spec.ts`
- `src/frontend/src/app/shared/course-settings.spec.ts`
- `src/frontend/src/app/shared/sidebar.component.ts`
- `src/packages/database/prisma/migrations/20261019120000_assignment_participation/migration.sql`
- `src/packages/database/prisma/schema.prisma`
