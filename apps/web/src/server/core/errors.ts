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
