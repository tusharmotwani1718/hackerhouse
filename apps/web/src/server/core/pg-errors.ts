import "server-only";

import { AppError, internalError, retryLater, type ErrorCode } from "./errors";
import { logger } from "./logger";

/**
 * Postgres errors reach us in two shapes (08_Spike_Results §S3):
 *  - statement errors: PrismaClientKnownRequestError, details in `meta.driverAdapterError.cause`
 *  - errors at COMMIT (deferred constraints): a bare `DriverAdapterError`, details in `cause`
 * Both carry the SQLSTATE in `originalCode`. Map on that, never on Prisma's P-codes alone.
 */
type AdapterCause = {
  originalCode?: string;
  originalMessage?: string;
  constraint?: { index?: string };
};

export type PgError = {
  sqlState: string;
  constraint?: string;
  /** True when the error was raised by COMMIT itself (deferred constraint). */
  atCommit: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export function getPgError(error: unknown): PgError | undefined {
  const err = asRecord(error);
  if (!err) return undefined;

  const meta = asRecord(err.meta);
  const wrapped = asRecord(meta?.driverAdapterError)?.cause as AdapterCause | undefined;
  const bare = err.name === "DriverAdapterError" ? (err.cause as AdapterCause) : undefined;
  const cause = wrapped ?? bare;
  if (!cause?.originalCode) return undefined;

  // CHECK violations carry no structured constraint name; take it from the message.
  const fromMessage = cause.originalMessage?.match(/constraint "([^"]+)"/)?.[1];
  return {
    sqlState: cause.originalCode,
    constraint: cause.constraint?.index ?? fromMessage,
    atCommit: Boolean(bare),
  };
}

/** Constraint name → client-facing error, supplied per call (e.g. teams_name_key → TEAM_NAME_TAKEN). */
export type ConstraintErrors = Record<string, { code: ErrorCode; message: string }>;

/** Thrown internally to ask runTx for one retry (deadlock / serialization failure). */
export class RetryableTxError extends Error {
  override readonly name = "RetryableTxError";
}

function isConnectionWaitTimeout(error: unknown): boolean {
  const err = asRecord(error);
  if (!err) return false;
  if (err.code === "P2028") return true; // Prisma: no connection in time / expired transaction
  return (
    typeof err.message === "string" &&
    err.message.includes("timeout exceeded when trying to connect")
  );
}

/**
 * Turn any error from a DB call into an AppError (or RetryableTxError).
 * AppErrors (business-rule failures thrown inside the transaction) pass through unchanged.
 */
export function mapDbError(error: unknown, constraintErrors: ConstraintErrors = {}): Error {
  if (error instanceof AppError) return error;

  const pg = getPgError(error);
  if (pg) {
    const mapped = pg.constraint ? constraintErrors[pg.constraint] : undefined;
    if (mapped) return new AppError(mapped.code, mapped.message, { cause: error });

    switch (pg.sqlState) {
      case "23505": // unique_violation
        return new AppError("CONFLICT", "This conflicts with existing data.", { cause: error });
      case "23503": // foreign_key_violation
        if (pg.atCommit) break; // deferred FK at COMMIT = our invariant broke → 500 below
        return new AppError("NOT_FOUND", "A referenced resource no longer exists.", {
          cause: error,
        });
      case "40P01": // deadlock_detected — must not happen given lock order I1
      case "40001": // serialization_failure
        return new RetryableTxError(pg.sqlState, { cause: error });
      case "55P03": // lock_not_available (lock_timeout)
        return retryLater(error);
    }
    // 23514 CHECK, deferred FK at COMMIT, 25006 write in read-only tx, anything else:
    // a database safety net caught a bug in our code.
    logger.error("database constraint violation (bug caught by safety net)", {
      sqlState: pg.sqlState,
      constraint: pg.constraint,
      atCommit: pg.atCommit,
    });
    return internalError(error);
  }

  if (isConnectionWaitTimeout(error)) return retryLater(error);
  return internalError(error);
}
