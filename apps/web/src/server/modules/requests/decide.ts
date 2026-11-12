import "server-only";

import type { DeclineReason, JoinRequestStatus } from "@hacker-house/db";

import { writeAudit } from "../../core/audit";
import { AppError } from "../../core/errors";
import type { DomainEvent } from "../../core/events";
import type { MutationResult } from "../../core/idempotency";
import type { Tx } from "../../core/tx";
import { isUuid } from "../../core/validate";
import { buildTeamCards } from "../teams/cards";
import { assertLeader, lockTeam, toTeamView, updateTeamRow, type TeamView } from "../teams/service";
import { cancelRequests, declineForFullTeam, lockPendingRequests } from "./settlement";

export type DecidedRequest = {
  id: string;
  teamId: string;
  status: JoinRequestStatus;
  declineReason: DeclineReason | null;
  decidedAt: Date;
};

export type ApprovedRequest = { request: DecidedRequest; team: TeamView };
export type DeclinedRequest = { request: DecidedRequest };

// --------------------------------------------------------------------------------- shared steps

type RequestTarget = { id: string; participantId: string; teamId: string; hackathonId: string };

/** Pre-lock (I4): who/what a request is about never changes (trigger join_requests_decided_is_final). */
async function readRequestTarget(tx: Tx, requestId: string): Promise<RequestTarget> {
  const request = isUuid(requestId)
    ? await tx.joinRequest.findUnique({
        where: { id: requestId },
        select: { id: true, participantId: true, teamId: true, hackathonId: true },
      })
    : null;
  if (!request) throw requestNotFound();
  return request;
}

const requestNotFound = () => new AppError("REQUEST_NOT_FOUND", "Join request not found.");

const LEADER_ONLY = "Only this team's leader can decide on join requests.";

/** The request is no longer pending: say what it became (or 404 if it's gone). */
async function notPending(tx: Tx, requestId: string): Promise<AppError> {
  const current = await tx.joinRequest.findUnique({
    where: { id: requestId },
    select: { status: true, declineReason: true },
  });
  if (!current) return requestNotFound();
  return new AppError("REQUEST_NOT_PENDING", "This request has already been decided.", {
    details: { status: current.status, declineReason: current.declineReason },
  });
}

function decisionEvents(
  type: "request.approved" | "request.declined",
  request: DecidedRequest & { hackathonId: string },
  requesterUserId: string,
  leaderUserId: string,
): DomainEvent[] {
  const payload = {
    id: request.id,
    teamId: request.teamId,
    hackathonId: request.hackathonId,
    status: request.status,
    declineReason: request.declineReason,
    cancelReason: null,
  };
  return [
    { channel: `user:${requesterUserId}`, type, payload },
    { channel: `user:${leaderUserId}`, type, payload },
  ];
}

// ---------------------------------------------------------------------------- approve (Flow 2)

/**
 * Flow 2: the leader approves a pending request; the requester joins the team. Runs inside
 * runMutation. Locks (I1): the REQUESTER's participant row → the team → the request batch (participant's request rows and/or team's request rows).
 *
 * Two teams approving the same person both lock that person's row first, so they run one after
 * the other: the second finds its request already CANCELLED (R9) → REQUEST_NOT_PENDING.
 */
