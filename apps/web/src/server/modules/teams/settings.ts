import "server-only";

import { z } from "zod";

import { writeAudit, type AuditEntry } from "../../core/audit";
import { AppError } from "../../core/errors";
import type { DomainEvent } from "../../core/events";
import type { Tx, TxResult } from "../../core/tx";
import { isUuid } from "../../core/validate";
import { buildTeamCards, teamCardSelect } from "./cards";
import { insertInviteCode } from "./invite-codes";
import { INVITE_HOURS_DEFAULT, INVITE_HOURS_MAX, INVITE_HOURS_MIN } from "./schemas";
import { assertLeader, lockTeam, toTeamView, updateTeamRow, type TeamView } from "./service";

/**
 * Team settings & invite codes (step 5.3, 03 Flow 9). The leader's operations (9a–9c) lock ONLY
 * the team row (`FOR NO KEY UPDATE`: membership doesn't change) and check leadership under it:
 *  - leadership moves only under the team lock (leave, 3.5), so the check can't go stale;
 *  - other flows that read/write the same state (joins changing member_count; redeemers
 *    re-checking codes, I7) take the same lock, so they're strictly ordered with us.
 * The leader's own participant row is NOT locked: nothing on it decides anything here.
 */

const LEADER_ONLY = "Only this team's leader can change its settings.";

const teamNotFound = () => new AppError("TEAM_NOT_FOUND", "Team not found.");

// ------------------------------------------------------------------------- 9a: toggle looking

/** PATCH /api/teams/{teamId} body. Only `isLooking` is editable in v1. */
export const teamSettingsSchema = z.strictObject({
  isLooking: z.boolean({ error: "must be true or false" }),
});
export type TeamSettings = z.output<typeof teamSettingsSchema>;

/**
 * 9a: turn "looking for teammates" on or off (board listing only, R21). Naturally idempotent
 * ("set to this value"), so no Idempotency-Key: the same value again → 200 with NO write (no
 * version bump, no event). Turning it ON while the team is full → 409 TEAM_FULL (the board
 * hides full teams anyway, so it would be meaningless).
 */
export async function setLooking(
  tx: Tx,
  userId: string,
  teamId: string,
  settings: TeamSettings,
): Promise<TxResult<{ team: TeamView }>> {
  if (!isUuid(teamId)) throw teamNotFound();
  const team = await lockTeam(tx, teamId, "NO KEY UPDATE");
  await assertLeader(tx, userId, team, LEADER_ONLY);

  if (settings.isLooking === team.isLooking) {
    // Nothing changes → nothing to write, version stays, no event.
    const current = await tx.team.findUniqueOrThrow({
      where: { id: team.id },
      select: { ...teamCardSelect, hackathonId: true },
    });
    return { value: { team: toTeamView(current) } };
  }
  if (settings.isLooking && team.memberCount >= team.maxSize) {
    throw new AppError("TEAM_FULL", "This team is full; it can't look for teammates.");
  }

  const updated = await updateTeamRow(tx, team.id, { isLooking: settings.isLooking });
  await writeAudit(tx, [
    {
      action: "LOOKING_TOGGLED",
      hackathonId: team.hackathonId,
      teamId: team.id,
      actorUserId: userId,
      metadata: { isLooking: updated.isLooking, version: updated.version },
    },
  ]);

  // `listed` on the card changes with it, so boards add/remove the team live.
  const [card] = await buildTeamCards(tx, [updated]);
  return {
    value: { team: toTeamView(updated) },
    events: [{ channel: `hackathon:${team.hackathonId}`, type: "team.updated", payload: card }],
  };
}

// ------------------------------------------------------------- 9b: regenerate the invite code

/** POST /api/teams/{teamId}/invite-code body. The leader picks the expiry (01 §5: 1h–30d). */
export const regenerateInviteSchema = z.strictObject({
  expiresInHours: z
    .number({ error: `must be a whole number of hours ${INVITE_HOURS_MIN}-${INVITE_HOURS_MAX}` })
    .int({ error: `must be a whole number of hours ${INVITE_HOURS_MIN}-${INVITE_HOURS_MAX}` })
    .min(INVITE_HOURS_MIN, { error: `must be ${INVITE_HOURS_MIN}-${INVITE_HOURS_MAX} hours` })
    .max(INVITE_HOURS_MAX, {
      error: `must be ${INVITE_HOURS_MIN}-${INVITE_HOURS_MAX} hours (30 days)`,
    })
    .default(INVITE_HOURS_DEFAULT),
});
export type RegenerateInvite = z.output<typeof regenerateInviteSchema>;

export type RegeneratedInvite = { inviteCode: { code: string; expiresAt: Date } };

/**
 * `invite.updated` to every CURRENT member's private channel — never the code (it's secret; it
 * never goes on hackathon: channels). Their UI refetches it via GET …/invite-code (9d). The
 * member list is read under the team lock, so it's exact (I2).
 */
async function inviteUpdatedEvents(
  tx: Tx,
  teamId: string,
  payload: { teamId: string; active: boolean; expiresAt?: Date },
): Promise<DomainEvent[]> {
  const members = await tx.participant.findMany({ where: { teamId }, select: { userId: true } });
  return members.map((member) => ({
    channel: `user:${member.userId}`,
    type: "invite.updated",
    payload,
  }));
}

/**
 * 9b: revoke the current code and issue a new one. Requires an Idempotency-Key: a retried
 * regenerate WITHOUT the stored response would revoke the code the leader just received and
 * issue yet another; with it, the retry returns the same new code.
 *
 * Under the team lock (I7): every writer of this team's codes holds it, so two regenerates
 * (two tabs) run one after the other — the second's UPDATE starts after the first committed and
 * sees (revokes) its code; without the lock, its snapshot would miss the first's new code and
 * the INSERT would hit "one active code per team" (23505). And a redeem re-checks the code
 * under the same lock, so once this commits, the old code admits no one.
 */
