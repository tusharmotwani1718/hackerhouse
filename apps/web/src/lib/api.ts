/**
 * Browser calls to our API (/api/*). Same-origin, so the session cookie goes along. Flow
 * endpoints (register, join, request, redeem) need an Idempotency-Key: one fresh key per user
 * action, so a retried click can't do the action twice (step 3.2).
 */
export type ApiSuccess<T> = { ok: true; status: number; data: T; nextCursor?: string | null };
export type ApiFailure = {
  ok: false;
  status: number;
  code: string;
  message: string;
  /** VALIDATION_FAILED: [{ path, message }] per invalid field. */
  details?: unknown;
};
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export async function api<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    idempotent?: boolean;
  } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.idempotent) headers["Idempotency-Key"] = crypto.randomUUID();

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    return { ok: false, status: 0, code: "NETWORK", message: friendlyMessage("NETWORK") };
  }

  const json = (await response.json().catch(() => null)) as {
    data?: T;
    nextCursor?: string | null;
    error?: { code?: string; message?: string; details?: unknown };
  } | null;
  if (response.ok) {
    return {
      ok: true,
      status: response.status,
      data: json?.data as T,
      nextCursor: json?.nextCursor,
    };
  }
  const code = json?.error?.code ?? "INTERNAL";
  return {
    ok: false,
    status: response.status,
    code,
    message: friendlyMessage(code, json?.error?.message),
    details: json?.error?.details,
  };
}

/** What to tell people for an API error code (falls back to the server's message). */
export function friendlyMessage(code: string, serverMessage?: string): string {
  switch (code) {
    case "NETWORK":
      return "Can't reach the server. Check your connection and try again.";
    case "TEAM_FULL":
      return "This team just filled up.";
    case "ALREADY_IN_TEAM":
      return "You're already in a team in this hackathon.";
    case "NOT_REGISTERED":
      return "Register for this hackathon first.";
    case "REQUEST_ALREADY_PENDING":
      return "You've already asked to join this team.";
    case "PREVIOUSLY_DECLINED":
      return "This team declined your earlier request.";
    case "USE_JOIN":
      return "This team is open now: join it directly.";
    case "APPROVAL_REQUIRED":
      return "This team now needs approval: send a request instead.";
    case "INVITE_REQUIRED":
      return "This team is invite-only: you need its invite code.";
    case "INVALID_CODE":
      return "That invite code isn't valid. It may have been replaced or expired.";
    case "TEAM_NOT_FOUND":
      return "This team no longer exists.";
    case "PROFILE_INCOMPLETE":
      return "Complete your profile first: add your GitHub username and at least one skill.";
    case "RETRY_LATER":
      return "Something went wrong on our side. Please try again in a moment.";
    default:
      return serverMessage ?? "Something went wrong. Please try again.";
  }
}
