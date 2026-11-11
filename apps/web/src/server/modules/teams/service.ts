import "server-only";

import type { JoinPolicy, TeamAccess } from "@hacker-house/db";

import { writeAudit } from "../../core/audit";
import { AppError } from "../../core/errors";
import type { DomainEvent } from "../../core/events";
import type { ConstraintErrors } from "../../core/pg-errors";
import type { Tx, TxResult } from "../../core/tx";
import { resolveHackathon } from "../hackathons/service";
import { buildTeamCards, teamCardSelect } from "./cards";
import { insertInviteCode } from "./invite-codes";
import type { CreateTeam } from "./schemas";

/** The full team as its creator sees it (public fields; the code is returned separately). */
export type TeamView = {
  id: string;
  hackathonId: string;
  name: string;
  description: string;
  joinPolicy: JoinPolicy;
  access: TeamAccess;
  isLooking: boolean;
  memberCount: number;
  maxSize: number;
  version: number;
  createdAt: Date;
};

export type CreatedTeam = {
  team: TeamView;
  /** Only in the creator's own response (and its stored idempotent copy); never public (R28). */
  inviteCode: { code: string; expiresAt: Date };
};

/** Pass to runMutation. The name index is hand-written: (hackathon_id, lower(name)). */
export const createTeamConstraintErrors: ConstraintErrors = {
  teams_hackathon_id_lower_name_key: {
    code: "TEAM_NAME_TAKEN",
    message: "A team with this name already exists in this hackathon. Please choose another name.",
  },
};

/**
 * Lock the caller's participant row in this hackathon (I1: participants come first), or 403.
 * After this returns, `teamId` is current and can't change until we commit (I3).
 */
export async function lockOwnParticipant(
  tx: Tx,
  userId: string,
  hackathonId: string,
): Promise<{ id: string; teamId: string | null }> {
  const rows = await tx.$queryRaw<{ id: string; team_id: string | null }[]>`
    SELECT id, team_id FROM participants
    WHERE user_id = ${userId}::uuid AND hackathon_id = ${hackathonId}::uuid
    FOR UPDATE`;
  const row = rows[0];
  if (!row) {
    throw new AppError("NOT_REGISTERED", "Register for this hackathon first.");
  }
  return { id: row.id, teamId: row.team_id };
}

/**
 * Flow 6: create a team; the creator becomes leader in the first seat (R5). Runs inside
 * runMutation (the idempotency claim already ran as this transaction's first statement).
 *
 * Locks: only the creator's participant row. The new team needs none: no other transaction
 * can know its id before we commit.
 */
export async function createTeam(
  tx: Tx,
  userId: string,
  idOrSlug: string,
  input: CreateTeam,
): Promise<TxResult<CreatedTeam>> {
  // Pre-lock read of immutable fields only (I4): the hackathon's id and max_team_size never change.
  const hackathon = await resolveHackathon(tx, idOrSlug);

  // Lock FIRST, then decide (no check-then-act): a second create by the same user waits here,
  // then sees team_id already set.
  const participant = await lockOwnParticipant(tx, userId, hackathon.id);
  if (participant.teamId) {
    throw new AppError("ALREADY_IN_TEAM", "You are already in a team in this hackathon.");
  }

  // The leader FK is DEFERRED: right now the team names P as leader while P's team_id is still
  // NULL. Checked at COMMIT, when the UPDATE below has made both rows agree.
  // A taken name (any letter case) → 23505 on teams_hackathon_id_lower_name_key → TEAM_NAME_TAKEN.
  const team = await tx.team.create({
    data: {
      hackathonId: hackathon.id,
      name: input.name,
      description: input.description,
      joinPolicy: input.joinPolicy,
      access: input.access,
      isLooking: input.isLooking,
      leaderParticipantId: participant.id,
      memberCount: 1,
      maxSize: hackathon.maxTeamSize, // copied; teams_hackathon_fkey keeps it equal (R10)
    },
    select: { ...teamCardSelect, hackathonId: true },
  });

  await tx.$executeRaw`
    UPDATE participants SET team_id = ${team.id}::uuid, team_joined_at = now()
    WHERE id = ${participant.id}::uuid`;

  const invite = await insertInviteCode(tx, {
    teamId: team.id,
    createdByUserId: userId,
    expiresInHours: input.inviteExpiresInHours,
  });

  // TODO(4.1): cancel P's pending join requests in this hackathon (R9), via the §0.4 helper.

  await writeAudit(tx, [
    {
      action: "TEAM_CREATED",
      hackathonId: hackathon.id,
      teamId: team.id,
      actorUserId: userId,
      metadata: {
        name: team.name,
        joinPolicy: team.joinPolicy,
        access: team.access,
        leaderParticipantId: participant.id,
      },
    },
    {
      action: "INVITE_CODE_GENERATED", // the code itself is never written to the audit log
      hackathonId: hackathon.id,
      teamId: team.id,
      actorUserId: userId,
      metadata: { inviteCodeId: invite.id, expiresAt: invite.expiresAt.toISOString() },
    },
  ]);

  // Event payload = the public board card (no code). Built after the writes, in this transaction.
  const [card] = await buildTeamCards(tx, [team]);
  const events: DomainEvent[] = [
    { channel: `hackathon:${hackathon.id}`, type: "team.created", payload: card },
  ];

  return {
    value: {
      team: {
        id: team.id,
        hackathonId: team.hackathonId,
        name: team.name,
        description: team.description,
        joinPolicy: team.joinPolicy,
        access: team.access,
        isLooking: team.isLooking,
        memberCount: team.memberCount,
        maxSize: team.maxSize,
        version: team.version,
        createdAt: team.createdAt,
      },
      inviteCode: { code: invite.code, expiresAt: invite.expiresAt },
    },
    events,
  };
}
