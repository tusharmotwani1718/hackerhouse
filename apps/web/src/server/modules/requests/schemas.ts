import "server-only";

import { JoinRequestStatus } from "@hacker-house/db";
import { z } from "zod";

import { LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX } from "../teams/schemas";

const STATUSES = Object.values(JoinRequestStatus) as [JoinRequestStatus, ...JoinRequestStatus[]];

const limit = z.coerce
  .number({ error: `must be a whole number 1-${LIST_LIMIT_MAX}` })
  .int({ error: `must be a whole number 1-${LIST_LIMIT_MAX}` })
  .min(1, { error: `must be 1-${LIST_LIMIT_MAX}` })
  .max(LIST_LIMIT_MAX, { error: `must be 1-${LIST_LIMIT_MAX}` })
  .default(LIST_LIMIT_DEFAULT);

const cursor = z.string().max(300, { error: "is not a valid cursor" }).optional();

/** GET /api/teams/{teamId}/requests (05 §4.3). Unknown parameters are ignored. */
export const inboxQuerySchema = z.object({
  status: z.enum(STATUSES, { error: `must be one of ${STATUSES.join(", ")}` }).default("PENDING"),
  cursor,
  limit,
});
export type InboxQuery = z.output<typeof inboxQuerySchema>;

/** GET /api/hackathons/{idOrSlug}/me/requests (05 §4.4). */
export const myRequestsQuerySchema = z.object({ cursor, limit });
export type MyRequestsQuery = z.output<typeof myRequestsQuerySchema>;
