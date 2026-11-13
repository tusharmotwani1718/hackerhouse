import "server-only";

import { connection } from "next/server";

import { getRequestContext, runWithContext } from "./context";
import { AppError } from "./errors";
import { errorResponse } from "./http";
import { logger } from "./logger";
import { mapDbError } from "./pg-errors";

// nginx (Phase 11) sets X-Request-Id; accept a client/proxy id only if it looks harmless.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

function pickRequestId(incoming: string | null): string {
  return incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
}

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  // Covers DB errors raised outside runTx too (plain queries: pool timeout, FK on a single write).
  const mapped = mapDbError(error);
  return mapped instanceof AppError
    ? mapped
    : new AppError("INTERNAL", "Something went wrong. Please try again later.", { cause: error });
}

/**
 * Wraps every route handler:
 *  1. `await connection()` FIRST — under cacheComponents `next build` executes GET handlers
 *     to prerender them; this stops it before any of our code runs (08 §S4).
 *  2. request id (header in, header out) + request context for logs,
 *  3. errors → error envelope (500s never leak internals; full error goes to the log),
 *  4. RateLimit-* headers when the handler called enforceLimits (Phase 7),
 *  5. one access-log line per request.
 *
 *   export const POST = route(async (req, ctx) => ok(...));
 */
export function route<Ctx>(handler: (req: Request, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    await connection(); // must stay outside the try: Next uses a thrown signal during prerender

    const requestId = pickRequestId(req.headers.get("x-request-id"));
    const startedAt = performance.now();

    return runWithContext({ requestId }, async () => {
      let response: Response;
      try {
        response = await handler(req, ctx);
      } catch (error) {
        const appError = toAppError(error);
        if (appError.status >= 500) {
          const log = appError.code === "RETRY_LATER" ? logger.warn : logger.error;
          log("request failed", { code: appError.code, err: appError.cause ?? appError });
        }
        response = errorResponse(appError, requestId);
      }

      response.headers.set("X-Request-Id", requestId);
      // Rate-limited endpoints (Phase 7): the tightest rule's budget, on success AND on 429.
      const rateLimit = getRequestContext()?.rateLimit;
      if (rateLimit) {
        response.headers.set("RateLimit-Limit", String(rateLimit.limit));
        response.headers.set("RateLimit-Remaining", String(rateLimit.remaining));
        response.headers.set("RateLimit-Reset", String(rateLimit.resetSeconds));
      }
      if (!response.headers.has("Cache-Control")) response.headers.set("Cache-Control", "no-store");

      logger.info("request", {
        method: req.method,
        path: new URL(req.url).pathname,
        status: response.status,
        ms: Math.round(performance.now() - startedAt),
      });
      return response;
    });
  };
}
