import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request context, available anywhere below the route wrapper without passing it
 * through every function (Node's AsyncLocalStorage follows the async call chain).
 */
export type RequestContext = {
  requestId: string;
  /** Set by `requireUser` from step 1.1. */
  userId?: string;
  /** Set by `enforceLimits` (step 7.1): route() turns it into RateLimit-* headers. */
  rateLimit?: { limit: number; remaining: number; resetSeconds: number };
};

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
