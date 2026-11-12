// POST /api/teams/{teamId}/members/{participantId}/remove — the leader removes a member, Flow 7
// (step 5.1). Body: `{}`. Requires an `Idempotency-Key` header. `participantId` comes from the
// team page's member list.
// 200 { teamId, removedParticipantId, team }. Not the leader → 403 NOT_LEADER; yourself → 409
// CANNOT_REMOVE_SELF (leave instead); not in this team → 409 NOT_A_MEMBER.
import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { runMutation } from "@/server/core/idempotency";
import { route } from "@/server/core/route";
import { emptyBodySchema, parseJson, parseParams } from "@/server/core/validate";
import { removeMember } from "@/server/modules/teams/remove";

// Malformed ids → 404 in the service.
const paramsSchema = z.object({ teamId: z.string(), participantId: z.string() });

export const POST = route(
  async (req: Request, ctx: RouteContext<"/api/teams/[teamId]/members/[participantId]/remove">) => {
    const { user } = await requireUser(req);
    const { teamId, participantId } = await parseParams(ctx.params, paramsSchema);
    const input = await parseJson(req, emptyBodySchema);
    return runMutation(req, { userId: user.id, input }, (tx) =>
      removeMember(tx, user.id, teamId, participantId),
    );
  },
);
