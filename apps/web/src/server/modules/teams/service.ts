import "server-only";

import { Prisma, type JoinPolicy, type TeamAccess } from "@hacker-house/db";

import { writeAudit } from "../../core/audit";
import { AppError } from "../../core/errors";
import type { DomainEvent } from "../../core/events";
import type { ConstraintErrors } from "../../core/pg-errors";
import type { Tx, TxResult } from "../../core/tx";
import { isUuid } from "../../core/validate";
import { resolveHackathon } from "../hackathons/service";
import { buildTeamCards, teamCardSelect, type TeamCardRow } from "./cards";
import { insertInviteCode, normalizeInviteCode } from "./invite-codes";
import type { CreateTeam } from "./schemas";

/** The full team as its creator sees it (public fields; the code is returned separately). */
export type TeamView = {
  id: string;
  hackathonId: string;
  name: string;
  description: string;
  joinPolicy: JoinPolicy;
  access: TeamAccess;
  isLooking: boolean;
  memberCount: number;
  maxSize: number;
  version: number;
  createdAt: Date;
};

/** A team row with everything a card or a TeamView needs. */
export type TeamRow = TeamCardRow & { hackathonId: string };

export function toTeamView(team: TeamRow): TeamView {
  return {
    id: team.id,
    hackathonId: team.hackathonId,
    name: team.name,
    description: team.description,
    joinPolicy: team.joinPolicy,
    access: team.access,
    isLooking: team.isLooking,
    memberCount: team.memberCount,
    maxSize: team.maxSize,
    version: team.version,
    createdAt: team.createdAt,
  };
}

export type CreatedTeam = {
  team: TeamView;
  /** Only in the creator's own response (and its stored idempotent copy); never public (R28). */
  inviteCode: { code: string; expiresAt: Date };
};

/** Pass to runMutation. The name index is hand-written: (hackathon_id, lower(name)). */
export const createTeamConstraintErrors: ConstraintErrors = {
  teams_hackathon_id_lower_name_key: {
    code: "TEAM_NAME_TAKEN",
    message: "A team with this name already exists in this hackathon. Please choose another name.",
  },
};

/**
 * Lock the caller's participant row in this hackathon (I1: participants come first), or 403.
 * After this returns, `teamId` is current and can't change until we commit (I3).
 */
export async function lockOwnParticipant(
  tx: Tx,
  userId: string,
  hackathonId: string,
): Promise<{ id: string; teamId: string | null }> {
  const rows = await tx.$queryRaw<{ id: string; team_id: string | null }[]>`
    SELECT id, team_id FROM participants
    WHERE user_id = ${userId}::uuid AND hackathon_id = ${hackathonId}::uuid
    FOR UPDATE`;
  const row = rows[0];
  if (!row) {
    throw new AppError("NOT_REGISTERED", "Register for this hackathon first.");
  }
  return { id: row.id, teamId: row.team_id };
}

/**
 * Flow 6: create a team; the creator becomes leader in the first seat (R5). Runs inside
 * runMutation (the idempotency claim already ran as this transaction's first statement).
 *
 * Locks: only the creator's participant row. The new team needs none: no other transaction
 * can know its id before we commit.
 */
export async function createTeam(
  tx: Tx,
  userId: string,
  idOrSlug: string,
  input: CreateTeam,
): Promise<TxResult<CreatedTeam>> {
  // Pre-lock read of immutable fields only (I4): the hackathon's id and max_team_size never change.
  const hackathon = await resolveHackathon(tx, idOrSlug);

  // Lock FIRST, then decide (no check-then-act): a second create by the same user waits here,
  // then sees team_id already set.
  const participant = await lockOwnParticipant(tx, userId, hackathon.id);
  if (participant.teamId) {
    throw new AppError("ALREADY_IN_TEAM", "You are already in a team in this hackathon.");
  }

  // The leader FK is DEFERRED: right now the team names P as leader while P's team_id is still
  // NULL. Checked at COMMIT, when the UPDATE below has made both rows agree.
  // A taken name (any letter case) → 23505 on teams_hackathon_id_lower_name_key → TEAM_NAME_TAKEN.
  const team = await tx.team.create({
    data: {
      hackathonId: hackathon.id,
      name: input.name,
      description: input.description,
      joinPolicy: input.joinPolicy,
      access: input.access,
      isLooking: input.isLooking,
      leaderParticipantId: participant.id,
      memberCount: 1,
      maxSize: hackathon.maxTeamSize, // copied; teams_hackathon_fkey keeps it equal (R10)
    },
    select: { ...teamCardSelect, hackathonId: true },
  });

  await tx.$executeRaw`
    UPDATE participants SET team_id = ${team.id}::uuid, team_joined_at = now()
    WHERE id = ${participant.id}::uuid`;

  const invite = await insertInviteCode(tx, {
    teamId: team.id,
    createdByUserId: userId,
    expiresInHours: input.inviteExpiresInHours,
  });

  // TODO(4.1): cancel P's pending join requests in this hackathon (R9), via the §0.4 helper.

  await writeAudit(tx, [
    {
      action: "TEAM_CREATED",
      hackathonId: hackathon.id,
      teamId: team.id,
      actorUserId: userId,
      metadata: {
        name: team.name,
        joinPolicy: team.joinPolicy,
        access: team.access,
        leaderParticipantId: participant.id,
      },
    },
    {
      action: "INVITE_CODE_GENERATED", // the code itself is never written to the audit log
      hackathonId: hackathon.id,
      teamId: team.id,
      actorUserId: userId,
      metadata: { inviteCodeId: invite.id, expiresAt: invite.expiresAt.toISOString() },
    },
  ]);

  // Event payload = the public board card (no code). Built after the writes, in this transaction.
  const [card] = await buildTeamCards(tx, [team]);
  const events: DomainEvent[] = [
    { channel: `hackathon:${hackathon.id}`, type: "team.created", payload: card },
  ];

  return {
    value: {
      team: toTeamView(team),
      inviteCode: { code: invite.code, expiresAt: invite.expiresAt },
    },
    events,
  };
}

