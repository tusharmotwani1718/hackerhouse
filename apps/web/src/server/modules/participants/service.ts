import "server-only";

import { writeAudit } from "../../core/audit";
import { AppError } from "../../core/errors";
import type { ConstraintErrors } from "../../core/pg-errors";
import type { Tx } from "../../core/tx";
import { resolveHackathon } from "../hackathons/service";
import { missingForCompleteProfile } from "../profile/service";

/** `GET /api/hackathons/{id}/me` (05 §4.5); also the body of a successful register. */
export type MyHackathonStatus = {
  registered: boolean;
  participantId: string | null;
  registeredAt: Date | null;
  /** My team in this hackathon, or null (step 3.3). */
  team: { id: string; name: string; isLeader: boolean } | null;
};

const NOT_REGISTERED_STATUS: MyHackathonStatus = {
  registered: false,
  participantId: null,
  registeredAt: null,
  team: null,
};

/** Pass to runTx. Hackathons can't be deleted in v1; this FK is only the safety net. */
export const registerConstraintErrors: ConstraintErrors = {
  participants_hackathon_id_fkey: { code: "HACKATHON_NOT_FOUND", message: "Hackathon not found." },
};

/**
 * Flow 5: register the user for a hackathon. Runs inside runTx. No explicit locks:
 *  - Duplicate registrations (even simultaneous ones) are settled by UNIQUE (user_id,
 *    hackathon_id): a second INSERT waits for the first to commit, then gets no row back.
 *  - The profile check is read without a lock and still can't go stale: a complete profile
 *    can never become incomplete (1.3 forbids clearing the GitHub username and removing the
 *    last skill). The only race is a profile becoming complete while we read it, which is the
 *    same as having checked a moment earlier.
 *  - The hackathon can't be deleted in v1 (FK → HACKATHON_NOT_FOUND as a safety net).
 */
export async function register(
  tx: Tx,
  userId: string,
  idOrSlug: string,
): Promise<MyHackathonStatus> {
  // The idempotency claim already ran as this transaction's first statement (runMutation).
  const hackathon = await resolveHackathon(tx, idOrSlug);

  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { githubUsername: true, _count: { select: { skills: true } } },
  });
  if (!user) throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");
  const missing = missingForCompleteProfile(user.githubUsername, user._count.skills);
  if (missing.length > 0) {
    throw new AppError(
      "PROFILE_INCOMPLETE",
      "Complete your profile (GitHub username and at least one skill) before registering.",
      { details: { missing } },
    );
  }

  // ON CONFLICT DO NOTHING, not "catch the unique violation": an error aborts the whole
  // transaction, and the audit row and the stored idempotent response come after this insert.
  const rows = await tx.$queryRaw<{ id: string; created_at: Date }[]>`
    INSERT INTO participants (user_id, hackathon_id)
    VALUES (${userId}::uuid, ${hackathon.id}::uuid)
    ON CONFLICT (user_id, hackathon_id) DO NOTHING
    RETURNING id, created_at`;
  const row = rows[0];
  if (!row) {
    throw new AppError("ALREADY_REGISTERED", "You are already registered for this hackathon.");
  }

  await writeAudit(tx, [
    {
      action: "PARTICIPANT_REGISTERED",
      hackathonId: hackathon.id,
      actorUserId: userId,
      metadata: { participantId: row.id },
    },
  ]);

  // runMutation stores the response before COMMIT. No SSE event (Flow 5).
  return { registered: true, participantId: row.id, registeredAt: row.created_at, team: null };
}

/** Two queries → call inside runReadTx (RD2). "Not registered" is a normal 200 answer. */
export async function getMyStatus(
  tx: Tx,
  userId: string,
  idOrSlug: string,
): Promise<MyHackathonStatus> {
  const hackathon = await resolveHackathon(tx, idOrSlug);
  const participant = await tx.participant.findUnique({
    where: { userId_hackathonId: { userId, hackathonId: hackathon.id } },
    select: {
      id: true,
      createdAt: true,
      team: { select: { id: true, name: true, leaderParticipantId: true } },
    },
  });
  if (!participant) return NOT_REGISTERED_STATUS;
  const { team } = participant;
  return {
    registered: true,
    participantId: participant.id,
    registeredAt: participant.createdAt,
    team: team
      ? { id: team.id, name: team.name, isLeader: team.leaderParticipantId === participant.id }
      : null,
  };
}
