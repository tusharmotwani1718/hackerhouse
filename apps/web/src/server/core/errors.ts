import "server-only";

/**
 * Error code registry: every error code the API can return, with its HTTP status.
 * Generic codes live here from the start; each step adds its flow-specific codes
 * (e.g. TEAM_FULL, ALREADY_IN_TEAM) from 03_Operation_Flows.md.
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  /** Same Idempotency-Key reused for a different request (step 3.2). */
  IDEMPOTENCY_KEY_REUSED: 422,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  RETRY_LATER: 503,

  // Hackathons (step 2.1)
  HACKATHON_NOT_FOUND: 404,
  SLUG_TAKEN: 409,

  // Participants (step 2.2)
  PROFILE_INCOMPLETE: 409,
  ALREADY_REGISTERED: 409,
  /** One status everywhere (3.3 D3): the hackathon exists, you just can't act in it yet. */
  NOT_REGISTERED: 403,

  // Teams (step 3.3)
  ALREADY_IN_TEAM: 409,
  TEAM_NAME_TAKEN: 409,

  // Joining (step 3.4)
  TEAM_NOT_FOUND: 404,
  INVITE_REQUIRED: 403,
  APPROVAL_REQUIRED: 409,
  TEAM_FULL: 409,
  /** One error for wrong, malformed, revoked and expired codes (01 §5: no oracle). */
  INVALID_CODE: 404,

  // Leaving (step 3.5)
  NOT_A_MEMBER: 409,

  // Join requests (step 4.2)
  /** The team is OPEN: join directly instead of requesting. */
  USE_JOIN: 409,
  REQUEST_ALREADY_PENDING: 409,
  /** The leader declined an earlier request; no re-request in v1 (R13). */
  PREVIOUSLY_DECLINED: 409,

  // Deciding requests (step 4.3)
  REQUEST_NOT_FOUND: 404,
  /** Only the team's current leader may approve or decline (R4). */
  NOT_LEADER: 403,
  /** Already approved, declined or cancelled; `details` carries the current status. */
  REQUEST_NOT_PENDING: 409,

  // Removing members (step 5.1)
  MEMBER_NOT_FOUND: 404,
  /** The leader can't remove themselves; leaving is a different flow (3.5). */
  CANNOT_REMOVE_SELF: 409,

  // Team settings & invite codes (step 5.3)
  /** The team has no code to revoke (9c) or show (9d). */
  NO_ACTIVE_CODE: 404,
} as const satisfies Record<string, number>;

export type ErrorCode = keyof typeof ERROR_CODES;

export type AppErrorOptions = {
  details?: unknown;
  headers?: Record<string, string>;
  cause?: unknown;
};

/** An error that is safe to show to the client: `code` + `message` (+ optional `details`). */
export class AppError extends Error {
  override readonly name = "AppError";
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly headers?: Record<string, string>;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.details = options.details;
    this.headers = options.headers;
  }

  get status(): number {
    return ERROR_CODES[this.code];
  }
}

/** Generic 500. The real error goes to the log (as `cause`), never to the client. */
export function internalError(cause: unknown): AppError {
  return new AppError("INTERNAL", "Something went wrong. Please try again later.", { cause });
}

/** 503 for overload / contention. Safe to retry: the transaction was rolled back. */
export function retryLater(cause: unknown): AppError {
  return new AppError("RETRY_LATER", "The server is busy. Please retry in a moment.", {
    cause,
    headers: { "Retry-After": "1" },
  });
}
