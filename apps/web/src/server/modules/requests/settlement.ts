import "server-only";

import type { DeclineReason, JoinRequestStatus } from "@hacker-house/db";

import { writeAudit } from "../../core/audit";
import type { DomainEvent } from "../../core/events";
import type { Tx } from "../../core/tx";

/**
 * Request settlement (step 4.1, 03 §0.4). EVERY transaction that changes pending join requests
 * in bulk goes through here:
 *
 *  1. `lockPendingRequests`: lock the whole batch — the participant's pending requests and/or
 *     the team's — in ONE statement, sorted by id. Two transactions whose batches overlap then
 *     lock the shared rows in the same order, so they can't deadlock. (A plain UPDATE … WHERE,
 *     or an ON DELETE CASCADE, locks rows in no guaranteed order.)
 *  2. One outcome per row: cancel, decline as TEAM_FULL, or report as dropped (team deleted).
 *     Each writes one audit row per request and returns the events to publish after COMMIT.
 *
 * Call AFTER the participant and team locks (I1: participants → team → requests).
 */

export type LockedRequest = {
  id: string;
  hackathonId: string;
  participantId: string;
  teamId: string;
  requesterUserId: string;
};

/** Why a request was cancelled; shown to the requester and kept in the audit log. */
export type CancelReason =
  | "JOINED_TEAM" // I joined an OPEN team
  | "CREATED_TEAM" // I created a team
  | "APPROVED_ELSEWHERE" // another team's leader approved me (4.3)
  | "TEAM_DELETED" // the team I requested was deleted
  | "WITHDREW"; // I withdrew from the hackathon (5.2)

/** The batch of a transaction: `participantId`'s pending requests ∪ (union) `teamId`'s pending requests. */
export async function lockPendingRequests(
  tx: Tx,
  components: { participantId?: string | null; teamId?: string | null },
): Promise<LockedRequest[]> {
  const participantId = components.participantId ?? null;
  const teamId = components.teamId ?? null;
  if (!participantId && !teamId) return [];

  // `FOR UPDATE OF jr`: lock ONLY the request rows. The join reads participants (for the
  // requester's user id) but must not lock them: those are other people's participant rows,
  // and locking them here — after a team lock — would break I1 and invite deadlocks.
  const rows = await tx.$queryRaw<
    {
      id: string;
      hackathon_id: string;
      participant_id: string;
      team_id: string;
      requester_user_id: string;
    }[]
  >`
    SELECT jr.id, jr.hackathon_id, jr.participant_id, jr.team_id, p.user_id AS requester_user_id
    FROM join_requests jr
    JOIN participants p ON p.id = jr.participant_id
    WHERE jr.status = 'PENDING'
      AND (jr.participant_id = ${participantId}::uuid OR jr.team_id = ${teamId}::uuid)
    ORDER BY jr.id
    FOR UPDATE OF jr`;
  return rows.map((row) => ({
    id: row.id,
    hackathonId: row.hackathon_id,
    participantId: row.participant_id,
    teamId: row.team_id,
    requesterUserId: row.requester_user_id,
  }));
}

/** R9: the requester joined or created a team (later: withdrew) → their requests are moot. */
export async function cancelRequests(
  tx: Tx,
  rows: readonly LockedRequest[],
  reason: CancelReason,
  actorUserId: string,
): Promise<DomainEvent[]> {
  if (rows.length === 0) return [];
  // `AND status = 'PENDING'` (I5): under the batch lock every row is still pending; the
  // condition can only ever skip a row, never change a decided one.
  const settled = await updateStatus(tx, rows, actorUserId, "CANCELLED", null);
  await writeAudit(
    tx,
    settled.map((row) => ({
      action: "REQUEST_CANCELLED" as const,
      hackathonId: row.hackathonId,
      teamId: row.teamId,
      actorUserId,
      targetUserId: row.requesterUserId,
      metadata: { requestId: row.id, reason },
    })),
  );
  return requestEvents(tx, settled, "request.cancelled", {
    status: "CANCELLED",
    declineReason: null,
    cancelReason: reason,
    notifyLeader: true,
  });
}

