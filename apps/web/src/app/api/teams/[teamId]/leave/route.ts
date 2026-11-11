// POST /api/teams/{teamId}/leave — leave my team, Flow 3 (step 3.5). Body: `{}`.
// Requires an `Idempotency-Key` header: a repeat returns the original 200.
// 200 { teamId, teamDeleted, newLeader }: last member → team deleted (R7); leader leaving →
// the longest-joined member leads (R6).
import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { runMutation } from "@/server/core/idempotency";
import { route } from "@/server/core/route";
import { emptyBodySchema, parseJson, parseParams } from "@/server/core/validate";
import { leaveTeam } from "@/server/modules/teams/service";

const paramsSchema = z.object({ teamId: z.string() }); // malformed ids → 404 in the service

export const POST = route(async (req: Request, ctx: RouteContext<"/api/teams/[teamId]/leave">) => {
  const { user } = await requireUser(req);
  const { teamId } = await parseParams(ctx.params, paramsSchema);
  const input = await parseJson(req, emptyBodySchema);
  return runMutation(req, { userId: user.id, input }, (tx) => leaveTeam(tx, user.id, teamId));
});
