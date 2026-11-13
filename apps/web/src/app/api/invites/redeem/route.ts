// POST /api/invites/redeem — use a team's invite code, any access (steps 3.4 + 4.2).
// Body: `{ code }` (case, hyphens, spaces and I/L/O look-alikes forgiven). Requires an
// `Idempotency-Key` header. The code's team decides the flow:
//   OPEN     → join (Flow 1):    200 { outcome: "JOINED", team, joinedAt }
//   APPROVAL → request (Flow 4): 201 { outcome: "REQUESTED", request }
// Every bad code (wrong, malformed, revoked, expired) gets the same 404 INVALID_CODE.
// Rate limits (06 §4, step 7.1): 10 attempts / 10 min per user + 50 / 10 min per IP, counted
// for EVERY attempt before any work (a failed guess is known only after the attempt).
import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { runMutation } from "@/server/core/idempotency";
import { route } from "@/server/core/route";
import { parseJson } from "@/server/core/validate";
import { redeemInvite } from "@/server/modules/invites/redeem";
import { requestConstraintErrors } from "@/server/modules/requests/service";
import { clientIp, enforceLimits } from "@/server/ratelimit/limiter";

const redeemSchema = z.strictObject({
  // Only a sanity bound: the format check happens in the service, so a malformed code gets
  // the same INVALID_CODE as a wrong one.
  code: z.string({ error: "must be a string" }).max(64, { error: "must be at most 64 characters" }),
});

export const POST = route(async (req: Request) => {
  const { user } = await requireUser(req);
  await enforceLimits([
    { rule: "redeem.user", subject: user.id },
    { rule: "redeem.ip", subject: clientIp(req) },
  ]);
  const input = await parseJson(req, redeemSchema);
  return runMutation(
    req,
    { userId: user.id, input, constraintErrors: requestConstraintErrors },
    (tx) => redeemInvite(tx, user.id, input.code),
  );
});
