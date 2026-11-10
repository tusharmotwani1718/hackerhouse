import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/client";

export * from "./generated/client";

export type DbClientOptions = {
  connectionString: string;
  /**
   * Max pooled connections (pg Pool `max`). Each open transaction holds one for its whole
   * duration. Budget: (instances + 1) × poolMax + ~15 (tools) ≤ 97 — see 07_Build_Plan §6.
   */
  poolMax?: number;
  /**
   * Max ms to wait for a free pool connection. Applied to transactions (Prisma `maxWait`)
   * AND to plain queries (pg `connectionTimeoutMillis`, which otherwise waits forever).
   */
  maxWaitMs?: number;
  /**
   * Max ms an interactive transaction may run (Prisma `timeout`). App-side timer only: it
   * cannot interrupt a statement blocked inside Postgres — `SET LOCAL lock_timeout` does that.
   */
  txTimeoutMs?: number;
};

/**
 * Creates a Prisma client over a `pg` pool (Prisma 7 driver adapter).
 * Consumers own the instance: the web app keeps one per process (src/server/db.ts);
 * scripts and tests create their own (and must call `$disconnect()` when done).
 */
export function createDbClient({
  connectionString,
  poolMax = 10,
  maxWaitMs = 5_000,
  txTimeoutMs = 10_000,
}: DbClientOptions) {
  const adapter = new PrismaPg({
    connectionString,
    max: poolMax,
    connectionTimeoutMillis: maxWaitMs,
  });
  return new PrismaClient({
    adapter,
    transactionOptions: { maxWait: maxWaitMs, timeout: txTimeoutMs },
  });
}

export type DbClient = ReturnType<typeof createDbClient>;
