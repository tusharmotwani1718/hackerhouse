-- HAND-WRITTEN (must come first): trigram support for the team-name search index below.
-- Prisma ignores extensions (no postgresqlExtensions preview), so the drift check stays clean.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "join_policy" AS ENUM ('OPEN', 'APPROVAL');

-- CreateEnum
CREATE TYPE "team_access" AS ENUM ('PUBLIC', 'INVITE_ONLY');

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('PARTICIPANT_REGISTERED', 'PARTICIPANT_WITHDREW', 'TEAM_CREATED', 'TEAM_DELETED', 'MEMBER_JOINED', 'MEMBER_LEFT', 'MEMBER_REMOVED', 'LEADER_CHANGED', 'REQUEST_CREATED', 'REQUEST_APPROVED', 'REQUEST_DECLINED', 'REQUEST_CANCELLED', 'LOOKING_TOGGLED', 'INVITE_CODE_GENERATED', 'INVITE_CODE_REVOKED', 'HACKATHON_CREATED', 'ADMIN_CREATED', 'USER_PROMOTED', 'USER_DEMOTED', 'PASSWORD_RESET');

-- AlterTable
ALTER TABLE "participants" ADD COLUMN     "team_id" UUID,
ADD COLUMN     "team_joined_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL DEFAULT gen_uuidv7(),
    "hackathon_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "join_policy" "join_policy" NOT NULL,
    "access" "team_access" NOT NULL,
    "is_looking" BOOLEAN NOT NULL DEFAULT true,
    "leader_participant_id" UUID NOT NULL,
    "member_count" SMALLINT NOT NULL,
    "max_size" SMALLINT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invite_codes" (
    "id" UUID NOT NULL DEFAULT gen_uuidv7(),
    "team_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_uuidv7(),
    "hackathon_id" UUID,
    "team_id" UUID,
    "actor_user_id" UUID,
    "target_user_id" UUID,
    "action" "audit_action" NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "teams_hackathon_id_created_at_id_idx" ON "teams"("hackathon_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "teams_name_trgm_idx" ON "teams" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "teams_leader_participant_id_idx" ON "teams"("leader_participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "teams_id_hackathon_id_key" ON "teams"("id", "hackathon_id");

-- CreateIndex
CREATE UNIQUE INDEX "invite_codes_code_key" ON "invite_codes"("code");

-- CreateIndex
CREATE INDEX "invite_codes_team_id_idx" ON "invite_codes"("team_id");

-- CreateIndex
CREATE INDEX "invite_codes_created_by_user_id_idx" ON "invite_codes"("created_by_user_id");

-- CreateIndex
CREATE INDEX "audit_logs_team_id_created_at_id_idx" ON "audit_logs"("team_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_hackathon_id_created_at_id_idx" ON "audit_logs"("hackathon_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "hackathons_id_max_team_size_key" ON "hackathons"("id", "max_team_size");

-- CreateIndex
CREATE INDEX "participants_team_id_team_joined_at_idx" ON "participants"("team_id", "team_joined_at");

-- CreateIndex
CREATE UNIQUE INDEX "participants_id_team_id_key" ON "participants"("id", "team_id");

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_team_fkey" FOREIGN KEY ("team_id", "hackathon_id") REFERENCES "teams"("id", "hackathon_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_hackathon_fkey" FOREIGN KEY ("hackathon_id", "max_size") REFERENCES "hackathons"("id", "max_team_size") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_leader_fkey" FOREIGN KEY ("leader_participant_id", "id") REFERENCES "participants"("id", "team_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===================== HAND-WRITTEN (Prisma can't express these; 08 §S3) =====================
-- Safety nets: the app enforces these first; the database catches any path that doesn't.

-- ---- teams ----

-- R1 never over max_size; R5/R7 a team is never empty (the last member leaving deletes it).
ALTER TABLE "teams" ADD CONSTRAINT "teams_member_count_check"
  CHECK ("member_count" BETWEEN 1 AND "max_size");

ALTER TABLE "teams" ADD CONSTRAINT "teams_version_check" CHECK ("version" >= 1);

-- Name: 3-40 chars, already trimmed.
ALTER TABLE "teams" ADD CONSTRAINT "teams_name_check"
  CHECK (length("name") BETWEEN 3 AND 40 AND "name" = btrim("name"));

ALTER TABLE "teams" ADD CONSTRAINT "teams_description_check"
  CHECK (length("description") <= 500);

-- R18: team names unique per hackathon, case-insensitive. 23505 → TEAM_NAME_TAKEN (step 3.3).
CREATE UNIQUE INDEX "teams_hackathon_id_lower_name_key" ON "teams" ("hackathon_id", lower("name"));

-- R4: exactly one leader, who is a member of THIS team. Checked at COMMIT, so team creation
-- (team row first, then the leader's team_id) and leader succession can pass through a
-- moment where the two rows disagree inside the transaction.
ALTER TABLE "teams" ALTER CONSTRAINT "teams_leader_fkey" DEFERRABLE INITIALLY DEFERRED;

-- Board: contains exactly the listed teams (looking, not full), in keyset order (05 §3).
CREATE INDEX "teams_board_idx" ON "teams" ("hackathon_id", "created_at" DESC, "id" DESC)
  WHERE "is_looking" AND "member_count" < "max_size";

-- Settings fixed at creation (01 §3), the hackathon, and max_size (R10) never change.
-- Same-value writes are allowed (IS DISTINCT FROM), so full-row updates still work.
CREATE FUNCTION "teams_immutable_columns"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."hackathon_id" IS DISTINCT FROM OLD."hackathon_id"
     OR NEW."join_policy" IS DISTINCT FROM OLD."join_policy"
     OR NEW."access" IS DISTINCT FROM OLD."access"
     OR NEW."max_size" IS DISTINCT FROM OLD."max_size" THEN
    RAISE EXCEPTION 'team hackathon, join policy, access and max size cannot change: violates constraint "teams_immutable_columns"'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'teams_immutable_columns';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "teams_immutable_columns"
  BEFORE UPDATE OF "hackathon_id", "join_policy", "access", "max_size" ON "teams"
  FOR EACH ROW EXECUTE FUNCTION "teams_immutable_columns"();

-- ---- participants (team membership) ----

ALTER TABLE "participants" ADD CONSTRAINT "participants_team_joined_at_check"
  CHECK (("team_id" IS NULL) = ("team_joined_at" IS NULL));

-- Unteamed participants of a hackathon (teammate suggestions, 04).
CREATE INDEX "participants_unteamed_idx" ON "participants" ("hackathon_id") WHERE "team_id" IS NULL;

-- ---- invite_codes ----

-- 10 chars Crockford base32 (no I, L, O, U), stored normalized: uppercase, no hyphens.
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_code_check"
  CHECK ("code" ~ '^[0-9A-HJKMNP-TV-Z]{10}$');

ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_expires_at_check"
  CHECK ("expires_at" > "created_at");

-- At most one non-revoked code per team. now() can't appear in an index predicate, so
-- "expired" isn't part of it: regenerate always revokes the old code first (I7).
CREATE UNIQUE INDEX "invite_codes_one_active_per_team" ON "invite_codes" ("team_id")
  WHERE "revoked_at" IS NULL;

-- ---- audit_logs ----

-- Append-only: no UPDATE or DELETE, ever. (TRUNCATE is unaffected, so test databases can reset.)
CREATE FUNCTION "audit_logs_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: violates constraint "audit_logs_append_only"'
    USING ERRCODE = 'check_violation', CONSTRAINT = 'audit_logs_append_only';
END;
$$;

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_append_only"();
