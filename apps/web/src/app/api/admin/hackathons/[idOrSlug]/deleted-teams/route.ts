// GET /api/admin/hackathons/{idOrSlug}/deleted-teams — ADMIN only (step 5.4). The hackathon's
// deleted teams, newest first, from their TEAM_DELETED audit rows: { teamId, name, deletedAt,
// deletedBy, reason, droppedRequests }. Open one's history with GET /api/teams/{teamId}/audit.
// Params: cursor, limit. Response { data: { teams }, nextCursor }.
import { z } from "zod";

import { requireAdmin } from "@/server/auth/session";
import { ok } from "@/server/core/http";
import { route } from "@/server/core/route";
import { runReadTx } from "@/server/core/tx";
import { parseParams, parseQuery } from "@/server/core/validate";
import { listDeletedTeams } from "@/server/modules/audit/reads";
import { deletedTeamsQuerySchema } from "@/server/modules/audit/schemas";
import { resolveHackathon } from "@/server/modules/hackathons/service";

const paramsSchema = z.object({ idOrSlug: z.string() });

export const GET = route(
  async (req: Request, ctx: RouteContext<"/api/admin/hackathons/[idOrSlug]/deleted-teams">) => {
    await requireAdmin(req);
    const { idOrSlug } = await parseParams(ctx.params, paramsSchema);
    const query = parseQuery(req, deletedTeamsQuerySchema);
    const { teams, nextCursor } = await runReadTx(async (tx) => {
      const hackathon = await resolveHackathon(tx, idOrSlug);
      return listDeletedTeams(tx, hackathon.id, query);
    });
    return ok({ teams }, { nextCursor });
  },
);
