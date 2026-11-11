import "server-only";

import { z } from "zod";

import { requireUser } from "../../auth/session";
import { ok } from "../../core/http";
import { runReadTx } from "../../core/tx";
import { parseParams, parseQuery } from "../../core/validate";
import { resolveHackathon } from "../hackathons/service";
import { listTeams } from "./reads";
import { listTeamsQuerySchema } from "./schemas";

const paramsSchema = z.object({ idOrSlug: z.string() });

/**
 * Handler shared by the board (`board`, 05 §3) and All Teams (`all`, 05 §4.1): same params,
 * same cards, same pagination. Wrap with `route()` in the route file. (Route files may only
 * export HTTP methods, so this lives here.)
 */
export function listTeamsHandler(scope: "board" | "all") {
  return async (req: Request, ctx: { params: Promise<{ idOrSlug: string }> }) => {
    await requireUser(req);
    const { idOrSlug } = await parseParams(ctx.params, paramsSchema);
    const query = parseQuery(req, listTeamsQuerySchema);
    const { teams, totalCount, nextCursor } = await runReadTx(async (tx) => {
      const hackathon = await resolveHackathon(tx, idOrSlug);
      return listTeams(tx, hackathon.id, scope, query);
    });
    return ok({ teams, totalCount }, { nextCursor });
  };
}
