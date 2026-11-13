import "server-only";

import type { BoardViewer } from "@/components/board/types";
import type { MyRequestView, MyTeamView } from "@/components/hackathon/types";

import { AppError } from "../../core/errors";
import type { Tx } from "../../core/tx";
import { getMyStatus } from "../participants/service";
import { listMyRequests } from "../requests/reads";
import { getTeamPage } from "../teams/reads";
import { getInviteCode } from "../teams/settings";
import { getHackathon, type HackathonDetail } from "./service";

export const MY_REQUESTS_PAGE_SIZE = 20;

export type HackathonShell = {
  hackathon: HackathonDetail;
  viewer: BoardViewer & { isLeader: boolean };
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
  return {
    hackathon,
    viewer: {
      registered: me.registered,
      team: me.team ? { id: me.team.id, name: me.team.name } : null,
      isLeader: me.team?.isLeader ?? false,
      pendingTeamIds: [], // only the board needs these (board-page.ts)
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
