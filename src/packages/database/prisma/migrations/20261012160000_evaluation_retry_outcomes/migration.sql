BEGIN;

-- Preserve all existing responses; each pairing owns its own response.
ALTER TABLE "evalAssignment"
  ADD COLUMN "retryRequested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "retryRequestedAt" TIMESTAMP(3);
DROP INDEX "evalResponse_subId_userId_key";
CREATE INDEX "evalResponse_subId_userId_idx" ON "evalResponse"("subId", "userId");

-- Repair cached pass/fail independently of replies, without changing finalScore.
WITH round_outcomes AS (
  SELECT s.id AS submission_id, a.req_eval,
    required_round.number,
    COALESCE(bool_or(e.status = 'Submitted' AND r.id IS NOT NULL AND a.max_score > 0
      AND r."givenMarks"::double precision / NULLIF(a.max_score, 0) * 100 >= a.pass_threshold), false) AS passed,
    COALESCE(bool_or(e.status = 'Submitted' AND r.id IS NOT NULL AND a.max_score > 0
      AND r."givenMarks"::double precision / NULLIF(a.max_score, 0) * 100 < a.pass_threshold), false) AS failed
  FROM submission s
  JOIN "group" g ON g.id = s."groupId"
  JOIN assignment a ON a.id = g."assId"
  CROSS JOIN LATERAL generate_series(1, a.req_eval) AS required_round(number)
  LEFT JOIN "evalAssignment" e ON e."evalueeGroupId" = g.id AND e."assignmentId" = a.id
    AND e.round = required_round.number AND e.status <> 'Cancelled' AND e."submissionId" = s.id
  LEFT JOIN "evalResponse" r ON r.id = e."evalResponseId" AND r."subId" = s.id
    AND r."userId" = e."evaluatorUserId" AND NOT r."isStaffReview"
  WHERE s.status = 'Close'
  GROUP BY s.id, a.req_eval, required_round.number
), outcomes AS (
  SELECT submission_id, CASE WHEN bool_or(failed AND NOT passed) THEN false
    WHEN bool_and(passed) THEN true ELSE NULL END AS passed
  FROM round_outcomes GROUP BY submission_id
)
UPDATE submission s SET passed = o.passed FROM outcomes o WHERE s.id = o.submission_id;
UPDATE submission SET passed = NULL WHERE status <> 'Close';
UPDATE submission s SET passed = NULL
FROM "group" g JOIN assignment a ON a.id = g."assId"
WHERE s."groupId" = g.id AND a.req_eval <= 0;

COMMIT;
