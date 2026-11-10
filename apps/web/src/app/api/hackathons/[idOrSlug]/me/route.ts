// GET /api/hackathons/{idOrSlug}/me — my status in this hackathon (05 §4.5, step 2.2).
import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { ok } from "@/server/core/http";
import { route } from "@/server/core/route";
import { runReadTx } from "@/server/core/tx";
import { parseParams } from "@/server/core/validate";
import { getMyStatus } from "@/server/modules/participants/service";

const paramsSchema = z.object({ idOrSlug: z.string() });

export const GET = route(
  async (req: Request, ctx: RouteContext<"/api/hackathons/[idOrSlug]/me">) => {
    const { user } = await requireUser(req);
    const { idOrSlug } = await parseParams(ctx.params, paramsSchema);
    return ok(await runReadTx((tx) => getMyStatus(tx, user.id, idOrSlug)));
  },
);
