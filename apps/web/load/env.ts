/**
 * Where the load test lives, shared by the seed (seed.ts) and the server launcher (serve.ts):
 * its own database, its own Redis database and its own port, so it never touches dev (3000,
 * Redis 0) or the API tests (3100, Redis 1).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

// load → web → apps → repo root
export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
export const APP_DIR = path.join(REPO_ROOT, "apps/web");
export const OUTPUT_DIR = path.join(import.meta.dirname, ".output");
export const SESSIONS_FILE = path.join(OUTPUT_DIR, "sessions.json");

export const LOAD_PORT = 3200;
export const LOAD_BASE_URL = `http://localhost:${LOAD_PORT}`;

/** The single env source of the monorepo: the root .env. Variables already set win. */
export function loadRootEnv(): void {
  const file = path.join(REPO_ROOT, ".env");
  if (!existsSync(file)) return;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (copy .env.example to .env)`);
  return value;
}

/** LOAD_DATABASE_URL, or the dev URL with the database name swapped for hacker_house_load. */
export function loadDatabaseUrl(): string {
  if (process.env.LOAD_DATABASE_URL) return process.env.LOAD_DATABASE_URL;
  const url = new URL(required("DATABASE_URL"));
  url.pathname = "/hacker_house_load";
  return url.toString();
}

/** LOAD_REDIS_URL, or the dev Redis with logical database 2 (dev uses 0, the tests 1). */
export function loadRedisUrl(): string {
  if (process.env.LOAD_REDIS_URL) return process.env.LOAD_REDIS_URL;
  const url = new URL(required("REDIS_URL"));
  url.pathname = "/2"; // redis for the load test, to not colloide with the dev (0) or tests(1)
  return url.toString();
}

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

/** The load scripts empty and fill their database: never let a wrong env var aim them at dev. */
export function assertLoadDatabase(url: string): void {
  const name = databaseName(url);
  if (!name.endsWith("_load")) {
    throw new Error(`Refusing "${name}": the load database's name must end in "_load".`);
  }
}
