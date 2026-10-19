CREATE TABLE "assignmentParticipation" (
  "id" SERIAL NOT NULL,
  "assignmentId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "evalueeEligible" BOOLEAN NOT NULL,
  "evaluatorEligible" BOOLEAN NOT NULL,
  CONSTRAINT "assignmentParticipation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "assignmentParticipation_assignmentId_userId_key" ON "assignmentParticipation"("assignmentId", "userId");
CREATE INDEX "assignmentParticipation_userId_idx" ON "assignmentParticipation"("userId");
ALTER TABLE "assignmentParticipation" ADD CONSTRAINT "assignmentParticipation_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignmentParticipation" ADD CONSTRAINT "assignmentParticipation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
