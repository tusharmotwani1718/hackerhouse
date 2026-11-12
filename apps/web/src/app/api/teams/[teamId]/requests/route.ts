// POST /api/teams/{teamId}/requests — ask to join an APPROVAL + PUBLIC team from the board,
// Flow 4 (step 4.2). Body: `{}`. Requires an `Idempotency-Key` header.
// 201 { request }. OPEN team → 409 USE_JOIN; INVITE_ONLY → 403 (use the invite code).
// (GET — the leader's inbox — joins this file in step 4.4.)
import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { runMutation } from "@/server/core/idempotency";
import { route } from "@/server/core/route";
import { emptyBodySchema, parseJson, parseParams } from "@/server/core/validate";
import { requestConstraintErrors, requestToJoin } from "@/server/modules/requests/service";

const paramsSchema = z.object({ teamId: z.string() }); // malformed ids → 404 in the service

export const POST = route(
  async (req: Request, ctx: RouteContext<"/api/teams/[teamId]/requests">) => {
    const { user } = await requireUser(req);
    const { teamId } = await parseParams(ctx.params, paramsSchema);
    const input = await parseJson(req, emptyBodySchema);
    return runMutation(
      req,
      { userId: user.id, input, status: 201, constraintErrors: requestConstraintErrors },
      (tx) => requestToJoin(tx, user.id, { via: "board", teamId }),
    );
  },
);
