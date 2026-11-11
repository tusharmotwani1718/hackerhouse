// POST /api/invites/redeem — join a team with its invite code, any access, Flow 1 (step 3.4).
// Body: `{ code }` (case, hyphens, spaces and I/L/O look-alikes forgiven). Requires an
// `Idempotency-Key` header. Every bad code (wrong, malformed, revoked, expired) gets the same
// 404 INVALID_CODE. APPROVAL teams' codes: 409 APPROVAL_REQUIRED until step 4.2 (Flow 4).
// TODO(phase 7): strict per-user rate limit (06 §5: 10 per 10 min) against code guessing.
import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { runMutation } from "@/server/core/idempotency";
import { route } from "@/server/core/route";
import { parseJson } from "@/server/core/validate";
import { joinTeam } from "@/server/modules/teams/service";

const redeemSchema = z.strictObject({
  // Only a sanity bound: the format check happens in the service, so a malformed code gets
  // the same INVALID_CODE as a wrong one.
  code: z.string({ error: "must be a string" }).max(64, { error: "must be at most 64 characters" }),
});

export const POST = route(async (req: Request) => {
  const { user } = await requireUser(req);
  const input = await parseJson(req, redeemSchema);
  return runMutation(req, { userId: user.id, input }, (tx) =>
    joinTeam(tx, user.id, { via: "code", code: input.code }),
  );
});
