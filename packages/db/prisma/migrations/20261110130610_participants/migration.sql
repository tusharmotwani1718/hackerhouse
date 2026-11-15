-- CreateTable
CREATE TABLE "participants" (
    "id" UUID NOT NULL DEFAULT gen_uuidv7(),
    "user_id" UUID NOT NULL,
    "hackathon_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "participants_hackathon_id_idx" ON "participants"("hackathon_id");

-- CreateIndex
CREATE UNIQUE INDEX "participants_user_id_hackathon_id_key" ON "participants"("user_id", "hackathon_id");

-- CreateIndex
CREATE UNIQUE INDEX "participants_id_hackathon_id_key" ON "participants"("id", "hackathon_id");

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_hackathon_id_fkey" FOREIGN KEY ("hackathon_id") REFERENCES "hackathons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
