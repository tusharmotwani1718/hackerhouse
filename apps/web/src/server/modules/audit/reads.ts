import "server-only";

import { Prisma, type AuditAction } from "@hacker-house/db";

import type { AuthUser } from "../../auth/session";
import { AppError } from "../../core/errors";
import { afterCursor, cursorTimestamp, decodeCursor, keysetOrder, pageOf } from "../../core/keyset";
import type { Tx } from "../../core/tx";
import { isUuid } from "../../core/validate";
import type { AuditCategory, DeletedTeamsQuery, TeamAuditQuery } from "./schemas";

/**
 * Team audit log reads (step 5.4). Only team-scoped history: every row here has a team_id
 * (team, request and invite-code events); hackathon-level and CLI rows are out of scope.
 * Call inside runReadTx (one snapshot, RD2); plain SELECTs, no locks (RD1).
 */

const KEYSET = { ts: "a.created_at", id: "a.id" };

/** `category` filter → the actions it covers. */
const CATEGORY_ACTIONS: Record<AuditCategory, AuditAction[]> = {
  team: [
    "TEAM_CREATED",
    "TEAM_DELETED",
    "MEMBER_JOINED",
    "MEMBER_LEFT",
    "MEMBER_REMOVED",
    "LEADER_CHANGED",
    "LOOKING_TOGGLED",
  ],
  requests: ["REQUEST_CREATED", "REQUEST_APPROVED", "REQUEST_DECLINED", "REQUEST_CANCELLED"],
  invites: ["INVITE_CODE_GENERATED", "INVITE_CODE_REVOKED"],
};

/**
 * The metadata keys a leader may see, per action. Everything else (participant, request and
 * invite-code ids) stays internal; codes were never stored. Admins get the raw metadata.
 */
const VISIBLE_DETAILS: Partial<Record<AuditAction, string[]>> = {
  TEAM_CREATED: ["name", "joinPolicy", "access"],
  TEAM_DELETED: ["reason", "droppedRequests"],
  MEMBER_JOINED: ["via", "memberCount"],
  MEMBER_LEFT: ["memberCount"],
  MEMBER_REMOVED: ["memberCount"],
  LEADER_CHANGED: ["reason"],
  LOOKING_TOGGLED: ["isLooking"],
  REQUEST_CREATED: ["via"],
  REQUEST_APPROVED: [],
  REQUEST_DECLINED: ["reason"],
  REQUEST_CANCELLED: ["reason"],
  INVITE_CODE_GENERATED: ["expiresAt"],
  INVITE_CODE_REVOKED: ["reason"],
};

function curate(action: AuditAction, metadata: Prisma.JsonValue): Record<string, unknown> {
  const raw = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  return Object.fromEntries(
    (VISIBLE_DETAILS[action] ?? []).filter((key) => key in raw).map((key) => [key, raw[key]]),
  );
}

type Person = { name: string } | null;

/** Names for every actor/target on a page, in ONE query (RD7). Gone users → "Deleted user". */
async function namesFor(tx: Tx, ids: (string | null)[]): Promise<(id: string | null) => Person> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  const users = wanted.length
    ? await tx.user.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } })
    : [];
  const byId = new Map(users.map((user) => [user.id, user.name]));
  return (id) => (id === null ? null : { name: byId.get(id) ?? "Deleted user" });
}

// ---------------------------------------------------------------------------------- team log

/** The base entry everyone sees; admins additionally get the `raw` fields (a superset). */
export type AuditEntry = {
  id: string;
  action: AuditAction;
  createdAt: Date;
  actor: Person;
  target: Person;
  details: Record<string, unknown>;
  // Admin only:
  actorUserId?: string | null;
  targetUserId?: string | null;
  metadata?: Prisma.JsonValue;
  requestId?: string | null;
};

export type TeamAudit = { entries: AuditEntry[]; nextCursor: string | null };

/**
 * GET /api/teams/{teamId}/audit — ONE endpoint, two access rules:
 *  - ADMIN: reads this team_id's audit rows whether or not the team still exists (audit rows
 *    have no FKs, so a deleted team's history survives). 404 only if there's neither a team
 *    row nor any audit row: the id never was a team. Entries carry the raw fields too.
 *  - anyone else: the team must exist (404) and the caller must be its CURRENT leader (403).
 *    A plain read in the snapshot, no lock: a just-replaced leader sees at most one stale page.
 * The leader sees the team's whole history, including events before they joined/led.
 */
