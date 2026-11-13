import "server-only";

import { createClient } from "redis";

import { getEnv } from "../env";
import { SLIDING_WINDOW_SCRIPT } from "../ratelimit/sliding-window";
import { logger } from "./logger";

/**
 * The shared Redis COMMAND client (step 6.1): one per process, lazy (so `next build` never
 * connects), cached on globalThis (dev hot reload would otherwise open a new one per reload).
 * Used for PUBLISH and by the rate limiter (Phase 7). Commands are pipelined on this one
 * Same connection for command and publish
 * TCP connection, so it needs no pool (unlike Postgres: no transaction ever holds it).
 *
 * The SUBSCRIBER connection is separate (a subscribed connection accepts no normal commands):
 * RedisEventBus creates it with `duplicate()`.
 */

/** Reconnect forever, backing off: 100 ms, 200 ms, … up to 5 s between attempts. */
export const reconnectStrategy = (retries: number) => Math.min(100 * 2 ** retries, 5_000);

function createCommandClient() {
  return createClient({
    url: getEnv().REDIS_URL,
    // Fail fast while disconnected instead of queueing: a publish must never make a request
    // wait for Redis to come back (6.1 D5). The caller logs the failure.
    disableOfflineQueue: true,
    socket: { connectTimeout: 2_000, reconnectStrategy },
    // Lua scripts callable as methods (EVALSHA with automatic fallback): the rate limiter (7.1).
    scripts: { slidingWindow: SLIDING_WINDOW_SCRIPT },
  });
}

/** The concrete client type (derived from our factory, not createClient's generic default). */
export type RedisClient = ReturnType<typeof createCommandClient>;

const g = globalThis as unknown as { __hhRedis?: RedisClient };

export function getRedis(): RedisClient {
  if (!g.__hhRedis) {
    const client = createCommandClient();
    // REQUIRED: without an `error` listener, a Redis error is thrown and kills the process.
    client.on("error", (err: unknown) => logger.warn("redis (commands) error", { err }));
    client
      .connect()
      .catch((err: unknown) => logger.warn("redis (commands) connect failed", { err }));
    g.__hhRedis = client;
  }
  return g.__hhRedis;
}
