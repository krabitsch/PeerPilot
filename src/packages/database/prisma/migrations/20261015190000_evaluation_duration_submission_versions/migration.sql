BEGIN;
ALTER TABLE "assignment" ADD COLUMN "evaluationDurationMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_evaluation_duration_check" CHECK ("evaluationDurationMinutes" BETWEEN 5 AND 180);
-- Originals remain in submission.fileId: no copying, deletion, or unsafe backfill.
CREATE TABLE "submissionFileVersion" (
  "id" SERIAL NOT NULL,
  "submissionId" INTEGER NOT NULL,
  "fileId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "submissionFileVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "submissionFileVersion_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submission"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "submissionFileVersion_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "file"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "submissionFileVersion_fileId_key" ON "submissionFileVersion"("fileId");
CREATE INDEX "submissionFileVersion_submissionId_createdAt_id_idx" ON "submissionFileVersion"("submissionId", "createdAt", "id");
COMMIT;
