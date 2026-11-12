import "server-only";

import { writeAudit } from "../../core/audit";
import { AppError } from "../../core/errors";
import type { Tx, TxResult } from "../../core/tx";
import { isUuid } from "../../core/validate";
import { buildTeamCards } from "./cards";
import { assertLeader, lockTeam, toTeamView, updateTeamRow, type TeamView } from "./service";

export type RemovedMember = { teamId: string; removedParticipantId: string; team: TeamView };

const memberNotFound = () => new AppError("MEMBER_NOT_FOUND", "Member not found.");

/**
 * Flow 7: the team's leader removes another member; the seat frees up. Runs inside runMutation.
 * The removed member may re-join later through the normal flows (no ban in v1, R25).
 *
 * Locks (I1): the REMOVED participant row → the team. The participant whose membership changes
 * is locked first (same shape as approve, 4.3); the leader (actor) is not locked — the team
 * lock freezes leadership. So a removal racing the member's own leave serializes on that
 * participant row (second → NOT_A_MEMBER), and one racing the leader's leave serializes on the
 * team row (leave first → NOT_LEADER).
 *
 * Nothing else to settle: a member has no pending requests (R9 cancelled them on joining), a
 * freed seat declines no one, the leader stays (no succession) and the team keeps ≥ 1 member
 * (never deleted here; teams_member_count_check is the safety net).
 */
export async function removeMember(
  tx: Tx,
  userId: string,
  teamId: string,
  participantId: string,
): Promise<TxResult<RemovedMember>> {
  if (!isUuid(teamId)) throw new AppError("TEAM_NOT_FOUND", "Team not found.");
  if (!isUuid(participantId)) throw memberNotFound();

  const removed = await tx.$queryRaw<{ id: string; team_id: string | null; user_id: string }[]>`
    SELECT id, team_id, user_id FROM participants WHERE id = ${participantId}::uuid
    FOR NO KEY UPDATE`; // PARTICIPANT_LOCK (teams/service.ts)
  const member = removed[0];
  if (!member) throw memberNotFound();

  // NO KEY UPDATE: the team is changed but never deleted here (the leader remains).
  const team = await lockTeam(tx, teamId, "NO KEY UPDATE");
  const leaderParticipantId = await assertLeader(
    tx,
    userId,
    team,
    "Only this team's leader can remove members.",
  );
  if (member.id === leaderParticipantId) {
    throw new AppError("CANNOT_REMOVE_SELF", "You can't remove yourself. Leave the team instead.");
  }
  if (member.team_id !== team.id) {
    throw new AppError("NOT_A_MEMBER", "This person is not a member of this team.");
  }

  await tx.$executeRaw`
    UPDATE participants SET team_id = NULL, team_joined_at = NULL WHERE id = ${member.id}::uuid`;
  const updated = await updateTeamRow(tx, team.id, { memberCountDelta: -1 });

  await writeAudit(tx, [
    {
      action: "MEMBER_REMOVED",
      hackathonId: team.hackathonId,
      teamId: team.id,
      actorUserId: userId,
      targetUserId: member.user_id,
      metadata: { participantId: member.id, memberCount: updated.memberCount },
    },
  ]);

  const [card] = await buildTeamCards(tx, [updated]);
  return {
    value: { teamId: team.id, removedParticipantId: member.id, team: toTeamView(updated) },
    events: [
      { channel: `hackathon:${team.hackathonId}`, type: "team.updated", payload: card },
      // Private: only the removed member learns it was THEM (teammates see team.updated).
      {
        channel: `user:${member.user_id}`,
        type: "membership.removed",
        payload: { teamId: team.id, teamName: team.name, hackathonId: team.hackathonId },
      },
    ],
  };
}