export async function approveRequest(
  tx: Tx,
  userId: string,
  requestId: string,
): Promise<MutationResult<ApprovedRequest>> {
  const target = await readRequestTarget(tx, requestId);

  const requesters = await tx.$queryRaw<{ id: string; team_id: string | null; user_id: string }[]>`
    SELECT id, team_id, user_id FROM participants WHERE id = ${target.participantId}::uuid
    FOR NO KEY UPDATE`; // PARTICIPANT_LOCK (teams/service.ts)
  const requester = requesters[0];
  if (!requester) throw requestNotFound(); // withdrew meanwhile (the request went with them)

  const team = await lockTeam(tx, target.teamId, "NO KEY UPDATE");
  await assertLeader(tx, userId, team, LEADER_ONLY);

  // 03 §0.4: ONE sorted batch — the requester's pending requests (always; r is one of them),
  // plus the team's if this approval fills it, or if it is already full (auto-decline below).
  const batch = await lockPendingRequests(tx, {
    participantId: requester.id,
    teamId: team.memberCount + 1 >= team.maxSize ? team.id : null,
  });
  const request = batch.find((row) => row.id === target.id);
  if (!request) throw await notPending(tx, target.id); // decided meanwhile (approve/decline/R9/R24)

  if (requester.team_id) {
    // Defence in depth: joining any team cancels the requester's pending requests (R9).
    throw new AppError("ALREADY_IN_TEAM", "This person is already in a team in this hackathon.");
  }

  if (team.memberCount >= team.maxSize) {
    // Should never happen (filling a team declines its requests, R24; requests to full teams are
    // refused, Flow 4) — handled anyway. State CHANGES (r and the team's other pending requests
    // are declined TEAM_FULL), so this error COMMITS and is stored as the idempotent response.
    const teamsRequests = batch.filter((row) => row.teamId === team.id);
    const events = await declineForFullTeam(tx, teamsRequests, userId);
    return {
      committedError: new AppError("TEAM_FULL", "This team is full. The request was declined.", {
        details: { request: { id: request.id, status: "DECLINED", declineReason: "TEAM_FULL" } },
      }),
      events,
    };
  }

  const approved = await tx.$queryRaw<{ decided_at: Date }[]>`
    UPDATE join_requests
    SET status = 'APPROVED', decided_by_user_id = ${userId}::uuid, decided_at = now()
    WHERE id = ${request.id}::uuid AND status = 'PENDING'
    RETURNING decided_at`;
  await tx.$executeRaw`
    UPDATE participants SET team_id = ${team.id}::uuid, team_joined_at = now()
    WHERE id = ${requester.id}::uuid`;
  const updated = await updateTeamRow(tx, team.id, { memberCountDelta: 1 });

  // The rest of the batch: the requester's other requests are moot (R9); if the team is now
  // full, everyone else's requests to it are declined (R24).
  const requestersOthers = batch.filter(
    (row) => row.participantId === requester.id && row.id !== request.id,
  );
  const teamsOthers = batch.filter(
    (row) => row.teamId === team.id && row.participantId !== requester.id,
  );
  const settlementEvents = [
    ...(await cancelRequests(tx, requestersOthers, "APPROVED_ELSEWHERE", userId)),
    ...(await declineForFullTeam(tx, teamsOthers, userId)),
  ];

  await writeAudit(tx, [
    {
      action: "REQUEST_APPROVED",
      hackathonId: team.hackathonId,
      teamId: team.id,
      actorUserId: userId,
      targetUserId: requester.user_id,
      metadata: { requestId: request.id, participantId: requester.id },
    },
    {
      action: "MEMBER_JOINED",
      hackathonId: team.hackathonId,
      teamId: team.id,
      actorUserId: userId,
      targetUserId: requester.user_id,
      metadata: {
        via: "request",
        requestId: request.id,
        participantId: requester.id,
        memberCount: updated.memberCount,
      },
    },
  ]);

  const decided: DecidedRequest = {
    id: request.id,
    teamId: team.id,
    status: "APPROVED",
    declineReason: null,
    decidedAt: approved[0]!.decided_at,
  };
  const [card] = await buildTeamCards(tx, [updated]);
  return {
    value: { request: decided, team: toTeamView(updated) },
    events: [
      { channel: `hackathon:${team.hackathonId}`, type: "team.updated", payload: card },
      ...decisionEvents(
        "request.approved",
        { ...decided, hackathonId: team.hackathonId },
        requester.user_id,
        userId,
      ),
      ...settlementEvents,
    ],
  };
}

// ---------------------------------------------------------------------------- decline (Flow 2b)

/**
 * Flow 2b: the leader declines a pending request (reason LEADER: blocks a re-request, R13).
 * Locks: the TEAM only (I1 allows skipping the participant level: no membership changes).
 *
 * One conditional UPDATE (I5) is enough. If the requester's own transaction (e.g. joining
 * elsewhere) holds this row in its settlement batch, our UPDATE waits for it; after it commits,
 * READ COMMITTED re-checks `status = 'PENDING'` on the newest version → false → 0 rows → 409.
 * No deadlock: we hold the team and wait for the row; they hold the row and never need our team.
 */
export async function declineRequest(
  tx: Tx,
  userId: string,
  requestId: string,
): Promise<MutationResult<DeclinedRequest>> {
  const target = await readRequestTarget(tx, requestId);
  const team = await lockTeam(tx, target.teamId, "NO KEY UPDATE");
  await assertLeader(tx, userId, team, LEADER_ONLY);

  const declined = await tx.$queryRaw<{ decided_at: Date }[]>`
    UPDATE join_requests
    SET status = 'DECLINED', decline_reason = 'LEADER',
        decided_by_user_id = ${userId}::uuid, decided_at = now()
    WHERE id = ${target.id}::uuid AND status = 'PENDING'
    RETURNING decided_at`;
  if (declined.length === 0) throw await notPending(tx, target.id);

  const requester = await tx.participant.findUniqueOrThrow({
    where: { id: target.participantId },
    select: { userId: true },
  });
  await writeAudit(tx, [
    {
      action: "REQUEST_DECLINED",
      hackathonId: target.hackathonId,
      teamId: target.teamId,
      actorUserId: userId,
      targetUserId: requester.userId,
      metadata: { requestId: target.id, reason: "LEADER" },
    },
  ]);

  const decided: DecidedRequest = {
    id: target.id,
    teamId: target.teamId,
    status: "DECLINED",
    declineReason: "LEADER",
    decidedAt: declined[0]!.decided_at,
  };
  return {
    value: { request: decided },
    events: decisionEvents(
      "request.declined",
      { ...decided, hackathonId: target.hackathonId },
      requester.userId,
      userId,
    ),
  };
}
