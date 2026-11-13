import "server-only";

import type { BoardViewer } from "@/components/board/types";
import type { InboxRequestView, MyRequestView, MyTeamView } from "@/components/hackathon/types";

import { AppError } from "../../core/errors";
import type { Tx } from "../../core/tx";
import { getMyStatus } from "../participants/service";
import { listInbox, listMyRequests, type InboxItem } from "../requests/reads";
import { getTeamPage } from "../teams/reads";
import { getInviteCode } from "../teams/settings";
import { getHackathon, type HackathonDetail } from "./service";

export const MY_REQUESTS_PAGE_SIZE = 20;
export const INBOX_PAGE_SIZE = 20;

/** An inbox row for the client (dates as ISO strings). */
export function toInboxView(item: InboxItem): InboxRequestView {
  return {
    id: item.id,
    status: item.status,
    declineReason: item.declineReason,
    createdAt: item.createdAt.toISOString(),
    decidedAt: item.decidedAt?.toISOString() ?? null,
    requester: {
      name: item.requester.name,
      githubUsername: item.requester.githubUsername,
      portfolioUrl: item.requester.portfolioUrl,
      timezone: item.requester.timezone,
      skills: item.requester.skills,
    },
  };
}

export type HackathonShell = {
  hackathon: HackathonDetail;
  viewer: BoardViewer & {
    isLeader: boolean;
    /** Leaders of APPROVAL teams: requests waiting for a decision (shown on the My team tab). */
    pendingInbox: number | null;
  };
};

/**
 * The part of /hackathons/[slug]/* every tab shares (header + tab bar): the hackathon, its
 * numbers, and where the viewer stands. Call inside runReadTx. Throws HACKATHON_NOT_FOUND.
 */
export async function loadHackathonShell(
  tx: Tx,
  userId: string,
  idOrSlug: string,
): Promise<HackathonShell> {
  const hackathon = await getHackathon(tx, idOrSlug);
  const me = await getMyStatus(tx, userId, hackathon.id);
  // Only leaders of APPROVAL teams have an inbox (OPEN teams can't receive requests; the policy
  // never changes). One indexed count: (team_id, status, created_at, id).
  let pendingInbox: number | null = null;
  if (me.team?.isLeader) {
    const team = await tx.team.findUnique({
      where: { id: me.team.id },
      select: { joinPolicy: true },
    });
    if (team?.joinPolicy === "APPROVAL") {
      pendingInbox = await tx.joinRequest.count({
        where: { teamId: me.team.id, status: "PENDING" },
      });
    }
  }
  return {
    hackathon,
    viewer: {
      registered: me.registered,
      team: me.team ? { id: me.team.id, name: me.team.name } : null,
      isLeader: me.team?.isLeader ?? false,
      pendingTeamIds: [], // only the board needs these (board-page.ts)
      pendingInbox,
    },
  };
}

/**
 * "My team" tab: the viewer's team in this hackathon with its members, plus the active invite
 * code (members only, R28), or `team: null` when the viewer has no team. Call inside runReadTx.
 */
export async function loadMyTeam(
  tx: Tx,
  userId: string,
  idOrSlug: string,
): Promise<{ registered: boolean; team: MyTeamView | null }> {
  const hackathon = await getHackathon(tx, idOrSlug);
  const me = await getMyStatus(tx, userId, hackathon.id);
  if (!me.team) return { registered: me.registered, team: null };

  const page = await getTeamPage(tx, userId, me.team.id);
  let invite: MyTeamView["invite"] = null;
  try {
    const active = await getInviteCode(tx, userId, me.team.id);
    invite = { code: active.code, expiresAt: active.expiresAt.toISOString() };
  } catch (error) {
    if (!(error instanceof AppError && error.code === "NO_ACTIVE_CODE")) throw error;
  }

  const { team } = page;
  // The card has `listed` (looking AND not full); the leader's switch needs the flag itself.
  const flags = await tx.team.findUnique({ where: { id: team.id }, select: { isLooking: true } });
  // The leader's inbox (APPROVAL teams only): first page of PENDING, oldest first. The other
  // statuses are fetched from the API when the leader switches to them.
  const inbox =
    page.viewer.isLeader && team.joinPolicy === "APPROVAL"
      ? await listInbox(tx, userId, team.id, { status: "PENDING", limit: INBOX_PAGE_SIZE })
      : null;
  return {
    registered: true,
    team: {
      id: team.id,
      name: team.name,
      description: team.description,
      joinPolicy: team.joinPolicy,
      access: team.access,
      memberCount: team.memberCount,
      maxSize: team.maxSize,
      seatsLeft: team.seatsLeft,
      listed: team.listed,
      isLooking: flags?.isLooking ?? false,
      isLeader: page.viewer.isLeader,
      createdAt: team.createdAt.toISOString(),
      members: page.members.map((member) => ({
        participantId: member.participantId,
        name: member.name,
        githubUsername: member.githubUsername,
        portfolioUrl: member.portfolioUrl,
        skills: member.skills,
        joinedAt: member.joinedAt.toISOString(),
        isLeader: member.isLeader,
      })),
      invite,
      inbox: inbox
        ? {
            requests: inbox.requests.map(toInboxView),
            totalCount: inbox.totalCount,
            nextCursor: inbox.nextCursor,
          }
        : null,
    },
  };
}

/** "My requests" tab: the viewer's join requests in this hackathon, newest first (first page). */
export async function loadMyRequests(
  tx: Tx,
  userId: string,
  idOrSlug: string,
): Promise<{ registered: boolean; requests: MyRequestView[]; nextCursor: string | null }> {
  const hackathon = await getHackathon(tx, idOrSlug);
  const me = await getMyStatus(tx, userId, hackathon.id);
  const page = await listMyRequests(tx, userId, hackathon.id, { limit: MY_REQUESTS_PAGE_SIZE });
  return {
    registered: me.registered,
    requests: page.requests.map((request) => ({
      id: request.id,
      status: request.status,
      declineReason: request.declineReason,
      createdAt: request.createdAt.toISOString(),
      decidedAt: request.decidedAt?.toISOString() ?? null,
      team: {
        name: request.team.name,
        joinPolicy: request.team.joinPolicy,
        access: request.team.access,
        memberCount: request.team.memberCount,
        maxSize: request.team.maxSize,
      },
    })),
    nextCursor: page.nextCursor,
  };
}
