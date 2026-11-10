-- CreateTable
CREATE TABLE "hackathons" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "min_team_size" SMALLINT NOT NULL,
    "max_team_size" SMALLINT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "hackathons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hackathons_slug_key" ON "hackathons"("slug");

-- CreateIndex
CREATE INDEX "hackathons_created_by_user_id_idx" ON "hackathons"("created_by_user_id");

-- AddForeignKey
ALTER TABLE "hackathons" ADD CONSTRAINT "hackathons_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===================== HAND-WRITTEN (Prisma can't express these; 08 §S3) =====================
-- Safety nets: the app validates first; these catch any path that skips validation (scripts, bugs).

-- Team sizes (02 §3.2): 1 <= min <= max <= 10.
ALTER TABLE "hackathons" ADD CONSTRAINT "hackathons_team_size_check"
  CHECK (1 <= "min_team_size" AND "min_team_size" <= "max_team_size" AND "max_team_size" <= 10);

-- Slug: 3-60 chars, lowercase letters/digits, single hyphens between them.
ALTER TABLE "hackathons" ADD CONSTRAINT "hackathons_slug_check"
  CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("slug") BETWEEN 3 AND 60);

-- Name: 3-100 chars, already trimmed.
ALTER TABLE "hackathons" ADD CONSTRAINT "hackathons_name_check"
  CHECK (length("name") BETWEEN 3 AND 100 AND "name" = btrim("name"));

-- Description: bounded.
ALTER TABLE "hackathons" ADD CONSTRAINT "hackathons_description_check"
  CHECK (length("description") <= 5000);

-- R10: team sizes never change after creation. Each team copies max_team_size into its own row
-- (the R1 "never over max" CHECK uses that copy), so a change here would silently disagree.
-- The app has no endpoint that updates them; this trigger stops scripts and future code.
-- Setting a size to its current value is allowed (IS DISTINCT FROM), so full-row updates work.
CREATE FUNCTION "hackathons_team_sizes_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."min_team_size" IS DISTINCT FROM OLD."min_team_size"
     OR NEW."max_team_size" IS DISTINCT FROM OLD."max_team_size" THEN
    RAISE EXCEPTION 'hackathon team sizes cannot change (R10): violates constraint "hackathons_team_sizes_immutable"'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'hackathons_team_sizes_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "hackathons_team_sizes_immutable"
  BEFORE UPDATE OF "min_team_size", "max_team_size" ON "hackathons"
  FOR EACH ROW EXECUTE FUNCTION "hackathons_team_sizes_immutable"();
