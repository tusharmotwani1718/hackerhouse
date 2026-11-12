import "server-only";

import type {
  DeclineReason,
  JoinPolicy,
  JoinRequestStatus,
  Skill,
  TeamAccess,
} from "@hacker-house/db";

import { AppError } from "../../core/errors";
import {
  afterCursor,
  cursorTimestamp,
  decodeCursor,
  keysetOrder,
  pageOf,
  type SortDirection,
} from "../../core/keyset";
import type { Tx } from "../../core/tx";
import { isUuid } from "../../core/validate";
import type { InboxQuery, MyRequestsQuery } from "./schemas";

/**
 * Join-request reads (step 4.4, 05 §4.3–4.4). Call inside runReadTx (one snapshot, RD2); plain
 * SELECTs, never locks (RD1); keyset pages (RD3) via core/keyset.ts.
 */

const KEYSET = { ts: "jr.created_at", id: "jr.id" };

type RawRequestRow = {
  id: string;
  status: JoinRequestStatus;
  decline_reason: DeclineReason | null;
  created_at: Date;
  decided_at: Date | null;
  cursor_ts: string;
};

// -------------------------------------------------------------------------------- leader inbox

export type InboxItem = {
  id: string;
  status: JoinRequestStatus;
  declineReason: DeclineReason | null;
  createdAt: Date;
  decidedAt: Date | null;
  requester: {
    participantId: string;
    name: string;
    githubUsername: string | null;
    githubVerified: false;
    portfolioUrl: string | null;
    skills: Partial<Record<Skill, number>>;
  };
};

export type Inbox = { requests: InboxItem[]; totalCount: number; nextCursor: string | null };

/**
 * GET /api/teams/{teamId}/requests — the CURRENT leader only (else 403 NOT_LEADER). The check is
 * a plain read in this snapshot, no lock: if leadership changes a moment later, the old leader
 * sees one stale page but can't act on it (approve/decline re-check under the team lock).
 * Pending: oldest first (FIFO fairness); other statuses: newest first. One index,
 * (team_id, status, created_at, id), read forwards or backwards.
 */
