// GET  /api/teams/{teamId}/requests — the leader's inbox (05 §4.3, step 4.4). Leader only.
//      ?status=PENDING (default, oldest first) | APPROVED | DECLINED | CANCELLED (newest first),
//      cursor, limit. Response { data: { requests, totalCount }, nextCursor }.
// POST /api/teams/{teamId}/requests — ask to join an APPROVAL + PUBLIC team from the board,
//      Flow 4 (step 4.2). Body: `{}`. Requires an `Idempotency-Key` header.
//      201 { request }. OPEN team → 409 USE_JOIN; INVITE_ONLY → 403 (use the invite code).
import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { ok } from "@/server/core/http";
import { runMutation } from "@/server/core/idempotency";
import { route } from "@/server/core/route";
import { runReadTx } from "@/server/core/tx";
import { emptyBodySchema, parseJson, parseParams, parseQuery } from "@/server/core/validate";
import { listInbox } from "@/server/modules/requests/reads";
import { inboxQuerySchema } from "@/server/modules/requests/schemas";
import { requestConstraintErrors, requestToJoin } from "@/server/modules/requests/service";

const paramsSchema = z.object({ teamId: z.string() }); // malformed ids → 404 in the service

export const GET = route(
  async (req: Request, ctx: RouteContext<"/api/teams/[teamId]/requests">) => {
    const { user } = await requireUser(req);
    const { teamId } = await parseParams(ctx.params, paramsSchema);
    const query = parseQuery(req, inboxQuerySchema);
    const { requests, totalCount, nextCursor } = await runReadTx((tx) =>
      listInbox(tx, user.id, teamId, query),
    );
    return ok({ requests, totalCount }, { nextCursor });
  },
);

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
