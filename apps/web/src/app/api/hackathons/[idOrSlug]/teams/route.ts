// GET  /api/hackathons/{idOrSlug}/teams — All Teams: every team, newest first, filters + keyset
//      pagination (05 §4.1, step 3.6). Same cards and parameters as the board.
// POST /api/hackathons/{idOrSlug}/teams — create a team, Flow 6 (step 3.3).
//      Requires an `Idempotency-Key` header: a repeat returns the original 201, same invite code.
import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { runMutation } from "@/server/core/idempotency";
import { route } from "@/server/core/route";
import { parseJson, parseParams } from "@/server/core/validate";
import { listTeamsHandler } from "@/server/modules/teams/list-route";
import { createTeamSchema } from "@/server/modules/teams/schemas";
import { createTeam, createTeamConstraintErrors } from "@/server/modules/teams/service";

const paramsSchema = z.object({ idOrSlug: z.string() });

export const GET = route(listTeamsHandler("all"));

export const POST = route(
  async (req: Request, ctx: RouteContext<"/api/hackathons/[idOrSlug]/teams">) => {
    const { user } = await requireUser(req);
    const { idOrSlug } = await parseParams(ctx.params, paramsSchema);
    const input = await parseJson(req, createTeamSchema);
    return runMutation(
      req,
      { userId: user.id, input, status: 201, constraintErrors: createTeamConstraintErrors },
      (tx) => createTeam(tx, user.id, idOrSlug, input),
    );
  },
);
