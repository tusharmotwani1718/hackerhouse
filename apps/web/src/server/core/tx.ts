import "server-only";

import { Prisma } from "@hacker-house/db";

import { getDb } from "../db";
import { getEnv } from "../env";
import { retryLater } from "./errors";
import { getEventBus } from "./bus";
import type { DomainEvent } from "./events";
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

    // Committed. Publishing must neither fail nor DELAY the request (6.1 D5): the change is
    // durable and events are only hints (clients resync), so it runs in the background and a
    // failure is logged. When Redis is down, PUBLISH fails at once (offline queue disabled).
    // Order is kept: this instance's publishes go down one Redis connection in call order.
    if (result.events?.length) {
      const events = result.events;
      void getEventBus()
        .publish(events)
        .then(
          () => logger.debug("events published", { count: events.length }),
          (error: unknown) =>
            logger.warn("event publish failed after commit (clients will resync)", {
              err: error,
              types: events.map((event) => event.type),
            }),
        );
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
