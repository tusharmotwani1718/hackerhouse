import "server-only";

import { z } from "zod";

import { writeAudit } from "../../core/audit";
import { AppError } from "../../core/errors";
import type { Tx, TxResult } from "../../core/tx";
import { isUuid } from "../../core/validate";
import { buildTeamCards, teamCardSelect } from "./cards";
import { assertLeader, lockTeam, toTeamView, updateTeamRow, type TeamView } from "./service";

/**
 * Team settings & invite codes (step 5.3, 03 Flow 9). The leader's operations (9a–9c) lock ONLY
 * the team row (`FOR NO KEY UPDATE`: membership doesn't change) and check leadership under it:
 *  - leadership moves only under the team lock (leave, 3.5), so the check can't go stale;
 *  - other flows that read/write the same state (joins changing member_count; redeemers
 *    re-checking codes, I7) take the same lock, so they're strictly ordered with us.
 * The leader's own participant row is NOT locked: nothing on it decides anything here.
 */

const LEADER_ONLY = "Only this team's leader can change its settings.";

const teamNotFound = () => new AppError("TEAM_NOT_FOUND", "Team not found.");

// ------------------------------------------------------------------------- 9a: toggle looking

/** PATCH /api/teams/{teamId} body. Only `isLooking` is editable in v1. */
export const teamSettingsSchema = z.strictObject({
  isLooking: z.boolean({ error: "must be true or false" }),
});
export type TeamSettings = z.output<typeof teamSettingsSchema>;

/**
 * 9a: turn "looking for teammates" on or off (board listing only, R21). Naturally idempotent
 * ("set to this value"), so no Idempotency-Key: the same value again → 200 with NO write (no
 * version bump, no event). Turning it ON while the team is full → 409 TEAM_FULL (the board
 * hides full teams anyway, so it would be meaningless).
 */
export async function setLooking(
  tx: Tx,
  userId: string,
  teamId: string,
  settings: TeamSettings,
): Promise<TxResult<{ team: TeamView }>> {
  if (!isUuid(teamId)) throw teamNotFound();
  const team = await lockTeam(tx, teamId, "NO KEY UPDATE");
  await assertLeader(tx, userId, team, LEADER_ONLY);

  if (settings.isLooking === team.isLooking) {
    // Nothing changes → nothing to write, version stays, no event.
    const current = await tx.team.findUniqueOrThrow({
      where: { id: team.id },
      select: { ...teamCardSelect, hackathonId: true },
    });
    return { value: { team: toTeamView(current) } };
  }
  if (settings.isLooking && team.memberCount >= team.maxSize) {
    throw new AppError("TEAM_FULL", "This team is full; it can't look for teammates.");
  }

  const updated = await updateTeamRow(tx, team.id, { isLooking: settings.isLooking });
  await writeAudit(tx, [
    {
      action: "LOOKING_TOGGLED",
      hackathonId: team.hackathonId,
      teamId: team.id,
      actorUserId: userId,
      metadata: { isLooking: updated.isLooking, version: updated.version },
    },
  ]);

  // `listed` on the card changes with it, so boards add/remove the team live.
  const [card] = await buildTeamCards(tx, [updated]);
  return {
    value: { team: toTeamView(updated) },
    events: [{ channel: `hackathon:${team.hackathonId}`, type: "team.updated", payload: card }],
  };
}
