// POST   /api/teams/{teamId}/invite-code — the leader regenerates the team's invite code, Flow 9b
//        (step 5.3). Body: `{ expiresInHours? }` (1-720, default 168). Requires an
//        `Idempotency-Key` header: a retry returns the SAME new code instead of revoking it and
//        issuing another. 201 { inviteCode: { code, expiresAt } }.
// DELETE /api/teams/{teamId}/invite-code — the leader revokes it, Flow 9c. No body (a cross-site
//        DELETE can't be sent without a CORS preflight, so the JSON content-type rule isn't
//        needed). Requires an `Idempotency-Key`. 200 { teamId, revoked: true }; none → 404
//        NO_ACTIVE_CODE.
// GET    /api/teams/{teamId}/invite-code — any current member views the active code, Flow 9d.
//        200 { code, expiresAt, createdAt }. Not a member → 403 NOT_A_MEMBER; none (revoked or
//        expired) → 404 NO_ACTIVE_CODE.
import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { ok } from "@/server/core/http";
import { runMutation } from "@/server/core/idempotency";
import { route } from "@/server/core/route";
import { runReadTx } from "@/server/core/tx";
import { parseJson, parseParams } from "@/server/core/validate";
import {
  getInviteCode,
  regenerateInviteCode,
  regenerateInviteSchema,
  revokeInviteCode,
} from "@/server/modules/teams/settings";

const paramsSchema = z.object({ teamId: z.string() }); // malformed ids → 404 in the service

export const GET = route(
  async (req: Request, ctx: RouteContext<"/api/teams/[teamId]/invite-code">) => {
    const { user } = await requireUser(req);
    const { teamId } = await parseParams(ctx.params, paramsSchema);
    return ok(await runReadTx((tx) => getInviteCode(tx, user.id, teamId)));
  },
);

export const POST = route(
  async (req: Request, ctx: RouteContext<"/api/teams/[teamId]/invite-code">) => {
    const { user } = await requireUser(req);
    const { teamId } = await parseParams(ctx.params, paramsSchema);
    const input = await parseJson(req, regenerateInviteSchema);
    return runMutation(req, { userId: user.id, input, status: 201 }, (tx) =>
      regenerateInviteCode(tx, user.id, teamId, input),
    );
  },
);

export const DELETE = route(
  async (req: Request, ctx: RouteContext<"/api/teams/[teamId]/invite-code">) => {
    const { user } = await requireUser(req);
    const { teamId } = await parseParams(ctx.params, paramsSchema);
    // No body: the fingerprint is method + path + {}.
    return runMutation(req, { userId: user.id, input: {} }, (tx) =>
      revokeInviteCode(tx, user.id, teamId),
    );
  },
);
