-- AlterTable
ALTER TABLE "audit_logs" ALTER COLUMN "created_at" SET DEFAULT transaction_timestamp();

-- AlterTable
ALTER TABLE "hackathons" ALTER COLUMN "created_at" SET DEFAULT transaction_timestamp(),
ALTER COLUMN "updated_at" SET DEFAULT transaction_timestamp();

-- AlterTable
ALTER TABLE "idempotency_keys" ALTER COLUMN "created_at" SET DEFAULT transaction_timestamp();

-- AlterTable
ALTER TABLE "invite_codes" ALTER COLUMN "created_at" SET DEFAULT transaction_timestamp();

-- AlterTable
ALTER TABLE "participants" ALTER COLUMN "created_at" SET DEFAULT transaction_timestamp();

-- AlterTable
ALTER TABLE "teams" ALTER COLUMN "created_at" SET DEFAULT transaction_timestamp(),
ALTER COLUMN "updated_at" SET DEFAULT transaction_timestamp();
