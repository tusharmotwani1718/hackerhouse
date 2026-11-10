// Better Auth endpoints (/api/auth/*). Wrapped in route() for connection(), request id and
// access logging (Phase 7 adds our rate limiter here). Response BODIES keep Better Auth's own
// format — its client library expects it — the one exception to our envelope.
import { getAuth } from "@/server/auth/auth";
import { route } from "@/server/core/route";

const handler = route(async (req: Request) => getAuth().handler(req));

export const GET = handler;
export const POST = handler;
