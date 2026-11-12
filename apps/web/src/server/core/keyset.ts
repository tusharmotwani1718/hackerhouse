import "server-only";

import { Prisma } from "@hacker-house/db";
import { z } from "zod";

import { AppError } from "./errors";
import { isUuid } from "./validate";

/**
 * Keyset (cursor) pagination helpers (05 RD3), shared by every list: board, All Teams, the
 * leader inbox, my requests.
 *
 * Position = the last row's (created_at, id). created_at has MICROSECOND precision (Postgres
 * clock) but a JS Date only holds milliseconds, so the timestamp travels as the exact text
 * Postgres printed (`cursorTimestamp`) and is parsed back by Postgres — never via Date (3.6:
 * a millisecond cursor silently skipped 20 of 20 rows inside a same-transaction tie). Rows of
 * one transaction share a created_at, so `id` breaks the ties.
 *
 * `k` names the list a cursor belongs to when one endpoint serves several orderings (the inbox:
 * pending oldest-first vs. others newest-first), so a cursor can't be replayed against a list
 * running the other way.
 */
export type KeysetCursor = { c: string; i: string; k?: string };

const cursorSchema = z.object({
  c: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
  i: z.string().refine(isUuid),
  k: z.string().max(40).optional(),
});

export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function invalidCursor(message: string): AppError {
  return new AppError("VALIDATION_FAILED", "Invalid query parameters.", {
    details: [{ path: "cursor", message }],
  });
}

/** Parse a client cursor; `listKey` must match the one it was issued for (if any). */
export function decodeCursor(text: string, listKey?: string): KeysetCursor {
  let cursor: KeysetCursor;
  try {
    cursor = cursorSchema.parse(JSON.parse(Buffer.from(text, "base64url").toString("utf8")));
  } catch {
    throw invalidCursor("is not a valid cursor; use nextCursor as returned");
  }
  if (cursor.k !== listKey) {
    throw invalidCursor("belongs to a different list; start again without a cursor");
  }
  return cursor;
}

/** `column` (e.g. "t.created_at") as UTC text with all 6 fractional digits. Our own column names only. */
export function cursorTimestamp(column: string): Prisma.Sql {
  return Prisma.sql`to_char(${Prisma.raw(column)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

export type SortDirection = "asc" | "desc";

/** `AND (created_at, id) </> (cursor)` for the given direction, or nothing on the first page. */
export function afterCursor(
  cursor: KeysetCursor | null,
  columns: { ts: string; id: string },
  direction: SortDirection,
): Prisma.Sql {
  if (!cursor) return Prisma.empty;
  const op = Prisma.raw(direction === "desc" ? "<" : ">");
  return Prisma.sql`AND (${Prisma.raw(columns.ts)}, ${Prisma.raw(columns.id)}) ${op} (${cursor.c}::timestamptz, ${cursor.i}::uuid)`;
}

/** `ORDER BY created_at <dir>, id <dir>` — both in the same direction, so one index serves it. */
export function keysetOrder(
  columns: { ts: string; id: string },
  direction: SortDirection,
): Prisma.Sql {
  const dir = direction === "desc" ? "DESC" : "ASC";
  return Prisma.raw(`ORDER BY ${columns.ts} ${dir}, ${columns.id} ${dir}`);
}

/**
 * Rows were fetched with LIMIT limit + 1. Returns the page and the cursor for the next one
 * (null when the extra row wasn't there).
 */
export function pageOf<R extends { id: string; cursor_ts: string }>(
  rows: readonly R[],
  limit: number,
  listKey?: string,
): { page: R[]; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > limit && last
      ? encodeCursor({ c: last.cursor_ts, i: last.id, ...(listKey && { k: listKey }) })
      : null;
  return { page, nextCursor };
}
