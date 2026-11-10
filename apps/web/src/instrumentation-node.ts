/**
 * Node.js server startup (imported by instrumentation.ts).
 * Fail fast: an invalid environment stops the process instead of failing on first use.
 */
import { getEnv } from "./server/env";

try {
  getEnv();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
