/*
  Warnings:

  - A unique constraint covering the columns `[passKey]` on the table `evalAssignment` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "evalAssignment" ADD COLUMN     "passKey" TEXT;

-- AlterTable
ALTER TABLE "submission" ALTER COLUMN "passkey" SET DEFAULT lpad(floor(random() * 1000000)::text, 6, '0');

-- CreateIndex
CREATE UNIQUE INDEX "evalAssignment_passKey_key" ON "evalAssignment"("passKey");
