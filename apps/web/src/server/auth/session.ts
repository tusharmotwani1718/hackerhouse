import "server-only";

import { getRequestContext } from "../core/context";
import { AppError } from "../core/errors";
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
 * The signed-in user, or 401. Reads the session (and the user's current role) from the DB on
 * every call — no cookie cache — so sign-out and role changes take effect immediately.
 * Also tags the request context, so every log line for this request carries the user id.
 */
export async function requireUser(req: Request): Promise<AuthSession> {
  const result = await getAuth().api.getSession({ headers: req.headers });
  if (!result) throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");

  const { user, session } = result;
  const context = getRequestContext();
  if (context) context.userId = user.id;

  return {
    user: { id: user.id, email: user.email, name: user.name, role: user.role as Role },
    session: { id: session.id, expiresAt: session.expiresAt },
  };
}

/** The signed-in admin, or 401 / 403. */
export async function requireAdmin(req: Request): Promise<AuthSession> {
  const auth = await requireUser(req);
  if (auth.user.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "Only admins can do this.");
  }
  return auth;
}
