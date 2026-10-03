-- Evaluation audio recording: link an uploaded File to an EvalResponse.
-- AlterTable
ALTER TABLE "evalResponse" ADD COLUMN     "recordingFileId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "evalResponse_recordingFileId_key" ON "evalResponse"("recordingFileId");

-- AddForeignKey
ALTER TABLE "evalResponse" ADD CONSTRAINT "evalResponse_recordingFileId_fkey" FOREIGN KEY ("recordingFileId") REFERENCES "file"("id") ON DELETE SET NULL ON UPDATE CASCADE;
