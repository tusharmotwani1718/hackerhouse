import "server-only";

import { writeAudit } from "../../core/audit";
import { AppError } from "../../core/errors";
import type { ConstraintErrors } from "../../core/pg-errors";
import type { Tx } from "../../core/tx";
import type { CreateHackathon } from "./schemas";

export type Hackathon = {
  id: string;
  slug: string;
  name: string;
  description: string;
  minTeamSize: number;
  maxTeamSize: number;
  createdAt: Date;
};

/** `05`: a small set, so no pagination, but capped so the response can't grow without bound. */
export const LIST_LIMIT = 100;

const select = {
  id: true,
  slug: true,
  name: true,
  description: true,
  minTeamSize: true,
  maxTeamSize: true,
  createdAt: true,
} as const; // creator not exposed

/** Pass to runTx: a duplicate slug is the admin's to fix, not a generic CONFLICT. */
export const createHackathonConstraintErrors: ConstraintErrors = {
  hackathons_slug_key: {
    code: "SLUG_TAKEN",
    message: "A hackathon with this slug already exists. Please choose another slug.",
  },
};

/**
 * Insert one hackathon. The caller has checked the user is an ADMIN (requireAdmin).
 *
 * No lock on the admin's row: if the admin is demoted at the same moment, the result is the
 * same as "created just before the demotion", which is a valid order, so the race is harmless.
 * A double-submit hits the unique slug → SLUG_TAKEN, so no idempotency key is needed here.
 */
export async function createHackathon(
  tx: Tx,
  adminUserId: string,
  input: CreateHackathon,
): Promise<Hackathon> {
  const hackathon = await tx.hackathon.create({
    data: { ...input, createdByUserId: adminUserId },
    select,
  });
  await writeAudit(tx, [
    {
      action: "HACKATHON_CREATED",
      hackathonId: hackathon.id,
      actorUserId: adminUserId,
      metadata: {
        slug: hackathon.slug,
        name: hackathon.name,
        minTeamSize: hackathon.minTeamSize,
        maxTeamSize: hackathon.maxTeamSize,
      },
    },
  ]);
  return hackathon;
}

/** Newest first; id breaks ties (uuidv7 grows with time). */
export async function listHackathons(tx: Tx): Promise<Hackathon[]> {
  return tx.hackathon.findMany({
    select,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LIST_LIMIT,
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every `/api/hackathons/{idOrSlug}/...` route starts here: by uuid if the value looks like one,
 * else by slug (case-insensitive); or 404 HACKATHON_NOT_FOUND.
 */
export async function resolveHackathon(tx: Tx, idOrSlug: string): Promise<Hackathon> {
  const value = idOrSlug.trim();
  const hackathon = await tx.hackathon.findUnique({
    where: UUID.test(value) ? { id: value } : { slug: value.toLowerCase() },
    select,
  });
  if (!hackathon) throw new AppError("HACKATHON_NOT_FOUND", "Hackathon not found.");
  return hackathon;
}

export type HackathonDetail = Hackathon & {
  /** `teams` and `lookingTeams` join in step 3.6 (05 §4.7). */
  stats: { participants: number };
};

/** Two queries → call inside runReadTx so they see one snapshot (RD2). */
export async function getHackathon(tx: Tx, idOrSlug: string): Promise<HackathonDetail> {
  const hackathon = await resolveHackathon(tx, idOrSlug);
  const participants = await tx.participant.count({ where: { hackathonId: hackathon.id } });
  return { ...hackathon, stats: { participants } };
}
