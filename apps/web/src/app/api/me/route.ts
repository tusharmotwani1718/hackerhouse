// GET /api/me — my profile + skills + completeness (05 §4.8).
// PATCH /api/me — partial update; `skills` replaces the whole set (step 1.3).
import { requireUser } from "@/server/auth/session";
import { ok } from "@/server/core/http";
import { route } from "@/server/core/route";
import { runReadTx, runTx } from "@/server/core/tx";
import { parseJson } from "@/server/core/validate";
import { profilePatchSchema } from "@/server/modules/profile/schemas";
import { getProfile, updateProfile } from "@/server/modules/profile/service";

export const GET = route(async (req: Request) => {
  const { user } = await requireUser(req);
  return ok(await runReadTx((tx) => getProfile(tx, user.id)));
});

export const PATCH = route(async (req: Request) => {
  const { user } = await requireUser(req); // authenticate before validating (03 §0.2)
  const patch = await parseJson(req, profilePatchSchema);
  const profile = await runTx(async (tx) => ({ value: await updateProfile(tx, user.id, patch) }));
  return ok(profile);
});
