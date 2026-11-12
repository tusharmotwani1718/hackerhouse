import "server-only";

import { z } from "zod";

import { LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX } from "../teams/schemas";

const limit = z.coerce
  .number({ error: `must be a whole number 1-${LIST_LIMIT_MAX}` })
  .int({ error: `must be a whole number 1-${LIST_LIMIT_MAX}` })
  .min(1, { error: `must be 1-${LIST_LIMIT_MAX}` })
  .max(LIST_LIMIT_MAX, { error: `must be 1-${LIST_LIMIT_MAX}` })
  .default(LIST_LIMIT_DEFAULT);

const cursor = z.string().max(300, { error: "is not a valid cursor" }).optional();

export const AUDIT_CATEGORIES = ["team", "requests", "invites"] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

/** GET /api/teams/{teamId}/audit (step 5.4). Unknown parameters are ignored. */
export const teamAuditQuerySchema = z.object({
  category: z
    .enum(AUDIT_CATEGORIES, { error: `must be one of ${AUDIT_CATEGORIES.join(", ")}` })
    .optional(),
  cursor,
  limit,
});
export type TeamAuditQuery = z.output<typeof teamAuditQuerySchema>;

/** GET /api/admin/hackathons/{idOrSlug}/deleted-teams (step 5.4). */
export const deletedTeamsQuerySchema = z.object({ cursor, limit });
export type DeletedTeamsQuery = z.output<typeof deletedTeamsQuerySchema>;
