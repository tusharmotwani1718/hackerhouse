// POST /api/teams/{teamId}/join — join an OPEN + PUBLIC team from the board, Flow 1 (step 3.4).
// Body: `{}`. Requires an `Idempotency-Key` header: a repeat returns the original 200.
import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { runMutation } from "@/server/core/idempotency";
import { route } from "@/server/core/route";
import { emptyBodySchema, parseJson, parseParams } from "@/server/core/validate";
import { joinTeam } from "@/server/modules/teams/service";

const paramsSchema = z.object({ teamId: z.string() }); // malformed ids → 404 in the service

export const POST = route(async (req: Request, ctx: RouteContext<"/api/teams/[teamId]/join">) => {
  const { user } = await requireUser(req);
  const { teamId } = await parseParams(ctx.params, paramsSchema);
  const input = await parseJson(req, emptyBodySchema);
  return runMutation(req, { userId: user.id, input }, (tx) =>
    joinTeam(tx, user.id, { via: "board", teamId }),
  );
});
