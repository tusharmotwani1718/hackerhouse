import "server-only";

import { Prisma, type Skill } from "@hacker-house/db";

import { AppError } from "../../core/errors";
import type { Tx } from "../../core/tx";
import { isUuid } from "../../core/validate";
import { formatOffset, formula, round2, SCORING_METHOD, skillReason } from "./explain";
import type { SuggestionsQuery } from "./schemas";

export type SkillBreakdown = {
  skill: Skill;
  teamLevel: number;
  candidateLevel: number;
  gain: number;
  reason: string;
};

export type Suggestion = {
  participant: {
    id: string;
    name: string;
    githubUsername: string | null;
    /** Always false in v1: self-entered, no OAuth yet (04 §1.3). */
    githubVerified: false;
    portfolioUrl: string | null;
  };
  score: number;
  breakdown: {
    skills: SkillBreakdown[];
    skillGain: number;
    timezone: { team: string; candidate: string; overlapHours: number; factor: number };
    formula: string;
  };
  hasRequestedYourTeam: boolean;
};

export type Suggestions = {
  method: string;
  team: { id: string; skillProfile: Partial<Record<Skill, number>>; timezone: string };
  suggestions: Suggestion[];
};

/**
 * A zone's UTC offset in hours, NOW (DST-aware): local wall time minus UTC wall time. Stored
 * timezones are canonical names from Postgres's own tzdata (profile step), so this can't fail.
 * Not pg_timezone_names: it reads the whole tz database per call (~47 ms measured).
 */
const offsetHours = (tzColumn: string) =>
  Prisma.sql`(EXTRACT(EPOCH FROM (now() AT TIME ZONE ${Prisma.raw(tzColumn)}) - (now() AT TIME ZONE 'UTC')) / 3600)`;

/**
 * The diminishing-returns curve (04 step 2), level → value: 0, .40, .65, .80, .90, 1.00.
 * A CASE expression, not a lookup table: no joins per skill row.
 */
const curve = (level: Prisma.Sql) =>
  Prisma.sql`(CASE ${level} WHEN 1 THEN 0.40 WHEN 2 THEN 0.65 WHEN 3 THEN 0.80 WHEN 4 THEN 0.90 WHEN 5 THEN 1.00 ELSE 0.00 END)`;

/**
 * One skill's gain: v(max(team, candidate)) − v(team). Defined ONCE, used for the ranking and
 * for the breakdown, so they can't disagree. Expects aliases `us` (candidate's user_skills row)
 * and `ts` (team_skill, LEFT JOINed: no row = team level 0).
 */
const SKILL_GAIN = Prisma.sql`(${curve(Prisma.sql`GREATEST(us.level, COALESCE(ts.level, 0))`)} - ${curve(Prisma.sql`COALESCE(ts.level, 0)`)})`;

type TeamRow = { team_offset: number; skill_profile: Partial<Record<Skill, number>> };

type CandidateRow = {
  participant_id: string;
  name: string;
  github_username: string | null;
  portfolio_url: string | null;
  timezone: string;
  off: Prisma.Decimal;
  skill_gain: Prisma.Decimal;
  overlap_hours: Prisma.Decimal;
  tz_factor: Prisma.Decimal;
  score: Prisma.Decimal;
  skills: { skill: Skill; candidateLevel: number; teamLevel: number; gain: number }[];
  has_requested: boolean;
};

/**
 * GET /api/teams/{teamId}/suggestions (04, step 8.1): unteamed participants of the team's
 * hackathon, ranked by how much they add. Leader only; the team needs an open seat. Read-only:
 * runs inside runReadTx (one REPEATABLE READ snapshot → the checks and the scores agree).
 */
