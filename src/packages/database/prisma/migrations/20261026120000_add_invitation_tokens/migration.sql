ALTER TABLE "auth_allowed_emails"
  ADD COLUMN "invite_token_hash" TEXT,
  ADD COLUMN "invite_token_expiry" TIMESTAMP(3),
  ADD COLUMN "invite_sent_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "auth_allowed_emails_invite_token_hash_key"
  ON "auth_allowed_emails"("invite_token_hash");
