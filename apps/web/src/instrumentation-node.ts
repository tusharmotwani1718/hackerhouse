/**
 * Node.js server startup (imported by instrumentation.ts).
 * Fail fast: an invalid environment stops the process instead of failing on first use.
 */
import { getEventBus } from "./server/core/bus";
import { getRedis } from "./server/core/redis";
import { getEnv } from "./server/env";

try {
  getEnv();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

// Start listening for events now, not on the first stream (6.2 D4). Fire-and-forget: if Redis
// is down, the server still starts; streams wait (heartbeats only) until the bus is listening.
getEventBus().start();

// Connect the command client now too (rate limiter, publish): otherwise the first requests after
// boot would find it still connecting and fall back to in-memory limits (7.1).
getRedis();
