-- CreateEnum
CREATE TYPE "skill" AS ENUM ('FRONTEND', 'BACKEND', 'MOBILE', 'AI_ML', 'DATA', 'DEVOPS_CLOUD', 'UI_UX_DESIGN', 'PRODUCT', 'BLOCKCHAIN', 'SECURITY', 'HARDWARE_IOT', 'GAME_DEV');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "github_username" TEXT,
ADD COLUMN     "portfolio_url" TEXT,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';

-- CreateTable
CREATE TABLE "user_skills" (
    "user_id" UUID NOT NULL,
    "skill" "skill" NOT NULL,
    "level" SMALLINT NOT NULL,

    CONSTRAINT "user_skills_pkey" PRIMARY KEY ("user_id","skill")
);

-- AddForeignKey
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===================== HAND-WRITTEN (Prisma can't express these; 08 §S3) =====================
-- Safety nets: the app validates first; these catch any path that skips validation (scripts, bugs).

-- GitHub username: 1-39 chars, lowercase letters/digits, single hyphens between them.
ALTER TABLE "users" ADD CONSTRAINT "users_github_username_check"
  CHECK ("github_username" ~ '^[a-z0-9](-?[a-z0-9])*$' AND length("github_username") <= 39);

-- Portfolio URL: https only, bounded length.
ALTER TABLE "users" ADD CONSTRAINT "users_portfolio_url_check"
  CHECK ("portfolio_url" LIKE 'https://%' AND length("portfolio_url") <= 2048);

-- Timezone: non-empty, bounded (the IANA list itself is validated in the app).
ALTER TABLE "users" ADD CONSTRAINT "users_timezone_check"
  CHECK (length("timezone") BETWEEN 1 AND 64);

-- Skill level 1-5 (level 0 = no row).
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_level_check"
  CHECK ("level" BETWEEN 1 AND 5);
