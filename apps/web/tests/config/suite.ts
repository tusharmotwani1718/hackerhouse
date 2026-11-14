import { afterAll, beforeAll, beforeEach } from "bun:test";

import { db, migrateTestDb, resetDb } from "./db";
import { assertTestDatabase } from "./env";
import { startApp } from "./server";

/**
 * The standard setup of an API test file: guard the DB, migrate, start the production build
 * once for the file, and empty every table before each test. Call once at the top of a file.
 * `env`: extra app variables for this file (e.g. tiny RATE_LIMIT_OVERRIDES).
 */
export function withTestApp(env: Record<string, string> = {}): void {
  let stopApp: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    assertTestDatabase(); // FIRST: never touch a non-test database
    migrateTestDb();
    stopApp = await startApp(env);
  }, 120_000);

  afterAll(async () => {
    await stopApp?.();
    await db.$disconnect();
  });

  beforeEach(resetDb);
}