export async function regenerateInviteCode(
  tx: Tx,
  userId: string,
  teamId: string,
  input: RegenerateInvite,
): Promise<TxResult<RegeneratedInvite>> {
  if (!isUuid(teamId)) throw teamNotFound();
  const team = await lockTeam(tx, teamId, "NO KEY UPDATE");
  await assertLeader(tx, userId, team, "Only this team's leader can manage its invite code.");

  // Revoke the current code — even an expired one: the partial unique index counts every
  // unrevoked code, expired or not (3.1). The UPDATE itself locks the rows it changes.
  const revoked = await tx.$queryRaw<{ id: string }[]>`
    UPDATE invite_codes SET revoked_at = now()
    WHERE team_id = ${team.id}::uuid AND revoked_at IS NULL
    RETURNING id`;

  const invite = await insertInviteCode(tx, {
    teamId: team.id,
    createdByUserId: userId,
    expiresInHours: input.expiresInHours,
  });

  // Codes never go into the audit log; ids and expiry only.
  const audit: AuditEntry[] = revoked.map((row) => ({
    action: "INVITE_CODE_REVOKED",
    hackathonId: team.hackathonId,
    teamId: team.id,
    actorUserId: userId,
    metadata: { inviteCodeId: row.id, reason: "REGENERATED" },
  }));
  audit.push({
    action: "INVITE_CODE_GENERATED",
    hackathonId: team.hackathonId,
    teamId: team.id,
    actorUserId: userId,
    metadata: { inviteCodeId: invite.id, expiresAt: invite.expiresAt.toISOString() },
  });
  await writeAudit(tx, audit);

  return {
    // The code: only in the leader's own response (and its stored idempotent copy).
    value: { inviteCode: { code: invite.code, expiresAt: invite.expiresAt } },
    events: await inviteUpdatedEvents(tx, team.id, {
      teamId: team.id,
      active: true,
      expiresAt: invite.expiresAt,
    }),
  };
}

// ---------------------------------------------------------------- 9c: revoke the invite code

export type RevokedInvite = { teamId: string; revoked: true };

/**
 * 9c: revoke the current code, leaving the team with none (members can still join from the
 * board if the team is PUBLIC; an INVITE_ONLY team is closed until a new code is generated).
 * Requires an Idempotency-Key: a double click then replays the 200 instead of a confusing 404.
 *
 * Under the team lock (I7): a redeem re-checks its code under the same lock, so once this
 * commits the code admits no one. One conditional UPDATE (it locks the rows it changes); it
 * also revokes an expired-but-unrevoked code (03: "0 rows → NO_ACTIVE_CODE").
 */
export async function revokeInviteCode(
  tx: Tx,
  userId: string,
  teamId: string,
): Promise<TxResult<RevokedInvite>> {
  if (!isUuid(teamId)) throw teamNotFound();
  const team = await lockTeam(tx, teamId, "NO KEY UPDATE");
  await assertLeader(tx, userId, team, "Only this team's leader can manage its invite code.");

  const revoked = await tx.$queryRaw<{ id: string }[]>`
    UPDATE invite_codes SET revoked_at = now()
    WHERE team_id = ${team.id}::uuid AND revoked_at IS NULL
    RETURNING id`;
  if (revoked.length === 0) {
    throw new AppError("NO_ACTIVE_CODE", "This team has no invite code to revoke.");
  }

  await writeAudit(
    tx,
    revoked.map((row) => ({
      action: "INVITE_CODE_REVOKED" as const,
      hackathonId: team.hackathonId,
      teamId: team.id,
      actorUserId: userId,
      metadata: { inviteCodeId: row.id, reason: "REVOKED" },
    })),
  );
  return {
    value: { teamId: team.id, revoked: true },
    events: await inviteUpdatedEvents(tx, team.id, { teamId: team.id, active: false }),
  };
}

// ------------------------------------------------------------------- 9d: view the invite code

export type ActiveInvite = { code: string; expiresAt: Date; createdAt: Date };

/**
 * 9d: any CURRENT member may see the active code (R26; managing it — 9b/9c — is leader only).
 * A read: call inside runReadTx (one snapshot), no locks (RD1). If a member is removed a moment
 * later, they may see it one last time — nothing they couldn't have copied while a member,
 * which is why a leader who removes someone should regenerate (9b).
 * Active = unrevoked AND unexpired (DB clock). None → 404 NO_ACTIVE_CODE.
 */
export async function getInviteCode(tx: Tx, userId: string, teamId: string): Promise<ActiveInvite> {
  const team = isUuid(teamId)
    ? await tx.team.findUnique({ where: { id: teamId }, select: { id: true, hackathonId: true } })
    : null;
  if (!team) throw teamNotFound();

  const me = await tx.participant.findUnique({
    where: { userId_hackathonId: { userId, hackathonId: team.hackathonId } },
    select: { teamId: true },
  });
  if (me?.teamId !== team.id) {
    throw new AppError("MEMBERS_ONLY", "Only this team's members can see its invite code.");
  }

  const rows = await tx.$queryRaw<{ code: string; expires_at: Date; created_at: Date }[]>`
    SELECT code, expires_at, created_at FROM invite_codes
    WHERE team_id = ${team.id}::uuid AND revoked_at IS NULL AND expires_at > now()`;
  const active = rows[0];
  if (!active) throw new AppError("NO_ACTIVE_CODE", "This team has no active invite code.");
  return { code: active.code, expiresAt: active.expires_at, createdAt: active.created_at };
}
