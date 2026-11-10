// POST /api/hackathons/{idOrSlug}/register — Flow 5 (step 2.2). Body: `{}`.
import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { ok } from "@/server/core/http";
import { route } from "@/server/core/route";
import { runTx } from "@/server/core/tx";
import { emptyBodySchema, parseJson, parseParams } from "@/server/core/validate";
import { register, registerConstraintErrors } from "@/server/modules/participants/service";

const paramsSchema = z.object({ idOrSlug: z.string() });

export const POST = route(
  async (req: Request, ctx: RouteContext<"/api/hackathons/[idOrSlug]/register">) => {
    const { user } = await requireUser(req);
    const { idOrSlug } = await parseParams(ctx.params, paramsSchema);
    await parseJson(req, emptyBodySchema);
    const status = await runTx(async (tx) => ({ value: await register(tx, user.id, idOrSlug) }), {
      constraintErrors: registerConstraintErrors,
    });
    return ok(status, { status: 201 });
  },
);