export async function suggestTeammates(
  tx: Tx,
  viewerUserId: string,
  teamId: string,
  query: SuggestionsQuery,
): Promise<Suggestions> {
  const team = isUuid(teamId)
    ? await tx.team.findUnique({
        where: { id: teamId },
        select: {
          id: true,
          hackathonId: true,
          leaderParticipantId: true,
          memberCount: true,
          maxSize: true,
        },
      })
    : null;
  if (!team) throw new AppError("TEAM_NOT_FOUND", "Team not found.");
  const me = await tx.participant.findUnique({
    where: { userId_hackathonId: { userId: viewerUserId, hackathonId: team.hackathonId } },
    select: { id: true },
  });
  if (me?.id !== team.leaderParticipantId) {
    throw new AppError("NOT_LEADER", "Only this team's leader can see teammate suggestions.");
  }
  if (team.memberCount >= team.maxSize) {
    throw new AppError("TEAM_FULL", "Your team is full: there is no open seat to suggest for.");
  }

  // Team: best level per skill (04 step 1) + median UTC offset of its members (step 3).
  const [teamRow] = await tx.$queryRaw<TeamRow[]>`
    SELECT
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ${offsetHours("u.timezone")}::float8)
         FROM participants p JOIN users u ON u.id = p.user_id
         WHERE p.team_id = ${team.id}::uuid) AS team_offset,
      (SELECT COALESCE(json_object_agg(s.skill, s.level ORDER BY s.skill::text), '{}'::json)
         FROM (SELECT us.skill, MAX(us.level)::int AS level
                 FROM participants p JOIN user_skills us ON us.user_id = p.user_id
                 WHERE p.team_id = ${team.id}::uuid
                 GROUP BY us.skill) s) AS skill_profile`;
  const teamOffset = Number(teamRow?.team_offset ?? 0);

  // Every candidate scored in ONE statement (04 §5); only the top N leave the database.
  // Shaped for 5,000 candidates (8.1 performance check: 265 ms → see 07):
  //  tz       offset, overlap and factor computed once per DISTINCT timezone (they depend only
  //           on the zone): a handful of rows instead of one per candidate
  //  gains    ranking needs only sums per candidate (no JSON, no curve-table joins)
  //           timezone distance wraps around 24 h (8.1 C1); overlap of a 12-hour day
  //  top      score DESC, total candidate levels DESC, participant id ASC (deterministic)
  //  skills   the per-skill breakdown is built for the top N only (user_skills primary key)
  const rows = await tx.$queryRaw<CandidateRow[]>`
    WITH team_skill AS (
      SELECT us.skill, MAX(us.level)::int AS level
      FROM participants p JOIN user_skills us ON us.user_id = p.user_id
      WHERE p.team_id = ${team.id}::uuid
      GROUP BY us.skill
    ),
    cand AS (
      SELECT p.id AS participant_id, p.user_id, u.timezone
      FROM participants p JOIN users u ON u.id = p.user_id
      WHERE p.hackathon_id = ${team.hackathonId}::uuid AND p.team_id IS NULL
    ),
    tz AS (
      SELECT z.timezone, z.off, o.overlap_hours, 0.5 + 0.5 * o.overlap_hours / 12 AS tz_factor
      FROM (SELECT d.timezone, ${offsetHours("d.timezone")} AS off
              FROM (SELECT DISTINCT timezone FROM cand) d) z
      CROSS JOIN LATERAL (SELECT mod(abs(z.off - ${teamOffset}::numeric), 24) AS d) dist
      CROSS JOIN LATERAL (SELECT GREATEST(0, 12 - LEAST(dist.d, 24 - dist.d)) AS overlap_hours) o
    ),
    gains AS (
      SELECT c.participant_id, SUM(${SKILL_GAIN}) AS skill_gain, SUM(us.level) AS total_level
      FROM cand c
      JOIN user_skills us ON us.user_id = c.user_id
      LEFT JOIN team_skill ts ON ts.skill = us.skill
      GROUP BY c.participant_id
    ),
    scored AS (
      SELECT c.participant_id, c.user_id, c.timezone, tz.off, tz.overlap_hours, tz.tz_factor,
             COALESCE(g.skill_gain, 0) AS skill_gain,
             COALESCE(g.total_level, 0) AS total_level,
             COALESCE(g.skill_gain, 0) * tz.tz_factor AS score
      FROM cand c
      JOIN tz ON tz.timezone = c.timezone
      LEFT JOIN gains g ON g.participant_id = c.participant_id
    ),
    top AS (
      SELECT * FROM scored
      ORDER BY score DESC, total_level DESC, participant_id ASC
      LIMIT ${query.limit}
    )
    SELECT top.participant_id, top.timezone, top.off, top.skill_gain, top.overlap_hours,
           top.tz_factor, top.score,
           u.name, u.github_username, u.portfolio_url,
           COALESCE((
             SELECT json_agg(json_build_object('skill', us.skill, 'candidateLevel', us.level,
                                               'teamLevel', COALESCE(ts.level, 0),
                                               'gain', ${SKILL_GAIN})
                             ORDER BY ${SKILL_GAIN} DESC, us.skill::text)
             FROM user_skills us LEFT JOIN team_skill ts ON ts.skill = us.skill
             WHERE us.user_id = top.user_id
           ), '[]'::json) AS skills,
           EXISTS (
             SELECT 1 FROM join_requests jr
             WHERE jr.team_id = ${team.id}::uuid AND jr.participant_id = top.participant_id
               AND jr.status = 'PENDING'
           ) AS has_requested
    FROM top JOIN users u ON u.id = top.user_id
    ORDER BY top.score DESC, top.total_level DESC, top.participant_id ASC`;

  const teamTimezone = formatOffset(teamOffset);
  return {
    method: SCORING_METHOD,
    team: { id: team.id, skillProfile: teamRow?.skill_profile ?? {}, timezone: teamTimezone },
    suggestions: rows.map((row) => {
      const skillGain = Number(row.skill_gain);
      const factor = Number(row.tz_factor);
      const score = Number(row.score);
      return {
        participant: {
          id: row.participant_id,
          name: row.name,
          githubUsername: row.github_username,
          githubVerified: false,
          portfolioUrl: row.portfolio_url,
        },
        score: round2(score),
        breakdown: {
          skills: row.skills.map((s) => ({
            skill: s.skill,
            teamLevel: s.teamLevel,
            candidateLevel: s.candidateLevel,
            gain: round2(Number(s.gain)),
            reason: skillReason(s.skill, s.teamLevel, s.candidateLevel),
          })),
          skillGain: round2(skillGain),
          timezone: {
            team: teamTimezone,
            candidate: `${row.timezone} (${formatOffset(Number(row.off))})`,
            overlapHours: round2(Number(row.overlap_hours)),
            factor: round2(factor),
          },
          formula: formula(skillGain, factor, score),
        },
        hasRequestedYourTeam: row.has_requested,
      };
    }),
  };
}
