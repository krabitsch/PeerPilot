-- AlterTable
ALTER TABLE "class" ADD COLUMN     "externalCourseCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "term" TEXT;

-- AlterTable
ALTER TABLE "enrollment" ADD COLUMN     "externalCourseCode" TEXT;

-- AlterTable
ALTER TABLE "submission" ALTER COLUMN "passkey" SET DEFAULT lpad(floor(random() * 1000000)::text, 6, '0');

-- CreateTable
CREATE TABLE "AllowedEnrollment" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "classId" INTEGER NOT NULL,
    "externalCourseCode" TEXT NOT NULL,

    CONSTRAINT "AllowedEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AllowedEnrollment_classId_idx" ON "AllowedEnrollment"("classId");

-- CreateIndex
CREATE UNIQUE INDEX "AllowedEnrollment_email_classId_key" ON "AllowedEnrollment"("email", "classId");

-- CreateIndex
CREATE INDEX "enrollment_classId_externalCourseCode_idx" ON "enrollment"("classId", "externalCourseCode");

-- AddForeignKey
ALTER TABLE "AllowedEnrollment" ADD CONSTRAINT "AllowedEnrollment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