// ---------------------------------------------------------------------------------- team row

type LockedTeam = { id: string; hackathonId: string; memberCount: number; maxSize: number };

/**
 * Lock a team row (I1: after participant rows, before request rows), or 404 if it's gone
 * (e.g. deleted by its last member leaving while we waited). After this returns, the team's
 * member_count and member set can't change until we commit (I2).
 *
 *  - "NO KEY UPDATE": we'll change the row but never delete it or change its id. Doesn't block
 *    FK checks from rows referencing the team (they take the weaker KEY SHARE lock).
 *  - "UPDATE": we may delete the team (leave, 3.5).
 */
export async function lockTeam(
  tx: Tx,
  teamId: string,
  mode: "NO KEY UPDATE" | "UPDATE",
): Promise<LockedTeam> {
  // `mode` is one of two literals from our code, never user input → safe as raw SQL.
  const rows = await tx.$queryRaw<
    { id: string; hackathon_id: string; member_count: number; max_size: number }[]
  >(Prisma.sql`
    SELECT id, hackathon_id, member_count, max_size FROM teams
    WHERE id = ${teamId}::uuid
    FOR ${Prisma.raw(mode)}`);
  const row = rows[0];
  if (!row) throw new AppError("TEAM_NOT_FOUND", "Team not found.");
  return {
    id: row.id,
    hackathonId: row.hackathon_id,
    memberCount: row.member_count,
    maxSize: row.max_size,
  };
}

type RawTeamRow = {
  id: string;
  hackathon_id: string;
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
};

/**
 * THE way to change a team row: applies the changes AND bumps `version` and sets
 * `updated_at = now()` in the same statement, so neither can be forgotten (SSE ordering, 05 §5).
 * The caller must hold the team lock (`lockTeam`). Returns the new row.
 */
export async function updateTeamRow(
  tx: Tx,
  teamId: string,
  changes: { memberCountDelta?: 1 | -1; isLooking?: boolean; leaderParticipantId?: string },
): Promise<TeamRow> {
  const rows = await tx.$queryRaw<RawTeamRow[]>`
    UPDATE teams SET
      member_count = member_count + ${changes.memberCountDelta ?? 0}::int,
      is_looking = COALESCE(${changes.isLooking ?? null}::boolean, is_looking),
      leader_participant_id = COALESCE(${changes.leaderParticipantId ?? null}::uuid, leader_participant_id),
      version = version + 1,
      updated_at = now()
    WHERE id = ${teamId}::uuid
    RETURNING id, hackathon_id, name, description, join_policy, access, is_looking,
              member_count, max_size, version, created_at, leader_participant_id`;
  const row = rows[0];
  if (!row) throw new AppError("TEAM_NOT_FOUND", "Team not found."); // can't happen under the lock
  return {
    id: row.id,
    hackathonId: row.hackathon_id,
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
  };
}

// ---------------------------------------------------------------------------------- join (Flow 1)

/** How the user is joining: from the board by team id, or by redeeming an invite code. */
export type JoinEntry = { via: "board"; teamId: string } | { via: "code"; code: string };

export type JoinedTeam = { team: TeamView; joinedAt: Date };

/** What the pre-lock step resolved: the team, and the code row when joining by code. */
type JoinTarget = { teamId: string; hackathonId: string; inviteCodeId: string | null };

const invalidCode = () =>
  new AppError(
    "INVALID_CODE",
    "This invite code is not valid. Check it, or ask the team for a new one.",
  );

/**
 * Pre-lock (I4): reads only fields that never change (team id, hackathon, join policy, access;
 * a code's team). They pick the flow and the target; every decision that depends on mutable
 * state (seats, membership, code validity) is made again after locking.
 */
