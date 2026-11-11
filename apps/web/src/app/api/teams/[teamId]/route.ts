// GET /api/teams/{teamId} — team page: card + full member list + viewer block (05 §4.2, step 3.6).
// Any signed-in user. Never the invite code, emails or user ids.
import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { ok } from "@/server/core/http";
import { route } from "@/server/core/route";
import { runReadTx } from "@/server/core/tx";
import { parseParams } from "@/server/core/validate";
import { getTeamPage } from "@/server/modules/teams/reads";

const paramsSchema = z.object({ teamId: z.string() }); // malformed ids → 404 in the service

export const GET = route(async (req: Request, ctx: RouteContext<"/api/teams/[teamId]">) => {
  const { user } = await requireUser(req);
  const { teamId } = await parseParams(ctx.params, paramsSchema);
  return ok(await runReadTx((tx) => getTeamPage(tx, user.id, teamId)));
});