export async function listTeamAudit(
  tx: Tx,
  viewer: AuthUser,
  teamId: string,
  query: TeamAuditQuery,
): Promise<TeamAudit> {
  const teamNotFound = () => new AppError("TEAM_NOT_FOUND", "Team not found.");
  if (!isUuid(teamId)) throw teamNotFound();
  const isAdmin = viewer.role === "ADMIN";

  if (isAdmin) {
    const [known] = await tx.$queryRaw<{ known: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM teams WHERE id = ${teamId}::uuid)
          OR EXISTS (SELECT 1 FROM audit_logs WHERE team_id = ${teamId}::uuid) AS known`;
    if (!known?.known) throw teamNotFound();
  } else {
    const team = await tx.team.findUnique({
      where: { id: teamId },
      select: { hackathonId: true, leaderParticipantId: true },
    });
    if (!team) throw teamNotFound();
    const me = await tx.participant.findUnique({
      where: { userId_hackathonId: { userId: viewer.id, hackathonId: team.hackathonId } },
      select: { id: true },
    });
    if (me?.id !== team.leaderParticipantId) {
      throw new AppError("NOT_LEADER", "Only this team's leader can see its activity log.");
    }
  }

  const listKey = `audit:${query.category ?? "all"}`;
  const cursor = query.cursor ? decodeCursor(query.cursor, listKey) : null;
  const actions = query.category
    ? Prisma.sql`AND a.action = ANY(${CATEGORY_ACTIONS[query.category]}::audit_action[])`
    : Prisma.empty;

  const rows = await tx.$queryRaw<
    {
      id: string;
      action: AuditAction;
      actor_user_id: string | null;
      target_user_id: string | null;
      metadata: Prisma.JsonValue;
      request_id: string | null;
      created_at: Date;
      cursor_ts: string;
    }[]
  >`
    SELECT a.id, a.action, a.actor_user_id, a.target_user_id, a.metadata, a.request_id,
           a.created_at, ${cursorTimestamp(KEYSET.ts)} AS cursor_ts
    FROM audit_logs a
    WHERE a.team_id = ${teamId}::uuid ${actions} ${afterCursor(cursor, KEYSET, "desc")}
    ${keysetOrder(KEYSET, "desc")}
    LIMIT ${query.limit + 1}`;

  const { page, nextCursor } = pageOf(rows, query.limit, listKey);
  const nameOf = await namesFor(
    tx,
    page.flatMap((row) => [row.actor_user_id, row.target_user_id]),
  );

  return {
    entries: page.map((row) => ({
      id: row.id,
      action: row.action,
      createdAt: row.created_at,
      actor: nameOf(row.actor_user_id),
      target: nameOf(row.target_user_id),
      details: curate(row.action, row.metadata),
      ...(isAdmin && {
        actorUserId: row.actor_user_id,
        targetUserId: row.target_user_id,
        metadata: row.metadata,
        requestId: row.request_id,
      }),
    })),
    nextCursor,
  };
}

// ----------------------------------------------------------------------- deleted teams (admin)

export type DeletedTeam = {
  teamId: string;
  name: string | null;
  deletedAt: Date;
  deletedBy: Person;
  reason: string | null;
  droppedRequests: number | null;
};

export type DeletedTeams = { teams: DeletedTeam[]; nextCursor: string | null };

/**
 * GET /api/admin/hackathons/{idOrSlug}/deleted-teams — built from the TEAM_DELETED audit rows
 * (the team row is gone; the audit row kept its name, 3.5). Each item's teamId opens its full
 * history through GET /api/teams/{teamId}/audit (admins can read deleted teams there).
 * `action = 'TEAM_DELETED'` is a LITERAL so the planner can match the partial index
 * audit_logs_team_deleted_idx (a bind parameter would hide the predicate from it).
 */
export async function listDeletedTeams(
  tx: Tx,
  hackathonId: string,
  query: DeletedTeamsQuery,
): Promise<DeletedTeams> {
  const listKey = "deleted-teams";
  const cursor = query.cursor ? decodeCursor(query.cursor, listKey) : null;
  const rows = await tx.$queryRaw<
    {
      id: string;
      team_id: string;
      actor_user_id: string | null;
      metadata: Prisma.JsonValue;
      created_at: Date;
      cursor_ts: string;
    }[]
  >`
    SELECT a.id, a.team_id, a.actor_user_id, a.metadata, a.created_at,
           ${cursorTimestamp(KEYSET.ts)} AS cursor_ts
    FROM audit_logs a
    WHERE a.hackathon_id = ${hackathonId}::uuid AND a.action = 'TEAM_DELETED'
      ${afterCursor(cursor, KEYSET, "desc")}
    ${keysetOrder(KEYSET, "desc")}
    LIMIT ${query.limit + 1}`;

  const { page, nextCursor } = pageOf(rows, query.limit, listKey);
  const nameOf = await namesFor(
    tx,
    page.map((row) => row.actor_user_id),
  );
  return {
    teams: page.map((row) => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      return {
        teamId: row.team_id,
        name: typeof meta.name === "string" ? meta.name : null,
        deletedAt: row.created_at,
        deletedBy: nameOf(row.actor_user_id),
        reason: typeof meta.reason === "string" ? meta.reason : null,
        droppedRequests: typeof meta.droppedRequests === "number" ? meta.droppedRequests : null,
      };
    }),
    nextCursor,
  };
}
