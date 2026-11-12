// POST /api/requests/{requestId}/approve — the team's leader accepts a join request, Flow 2
// (step 4.3). Body: `{}`. Requires an `Idempotency-Key` header.
// 200 { request, team }. Not the leader → 403 NOT_LEADER; already decided → 409
// REQUEST_NOT_PENDING (details: status). Team full → 409 TEAM_FULL, COMMITTED: the request is
// declined (stored as the idempotent response).
import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { runMutation } from "@/server/core/idempotency";
import { route } from "@/server/core/route";
import { emptyBodySchema, parseJson, parseParams } from "@/server/core/validate";
import { approveRequest } from "@/server/modules/requests/decide";

const paramsSchema = z.object({ requestId: z.string() }); // malformed ids → 404 in the service

export const POST = route(
  async (req: Request, ctx: RouteContext<"/api/requests/[requestId]/approve">) => {
    const { user } = await requireUser(req);
    const { requestId } = await parseParams(ctx.params, paramsSchema);
    const input = await parseJson(req, emptyBodySchema);
    return runMutation(req, { userId: user.id, input }, (tx) =>
      approveRequest(tx, user.id, requestId),
    );
  },
);
