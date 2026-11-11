import "server-only";

import { randomInt } from "node:crypto";

import { internalError } from "../../core/errors";
import { logger } from "../../core/logger";
import type { Tx } from "../../core/tx";

/** Crockford base32: digits + letters without I, L, O, U (easy to misread). 32 symbols. */
export const INVITE_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** 10 symbols × 5 bits = 50 bits of entropy (01 §5). Same rule as invite_codes_code_check. */
export const INVITE_CODE_LENGTH = 10;

const INVITE_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{10}$/; // same as invite_codes_code_check

/**
 * A typed-in code → its stored form, or null if it can't be one. Crockford's decoding rules:
 * case-insensitive, hyphens and spaces ignored, look-alikes mapped (I, L → 1; O → 0).
 * So "9wbex-hjvv7" and "9WBEX HJVV7" both find 9WBEXHJVV7.
 */
export function normalizeInviteCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  return INVITE_CODE_PATTERN.test(code) ? code : null;
}

/** Returns a uniform integer in [0, max). Injectable so tests can force a collision. */
export type RandomIndex = (max: number) => number;

/** CSPRNG, no modulo bias: randomInt picks each index uniformly from 0..31. */
export function generateInviteCode(random: RandomIndex = randomInt): string {
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_CODE_ALPHABET[random(INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

const MAX_ATTEMPTS = 3;

export type NewInviteCode = { id: string; code: string; expiresAt: Date };

/**
 * Insert a new active code for a team. Call under the team's lock (I7) — or, at team
 * creation, before anyone else can know the team exists.
 *
 * A code collision (astronomically rare at 50 bits) is an EXPECTED duplicate we want to
 * survive without aborting the transaction: `ON CONFLICT (code) DO NOTHING` returns 0 rows,
 * and we simply draw a new code. Any other unique violation (e.g. a second active code for
 * the team) still raises, because it isn't the conflict target: that would be a bug.
 */
export async function insertInviteCode(
  tx: Tx,
  input: { teamId: string; createdByUserId: string; expiresInHours: number },
  random: RandomIndex = randomInt,
): Promise<NewInviteCode> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const code = generateInviteCode(random);
    const rows = await tx.$queryRaw<{ id: string; expires_at: Date }[]>`
      INSERT INTO invite_codes (team_id, code, expires_at, created_by_user_id)
      VALUES (${input.teamId}::uuid, ${code}, now() + make_interval(hours => ${input.expiresInHours}::int),
              ${input.createdByUserId}::uuid)
      ON CONFLICT (code) DO NOTHING
      RETURNING id, expires_at`;
    const row = rows[0];
    if (row) return { id: row.id, code, expiresAt: row.expires_at };
    logger.warn("invite code collision; drawing a new code", { attempt });
  }
  throw internalError(new Error(`no unique invite code after ${MAX_ATTEMPTS} attempts`));
}
