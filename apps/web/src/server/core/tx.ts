import "server-only";

import { Prisma } from "@hacker-house/db";

import { getDb } from "../db";
import { getEnv } from "../env";
import { retryLater } from "./errors";
import { getEventPublisher, type DomainEvent } from "./events";
import { logger } from "./logger";
import { mapDbError, RetryableTxError, type ConstraintErrors } from "./pg-errors";

/** The client to use INSIDE a transaction. Services take this, never `getDb()` (`prisma.` vs `tx.` pitfall). */
export type Tx = Prisma.TransactionClient;

/** Services return their result plus the events to publish once the transaction has committed. */
export type TxResult<T> = { value: T; events?: readonly DomainEvent[] };

export type RunTxOptions = {
  /** Map constraint names to client-facing errors, e.g. `{ teams_name_key: {...} }`. */
  constraintErrors?: ConstraintErrors;
};

const MAX_ATTEMPTS = 2; // one retry for deadlock / serialization failure

/**
 * Read-write transaction (READ COMMITTED) for every mutation (03 §0.2, steps 1–8):
 *  - first statement: SET LOCAL lock_timeout (the only limit that frees a connection
 *    blocked on a lock inside Postgres; Prisma's own timeout can't),
 *  - business errors (AppError) thrown inside roll back and pass through unchanged,
 *  - Postgres errors are mapped (pg-errors.ts); deadlocks are retried once,
 *  - events are published only AFTER COMMIT (I6), never on rollback.
 * Step 3.2 adds the idempotency insert as the first step inside the transaction.
 */
export async function runTx<T>(
  fn: (tx: Tx) => Promise<TxResult<T>>,
  options: RunTxOptions = {},
): Promise<T> {
  // Validated integer from env — safe to inline (SET can't take bind parameters).
  const lockTimeoutMs = getEnv().DATABASE_LOCK_TIMEOUT_MS;

  for (let attempt = 1; ; attempt++) {
    let result: TxResult<T>;
    try {
      result = await getDb().$transaction(async (tx) => {
        // set the lock timeout before running any txn -> neither postgres nor prisma config, set before we run a txn
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${lockTimeoutMs}ms'`);
        return fn(tx);
      });
    } catch (error) {
      const mapped = mapDbError(error, options.constraintErrors);
      if (mapped instanceof RetryableTxError) {
        if (attempt < MAX_ATTEMPTS) {
          logger.warn("transaction retried", { reason: mapped.message, attempt });
          continue;
        }
        throw retryLater(mapped);
      }
      throw mapped;
    }

    // Committed. Publishing must not fail the request: the change is already durable and
    // events are only hints (clients resync), so a publish failure is logged, not thrown.
    if (result.events?.length) {
      try {
        await getEventPublisher().publish(result.events);
      } catch (error) {
        logger.error("event publish failed after commit", { err: error });
      }
    }
    return result.value;
  }
}

/**
 * Read-only snapshot for reads that need several queries to agree (05): REPEATABLE READ
 * + READ ONLY, no locks taken. A write attempted inside fails (25006) → 500 (a bug).
 */
export async function runReadTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await getDb().$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        return fn(tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  } catch (error) {
    throw mapDbError(error);
  }
}
