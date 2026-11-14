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

export interface ApiResult {
  status: number;
  data: any;
  error: { code: null | string; message: string; details?: any } | null;
  headers: Headers;
}

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
  { cookie, body, key }: { cookie?: string | null; body?: unknown; key?: string } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (method !== "GET") {
    headers["content-type"] = "application/json";
    headers["idempotency-key"] = key ?? randomUUID(); // mutations require one
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: unknown;
    error?: ApiResult["error"];
  };
  return {
    status: res.status,
    data: json.data ?? null,
    error: json.error ?? null,
    headers: res.headers,
  };
}
