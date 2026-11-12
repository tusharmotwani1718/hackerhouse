import "server-only";

import { Prisma, type JoinPolicy, type TeamAccess } from "@hacker-house/db";

import { writeAudit } from "../../core/audit";
import { AppError, internalError } from "../../core/errors";
import type { DomainEvent } from "../../core/events";
import type { ConstraintErrors } from "../../core/pg-errors";
import type { Tx, TxResult } from "../../core/tx";
import { isUuid } from "../../core/validate";
import { resolveHackathon } from "../hackathons/service";
import {
  cancelRequests,
  declineForFullTeam,
  lockPendingRequests,
  reportDroppedRequests,
} from "../requests/settlement";
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

  // R9: now that I'm on a team, my pending requests in this hackathon are moot (03 §0.4, the
  // participant part of the batch; the new team has no requests yet).
  const myRequests = await lockPendingRequests(tx, { participantId: participant.id });
  const settlementEvents = await cancelRequests(tx, myRequests, "CREATED_TEAM", userId);

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
    ...settlementEvents,
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

type LockedTeam = {
  id: string;
  hackathonId: string;
  name: string;
  memberCount: number;
  maxSize: number;
  leaderParticipantId: string;
  version: number;
};

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
    {
      id: string;
      hackathon_id: string;
      name: string;
      member_count: number;
      max_size: number;
      leader_participant_id: string;
      version: number;
    }[]
  >(Prisma.sql`
    SELECT id, hackathon_id, name, member_count, max_size, leader_participant_id, version
    FROM teams
    WHERE id = ${teamId}::uuid
    FOR ${Prisma.raw(mode)}`);
  const row = rows[0];
  if (!row) throw new AppError("TEAM_NOT_FOUND", "Team not found.");
  return {
    id: row.id,
    hackathonId: row.hackathon_id,
    name: row.name,
    memberCount: row.member_count,
    maxSize: row.max_size,
    leaderParticipantId: row.leader_participant_id,
    version: row.version,
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

/** How the user reaches a team: from the board by team id, or by redeeming an invite code. */
export type TeamEntry = { via: "board"; teamId: string } | { via: "code"; code: string };

export type JoinedTeam = { team: TeamView; joinedAt: Date };

/** What the pre-lock step resolved: the team, its policy, and the code row on the code path. */
export type EntryTarget = {
  via: TeamEntry["via"];
  teamId: string;
  hackathonId: string;
  joinPolicy: JoinPolicy;
  inviteCodeId: string | null;
};

const invalidCode = () =>
  new AppError(
    "INVALID_CODE",
    "This invite code is not valid. Check it, or ask the team for a new one.",
  );

/**
 * Pre-lock (I4), shared by join (Flow 1) and request (Flow 4): reads only fields that never
 * change (team id, hackathon, join policy, access; a code's team). They pick the flow and the
 * target; every decision on mutable state (seats, membership, code validity) is made again
 * after locking. The caller then requires the policy its flow needs.
 */
export async function resolveEntryTarget(tx: Tx, entry: TeamEntry): Promise<EntryTarget> {
  if (entry.via === "board") {
    const team = isUuid(entry.teamId)
      ? await tx.team.findUnique({
          where: { id: entry.teamId },
          select: { id: true, hackathonId: true, joinPolicy: true, access: true },
        })
      : null;
    if (!team) throw new AppError("TEAM_NOT_FOUND", "Team not found.");
    if (team.access === "INVITE_ONLY") {
      throw new AppError("INVITE_REQUIRED", "This team is invite-only. Use its invite code.");
    }
    return {
      via: "board",
      teamId: team.id,
      hackathonId: team.hackathonId,
      joinPolicy: team.joinPolicy,
      inviteCodeId: null,
    };
  }

  const code = normalizeInviteCode(entry.code);
  if (!code) throw invalidCode();
  // Validity is checked here, BEFORE the team's policy can show in an answer: otherwise a
  // revoked code of an APPROVAL team would get a different reply than a wrong code, telling a
  // guesser it existed. The authoritative check is repeated under the team lock (I7). DB clock.
  const rows = await tx.$queryRaw<
    { invite_id: string; team_id: string; hackathon_id: string; join_policy: JoinPolicy }[]
  >`
    SELECT ic.id AS invite_id, t.id AS team_id, t.hackathon_id, t.join_policy
    FROM invite_codes ic JOIN teams t ON t.id = ic.team_id
    WHERE ic.code = ${code} AND ic.revoked_at IS NULL AND ic.expires_at > now()`;
  const invite = rows[0];
  if (!invite) throw invalidCode();
  return {
    via: "code",
    teamId: invite.team_id,
    hackathonId: invite.hackathon_id,
    joinPolicy: invite.join_policy,
    inviteCodeId: invite.invite_id,
  };
}

/**
 * I7: re-validate a code UNDER the team lock. Revoke/regenerate take the same lock, so once a
 * revocation commits, the old code can't admit anyone (or create a request).
 */
export async function revalidateInviteCode(tx: Tx, inviteCodeId: string): Promise<void> {
  const valid = await tx.$queryRaw<{ ok: number }[]>`
    SELECT 1 AS ok FROM invite_codes
    WHERE id = ${inviteCodeId}::uuid AND revoked_at IS NULL AND expires_at > now()`;
  if (valid.length === 0) throw invalidCode();
}

/**
 * Flow 1: join an OPEN team. Runs inside runMutation (the idempotency claim already ran first).
 * An APPROVAL team → 409 APPROVAL_REQUIRED (send a request instead, Flow 4).
 */
export async function joinTeam(
  tx: Tx,
  userId: string,
  entry: TeamEntry,
): Promise<TxResult<JoinedTeam>> {
  const target = await resolveEntryTarget(tx, entry);
  if (target.joinPolicy !== "OPEN") {
    throw new AppError("APPROVAL_REQUIRED", "This team approves members. Send a join request.");
  }
  return joinResolvedTeam(tx, userId, target);
}

/**
 * Flow 1 from the locks on, for an already-resolved OPEN target (redeem resolves once, then
 * dispatches here or to a request).
 *
 * Locks (I1): my participant row, then the team row. 50 people racing for 1 seat each lock
 * their own participant row (no contention), then queue on the SAME team row: the first reads
 * 3/4 and joins; every later one gets the latest committed row, reads 4/4 → TEAM_FULL.
 */
export async function joinResolvedTeam(
  tx: Tx,
  userId: string,
  target: EntryTarget,
): Promise<TxResult<JoinedTeam>> {
  const participant = await lockOwnParticipant(tx, userId, target.hackathonId);
  const team = await lockTeam(tx, target.teamId, "NO KEY UPDATE");
  if (target.inviteCodeId) await revalidateInviteCode(tx, target.inviteCodeId);

  // Decisions on mutable state, made only now that the rows are locked (no check-then-act).
  if (participant.teamId) {
    throw new AppError("ALREADY_IN_TEAM", "You are already in a team in this hackathon.");
  }
  if (team.memberCount >= team.maxSize) {
    throw new AppError("TEAM_FULL", "This team is full.");
  }

  // 03 §0.4: ONE batch, sorted by id — my pending requests (always: R9), plus the team's if
  // this join takes the last seat (R24). OPEN teams normally have none (requests only go to
  // APPROVAL teams), but the rule lives in one place.
  const fillsTeam = team.memberCount + 1 === team.maxSize;
  const batch = await lockPendingRequests(tx, {
    participantId: participant.id,
    teamId: fillsTeam ? team.id : null,
  });
  const mine = batch.filter((request) => request.participantId === participant.id);
  const theTeams = batch.filter((request) => request.participantId !== participant.id);

  const joined = await tx.$queryRaw<{ team_joined_at: Date }[]>`
    UPDATE participants SET team_id = ${team.id}::uuid, team_joined_at = now()
    WHERE id = ${participant.id}::uuid
    RETURNING team_joined_at`;
  const updated = await updateTeamRow(tx, team.id, { memberCountDelta: 1 });
  const settlementEvents = [
    ...(await cancelRequests(tx, mine, "JOINED_TEAM", userId)),
    ...(await declineForFullTeam(tx, theTeams, userId)),
  ];

  await writeAudit(tx, [
    {
      action: "MEMBER_JOINED",
      hackathonId: team.hackathonId,
      teamId: team.id,
      actorUserId: userId,
      metadata: {
        via: target.via,
        participantId: participant.id,
        memberCount: updated.memberCount,
        ...(target.inviteCodeId && { inviteCodeId: target.inviteCodeId }),
      },
    },
  ]);

  const [card] = await buildTeamCards(tx, [updated]);
  return {
    value: { team: toTeamView(updated), joinedAt: joined[0]!.team_joined_at },
    events: [
      { channel: `hackathon:${team.hackathonId}`, type: "team.updated", payload: card },
      ...settlementEvents,
    ],
  };
}

// ---------------------------------------------------------------------------------- leave (Flow 3)

export type LeftTeam = {
  teamId: string;
  /** Case A: I was the last member, so the team was deleted (R7). */
  teamDeleted: boolean;
  /** Case C: I was the leader; leadership passed to the longest-joined member (R6). */
  newLeader: { participantId: string; userId: string; name: string } | null;
};

/**
 * Flow 3: leave my team. Runs inside runMutation. Locks (I1): my participant row, then the team.
 */
export async function leaveTeam(
  tx: Tx,
  userId: string,
  teamId: string,
): Promise<TxResult<LeftTeam>> {
  // Pre-lock (I4): only the team's hackathon, which never changes.
  const team = isUuid(teamId)
    ? await tx.team.findUnique({ where: { id: teamId }, select: { id: true, hackathonId: true } })
    : null;
  if (!team) throw new AppError("TEAM_NOT_FOUND", "Team not found.");

  const participant = await lockOwnParticipant(tx, userId, team.hackathonId);
  if (participant.teamId !== team.id) {
    throw new AppError("NOT_A_MEMBER", "You are not a member of this team.");
  }
  return leaveTeamAsLockedMember(tx, { userId, participantId: participant.id, teamId: team.id });
}

/**
 * Flow 3 from step 4. The caller already holds the leaving participant's lock and has checked
 * they belong to `teamId`. Flow 8 (withdraw, 5.2) calls this inside its own transaction.
 */
export async function leaveTeamAsLockedMember(
  tx: Tx,
  input: { userId: string; participantId: string; teamId: string },
): Promise<TxResult<LeftTeam>> {
  // FOR UPDATE, not NO KEY UPDATE: we may delete the team, and we only know that after reading
  // member_count under the lock. Upgrading a weaker lock later would be fragile.
  const team = await lockTeam(tx, input.teamId, "UPDATE");
  const iAmLeader = team.leaderParticipantId === input.participantId;

  // Common first step for all cases. Required before a delete (participants_team_fkey is
  // RESTRICT and checked immediately); harmless before a leader change (the leader FK is
  // deferred, so the brief "leader isn't a member" state is only checked at COMMIT).
  await tx.$executeRaw`
    UPDATE participants SET team_id = NULL, team_joined_at = NULL
    WHERE id = ${input.participantId}::uuid`;

  const audit = {
    hackathonId: team.hackathonId,
    teamId: team.id,
    actorUserId: input.userId,
  };

  if (team.memberCount === 1) {
    // Case A — last member, so necessarily the leader (the deferred leader FK guarantees the
    // leader is a member). Anything else means member_count drifted: stop, don't delete.
    if (!iAmLeader) {
      throw internalError(new Error(`team ${team.id}: member_count 1 but leaver isn't leader`));
    }
    // R23: lock the team's pending requests (sorted, 03 §0.4) BEFORE the delete cascades to
    // them — a cascade deletes in no guaranteed order — and report them while the requesters
    // can still be read.
    const dropped = await lockPendingRequests(tx, { teamId: team.id });
    const droppedEvents = await reportDroppedRequests(tx, dropped, input.userId);
    // Invite codes and those requests go with the team (ON DELETE CASCADE). If a member were
    // still left behind, RESTRICT on participants_team_fkey would refuse this delete.
    await tx.$executeRaw`DELETE FROM teams WHERE id = ${team.id}::uuid`;

    await writeAudit(tx, [
      {
        ...audit,
        action: "MEMBER_LEFT",
        metadata: { participantId: input.participantId, memberCount: 0 },
      },
      {
        ...audit,
        action: "TEAM_DELETED",
        metadata: {
          name: team.name,
          reason: "LAST_MEMBER_LEFT",
          droppedRequests: dropped.length,
        },
      },
    ]);
    return {
      value: { teamId: team.id, teamDeleted: true, newLeader: null },
      // version = last + 1, so a deletion always outranks any late team.updated (05 §5).
      events: [
        {
          channel: `hackathon:${team.hackathonId}`,
          type: "team.deleted",
          payload: { id: team.id, version: team.version + 1 },
        },
        ...droppedEvents,
      ],
    };
  }

  let updated: TeamRow;
  let newLeader: LeftTeam["newLeader"] = null;

  if (!iAmLeader) {
    // Case B — a regular member: one seat frees up.
    updated = await updateTeamRow(tx, team.id, { memberCountDelta: -1 });
    await writeAudit(tx, [
      {
        ...audit,
        action: "MEMBER_LEFT",
        metadata: { participantId: input.participantId, memberCount: updated.memberCount },
      },
    ]);
  } else {
    // Case C — the leader leaves, others remain: the longest-joined member leads (R6); id
    // breaks ties, so the choice is deterministic. No lock on the successor: by I2 nobody can
    // join or leave this team without the team lock, which we hold, so this member set is
    // frozen until we commit. (Locking a participant after a team would also break I1.)
    // I'm already cleared above, so `team_id = T` excludes me.
    const successors = await tx.$queryRaw<{ id: string; user_id: string; name: string }[]>`
      SELECT p.id, p.user_id, u.name
      FROM participants p JOIN users u ON u.id = p.user_id
      WHERE p.team_id = ${team.id}::uuid
      ORDER BY p.team_joined_at ASC, p.id ASC
      LIMIT 1`;
    const successor = successors[0];
    if (!successor) {
      throw internalError(new Error(`team ${team.id}: member_count > 1 but no other member`));
    }
    updated = await updateTeamRow(tx, team.id, {
      memberCountDelta: -1,
      leaderParticipantId: successor.id,
    });
    newLeader = { participantId: successor.id, userId: successor.user_id, name: successor.name };
    await writeAudit(tx, [
      {
        ...audit,
        action: "MEMBER_LEFT",
        metadata: { participantId: input.participantId, memberCount: updated.memberCount },
      },
      {
        ...audit,
        action: "LEADER_CHANGED",
        targetUserId: successor.user_id,
        metadata: {
          fromParticipantId: input.participantId,
          toParticipantId: successor.id,
          reason: "LEADER_LEFT",
        },
      },
    ]);
  }

  // Built after ALL writes, so the card shows the final members and leader.
  const [card] = await buildTeamCards(tx, [updated]);
  return {
    value: { teamId: team.id, teamDeleted: false, newLeader },
    events: [{ channel: `hackathon:${team.hackathonId}`, type: "team.updated", payload: card }],
  };
}
