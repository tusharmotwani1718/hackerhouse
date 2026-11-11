import "server-only";

import { JoinPolicy, TeamAccess } from "@hacker-house/db";
import { z } from "zod";

export const TEAM_NAME_MIN = 3;
export const TEAM_NAME_MAX = 40;
export const TEAM_DESCRIPTION_MAX = 500;
/** 01 §5: invite codes live 1 hour – 30 days, never forever. */
export const INVITE_HOURS_MIN = 1;
export const INVITE_HOURS_MAX = 30 * 24;
export const INVITE_HOURS_DEFAULT = 7 * 24;

/**
 * Trim and collapse whitespace runs to one space. The case-insensitive unique index ignores
 * letter case but not spacing, so without this "Rocket  Team" and "Rocket Team" could coexist.
 */
export function normalizeTeamName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

const name = z
  .string({ error: "must be a string" })
  .transform(normalizeTeamName)
  .pipe(
    z
      .string()
      .min(TEAM_NAME_MIN, { error: `must be ${TEAM_NAME_MIN}-${TEAM_NAME_MAX} characters` })
      .max(TEAM_NAME_MAX, { error: `must be ${TEAM_NAME_MIN}-${TEAM_NAME_MAX} characters` })
      .refine((value) => !/\p{Cc}/u.test(value), { error: "must not contain control characters" }),
  );

const description = z
  .string({ error: "must be a string" })
  .trim()
  .max(TEAM_DESCRIPTION_MAX, { error: `must be at most ${TEAM_DESCRIPTION_MAX} characters` });

const JOIN_POLICIES = Object.values(JoinPolicy) as [JoinPolicy, ...JoinPolicy[]];
const ACCESS_VALUES = Object.values(TeamAccess) as [TeamAccess, ...TeamAccess[]];

/** POST /api/hackathons/{idOrSlug}/teams body (Flow 6). Policy and access can never change later. */
export const createTeamSchema = z.strictObject({
  name,
  description: description.default(""),
  joinPolicy: z.enum(JOIN_POLICIES, { error: `must be one of ${JOIN_POLICIES.join(", ")}` }),
  access: z.enum(ACCESS_VALUES, { error: `must be one of ${ACCESS_VALUES.join(", ")}` }),
  isLooking: z.boolean({ error: "must be true or false" }).default(true),
  inviteExpiresInHours: z
    .number({ error: `must be a whole number of hours ${INVITE_HOURS_MIN}-${INVITE_HOURS_MAX}` })
    .int({ error: `must be a whole number of hours ${INVITE_HOURS_MIN}-${INVITE_HOURS_MAX}` })
    .min(INVITE_HOURS_MIN, { error: `must be ${INVITE_HOURS_MIN}-${INVITE_HOURS_MAX} hours` })
    .max(INVITE_HOURS_MAX, {
      error: `must be ${INVITE_HOURS_MIN}-${INVITE_HOURS_MAX} hours (30 days)`,
    })
    .default(INVITE_HOURS_DEFAULT),
});

export type CreateTeam = z.output<typeof createTeamSchema>;
