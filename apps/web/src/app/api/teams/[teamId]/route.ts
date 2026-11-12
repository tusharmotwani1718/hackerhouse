// GET   /api/teams/{teamId} — team page: card + full member list + viewer block (05 §4.2,
//       step 3.6). Any signed-in user. Never the invite code, emails or user ids.
// PATCH /api/teams/{teamId} — the leader turns "looking for teammates" on/off, Flow 9a (step
//       5.3). Body: `{ isLooking }`. No Idempotency-Key: "set to this value" is naturally
//       idempotent. 200 { team }. Not the leader → 403 NOT_LEADER; on while full → 409 TEAM_FULL.
import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { ok } from "@/server/core/http";
import { route } from "@/server/core/route";
import { runReadTx, runTx } from "@/server/core/tx";
import { parseJson, parseParams } from "@/server/core/validate";
import { getTeamPage } from "@/server/modules/teams/reads";
import { setLooking, teamSettingsSchema } from "@/server/modules/teams/settings";

const paramsSchema = z.object({ teamId: z.string() }); // malformed ids → 404 in the service

export const GET = route(async (req: Request, ctx: RouteContext<"/api/teams/[teamId]">) => {
  const { user } = await requireUser(req);
  const { teamId } = await parseParams(ctx.params, paramsSchema);
  return ok(await runReadTx((tx) => getTeamPage(tx, user.id, teamId)));
});

export const PATCH = route(async (req: Request, ctx: RouteContext<"/api/teams/[teamId]">) => {
  const { user } = await requireUser(req);
  const { teamId } = await parseParams(ctx.params, paramsSchema);
  const settings = await parseJson(req, teamSettingsSchema);
  return ok(await runTx((tx) => setLooking(tx, user.id, teamId, settings)));
});
