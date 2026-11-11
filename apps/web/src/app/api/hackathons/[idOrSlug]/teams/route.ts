// POST /api/hackathons/{idOrSlug}/teams — create a team, Flow 6 (step 3.3).
// Requires an `Idempotency-Key` header: a repeat returns the original 201, same invite code.
// (GET — All Teams — joins this file in step 3.6.)
import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { runMutation } from "@/server/core/idempotency";
import { route } from "@/server/core/route";
import { parseJson, parseParams } from "@/server/core/validate";
import { createTeamSchema } from "@/server/modules/teams/schemas";
import { createTeam, createTeamConstraintErrors } from "@/server/modules/teams/service";

const paramsSchema = z.object({ idOrSlug: z.string() });

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
