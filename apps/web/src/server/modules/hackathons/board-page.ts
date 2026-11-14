import "server-only";

import { z } from "zod";

import type { BoardFilters, BoardTeam, BoardViewer } from "@/components/board/types";

import type { Tx } from "../../core/tx";
import { getMyStatus } from "../participants/service";
import { listTeams } from "../teams/reads";
import { TEAM_NAME_MAX } from "../teams/schemas";
import { getHackathon, type HackathonDetail } from "./service";

/** First page size of the board (Load more fetches the next pages through the API). */
export const BOARD_PAGE_SIZE = 20;

export type BoardPageData = {
  hackathon: HackathonDetail;
  viewer: BoardViewer & { isLeader: boolean };
  teams: BoardTeam[];
  totalCount: number;
  nextCursor: string | null;
};

const filtersSchema = {
  q: z.string().trim().min(1).max(TEAM_NAME_MAX),
  show: z.enum(["looking", "all"]),
  policy: z.enum(["OPEN", "APPROVAL"]),
  access: z.enum(["PUBLIC", "INVITE_ONLY"]),
};

/** URL search params → filters. A malformed value is ignored (no error page for a bad link). */
export function parseBoardFilters(
  params: Record<string, string | string[] | undefined>,
): BoardFilters {
  const pick = <K extends keyof typeof filtersSchema>(key: K) => {
    const raw = params[key];
    const result = filtersSchema[key].safeParse(Array.isArray(raw) ? raw[0] : raw);
    return result.success ? (result.data as z.output<(typeof filtersSchema)[K]>) : undefined;
  };
  return {
    show: pick("show") ?? "looking",
    q: pick("q"),
    policy: pick("policy"),
    access: pick("access"),
  };
}

/**
 * Everything /hackathons/[slug] renders, from one REPEATABLE READ snapshot (call inside
 * runReadTx): the hackathon + stats, the viewer's status, the first page of teams for the
 * filters, and the teams the viewer already asked to join (for "Requested" buttons).
 * Throws HACKATHON_NOT_FOUND for an unknown slug.
 */
export async function loadBoardPage(
  tx: Tx,
  userId: string,
  idOrSlug: string,
  filters: BoardFilters,
): Promise<BoardPageData> {
  const hackathon = await getHackathon(tx, idOrSlug);
  const me = await getMyStatus(tx, userId, hackathon.id);
  const list = await listTeams(tx, hackathon.id, filters.show === "all" ? "all" : "board", {
    limit: BOARD_PAGE_SIZE,
    q: filters.q,
    policy: filters.policy,
    access: filters.access,
  });
  const pending = me.participantId
    ? await tx.joinRequest.findMany({
        where: { participantId: me.participantId, status: "PENDING" },
        select: { teamId: true },
      })
    : [];

  return {
    hackathon,
    viewer: {
      registered: me.registered,
      team: me.team ? { id: me.team.id, name: me.team.name } : null,
      isLeader: me.team?.isLeader ?? false,
      pendingTeamIds: pending.map((request) => request.teamId),
    },
    teams: list.teams.map((team) => ({
      id: team.id,
      name: team.name,
      description: team.description,
      joinPolicy: team.joinPolicy,
      access: team.access,
      memberCount: team.memberCount,
      maxSize: team.maxSize,
      seatsLeft: team.seatsLeft,
      listed: team.listed,
      version: team.version,
      leader: team.leader,
      skillProfile: team.skillProfile,
      createdAt: team.createdAt.toISOString(),
    })),
    totalCount: list.totalCount,
    nextCursor: list.nextCursor,
  };
}
