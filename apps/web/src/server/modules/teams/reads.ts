import "server-only";

import { Prisma, type JoinPolicy, type Skill, type TeamAccess } from "@hacker-house/db";

import { AppError } from "../../core/errors";
import { afterCursor, cursorTimestamp, decodeCursor, keysetOrder, pageOf } from "../../core/keyset";
import type { Tx } from "../../core/tx";
import { isUuid } from "../../core/validate";
import { latestRequestTo, type MyRequestSummary } from "../requests/reads";
import {
  buildTeamCards,
  teamCardSelect,
  toTeamCard,
  type TeamCard,
  type TeamCardRow,
} from "./cards";
import type { ListTeamsQuery } from "./schemas";

/**
 * Team reads (step 3.6, 05 §3–4). Rules for every function here:
 *  - call inside runReadTx: one REPEATABLE READ snapshot, so page, count and members agree (RD2);
 *  - plain SELECTs, never locks (RD1);
 *  - members + skills for a whole page in one query (RD7).
 */

// Keyset cursor helpers (microsecond-exact timestamps, tie-break on id): core/keyset.ts.
const KEYSET = { ts: "t.created_at", id: "t.id" };

/** `q` is matched literally: %, _ and \ would otherwise be LIKE wildcards / the escape char. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// ------------------------------------------------------------------------------- board + all

export type TeamList = { teams: TeamCard[]; totalCount: number; nextCursor: string | null };

type RawCardRow = {
  id: string;
  name: string;
  description: string;
  join_policy: JoinPolicy;
  access: TeamAccess;
  is_looking: boolean;
  member_count: number;
  max_size: number;
  version: number;
  created_at: Date;
  leader_participant_id: string;
  cursor_ts: string;
};

/**
 * One page of teams, newest first. `board` = listed teams only (looking AND not full; the
 * condition matches the partial index teams_board_idx exactly, so it can be used). `all` =
 * every team (index teams_hackathon_id_created_at_id_idx).
 */
export async function listTeams(
  tx: Tx,
  hackathonId: string,
  scope: "board" | "all",
  query: ListTeamsQuery,
): Promise<TeamList> {
  const filters: Prisma.Sql[] = [Prisma.sql`t.hackathon_id = ${hackathonId}::uuid`];
  if (scope === "board") filters.push(Prisma.sql`t.is_looking AND t.member_count < t.max_size`);
  if (query.policy) filters.push(Prisma.sql`t.join_policy = ${query.policy}::join_policy`);
  if (query.access) filters.push(Prisma.sql`t.access = ${query.access}::team_access`);
  if (query.q) filters.push(Prisma.sql`t.name ILIKE ${`%${escapeLike(query.q)}%`}`);
  const matches = Prisma.join(filters, " AND ");

  const cursor = query.cursor ? decodeCursor(query.cursor) : null;

  // limit + 1: the extra row only tells us whether a next page exists.
  const rows = await tx.$queryRaw<RawCardRow[]>`
    SELECT t.id, t.name, t.description, t.join_policy, t.access, t.is_looking, t.member_count,
           t.max_size, t.version, t.created_at, t.leader_participant_id,
           ${cursorTimestamp(KEYSET.ts)} AS cursor_ts
    FROM teams t
    WHERE ${matches} ${afterCursor(cursor, KEYSET, "desc")}
    ${keysetOrder(KEYSET, "desc")}
    LIMIT ${query.limit + 1}`;

  // Same filters, no cursor: how many teams match in total (05 §3, query 3).
  const [count] = await tx.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM teams t WHERE ${matches}`;

  const { page, nextCursor } = pageOf(rows, query.limit);

  const teams = await buildTeamCards(
    tx,
    page.map((row): TeamCardRow => ({
      id: row.id,
      name: row.name,
      description: row.description,
      joinPolicy: row.join_policy,
      access: row.access,
      isLooking: row.is_looking,
      memberCount: row.member_count,
      maxSize: row.max_size,
      version: row.version,
      createdAt: row.created_at,
      leaderParticipantId: row.leader_participant_id,
    })),
  );
  return { teams, totalCount: count?.n ?? 0, nextCursor };
}

// ---------------------------------------------------------------------------------- team page

export type TeamMember = {
  participantId: string;
  name: string;
  githubUsername: string | null;
  /** Always false in v1 (04 §1.3). */
  githubVerified: false;
  portfolioUrl: string | null;
  skills: Partial<Record<Skill, number>>;
  joinedAt: Date;
  isLeader: boolean;
};

export type TeamPage = {
  team: TeamCard;
  /** In join order, leader included: the order also shows who would lead next (R6). */
  members: TeamMember[];
  viewer: {
    isMember: boolean;
    isLeader: boolean;
    /**
     * My most recent request to this team, or null (never requested / not registered). The latest
     * is enough: at most one is pending, and nothing can follow a LEADER decline (R13).
     */
    myRequest: MyRequestSummary | null;
  };
};

/** GET /api/teams/{id} (05 §4.2). Public team data; never the invite code, emails or user ids. */
export async function getTeamPage(tx: Tx, viewerUserId: string, teamId: string): Promise<TeamPage> {
  const team = isUuid(teamId)
    ? await tx.team.findUnique({
        where: { id: teamId },
        select: { ...teamCardSelect, hackathonId: true },
      })
    : null;
  if (!team) throw new AppError("TEAM_NOT_FOUND", "Team not found.");

  const memberRows = await tx.participant.findMany({
    where: { teamId: team.id },
    orderBy: [{ teamJoinedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      teamJoinedAt: true,
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

  const viewer = await tx.participant.findUnique({
    where: { userId_hackathonId: { userId: viewerUserId, hackathonId: team.hackathonId } },
    select: { id: true, teamId: true },
  });
  const isMember = viewer?.teamId === team.id;
  const myRequest = viewer ? await latestRequestTo(tx, viewer.id, team.id) : null;

  return {
    team: toTeamCard(
      team,
      memberRows.map((m) => ({ participantId: m.id, name: m.user.name, skills: m.user.skills })),
    ),
    members: memberRows.map((m) => ({
      participantId: m.id,
      name: m.user.name,
      githubUsername: m.user.githubUsername,
      githubVerified: false,
      portfolioUrl: m.user.portfolioUrl,
      skills: Object.fromEntries(m.user.skills.map((s) => [s.skill, s.level])),
      joinedAt: m.teamJoinedAt!, // members always have it (participants_team_joined_at_check)
      isLeader: m.id === team.leaderParticipantId,
    })),
    viewer: {
      isMember,
      isLeader: isMember && viewer?.id === team.leaderParticipantId,
      myRequest,
    },
  };
}
