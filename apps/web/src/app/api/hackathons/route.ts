// GET /api/hackathons — every hackathon, newest first (any signed-in user; 05 §4.7).
// POST /api/hackathons — create one (admins only, R14). Step 2.1.
import { requireAdmin, requireUser } from "@/server/auth/session";
import { ok } from "@/server/core/http";
import { route } from "@/server/core/route";
import { runReadTx, runTx } from "@/server/core/tx";
import { parseJson } from "@/server/core/validate";
import { createHackathonSchema } from "@/server/modules/hackathons/schemas";
import {
  createHackathon,
  createHackathonConstraintErrors,
  listHackathons,
} from "@/server/modules/hackathons/service";

export const GET = route(async (req: Request) => {
  await requireUser(req);
  return ok(await runReadTx((tx) => listHackathons(tx)));
});

export const POST = route(async (req: Request) => {
  const { user } = await requireAdmin(req); // authenticate + authorize before validating
  const input = await parseJson(req, createHackathonSchema);
  const hackathon = await runTx(
    async (tx) => ({ value: await createHackathon(tx, user.id, input) }),
    { constraintErrors: createHackathonConstraintErrors },
  );
  return ok(hackathon, { status: 201 });
});
