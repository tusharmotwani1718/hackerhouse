import "server-only";

import type { AppError } from "./errors";

/** Success envelope: `{ data }`, plus `nextCursor` for paginated lists (05 RD5). */
export function ok<T>(
  data: T,
  init: { status?: number; nextCursor?: string | null; headers?: HeadersInit } = {},
): Response {
  const body = init.nextCursor === undefined ? { data } : { data, nextCursor: init.nextCursor };
  return Response.json(body, { status: init.status ?? 200, headers: init.headers });
}

/** Error envelope: `{ error: { code, message, details?, requestId } }`. */
export function errorResponse(error: AppError, requestId: string): Response {
  return Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined && { details: error.details }),
        requestId,
      },
    },
    { status: error.status, headers: error.headers },
  );
}
