-- AlterTable
ALTER TABLE "class" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "submission" ALTER COLUMN "passkey" SET DEFAULT lpad(floor(random() * 1000000)::text, 6, '0');