export async function listInbox(
  tx: Tx,
  viewerUserId: string,
  teamId: string,
  query: InboxQuery,
): Promise<Inbox> {
  const team = isUuid(teamId)
    ? await tx.team.findUnique({
        where: { id: teamId },
        select: { id: true, hackathonId: true, leaderParticipantId: true },
      })
    : null;
  if (!team) throw new AppError("TEAM_NOT_FOUND", "Team not found.");
  const me = await tx.participant.findUnique({
    where: { userId_hackathonId: { userId: viewerUserId, hackathonId: team.hackathonId } },
    select: { id: true },
  });
  if (me?.id !== team.leaderParticipantId) {
    throw new AppError("NOT_LEADER", "Only this team's leader can see its join requests.");
  }

  const direction: SortDirection = query.status === "PENDING" ? "asc" : "desc";
  // The cursor is tied to this status list: the lists run in different directions.
  const listKey = `inbox:${query.status}`;
  const cursor = query.cursor ? decodeCursor(query.cursor, listKey) : null;

  const rows = await tx.$queryRaw<(RawRequestRow & { participant_id: string })[]>`
    SELECT jr.id, jr.status, jr.decline_reason, jr.created_at, jr.decided_at, jr.participant_id,
           ${cursorTimestamp(KEYSET.ts)} AS cursor_ts
    FROM join_requests jr
    WHERE jr.team_id = ${team.id}::uuid AND jr.status = ${query.status}::join_request_status
      ${afterCursor(cursor, KEYSET, direction)}
    ${keysetOrder(KEYSET, direction)}
    LIMIT ${query.limit + 1}`;
  const [count] = await tx.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM join_requests
    WHERE team_id = ${team.id}::uuid AND status = ${query.status}::join_request_status`;

  const { page, nextCursor } = pageOf(rows, query.limit, listKey);

  // Requester profiles for the whole page in one query (RD7). Requesters are always in this
  // hackathon (composite FK); deleting a participant deletes their requests (cascade).
  const requesters = await tx.participant.findMany({
    where: { id: { in: page.map((row) => row.participant_id) } },
    select: {
      id: true,
      user: {
        select: {
          name: true,
          githubUsername: true,
          portfolioUrl: true,
          skills: { select: { skill: true, level: true }, orderBy: { skill: "asc" } },
        },
      },
    },
  });
  const byId = new Map(requesters.map((p) => [p.id, p]));

  return {
    requests: page.map((row) => {
      const p = byId.get(row.participant_id)!;
      return {
        id: row.id,
        status: row.status,
        declineReason: row.decline_reason,
        createdAt: row.created_at,
        decidedAt: row.decided_at,
        requester: {
          participantId: p.id,
          name: p.user.name,
          githubUsername: p.user.githubUsername,
          githubVerified: false,
          portfolioUrl: p.user.portfolioUrl,
          skills: Object.fromEntries(p.user.skills.map((s) => [s.skill, s.level])),
        },
      };
    }),
    totalCount: count?.n ?? 0,
    nextCursor,
  };
}

// --------------------------------------------------------------------------------- my requests

export type MyRequestItem = {
  id: string;
  status: JoinRequestStatus;
  declineReason: DeclineReason | null;
  createdAt: Date;
  decidedAt: Date | null;
  team: {
    id: string;
    name: string;
    joinPolicy: JoinPolicy;
    access: TeamAccess;
    memberCount: number;
    maxSize: number;
    seatsLeft: number;
    listed: boolean;
  };
};

export type MyRequests = { requests: MyRequestItem[]; nextCursor: string | null };

/**
 * GET /api/hackathons/{idOrSlug}/me/requests — every status, newest first. Not registered →
 * an empty list (like GET …/me: "not registered" is a normal answer). Requests to deleted
 * teams were deleted with them (4.1), so every item has its team.
 */
export async function listMyRequests(
  tx: Tx,
  viewerUserId: string,
  hackathonId: string,
  query: MyRequestsQuery,
): Promise<MyRequests> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const me = await tx.participant.findUnique({
    where: { userId_hackathonId: { userId: viewerUserId, hackathonId } },
    select: { id: true },
  });
  if (!me) return { requests: [], nextCursor: null };

  const rows = await tx.$queryRaw<
    (RawRequestRow & {
      team_id: string;
      team_name: string;
      join_policy: JoinPolicy;
      access: TeamAccess;
      member_count: number;
      max_size: number;
      is_looking: boolean;
    })[]
  >`
    SELECT jr.id, jr.status, jr.decline_reason, jr.created_at, jr.decided_at,
           ${cursorTimestamp(KEYSET.ts)} AS cursor_ts,
           t.id AS team_id, t.name AS team_name, t.join_policy, t.access, t.member_count,
           t.max_size, t.is_looking
    FROM join_requests jr JOIN teams t ON t.id = jr.team_id
    WHERE jr.participant_id = ${me.id}::uuid ${afterCursor(cursor, KEYSET, "desc")}
    ${keysetOrder(KEYSET, "desc")}
    LIMIT ${query.limit + 1}`;

  const { page, nextCursor } = pageOf(rows, query.limit);
  return {
    requests: page.map((row) => ({
      id: row.id,
      status: row.status,
      declineReason: row.decline_reason,
      createdAt: row.created_at,
      decidedAt: row.decided_at,
      team: {
        id: row.team_id,
        name: row.team_name,
        joinPolicy: row.join_policy,
        access: row.access,
        memberCount: row.member_count,
        maxSize: row.max_size,
        seatsLeft: row.max_size - row.member_count,
        listed: row.is_looking && row.member_count < row.max_size,
      },
    })),
    nextCursor,
  };
}

// --------------------------------------------------------------------- viewer.myRequest (3.6)

export type MyRequestSummary = {
  id: string;
  status: JoinRequestStatus;
  declineReason: DeclineReason | null;
};

/** My most recent request to a team (team page `viewer.myRequest`), or null. */
export async function latestRequestTo(
  tx: Tx,
  participantId: string,
  teamId: string,
): Promise<MyRequestSummary | null> {
  return tx.joinRequest.findFirst({
    where: { participantId, teamId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, status: true, declineReason: true },
  });
}
