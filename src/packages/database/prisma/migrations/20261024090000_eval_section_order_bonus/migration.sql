ALTER TABLE "evalSection" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
                          ADD COLUMN "isBonus" BOOLEAN NOT NULL DEFAULT false;
WITH ordered AS (
  SELECT id, (ROW_NUMBER() OVER (PARTITION BY "evalSheetId" ORDER BY id) - 1)::INTEGER AS position
  FROM "evalSection"
)
UPDATE "evalSection" s SET "sortOrder" = ordered.position FROM ordered WHERE s.id = ordered.id;

-- Preserve historical evaluation totals as core points. New responses snapshot
-- both components so later rubric edits cannot change their pass/fail result.
ALTER TABLE "evalResponse" ADD COLUMN "coreScore" INTEGER,
                           ADD COLUMN "bonusScore" INTEGER NOT NULL DEFAULT 0;
UPDATE "evalResponse" SET "coreScore" = "givenMarks";
