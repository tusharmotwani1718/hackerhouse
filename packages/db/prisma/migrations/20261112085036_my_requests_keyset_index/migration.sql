-- DropIndex
DROP INDEX "join_requests_participant_id_created_at_idx";

-- CreateIndex
CREATE INDEX "join_requests_participant_id_created_at_id_idx" ON "join_requests"("participant_id", "created_at" DESC, "id" DESC);
