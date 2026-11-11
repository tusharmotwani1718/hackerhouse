// GET /api/hackathons/{idOrSlug}/board — "Looking for teammates": listed teams only (looking AND
// not full), newest first. Params: cursor, limit (1-50, default 20), policy, access, q
// (05 §3, step 3.6). Response: { data: { teams, totalCount }, nextCursor }.
import { route } from "@/server/core/route";
import { listTeamsHandler } from "@/server/modules/teams/list-route";

export const GET = route(listTeamsHandler("board"));
