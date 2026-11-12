import "server-only";

import type { MutationResult } from "../../core/idempotency";
import type { Tx } from "../../core/tx";
import { requestResolvedTeam, type CreatedRequest } from "../requests/service";
import { joinResolvedTeam, resolveEntryTarget, type JoinedTeam } from "../teams/service";

export type RedeemOutcome =
  ({ outcome: "JOINED" } & JoinedTeam) | ({ outcome: "REQUESTED" } & CreatedRequest);

/**
 * POST /api/invites/redeem: the code identifies the team; its join policy picks the flow.
 * OPEN → join (Flow 1, 200 JOINED); APPROVAL → request (Flow 4, 201 REQUESTED). The code's
 * validity is checked (uniformly) before the policy shows in any answer, then again under the
 * team lock (I7) inside each flow.
 */
export async function redeemInvite(
  tx: Tx,
  userId: string,
  code: string,
): Promise<MutationResult<RedeemOutcome>> {
  const target = await resolveEntryTarget(tx, { via: "code", code });
  if (target.joinPolicy === "OPEN") {
    const joined = await joinResolvedTeam(tx, userId, target);
    return { value: { outcome: "JOINED", ...joined.value }, events: joined.events, status: 200 };
  }
  const requested = await requestResolvedTeam(tx, userId, target);
  return {
    value: { outcome: "REQUESTED", ...requested.value },
    events: requested.events,
    status: 201,
  };
}