/** R24: the team just became full → its other pending requests are declined (TEAM_FULL). */
export async function declineForFullTeam(
  tx: Tx,
  rows: readonly LockedRequest[],
  actorUserId: string,
): Promise<DomainEvent[]> {
  if (rows.length === 0) return [];
  const settled = await updateStatus(tx, rows, actorUserId, "DECLINED", "TEAM_FULL");
  await writeAudit(
    tx,
    settled.map((row) => ({
      action: "REQUEST_DECLINED" as const,
      hackathonId: row.hackathonId,
      teamId: row.teamId,
      actorUserId,
      targetUserId: row.requesterUserId,
      metadata: { requestId: row.id, reason: "TEAM_FULL" },
    })),
  );
  return requestEvents(tx, settled, "request.declined", {
    status: "DECLINED",
    declineReason: "TEAM_FULL",
    cancelReason: null,
    notifyLeader: true,
  });
}

/**
 * R23: the team is about to be deleted; its requests go with it (ON DELETE CASCADE). Call with
 * the LOCKED batch BEFORE the delete, so the cascade only touches rows we hold, and while the
 * requesters can still be read. No UPDATE: the rows disappear. The leader isn't notified (the
 * team is gone, and the leader is the one deleting it).
 */
export async function reportDroppedRequests(
  tx: Tx,
  rows: readonly LockedRequest[],
  actorUserId: string,
): Promise<DomainEvent[]> {
  if (rows.length === 0) return [];
  await writeAudit(
    tx,
    rows.map((row) => ({
      action: "REQUEST_CANCELLED" as const,
      hackathonId: row.hackathonId,
      teamId: row.teamId,
      actorUserId,
      targetUserId: row.requesterUserId,
      metadata: { requestId: row.id, reason: "TEAM_DELETED" },
    })),
  );
  return requestEvents(tx, rows, "request.cancelled", {
    status: "CANCELLED",
    declineReason: null,
    cancelReason: "TEAM_DELETED",
    notifyLeader: false,
  });
}

// ------------------------------------------------------------------------------------ helpers

async function updateStatus(
  tx: Tx,
  rows: readonly LockedRequest[],
  actorUserId: string,
  status: Extract<JoinRequestStatus, "CANCELLED" | "DECLINED">,
  declineReason: DeclineReason | null,
): Promise<LockedRequest[]> {
  const updated = await tx.$queryRaw<{ id: string }[]>`
    UPDATE join_requests
    SET status = ${status}::join_request_status,
        decline_reason = ${declineReason}::decline_reason,
        decided_by_user_id = ${actorUserId}::uuid,
        decided_at = now()
    WHERE id = ANY(${rows.map((row) => row.id)}::uuid[]) AND status = 'PENDING'
    RETURNING id`;
  const ids = new Set(updated.map((row) => row.id));
  return rows.filter((row) => ids.has(row.id));
}

/**
 * One event to the requester (`user:` channel, 05 §5) and, unless the team is being deleted,
 * one to that team's leader (their inbox changed). The leader is read without a lock: we
 * don't hold every affected team's lock, so a leadership change racing with this could notify
 * the previous leader. Harmless: events are hints, and the new leader's inbox read is exact.
 */
async function requestEvents(
  tx: Tx,
  rows: readonly LockedRequest[],
  type: "request.cancelled" | "request.declined",
  outcome: {
    status: JoinRequestStatus;
    declineReason: DeclineReason | null;
    cancelReason: CancelReason | null;
    notifyLeader: boolean;
  },
): Promise<DomainEvent[]> {
  if (rows.length === 0) return [];
  const leaders = outcome.notifyLeader
    ? await tx.$queryRaw<{ team_id: string; leader_user_id: string }[]>`
        SELECT t.id AS team_id, p.user_id AS leader_user_id
        FROM teams t JOIN participants p ON p.id = t.leader_participant_id
        WHERE t.id = ANY(${[...new Set(rows.map((row) => row.teamId))]}::uuid[])`
    : [];
  const leaderOf = new Map(leaders.map((row) => [row.team_id, row.leader_user_id]));

  return rows.flatMap((row) => {
    const payload = {
      id: row.id,
      teamId: row.teamId,
      hackathonId: row.hackathonId,
      status: outcome.status,
      declineReason: outcome.declineReason,
      cancelReason: outcome.cancelReason,
    };
    const leaderUserId = leaderOf.get(row.teamId);
    return [
      { channel: `user:${row.requesterUserId}`, type, payload },
      ...(leaderUserId ? [{ channel: `user:${leaderUserId}`, type, payload }] : []),
    ];
  });
}
