import "server-only";

import { createHash } from "node:crypto";

import type { Prisma } from "@hacker-house/db";

import { AppError, internalError } from "./errors";
import { logger } from "./logger";
import type { ConstraintErrors } from "./pg-errors";
import { runTx, type Tx, type TxResult } from "./tx";

/**
 * Idempotency keys (step 3.2, 01 §8, 03 §0.2 step 2): a mutation sent twice with the same
 * `Idempotency-Key` does its work once; every repeat gets the original response.
 *
 * Layering: `runMutation` adds the HTTP side (header, fingerprint, stored response, replay
 * header) and runs everything through the ordinary `runTx`, which keeps the transaction side
 * (lock_timeout, error mapping, deadlock retry, events after COMMIT). The claim is the first
 * statement INSIDE that transaction, so the key row commits or rolls back with the work.
 */

export const IDEMPOTENCY_HEADER = "Idempotency-Key";
export const REPLAYED_HEADER = "Idempotent-Replayed";
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/; // same rule as idempotency_keys_key_check
const TTL = "24 hours"; // 01 §8, 06 §8

/** The header value, or 400. Required on every flow endpoint (3.2 decision D3). */
export function readIdempotencyKey(req: Request): string {
  const key = req.headers.get(IDEMPOTENCY_HEADER);
  const message = !key
    ? "is required on this endpoint (a new UUID per user action)"
    : !KEY_PATTERN.test(key)
      ? "must be 8-128 characters: letters, digits, '-' or '_'"
      : null;
  if (message) {
    throw new AppError("VALIDATION_FAILED", "Invalid request headers.", {
      details: [{ path: `header ${IDEMPOTENCY_HEADER}`, message }],
    });
  }
  return key!;
}

/** JSON with object keys sorted at every level → equal values give equal text. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object" || value instanceof Date) {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const fields = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${fields.join(",")}}`;
}

/**
 * sha256(method + path + canonical validated body). Hashing the VALIDATED body, keys sorted,
 * means whitespace or key order don't make a retry look like a different request.
 */
export function requestFingerprint(req: Request, input: unknown): string {
  const { pathname } = new URL(req.url);
  return createHash("sha256")
    .update(`${req.method} ${pathname}\n${canonicalJson(input)}`)
    .digest("hex");
}

/**
 * Claim the key: the transaction's first statement after lock_timeout.
 *  - No row yet → inserted → we're first: returns its id.
 *  - Same key in a transaction still running → this INSERT waits on the unique index
 *    (bounded by lock_timeout). It commits → no row back (below). It rolls back → we insert.
 *  - Row committed and still valid → the DO UPDATE's WHERE is false → no row back → replay.
 *  - Row committed but expired (cleanup hasn't run yet) → taken over: reset to a fresh
 *    claim, atomically under the row lock.
 */
async function claim(tx: Tx, userId: string, key: string, requestHash: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO idempotency_keys (user_id, key, request_hash, expires_at)
    VALUES (${userId}::uuid, ${key}, ${requestHash}, now() + ${TTL}::interval)
    ON CONFLICT (user_id, key) DO UPDATE
      SET request_hash = EXCLUDED.request_hash,
          response_status = NULL,
          response_body = NULL,
          created_at = now(),
          expires_at = EXCLUDED.expires_at
      WHERE idempotency_keys.expires_at < now()
    RETURNING id`;
  // id = "I own this key now", null = "someone already did this"
  return rows[0]?.id ?? null; // return the inserted or updated key (if current key has expired) or null if there is already a key and is valid.
}

type StoredResponse = { status: number; body: Prisma.JsonValue };

/** The committed duplicate's response. READ COMMITTED: this new statement sees its commit. */
async function loadStored(
  tx: Tx,
  userId: string,
  key: string,
  requestHash: string,
): Promise<StoredResponse> {
  const row = await tx.idempotencyKey.findUnique({
    where: { userId_key: { userId, key } },
    select: { requestHash: true, responseStatus: true, responseBody: true },
  });
  if (row && row.requestHash !== requestHash) {
    throw new AppError(
      "IDEMPOTENCY_KEY_REUSED",
      `This ${IDEMPOTENCY_HEADER} was already used for a different request. Use a new key for each action.`,
    );
  }
  // Committed rows always carry a response (stored before COMMIT; CHECK keeps the pair whole).
  if (!row || row.responseStatus === null || row.responseBody === null) {
    throw internalError(new Error(`idempotency row without a stored response (key ${key})`));
  }
  return { status: row.responseStatus, body: row.responseBody };
}

export type MutationOptions = {
  userId: string;
  /** The validated body; part of the fingerprint. */
  input: unknown;
  /** Success status to send and store (default 200). */
  status?: number;
  constraintErrors?: ConstraintErrors;
};

/**
 * Run a flow mutation with an idempotency key. The route authenticates and validates first
 * (03 §0.2 a–b); `fn` is the service, unchanged, returning `{ value, events? }`.
 *
 *   return runMutation(req, { userId, input, status: 201 }, async (tx) => ({ value: ... }));
 */
export async function runMutation<T>(
  req: Request,
  options: MutationOptions,
  fn: (tx: Tx) => Promise<TxResult<T>>,
): Promise<Response> {
  const key = readIdempotencyKey(req);
  const requestHash = requestFingerprint(req, options.input);
  const status = options.status ?? 200;

  const outcome = await runTx<{ replayed: boolean; status: number; body: unknown }>(
    async (tx) => {
      // claim the id inside the txn, at the beginning.
      const claimId = await claim(tx, options.userId, key, requestHash);
      if (!claimId) {
        // !claimed means there is aleady an idempotency key and it is still valid (not expired)
        // Duplicate: nothing was written in this transaction; send no events (the original sent them).
        return {
          value: { replayed: true, ...(await loadStored(tx, options.userId, key, requestHash)) },
        };
      }

      const result = await fn(tx);
      // Normalize through JSON once (Dates → ISO strings) so the first response and every
      // replay are built from the very same stored value.
      const body = JSON.parse(JSON.stringify({ data: result.value })) as Prisma.InputJsonObject;
      await tx.idempotencyKey.update({
        where: { id: claimId },
        data: { responseStatus: status, responseBody: body },
      });
      return { value: { replayed: false, status, body }, events: result.events };
    },
    { constraintErrors: options.constraintErrors },
  );

  if (outcome.replayed) logger.info("idempotent replay", { status: outcome.status });
  return Response.json(outcome.body, {
    status: outcome.status,
    headers: outcome.replayed ? { [REPLAYED_HEADER]: "true" } : undefined,
  });
}
