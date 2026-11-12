// POST /api/requests/{requestId}/decline — the team's leader declines a join request, Flow 2b
// (step 4.3). Body: `{}`. Requires an `Idempotency-Key` header.
// 200 { request } (DECLINED, reason LEADER: the requester can't ask this team again, R13).
// Not the leader → 403 NOT_LEADER; already decided → 409 REQUEST_NOT_PENDING (details: status).
import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { runMutation } from "@/server/core/idempotency";
import { route } from "@/server/core/route";
import { emptyBodySchema, parseJson, parseParams } from "@/server/core/validate";
import { declineRequest } from "@/server/modules/requests/decide";

const paramsSchema = z.object({ requestId: z.string() }); // malformed ids → 404 in the service

export const POST = route(
  async (req: Request, ctx: RouteContext<"/api/requests/[requestId]/decline">) => {
    const { user } = await requireUser(req);
    const { requestId } = await parseParams(ctx.params, paramsSchema);
    const input = await parseJson(req, emptyBodySchema);
    return runMutation(req, { userId: user.id, input }, (tx) =>
      declineRequest(tx, user.id, requestId),
    );
  },
);
