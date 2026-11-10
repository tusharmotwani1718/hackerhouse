import "server-only";

import { createDbClient, type DbClient } from "@hacker-house/db";

import { getEnv } from "./env";

// One Prisma client (and pg pool) per server process, created on first use (lazy, so that
// `next build` importing a route module needs no env). In dev, Next re-evaluates modules on
// hot reload; caching on globalThis stops each reload from opening a new pool.
const globalForDb = globalThis as typeof globalThis & { __hhDb?: DbClient };

export function getDb(): DbClient {
  if (!globalForDb.__hhDb) {
    const env = getEnv();
    globalForDb.__hhDb = createDbClient({
      connectionString: env.DATABASE_URL,
      poolMax: env.DATABASE_POOL_MAX,
      maxWaitMs: env.DATABASE_TX_MAX_WAIT_MS,
      txTimeoutMs: env.DATABASE_TX_TIMEOUT_MS,
    });
  }
  return globalForDb.__hhDb;
}
