// GET /api/hackathons/{idOrSlug}/me/requests — my join requests in this hackathon, every status,
// newest first, with a team summary (05 §4.4, step 4.4). Used to overlay "Requested ✓" /
// "Declined" on board cards. Params: cursor, limit. Not registered → an empty list.
// Response { data: { requests }, nextCursor }.
import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { ok } from "@/server/core/http";
import { route } from "@/server/core/route";
import { runReadTx } from "@/server/core/tx";
import { parseParams, parseQuery } from "@/server/core/validate";
import { resolveHackathon } from "@/server/modules/hackathons/service";
import { listMyRequests } from "@/server/modules/requests/reads";
import { myRequestsQuerySchema } from "@/server/modules/requests/schemas";

const paramsSchema = z.object({ idOrSlug: z.string() });

export const GET = route(
  async (req: Request, ctx: RouteContext<"/api/hackathons/[idOrSlug]/me/requests">) => {
    const { user } = await requireUser(req);
    const { idOrSlug } = await parseParams(ctx.params, paramsSchema);
    const query = parseQuery(req, myRequestsQuerySchema);
    const { requests, nextCursor } = await runReadTx(async (tx) => {
      const hackathon = await resolveHackathon(tx, idOrSlug);
      return listMyRequests(tx, user.id, hackathon.id, query);
    });
    return ok({ requests }, { nextCursor });
  },
);
