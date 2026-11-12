// GET /api/teams/{teamId}/audit — the team's activity log, newest first (step 5.4).
// The team's CURRENT LEADER (live team), or an ADMIN (any team, including deleted ones — find
// them via GET /api/admin/hackathons/{idOrSlug}/deleted-teams). Params: category (team |
// requests | invites), cursor, limit. Response { data: { entries }, nextCursor }.
// Entries: { id, action, createdAt, actor: { name }, target: { name }, details }; admins also get
// actorUserId, targetUserId, metadata, requestId.
import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { ok } from "@/server/core/http";
import { route } from "@/server/core/route";
import { runReadTx } from "@/server/core/tx";
import { parseParams, parseQuery } from "@/server/core/validate";
import { listTeamAudit } from "@/server/modules/audit/reads";
import { teamAuditQuerySchema } from "@/server/modules/audit/schemas";

const paramsSchema = z.object({ teamId: z.string() }); // malformed ids → 404 in the service

export const GET = route(async (req: Request, ctx: RouteContext<"/api/teams/[teamId]/audit">) => {
  const { user } = await requireUser(req);
  const { teamId } = await parseParams(ctx.params, paramsSchema);
  const query = parseQuery(req, teamAuditQuerySchema);
  const { entries, nextCursor } = await runReadTx((tx) => listTeamAudit(tx, user, teamId, query));
  return ok({ entries }, { nextCursor });
});
