import "server-only";

import type { JoinPolicy, Skill, TeamAccess } from "@hacker-house/db";

import type { Tx } from "../../core/tx";

/**
 * Board card (05 §3): public team summary. Also the payload of `team.*` SSE events (05 §5).
 * No invite code, no viewer-specific fields (RD4).
 */
export type TeamCard = {
  id: string;
  name: string;
  description: string;
  joinPolicy: JoinPolicy;
  access: TeamAccess;
  memberCount: number;
  maxSize: number;
  seatsLeft: number;
  /** Shown on the board: looking for teammates AND not full. */
  listed: boolean;
  leader: { name: string };
  /** Best level per skill across members. */
  skillProfile: Partial<Record<Skill, number>>;
  version: number;
  createdAt: Date;
};

/** The team columns a card needs (the board query selects exactly these). */
export type TeamCardRow = {
  id: string;
  name: string;
  description: string;
  joinPolicy: JoinPolicy;
  access: TeamAccess;
  isLooking: boolean;
  memberCount: number;
  maxSize: number;
  version: number;
  createdAt: Date;
  leaderParticipantId: string;
};

export const teamCardSelect = {
  id: true,
  name: true,
  description: true,
  joinPolicy: true,
  access: true,
  isLooking: true,
  memberCount: true,
  maxSize: true,
  version: true,
  createdAt: true,
  leaderParticipantId: true,
} as const;

/**
 * Cards for a page of teams. Members + skills are loaded for ALL the teams at once
 * (`WHERE team_id IN (…)`), never per team (RD7: no N+1). Inside runReadTx (RD2) for reads,
 * or inside the mutation's transaction for events.
 */
export async function buildTeamCards(tx: Tx, teams: readonly TeamCardRow[]): Promise<TeamCard[]> {
  if (teams.length === 0) return [];
  const members = await tx.participant.findMany({
    where: { teamId: { in: teams.map((team) => team.id) } },
    select: {
      id: true,
      teamId: true,
      user: { select: { name: true, skills: { select: { skill: true, level: true } } } },
    },
  });

  return teams.map((team) => {
    const teamMembers = members.filter((member) => member.teamId === team.id);
    const skillProfile: Partial<Record<Skill, number>> = {};
    for (const member of teamMembers) {
      for (const { skill, level } of member.user.skills) {
        skillProfile[skill] = Math.max(skillProfile[skill] ?? 0, level);
      }
    }
    const leader = teamMembers.find((member) => member.id === team.leaderParticipantId);
    return {
      id: team.id,
      name: team.name,
      description: team.description,
      joinPolicy: team.joinPolicy,
      access: team.access,
      memberCount: team.memberCount,
      maxSize: team.maxSize,
      seatsLeft: team.maxSize - team.memberCount,
      listed: team.isLooking && team.memberCount < team.maxSize,
      // The deferred leader FK guarantees the leader is a member, so this is always found.
      leader: { name: leader?.user.name ?? "" },
      skillProfile: Object.fromEntries(
        Object.entries(skillProfile).sort(([a], [b]) => a.localeCompare(b)),
      ),
      version: team.version,
      createdAt: team.createdAt,
    };
  });
}
