import "server-only";

import { getRequestContext } from "../core/context";
import { AppError } from "../core/errors";
import { enforceLimits } from "../ratelimit/limiter";
import type { RateLimitRuleName } from "../ratelimit/rules";
import { getAuth } from "./auth";

export type Role = "USER" | "ADMIN";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

export type AuthSession = {
  user: AuthUser;
  session: { id: string; expiresAt: Date };
};

/**
 * The user budget a request counts against (06 §4, step 7.2): one per request, never stacked.
 * `stream` = live-stream connects (7.4). `none` = the route enforces its own rules (redeem) — an
 * explicit opt-out.
 */
export type LimitGroup = "read" | "mutation" | "request" | "suggestion" | "stream" | "none";

const GROUP_RULES: Record<Exclude<LimitGroup, "none">, RateLimitRuleName> = {
  read: "read.user",
  mutation: "mutation.user",
  request: "request.user",
  suggestion: "suggestion.user",
  stream: "stream.connect.user", // per user stream connection limit
};

export type RequireUserOptions = {
  /** Default: GET/HEAD → `read`, every other method → `mutation`. */
  limit?: LimitGroup;
};

/**
 * The signed-in user, or 401. Reads the session (and the user's current role) from the DB on
 * every call — no cookie cache — so sign-out and role changes take effect immediately.
 * Also tags the request context, so every log line for this request carries the user id.
 *
 * Rate limited BY DEFAULT (7.2 D1): right after authenticating, the request is counted against
 * the user's budget for its group (or 429). Done here, not in each handler, so a new endpoint
 * can't be forgotten; opting out takes a visible `{ limit: "none" }`. Requests without a valid
 * session are not limited here (no user to count; nginx limits per IP, Phase 11).
 */
export async function requireUser(
  req: Request,
  options: RequireUserOptions = {},
): Promise<AuthSession> {
  const result = await getAuth().api.getSession({ headers: req.headers });
  if (!result) throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");

  const { user, session } = result;
  const context = getRequestContext();
  if (context) context.userId = user.id;

  const group =
    options.limit ?? (req.method === "GET" || req.method === "HEAD" ? "read" : "mutation");
  if (group !== "none") await enforceLimits([{ rule: GROUP_RULES[group], subject: user.id }]);

  return {
    user: { id: user.id, email: user.email, name: user.name, role: user.role as Role },
    session: { id: session.id, expiresAt: session.expiresAt },
  };
}

/** The signed-in admin, or 401 / 403. Rate limited like requireUser (admins have user budgets). */
export async function requireAdmin(
  req: Request,
  options: RequireUserOptions = {},
): Promise<AuthSession> {
  const auth = await requireUser(req, options);
  if (auth.user.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "Only admins can do this.");
  }
  return auth;
}
