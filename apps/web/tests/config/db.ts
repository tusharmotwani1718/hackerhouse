import { createDbClient } from "@hacker-house/db";

import { DB_PACKAGE_DIR, TEST_DATABASE_URL } from "./env";

/** The test's own Prisma client, directly on the test DB (never through the app). */
export const db = createDbClient({ connectionString: TEST_DATABASE_URL, poolMax: 5 });

/** Bring the test DB's schema up to date: the same migrations production runs. */
export function migrateTestDb(): void {
  const result = Bun.spawnSync([process.execPath, "x", "prisma", "migrate", "deploy"], {
    cwd: DB_PACKAGE_DIR,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`migrate deploy failed:\n${result.stderr.toString()}`);
  }
}

/** Empty every table. Each scenario starts from nothing, so scenarios never affect each other. */
export async function resetDb(): Promise<void> {
  await db.$executeRawUnsafe(`
    TRUNCATE audit_logs, idempotency_keys, invite_codes, teams, participants, hackathons,
             user_skills, session, account, verification, users
    RESTART IDENTITY CASCADE`);
}
