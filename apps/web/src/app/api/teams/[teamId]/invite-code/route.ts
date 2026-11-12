// POST /api/teams/{teamId}/invite-code — the leader regenerates the team's invite code, Flow 9b
// (step 5.3). Body: `{ expiresInHours? }` (1-720, default 168). Requires an `Idempotency-Key`
// header: a retry returns the SAME new code instead of revoking it and issuing another.
// 201 { inviteCode: { code, expiresAt } } — the code appears only here (and via GET, 9d).
// (DELETE — revoke, 9c — and GET — view, 9d — join this file next.)
import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { runMutation } from "@/server/core/idempotency";
import { route } from "@/server/core/route";
import { parseJson, parseParams } from "@/server/core/validate";
import { regenerateInviteCode, regenerateInviteSchema } from "@/server/modules/teams/settings";

const paramsSchema = z.object({ teamId: z.string() }); // malformed ids → 404 in the service

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
