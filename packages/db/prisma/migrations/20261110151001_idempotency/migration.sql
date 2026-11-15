-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL DEFAULT gen_uuidv7(),
    "user_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" SMALLINT,
    "response_body" JSON,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_user_id_key_key" ON "idempotency_keys"("user_id", "key");

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===================== HAND-WRITTEN (Prisma can't express these; 08 §S3) =====================

-- Same rule the app validates on the Idempotency-Key header.
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_key_check"
  CHECK ("key" ~ '^[A-Za-z0-9_-]{8,128}$');

-- A response is stored whole or not at all.
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_response_check"
  CHECK (("response_status" IS NULL) = ("response_body" IS NULL));

ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_expires_at_check"
  CHECK ("expires_at" > "created_at");
