/**
 * Node.js server startup (imported by instrumentation.ts).
 * Fail fast: an invalid environment stops the process instead of failing on first use.
 */
try {
  await import("./server/env");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

export {};
