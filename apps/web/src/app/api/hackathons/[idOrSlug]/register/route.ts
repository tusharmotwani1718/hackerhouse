// POST /api/hackathons/{idOrSlug}/register — Flow 5 (step 2.2). Body: `{}`.
// Requires an `Idempotency-Key` header (step 3.2): a repeat returns the original 201.
import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { runMutation } from "@/server/core/idempotency";
import { route } from "@/server/core/route";
import { emptyBodySchema, parseJson, parseParams } from "@/server/core/validate";
import { register, registerConstraintErrors } from "@/server/modules/participants/service";

const paramsSchema = z.object({ idOrSlug: z.string() });

export const POST = route(
  async (req: Request, ctx: RouteContext<"/api/hackathons/[idOrSlug]/register">) => {
    const { user } = await requireUser(req);
    const { idOrSlug } = await parseParams(ctx.params, paramsSchema);
    const input = await parseJson(req, emptyBodySchema);
    return runMutation(
      req,
      { userId: user.id, input, status: 201, constraintErrors: registerConstraintErrors },
      async (tx) => ({ value: await register(tx, user.id, idOrSlug) }),
    );
  },
);
