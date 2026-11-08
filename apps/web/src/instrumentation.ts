/**
 * Runs once when a Next.js server instance starts, before it handles any request.
 * Node-only code lives in instrumentation-node.ts (this file is also compiled for Edge).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
