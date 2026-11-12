-- ===================== HAND-WRITTEN (Prisma ignores partial indexes; 08 §S3) =====================
-- Step 5.4: the admin's "deleted teams" list reads the TEAM_DELETED audit rows of a hackathon,
-- newest first. This index holds ONLY those rows, in keyset order, so each page is a direct
-- index read instead of a scan of every audit row of the hackathon. The query must spell the
-- predicate the same way (action = 'TEAM_DELETED' as a literal) for the planner to use it.
CREATE INDEX "audit_logs_team_deleted_idx" ON "audit_logs" ("hackathon_id", "created_at" DESC, "id" DESC)
  WHERE "action" = 'TEAM_DELETED';
