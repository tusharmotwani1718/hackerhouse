// Better Auth endpoints (/api/auth/*). Wrapped in route() for connection(), request id and
// access logging. Response BODIES keep Better Auth's own format — its client library expects it —
// the one exception to our envelope.
// Rate limits (step 7.3): sign-in and sign-up are checked BEFORE Better Auth runs (no password
// hashing for a rejected attempt); see server/ratelimit/auth-limits.ts.
import { getAuth } from "@/server/auth/auth";
import { AppError } from "@/server/core/errors";
import { route } from "@/server/core/route";
import { enforceAuthLimits } from "@/server/ratelimit/auth-limits";

const handler = route(async (req: Request) => {
  try {
    await enforceAuthLimits(req);
  } catch (error) {
    // 429 RATE_LIMITED / 503 RETRY_LATER in Better Auth's error shape `{ code, message }`, so its
    // client reads them like its own errors. Headers (Retry-After; RateLimit-* via route()) kept.
    if (
      error instanceof AppError &&
      (error.code === "RATE_LIMITED" || error.code === "RETRY_LATER")
    ) {
      return Response.json(
        { code: error.code, message: error.message },
        { status: error.status, headers: error.headers },
      );
    }
    throw error;
  }
  return getAuth().handler(req);
});

export const GET = handler;
export const POST = handler;
