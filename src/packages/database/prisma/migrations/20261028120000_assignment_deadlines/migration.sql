ALTER TABLE "assignment"
ADD COLUMN "submissionDeadline" TIMESTAMPTZ(3),
ADD COLUMN "evaluationDeadline" TIMESTAMPTZ(3);
