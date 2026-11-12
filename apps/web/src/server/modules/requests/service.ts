import "server-only";

import { writeAudit } from "../../core/audit";
import { AppError } from "../../core/errors";
import type { DomainEvent } from "../../core/events";
import type { ConstraintErrors } from "../../core/pg-errors";
import type { Tx, TxResult } from "../../core/tx";
import {
  lockOwnParticipant,
  lockTeam,
  resolveEntryTarget,
  revalidateInviteCode,
  type EntryTarget,
  type TeamEntry,
} from "../teams/service";

export type CreatedRequest = {
  request: { id: string; teamId: string; hackathonId: string; status: "PENDING"; createdAt: Date };
};

/**
 * Pass to runMutation. Only a backstop: under both locks step 7 below finds an existing
 * request first, and can tell pending from leader-declined (the index can't).
 */
export const requestConstraintErrors: ConstraintErrors = {
  join_requests_active_pair_key: {
    code: "REQUEST_ALREADY_PENDING",
    message: "You already have a pending request to this team.",
  },
};

/**
 * Flow 4: request to join an APPROVAL team. Runs inside runMutation. An OPEN team → 409
 * USE_JOIN (join directly, Flow 1).
 */
export async function requestToJoin(
  tx: Tx,
  userId: string,
  entry: TeamEntry,
): Promise<TxResult<CreatedRequest>> {
  const target = await resolveEntryTarget(tx, entry);
  if (target.joinPolicy !== "APPROVAL") {
    throw new AppError("USE_JOIN", "This team takes members directly. Join it instead.");
  }
  return requestResolvedTeam(tx, userId, target);
}

/**
 * Flow 4 from the locks on, for an already-resolved APPROVAL target (redeem resolves once).
 *
 * BOTH locks, because a new request is invisible to other transactions until it commits, so
 * settlement can't see it:
 *  - my participant lock: else I could request T while joining U; U's settlement (R9) can't
 *    cancel the uncommitted request → an orphan PENDING request from someone on a team;
 *  - the team lock: else I could request T while T's last seat is filled; the fill's settlement
 *    (R24) can't decline it → a PENDING request to a full team.
 * With both held, those pairs run one after the other, and either we refuse (steps 5–6) or our
 * committed request is settled normally by the later transaction.
 */
export async function requestResolvedTeam(
  tx: Tx,
  userId: string,
  target: EntryTarget,
): Promise<TxResult<CreatedRequest>> {
  const participant = await lockOwnParticipant(tx, userId, target.hackathonId);
  const team = await lockTeam(tx, target.teamId, "NO KEY UPDATE");
  if (target.inviteCodeId) await revalidateInviteCode(tx, target.inviteCodeId);

  if (participant.teamId) {
    throw new AppError("ALREADY_IN_TEAM", "You are already in a team in this hackathon.");
  }
  if (team.memberCount >= team.maxSize) {
    throw new AppError("TEAM_FULL", "This team is full.");
  }

  // Stable without a further lock: requests for (me → T) change only under my participant
  // lock or T's lock (settlement, approve, decline), and we hold both.
  const existing = await tx.$queryRaw<{ status: string }[]>`
    SELECT status FROM join_requests
    WHERE participant_id = ${participant.id}::uuid AND team_id = ${team.id}::uuid
      AND (status = 'PENDING' OR (status = 'DECLINED' AND decline_reason = 'LEADER'))
    LIMIT 1`;
  if (existing[0]?.status === "PENDING") {
    throw new AppError(
      "REQUEST_ALREADY_PENDING",
      "You already have a pending request to this team.",
    );
  }
  if (existing[0]) {
    throw new AppError(
      "PREVIOUSLY_DECLINED",
      "This team's leader declined your earlier request. You can't request again.",
    );
  }

  // No cap on pending requests per participant (R27); no expiry (R8).
  const inserted = await tx.$queryRaw<{ id: string; created_at: Date }[]>`
    INSERT INTO join_requests (hackathon_id, participant_id, team_id)
    VALUES (${team.hackathonId}::uuid, ${participant.id}::uuid, ${team.id}::uuid)
    RETURNING id, created_at`;
  const request = inserted[0]!;

  await writeAudit(tx, [
    {
      action: "REQUEST_CREATED",
      hackathonId: team.hackathonId,
      teamId: team.id,
      actorUserId: userId,
      metadata: {
        requestId: request.id,
        via: target.via,
        ...(target.inviteCodeId && { inviteCodeId: target.inviteCodeId }),
      },
    },
  ]);

  // The leader is read under the team lock, so this reaches the CURRENT leader (their inbox).
  const leader = await tx.participant.findUniqueOrThrow({
    where: { id: team.leaderParticipantId },
    select: { userId: true },
  });
  const payload = {
    id: request.id,
    teamId: team.id,
    hackathonId: team.hackathonId,
    status: "PENDING" as const,
    declineReason: null,
    cancelReason: null,
    createdAt: request.created_at,
  };
  const events: DomainEvent[] = [
    { channel: `user:${userId}`, type: "request.created", payload },
    { channel: `user:${leader.userId}`, type: "request.created", payload },
  ];

  return {
    value: {
      request: {
        id: request.id,
        teamId: team.id,
        hackathonId: team.hackathonId,
        status: "PENDING",
        createdAt: request.created_at,
      },
    },
    events,
  };
}
