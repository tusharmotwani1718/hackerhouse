import { randomUUID } from "node:crypto";

import { BASE_URL } from "./env";

export type JoinResult = {
  status: number;
  code: string | null; // error code, if any
  replayed: boolean;
  body: unknown;
  startedAt: number;
  endedAt: number;
};

/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies: each test asserts the
   shape it expects with expect(); typing every endpoint's body here would only add noise. */
export interface ApiResult {
  status: number;
  data: any;
  error: { code: null | string; message: string; details?: any } | null;
  /** Paginated lists: the cursor for the next page, or null on the last page. */
  nextCursor: string | null;
  headers: Headers;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function joinTeam(cookie: string, teamId: string, key = randomUUID()) {
  const startedAt = performance.now();
  const res = await fetch(`${BASE_URL}/api/teams/${teamId}/join`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "idempotency-key": key },
    body: "{}",
  });
  const body = (await res.json()) as { error?: { code: string } };
  return {
    status: res.status,
    code: body.error?.code ?? null,
    replayed: res.headers.get("idempotent-replayed") === "true",
    body,
    startedAt,
    endedAt: performance.now(),
  } satisfies JoinResult;
}

/** Proof that the requests really overlapped: every one had started before the first finished. */
export function allOverlapped(results: JoinResult[]): boolean {
  const lastStart = Math.max(...results.map((r) => r.startedAt));
  const firstEnd = Math.min(...results.map((r) => r.endedAt));
  return lastStart < firstEnd;
}

export function timingSummary(results: JoinResult[]): string {
  const ms = results.map((r) => r.endedAt - r.startedAt).sort((a, b) => a - b);
  const pick = (p: number) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))]!.toFixed(0);
  return `n=${ms.length} p50=${pick(0.5)}ms p95=${pick(0.95)}ms max=${pick(1)}ms`;
}

/** One API call, as a signed-in user (cookie) or anonymous (null). */
export async function api(
  method: string,
  path: string,
  {
    cookie,
    body,
    key,
    headers: extra,
  }: {
    cookie?: string | null;
    body?: unknown;
    key?: string;
    /** Extra request headers, e.g. X-Real-IP (what nginx sets in production). */
    headers?: Record<string, string>;
  } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { ...extra };
  if (cookie) headers.cookie = cookie;
  // DELETE carries no body (9c); every other mutation sends JSON, `{}` by default.
  const sendsBody = method !== "GET" && (method !== "DELETE" || body !== undefined);
  if (sendsBody) headers["content-type"] = "application/json";
  if (method !== "GET") headers["idempotency-key"] = key ?? randomUUID(); // mutations need one
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: sendsBody ? JSON.stringify(body ?? {}) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: unknown;
    error?: ApiResult["error"];
    nextCursor?: string | null;
  };
  return {
    status: res.status,
    data: json.data ?? null,
    error: json.error ?? null,
    nextCursor: json.nextCursor ?? null,
    headers: res.headers,
  };
}
