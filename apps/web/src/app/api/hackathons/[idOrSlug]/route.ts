// GET /api/hackathons/{idOrSlug} — one hackathon by uuid or slug (any signed-in user).
// Step 2.1; `stats.participants` since 2.2 (`teams`, `lookingTeams` join in 3.6, 05 §4.7).
import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { ok } from "@/server/core/http";
import { route } from "@/server/core/route";
import { runReadTx } from "@/server/core/tx";
import { parseParams } from "@/server/core/validate";
import { getHackathon } from "@/server/modules/hackathons/service";

const paramsSchema = z.object({ idOrSlug: z.string() }); // anything unknown → 404, not 400

export const GET = route(async (req: Request, ctx: RouteContext<"/api/hackathons/[idOrSlug]">) => {
  await requireUser(req);
  const { idOrSlug } = await parseParams(ctx.params, paramsSchema);
  return ok(await runReadTx((tx) => getHackathon(tx, idOrSlug)));
});
