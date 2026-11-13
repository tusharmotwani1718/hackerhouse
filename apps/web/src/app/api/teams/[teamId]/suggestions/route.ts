// GET /api/teams/{teamId}/suggestions?limit=20 — teammate suggestions for the team's open seats
// (04, step 8.1). Leader only (403 NOT_LEADER); the team needs an open seat (409 TEAM_FULL);
// unknown or malformed team → 404. Limit 1-50, default 20. Rate limit: suggestion.user 20/min.
// Response { data: { method, team: { id, skillProfile, timezone }, suggestions: [...] } }, each
// suggestion with a per-skill breakdown, the timezone factor and the formula (scoring explained).
import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { ok } from "@/server/core/http";
import { route } from "@/server/core/route";
import { runReadTx } from "@/server/core/tx";
import { parseParams, parseQuery } from "@/server/core/validate";
import { suggestionsQuerySchema } from "@/server/modules/suggestions/schemas";
import { suggestTeammates } from "@/server/modules/suggestions/service";

const paramsSchema = z.object({ teamId: z.string() }); // malformed ids → 404 in the service

export const GET = route(
  async (req: Request, ctx: RouteContext<"/api/teams/[teamId]/suggestions">) => {
    // Its own budget (06 §4: 20/min, the heaviest read), not the general read one.
    const { user } = await requireUser(req, { limit: "suggestion" });
    const { teamId } = await parseParams(ctx.params, paramsSchema);
    const query = parseQuery(req, suggestionsQuerySchema);
    return ok(await runReadTx((tx) => suggestTeammates(tx, user.id, teamId, query)));
  },
);