async function resolveJoinTarget(tx: Tx, entry: JoinEntry): Promise<JoinTarget> {
  if (entry.via === "board") {
    const team = isUuid(entry.teamId)
      ? await tx.team.findUnique({
          where: { id: entry.teamId },
          select: { id: true, hackathonId: true, joinPolicy: true, access: true },
        })
      : null;
    if (!team) throw new AppError("TEAM_NOT_FOUND", "Team not found.");
    if (team.access === "INVITE_ONLY") {
      throw new AppError("INVITE_REQUIRED", "This team is invite-only. Join with its invite code.");
    }
    if (team.joinPolicy === "APPROVAL") {
      throw new AppError("APPROVAL_REQUIRED", "This team approves members. Send a join request.");
    }
    return { teamId: team.id, hackathonId: team.hackathonId, inviteCodeId: null };
  }

  const code = normalizeInviteCode(entry.code);
  if (!code) throw invalidCode();
  // Validity is checked here too, before the team's policy is revealed: otherwise a revoked
  // code of an APPROVAL team would answer APPROVAL_REQUIRED, telling a guesser it existed.
  // The authoritative check is repeated under the team lock (I7). Both use the DB clock.
  const rows = await tx.$queryRaw<
    { invite_id: string; team_id: string; hackathon_id: string; join_policy: JoinPolicy }[]
  >`
    SELECT ic.id AS invite_id, t.id AS team_id, t.hackathon_id, t.join_policy
    FROM invite_codes ic JOIN teams t ON t.id = ic.team_id
    WHERE ic.code = ${code} AND ic.revoked_at IS NULL AND ic.expires_at > now()`;
  const invite = rows[0];
  if (!invite) throw invalidCode();
  if (invite.join_policy === "APPROVAL") {
    // TODO(4.2): APPROVAL teams' codes create a join request (Flow 4) instead.
    throw new AppError("APPROVAL_REQUIRED", "This team approves members. Send a join request.");
  }
  return {
    teamId: invite.team_id,
    hackathonId: invite.hackathon_id,
    inviteCodeId: invite.invite_id,
  };
}

/**
 * Flow 1: join an OPEN team. Both entry points (join from board, invite code) end here — one locking
 * path. Runs inside runMutation (the idempotency claim already ran first).
 *
 * Locks (I1): my participant row, then the team row. 50 people racing for 1 seat each lock
 * their own participant row (no contention), then queue on the SAME team row: the first reads
 * 3/4 and joins; every later one gets the latest committed row, reads 4/4 → TEAM_FULL.
 */
export async function joinTeam(
  tx: Tx,
  userId: string,
  entry: JoinEntry,
): Promise<TxResult<JoinedTeam>> {
  const target = await resolveJoinTarget(tx, entry);

  const participant = await lockOwnParticipant(tx, userId, target.hackathonId);
  const team = await lockTeam(tx, target.teamId, "NO KEY UPDATE");

  if (target.inviteCodeId) {
    // I7: re-validate under the team lock. Revoke/regenerate take the same lock, so once a
    // revocation commits, this code can't admit anyone.
    const valid = await tx.$queryRaw<{ ok: number }[]>`
      SELECT 1 AS ok FROM invite_codes
      WHERE id = ${target.inviteCodeId}::uuid AND revoked_at IS NULL AND expires_at > now()`;
    if (valid.length === 0) throw invalidCode();
  }

  // Decisions on mutable state, made only now that the rows are locked (no check-then-act).
  if (participant.teamId) {
    throw new AppError("ALREADY_IN_TEAM", "You are already in a team in this hackathon.");
  }
  if (team.memberCount >= team.maxSize) {
    throw new AppError("TEAM_FULL", "This team is full.");
  }

  // TODO(4.1): lock + settle requests (§0.4): mine → CANCELLED (R9); the team's → DECLINED
  // TEAM_FULL if this join fills it (R24).

  const joined = await tx.$queryRaw<{ team_joined_at: Date }[]>`
    UPDATE participants SET team_id = ${team.id}::uuid, team_joined_at = now()
    WHERE id = ${participant.id}::uuid
    RETURNING team_joined_at`;
  const updated = await updateTeamRow(tx, team.id, { memberCountDelta: 1 });

  await writeAudit(tx, [
    {
      action: "MEMBER_JOINED",
      hackathonId: team.hackathonId,
      teamId: team.id,
      actorUserId: userId,
      metadata: {
        via: entry.via,
        participantId: participant.id,
        memberCount: updated.memberCount,
        ...(target.inviteCodeId && { inviteCodeId: target.inviteCodeId }),
      },
    },
  ]);

  const [card] = await buildTeamCards(tx, [updated]);
  return {
    value: { team: toTeamView(updated), joinedAt: joined[0]!.team_joined_at },
    events: [{ channel: `hackathon:${team.hackathonId}`, type: "team.updated", payload: card }],
  };
}
