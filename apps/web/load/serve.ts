/**
 * Start the app for the load test (step 10.4): the PRODUCTION build on :3200, against the load
 * database (hacker_house_load) and Redis database 2. Keep it running in one terminal, run k6 in
 * another, stop with Ctrl+C.
 *
 *   bun run load:serve             (from the repo root; uses the existing build in apps/web/.next)
 *   bun run load:serve --build     (runs `next build` first: do this after changing app code)
 *
 * Why each setting (see the step notes in 07_Build_Plan):
 * - production build: `next dev` compiles routes on first visit and runs unoptimized code.
 * - load database: the 10,000 users / 2,000 teams of `bun run load:seed`.
 * - Redis database 2, emptied at every start: rate-limit counters never mix with dev (0) or the
 *   tests (1), and a previous run's counters can't cause 429s in this one.
 * - the same BETTER_AUTH_SECRET as the seed: sessions.json cookies are signed with it.
 * - LOG_LEVEL=warn: a log line per request costs time that would show up in p95.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { createClient } from "redis";

import {
  APP_DIR,
  assertLoadDatabase,
  databaseName,
  LOAD_BASE_URL,
  LOAD_PORT,
  loadDatabaseUrl,
  loadRedisUrl,
  loadRootEnv,
  required,
  SESSIONS_FILE,
} from "./env";

loadRootEnv();
const databaseUrl = loadDatabaseUrl();
const redisUrl = loadRedisUrl();
assertLoadDatabase(databaseUrl);
if (redisUrl === process.env.REDIS_URL) {
  throw new Error("The load Redis must not be dev's Redis database (set LOAD_REDIS_URL).");
}
if (!existsSync(SESSIONS_FILE)) {
  throw new Error("No sessions.json: run `bun run load:seed` first.");
}
if (await isUp()) {
  throw new Error(`Port ${LOAD_PORT} is already in use; stop that process first.`);
}

if (process.argv.includes("--build")) {
  console.log("Building (next build)...");
  const build = Bun.spawnSync([process.execPath, "x", "next", "build"], {
    cwd: APP_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);
} else if (!existsSync(path.join(APP_DIR, ".next", "BUILD_ID"))) {
  throw new Error("No production build in apps/web/.next: run with --build.");
}

const redis = createClient({ url: redisUrl });
await redis.connect();
await redis.flushDb(); // only the load database (2), never dev's
await redis.quit();

const server = Bun.spawn([process.execPath, "x", "next", "start", "-p", String(LOAD_PORT)], {
  cwd: APP_DIR,
  env: {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: databaseUrl, // the process env wins over .env (next.config.ts)
    REDIS_URL: redisUrl,
    BETTER_AUTH_URL: LOAD_BASE_URL,
    BETTER_AUTH_SECRET: required("BETTER_AUTH_SECRET"), // explicit: must match the seed's signer
    LOG_LEVEL: process.env.LOAD_LOG_LEVEL ?? "warn",
  },
  stdout: "inherit",
  stderr: "inherit",
});

let stopping = false;
function stop(code: number): never {
  if (!stopping) {
    stopping = true;
    killTree(server.pid);
  }
  process.exit(code);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
// If Next dies on its own (bad env, crash), say so instead of hanging.
void server.exited.then((code) => {
  if (!stopping) {
    console.error(`\nThe server exited (code ${code}).`);
    process.exit(code || 1);
  }
});

await waitUntilUp(60_000);
console.log(`
Load server ready on ${LOAD_BASE_URL}
  database  ${databaseName(databaseUrl)}  (pool ${process.env.DATABASE_POOL_MAX || 10} connections)
  redis     ${new URL(redisUrl).pathname.slice(1) || "0"} (emptied)

In another terminal:  bun run load:board
Stop with Ctrl+C.`);

// ---------------------------------------------------------------------------------- helpers

/**
 * Stop the server AND its children: `bun x next start` runs Next in a child `node` process, and
 * on Windows killing only the parent leaves that child holding the port.
 */
function killTree(pid: number): void {
  if (process.platform === "win32") {
    Bun.spawnSync(["taskkill", "/pid", String(pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
    });
  } else {
    process.kill(pid);
  }
}

/** "Up" = a real route answers. 401 is the expected answer: no cookie sent. */
async function isUp(): Promise<boolean> {
  try {
    return (await fetch(`${LOAD_BASE_URL}/api/hackathons`)).status === 401;
  } catch {
    return false; // connection refused: not listening (yet)
  }
}

async function waitUntilUp(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isUp()) return;
    await Bun.sleep(250);
  }
  console.error(`The server didn't answer on ${LOAD_BASE_URL} within ${timeoutMs / 1000} s.`);
  stop(1);
}
