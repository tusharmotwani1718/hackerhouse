import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

// tests/support → tests → web → apps → repo root
export const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
export const APP_DIR = path.join(REPO_ROOT, "apps/web");
export const DB_PACKAGE_DIR = path.join(REPO_ROOT, "packages/db");

// Same single env source as the app and the CLI: the root .env, process env wins.
const envFile = path.join(REPO_ROOT, ".env");
if (existsSync(envFile)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(envFile, "utf8")))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (copy .env.example to .env)`);
  return value;
}

/** The dev URL with the database name swapped for hacker_house_test (created in step 0.2). */
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const url = new URL(required("DATABASE_URL"));
  url.pathname = "/hacker_house_test";
  return url.toString();
}

export const TEST_DATABASE_URL = testDatabaseUrl();

/**
 * The dev Redis, logical database 1 (dev uses 0): the rate-limit counters of test runs never
 * mix with dev's. (Pub/sub channels are server-wide, but our channel names carry random ids,
 * so nothing crosses over in practice.)
 */
function testRedisUrl(): string {
  if (process.env.TEST_REDIS_URL) return process.env.TEST_REDIS_URL;
  const url = new URL(required("REDIS_URL"));
  url.pathname = "/1";
  return url.toString();
}

export const TEST_REDIS_URL = testRedisUrl();
export const AUTH_SECRET = required("BETTER_AUTH_SECRET");
export const PORT = 3100;
export const BASE_URL = `http://localhost:${PORT}`;

/**
 * Tests TRUNCATE every table. Refuse to run against anything that isn't clearly a test
 * database: a wrong env var must never wipe your dev data.
 */
export function assertTestDatabase(): void {
  const name = new URL(TEST_DATABASE_URL).pathname.slice(1);
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to run: database "${name}" doesn't end with "_test".`);
  }
}
