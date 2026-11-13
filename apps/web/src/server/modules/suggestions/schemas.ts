import "server-only";

import { z } from "zod";

export const SUGGESTIONS_LIMIT_DEFAULT = 20;
export const SUGGESTIONS_LIMIT_MAX = 50;

/** GET /api/teams/{teamId}/suggestions query string (04 §2). Unknown parameters are ignored. */
export const suggestionsQuerySchema = z.object({
  limit: z.coerce
    .number({ error: `must be a whole number 1-${SUGGESTIONS_LIMIT_MAX}` })
    .int({ error: `must be a whole number 1-${SUGGESTIONS_LIMIT_MAX}` })
    .min(1, { error: `must be 1-${SUGGESTIONS_LIMIT_MAX}` })
    .max(SUGGESTIONS_LIMIT_MAX, { error: `must be 1-${SUGGESTIONS_LIMIT_MAX}` })
    .default(SUGGESTIONS_LIMIT_DEFAULT),
});

export type SuggestionsQuery = z.output<typeof suggestionsQuerySchema>;
