-- CreateEnum
CREATE TYPE "join_request_status" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "decline_reason" AS ENUM ('LEADER', 'TEAM_FULL');

-- CreateTable
CREATE TABLE "join_requests" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "hackathon_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "status" "join_request_status" NOT NULL DEFAULT 'PENDING',
    "decline_reason" "decline_reason",
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),

    CONSTRAINT "join_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "join_requests_team_id_status_created_at_id_idx" ON "join_requests"("team_id", "status", "created_at", "id");

-- CreateIndex
CREATE INDEX "join_requests_participant_id_status_idx" ON "join_requests"("participant_id", "status");

-- CreateIndex
CREATE INDEX "join_requests_participant_id_created_at_idx" ON "join_requests"("participant_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_participant_fkey" FOREIGN KEY ("participant_id", "hackathon_id") REFERENCES "participants"("id", "hackathon_id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_team_fkey" FOREIGN KEY ("team_id", "hackathon_id") REFERENCES "teams"("id", "hackathon_id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===================== HAND-WRITTEN (Prisma can't express these; 08 §S3) =====================

-- A decline always says why; nothing else has a decline reason.
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_decline_reason_check"
  CHECK (("status" = 'DECLINED') = ("decline_reason" IS NOT NULL));

-- Decided exactly when no longer pending.
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_decided_at_check"
  CHECK (("status" = 'PENDING') = ("decided_at" IS NULL));

-- One index, four rules (02 §3.6): no duplicate pending request for a pair; no re-request
-- after a LEADER decline (R13); a TEAM_FULL decline or a cancellation does NOT block one.
-- 23505 here → REQUEST_ALREADY_PENDING / PREVIOUSLY_DECLINED (step 4.2).
CREATE UNIQUE INDEX "join_requests_active_pair_key" ON "join_requests" ("participant_id", "team_id")
  WHERE "status" = 'PENDING' OR ("status" = 'DECLINED' AND "decline_reason" = 'LEADER');

-- I5: a request changes only FROM 'PENDING'; once decided the row is frozen, and which
-- participant / team / hackathon it is about never changes. A CHECK only sees the new row, so
-- a rule about the transition (old → new) needs a trigger. Deletes (cascades) are unaffected.
CREATE FUNCTION "join_requests_decided_is_final"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'a decided join request cannot change: violates constraint "join_requests_decided_is_final"'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'join_requests_decided_is_final';
  END IF;
  IF NEW."participant_id" IS DISTINCT FROM OLD."participant_id"
     OR NEW."team_id" IS DISTINCT FROM OLD."team_id"
     OR NEW."hackathon_id" IS DISTINCT FROM OLD."hackathon_id" THEN
    RAISE EXCEPTION 'a join request''s participant, team and hackathon cannot change: violates constraint "join_requests_decided_is_final"'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'join_requests_decided_is_final';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "join_requests_decided_is_final"
  BEFORE UPDATE ON "join_requests"
  FOR EACH ROW EXECUTE FUNCTION "join_requests_decided_is_final"();
